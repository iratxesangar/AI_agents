"""Loader del corpus ficticio y guardrails comunes al retrieval local/gestionado."""
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from app.schemas import KnowledgeInvestigation

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
REQUIRED_METADATA = frozenset({
    "dataset", "domain", "environment", "version", "last_reviewed", "status"
})
REQUIRED_SOURCE_TYPES = frozenset({
    "catalog", "runbook", "deployment_history", "escalation"
})
ALLOWED_SOURCE_TYPES = REQUIRED_SOURCE_TYPES | frozenset({
    "ownership", "distractor", "deprecated_runbook"
})
MAX_REVIEW_AGE_DAYS = 180


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _tokens(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9_]+", _normalize(value))
        if len(token) > 2
    }


def _parse_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError(f"Falta YAML front matter: {path}")
    try:
        end = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration as exc:
        raise ValueError(f"Front matter sin cierre: {path}") from exc
    metadata: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition(":")
        if not separator:
            raise ValueError(f"Metadato inválido en {path}: {line}")
        metadata[key.strip()] = value.strip().strip("\"'")
    missing = REQUIRED_METADATA - set(metadata)
    if missing:
        raise ValueError(
            f"Faltan metadatos requeridos en {path}: {', '.join(sorted(missing))}"
        )
    if metadata["status"] not in {"active", "deprecated"}:
        raise ValueError(f"status inválido en {path}")
    if metadata.get("source_type") not in ALLOWED_SOURCE_TYPES:
        raise ValueError(f"source_type inválido en {path}")
    if not metadata.get("source_id") or not metadata.get("incident_type"):
        raise ValueError(f"Faltan source_id o incident_type en {path}")
    date.fromisoformat(metadata["last_reviewed"])
    return metadata, "\n".join(lines[end + 1:]).strip() + "\n"


def load_knowledge_documents() -> list[dict[str, Any]]:
    """Carga y valida todos los Markdown versionados sin acceder a rutas externas."""
    documents = []
    root = KNOWLEDGE_DIR.resolve()
    for path in sorted(root.rglob("*.md")):
        if root not in path.resolve().parents:
            raise ValueError("Documento fuera del corpus de conocimiento")
        metadata, content = _parse_frontmatter(path)
        documents.append({
            **metadata,
            "uri": path.relative_to(root).as_posix(),
            "title": next(
                (line.lstrip("# ").strip() for line in content.splitlines() if line.startswith("#")),
                path.stem,
            ),
            "content": content,
        })
    if not documents:
        raise ValueError("El corpus de conocimiento está vacío")
    source_ids = [doc["source_id"] for doc in documents]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("source_id debe ser único en todo el corpus")
    return documents


def vector_store_attributes(document: dict[str, Any]) -> dict[str, str | float | bool]:
    """Normaliza atributos escalares para filtros de OpenAI Vector Store."""
    valid_from = document.get("valid_from", "1970-01-01T00:00:00Z")
    valid_to = document.get("valid_to", "2099-12-31T23:59:59Z")
    last_reviewed = date.fromisoformat(document["last_reviewed"])
    return {
        "source_id": document["source_id"],
        "source_type": document["source_type"],
        "dataset": document["dataset"],
        "domain": document["domain"],
        "environment": document["environment"],
        "version": document["version"],
        "last_reviewed": float(last_reviewed.toordinal()),
        "status": document["status"],
        "incident_type": document["incident_type"],
        "uri": document["uri"],
        "title": document["title"],
        "valid_from": datetime.fromisoformat(valid_from.replace("Z", "+00:00")).timestamp(),
        "valid_to": datetime.fromisoformat(valid_to.replace("Z", "+00:00")).timestamp(),
    }


def search_knowledge_documents(
    *,
    query: str,
    dataset_id: str,
    domain: str,
    environment: str,
    incident_type: str,
    as_of: str | None = None,
    source_types: Iterable[str] | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """Simula retrieval con los mismos filtros de metadatos que el vector store."""
    if not query.strip() or not dataset_id.strip():
        raise ValueError("query y dataset_id son obligatorios")
    if limit < 1 or limit > 20:
        raise ValueError("limit debe estar entre 1 y 20")
    selected_types = set(source_types or ALLOWED_SOURCE_TYPES)
    if selected_types - ALLOWED_SOURCE_TYPES:
        raise ValueError("Filtro source_types no permitido")
    reference_time = datetime.fromisoformat(
        as_of.replace("Z", "+00:00")
    ) if as_of else datetime.now(timezone.utc)
    if reference_time.tzinfo is None:
        raise ValueError("as_of debe incluir zona horaria")

    cutoff = (reference_time.date() - timedelta(days=MAX_REVIEW_AGE_DAYS)).toordinal()
    query_terms = _tokens(query)
    candidates = []
    for document in load_knowledge_documents():
        metadata = document
        if metadata["status"] != "active":
            continue
        if metadata["source_type"] not in selected_types:
            continue
        if metadata["dataset"] not in {dataset_id, "*"}:
            continue
        if metadata["domain"] not in {domain, "*"}:
            continue
        if metadata["environment"] not in {environment, "*"}:
            continue
        if metadata["incident_type"] not in {incident_type, "*"}:
            continue
        if date.fromisoformat(metadata["last_reviewed"]).toordinal() < cutoff:
            continue
        valid_from = metadata.get("valid_from", "1970-01-01T00:00:00Z")
        valid_to = metadata.get("valid_to", "2099-12-31T23:59:59Z")
        if reference_time < datetime.fromisoformat(valid_from.replace("Z", "+00:00")):
            continue
        if reference_time > datetime.fromisoformat(valid_to.replace("Z", "+00:00")):
            continue
        searchable = " ".join([
            metadata["title"], metadata["source_id"], metadata["source_type"],
            metadata["dataset"], metadata["domain"], metadata["incident_type"],
            document["content"],
        ])
        matched = query_terms & _tokens(searchable)
        if matched:
            candidates.append({
                **metadata,
                "matched_terms": sorted(matched),
                "score": len(matched),
            })
    candidates.sort(key=lambda item: (-item["score"], item["source_id"]))
    return candidates[:limit]


def abstain(reason: str) -> KnowledgeInvestigation:
    return KnowledgeInvestigation(
        status="abstained",
        summary="No se emite una investigación documental sin respaldo suficiente.",
        abstention_reason=reason,
    )


def validate_grounding(
    investigation: KnowledgeInvestigation,
    retrieved_documents: list[dict[str, Any]],
) -> KnowledgeInvestigation:
    """Valida fuente, metadatos y fragmento literal antes de aceptar la respuesta."""
    if investigation.status == "abstained":
        return investigation
    by_id = {doc["source_id"]: doc for doc in retrieved_documents}
    covered_types = {doc["source_type"] for doc in retrieved_documents}
    if not REQUIRED_SOURCE_TYPES <= covered_types:
        missing = sorted(REQUIRED_SOURCE_TYPES - covered_types)
        return abstain(
            "Faltan fuentes requeridas para una investigación auditable: "
            + ", ".join(missing) + "."
        )
    for citation in investigation.citations:
        source = by_id.get(citation.source_id)
        if source is None:
            return abstain("La respuesta citó una fuente que no se recuperó.")
        if (
            citation.title != source["title"]
            or citation.source_type != source["source_type"]
            or citation.uri != source["uri"]
            or citation.excerpt not in source["content"]
        ):
            return abstain("No se pudo verificar una cita contra el resultado recuperado.")
    for statement in (*investigation.findings, *investigation.recommendations):
        if not set(statement.citation_ids) <= set(by_id):
            return abstain("Un hallazgo o recomendación cita una fuente no recuperada.")
    cited_types = {
        by_id[citation.source_id]["source_type"]
        for citation in investigation.citations
    }
    if not REQUIRED_SOURCE_TYPES <= cited_types:
        return abstain("Las citas no cubren todas las categorías requeridas.")
    return investigation
