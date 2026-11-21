"""Servidor local de RevisaViajes. Solo requiere Python 3.10 o posterior."""
import hashlib
import hmac
import json
import os
import secrets
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from research import ASSESSMENT_PROMPT, investigate
from routes import propose
from services import compare, preflight

ROOT = Path(__file__).resolve().parent
SIGNING_KEY = secrets.token_bytes(32)
FIELDS = ("destino", "fechas", "origen", "viajeros", "presupuesto", "preferencias", "llegada", "salida", "ritmo")
ACTIONS = {"investigar", "proponer", "ajustar", "servicios"}

def config(name, default=""):
    if name in os.environ:
        return os.environ[name]
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == name:
                return value.strip()
    return default

def signature(sheet, route):
    raw = json.dumps([sheet, route], sort_keys=True, ensure_ascii=False).encode()
    return hmac.new(SIGNING_KEY, raw, hashlib.sha256).hexdigest()

def post(url, payload, headers):
    req = Request(url, json.dumps(payload).encode(), {
        "Content-Type": "application/json", **headers,
    })
    try:
        with urlopen(req, timeout=45) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code == 429:
            raise ValueError("El proveedor ha limitado las consultas. Inténtalo más tarde.") from None
        raise ValueError(f"El proveedor respondió con error {exc.code}. Revisa la clave y el modelo.") from None
    except (URLError, TimeoutError):
        raise ValueError("No se pudo conectar con el proveedor.") from None

def search(query):
    response = post("https://api.tavily.com/search", {
        "query": query[:390], "search_depth": "basic", "max_results": 5,
    }, {"Authorization": "Bearer " + config("TAVILY_API_KEY")})
    sources = []
    for item in response.get("results", []):
        url = item.get("url", "")
        parsed = urlsplit(url)
        if parsed.scheme in ("http", "https") and parsed.hostname:
            sources.append({"url": url, "title": item.get("title", url),
                            "excerpt": item.get("content", "")[:1300],
                            "published": item.get("published_date") or ""})
    return sources

def gemini(instructions, payload, structured=False):
    model = config("GEMINI_MODEL", "gemini-3.1-flash-lite")
    if not model or not all(c.isascii() and (c.isalnum() or c in "-_.") for c in model):
        raise ValueError("GEMINI_MODEL no es válido.")
    result = post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", {
        "systemInstruction": {"parts": [{"text": instructions}]},
        "contents": [{"parts": [{"text": json.dumps(payload, ensure_ascii=False)}]}],
        "generationConfig": {
            "maxOutputTokens": 8500 if structured else 2800,
            **({"responseMimeType": "application/json"} if structured else {}),
        },
    }, {"x-goog-api-key": config("GEMINI_API_KEY")})
    candidates = result.get("candidates", [])
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    answer = "\n".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
    if not answer:
        raise ValueError("Gemini no devolvió una respuesta utilizable.")
    return answer

def assess_research(sheet, options, sources, gaps):
    result = gemini(ASSESSMENT_PROMPT, {
        "ficha": sheet,
        "opciones_existentes": [option["nombre"] + " — " + option["zona"] for option in options],
        "lagunas_previas": gaps,
        "fuentes": [{"numero": number, **item} for number, item in enumerate(sources, 1)],
    }, structured=True)
    try:
        assessment = json.loads(result)
    except json.JSONDecodeError:
        raise ValueError("Gemini devolvió una evaluación incompleta. Intenta repetir la investigación.") from None
    if not isinstance(assessment, dict):
        raise ValueError("Gemini devolvió una evaluación no válida.")
    return assessment


def handle(data):
    action = data.get("action")
    raw_sheet = data.get("sheet", {})
    sheet = {field: str(raw_sheet.get(field, "")).strip()[:1200] for field in FIELDS}
    route = str(data.get("route", "")).strip()[:14000]
    note = str(data.get("note", "")).strip()[:2500]
    if action == "aceptar":
        if not route:
            raise ValueError("Guarda una ruta antes de aceptarla.")
        return {"token": signature(sheet, route)}
    if action not in ACTIONS:
        raise ValueError("Acción desconocida.")
    if action != "servicios" and not all(sheet[field] for field in FIELDS[:4]):
        raise ValueError("Completa el destino, las fechas o duración, el origen y los viajeros.")
    if action == "servicios" and (not route or not hmac.compare_digest(
        signature(sheet, route), str(data.get("token", ""))
    )):
        raise ValueError("Acepta explícitamente esta versión de la ruta antes de buscar servicios.")
    if action == "servicios":
        needed, _ = preflight(sheet, data.get("service_details"))
        if needed:
            return {"missing": needed}
    if action == "ajustar" and (not route or not note):
        raise ValueError("Guarda la ruta y escribe qué quieres cambiar.")
    if not config("GEMINI_API_KEY"):
        raise ValueError("Configura GEMINI_API_KEY para usar la planificación automática.")
    if action in ("investigar", "servicios") and not config("TAVILY_API_KEY"):
        raise ValueError("Configura TAVILY_API_KEY para buscar fuentes web.")
    if action == "investigar":
        return investigate(sheet, search, assess_research)
    if action in ("proponer", "ajustar"):
        return propose(sheet, data.get("research"), gemini,
                       current=route if action == "ajustar" else "",
                       comment=note if action == "ajustar" else "",
                       decisions=data.get("decisions") if action == "ajustar" else None)
    return compare(sheet, route, data.get("service_details"), search, gemini)

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, status, value):
        self.respond(status, json.dumps(value).encode(), "application/json")

    def local_host(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def do_GET(self):
        if not self.local_host():
            return self.send_json(403, {"error": "Abre la dirección local indicada."})
        if self.path == "/api/status":
            return self.send_json(200, {"model": bool(config("GEMINI_API_KEY")),
                                        "search": bool(config("TAVILY_API_KEY"))})
        files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                 "/style.css": ("style.css", "text/css"),
                 "/workflow.js": ("workflow.js", "text/javascript")}
        if self.path not in files:
            return self.send_error(404)
        name, mime = files[self.path]
        self.respond(200, (ROOT / "web" / name).read_bytes(), mime + "; charset=utf-8")

    def do_POST(self):
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if (self.path != "/api/action" or not self.local_host()
                or self.headers.get("Origin", origin) != origin
                or self.headers.get_content_type() != "application/json"):
            return self.send_json(403, {"error": "Solicitud local no válida."})
        try:
            count = int(self.headers.get("Content-Length", 0))
            if not 0 < count <= 300_000:
                raise ValueError("Tamaño de solicitud no válido.")
            data = json.loads(self.rfile.read(count))
            if not isinstance(data, dict) or not isinstance(data.get("sheet", {}), dict):
                raise ValueError("La ficha no es válida.")
            self.send_json(200, handle(data))
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})

if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", int(os.getenv("REVISA_PORT", "8765"))), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}"
        print(f"RevisaViajes: {url} · Ctrl+C para cerrar", flush=True)
        if "--no-browser" not in __import__("sys").argv:
            webbrowser.open(url)
        server.serve_forever()
