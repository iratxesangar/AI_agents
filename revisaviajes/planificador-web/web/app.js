const $ = (id) => document.getElementById(id);
const storageKey = "revisaviajes-local-v1";
const initial = {sheet: {}, route: "", draft: "", version: 0, accepted: 0,
  assumptions: "", questions: "", messages: [], services: null, research: null, comparison: null, review: {}, routeSummary: "", acceptedRoutes: [], serviceDetails: {}, intakeOptionalDone: false};
let state = structuredClone(initial);
try { Object.assign(state, JSON.parse(localStorage.getItem(storageKey)) || {}); } catch {}
if (state.accepted && state.accepted === state.version && state.route && !state.acceptedRoutes.length) {
  state.acceptedRoutes.push({version: state.accepted, route: state.route, date: null, review: {}});
}
let token = "";
let busy = false;
let connection = {model: false, search: false};
const sheetForm = $("sheet");
const persist = () => localStorage.setItem(storageKey, JSON.stringify(state));
let missingServices = {};
const status = (text) => { $("status").textContent = text; };

for (const input of sheetForm.elements) {
  input.maxLength = 1200;
  input.value = state.sheet[input.name] || "";
}
for (const key of ["assumptions", "questions"]) {
  $(key).value = state[key];
  $(key).oninput = () => { state[key] = $(key).value; persist(); };
}
$("route").value = state.draft;

for (const [id, key] of [["service-criterion", "criterio"], ["service-requirements", "requisitos"]]) {
  $(id).value = state.serviceDetails[key] || "";
  $(id).oninput = () => {
    state.serviceDetails[key] = $(id).value;
    state.services = null;
    persist();
  };
}

function renderServiceQuestions() {
  const fields = $("service-missing");
  fields.replaceChildren();
  for (const [key, question] of Object.entries(missingServices)) {
    const label = document.createElement("label");
    label.textContent = question;
    const input = document.createElement(key === "respuesta" ? "textarea" : "input");
    input.value = state.serviceDetails[key] || "";
    input.required = true;
    input.maxLength = 1200;
    input.oninput = () => {
      state.serviceDetails[key] = input.value;
      persist();
    };
    label.append(input);
    fields.append(label);
  }
}

function renderNextStep() {
  const step = nextTripStep(state, connection, Boolean(token), Boolean(Object.keys(missingServices).length));
  document.querySelectorAll("#stages li").forEach((item, index) => {
    if (index + 1 === step.stage) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  $("next-message").textContent = step.field ? "" : step.text;
  $("agent-intake").hidden = !step.field;
  $("agent-question").textContent = step.field ? step.text : "";
  $("skip-intake").hidden = !step.optional;
  $("skip-intake").disabled = busy;
  $("agent-answer").placeholder = step.placeholder || "";
  $("next-action").hidden = !step.action;
  $("next-action").textContent = step.label || "";
  $("next-action").disabled = busy;
  $("agent-answer").disabled = busy;
  return step;
}

$("agent-intake").onsubmit = (event) => {
  event.preventDefault();
  const step = renderNextStep();
  const value = $("agent-answer").value.trim();
  if (!step.field || !value || busy) return;
  const input = sheetForm.elements.namedItem(step.field);
  input.value = value;
  input.dispatchEvent(new Event("input", {bubbles: true}));
  $("agent-answer").value = "";
  state.messages.push({label: "RevisaViajes", text: step.text});
  add("Tú", value);
  if (!$("agent-intake").hidden) $("agent-answer").focus();
};

$("skip-intake").onclick = () => {
  state.intakeOptionalDone = true;
  persist();
  controls();
};

$("next-action").onclick = () => {
  const {action} = renderNextStep();
  if (action === "comparison") {
    const choice = $("messages").querySelector(".choose-route");
    choice?.closest("details")?.scrollIntoView({block: "nearest"});
    return;
  }
  const targets = {manual: "route", review: "review", "pending-services": "service-questions"};
  if (targets[action]) {
    const target = $(targets[action]);
    target.scrollIntoView({block: "center"});
    if (action === "manual") target.focus();
    return;
  }
  if (action) $(action)?.click();
};

function controls() {
  const step = renderNextStep();
  const complete = !step.field;
  const saved = state.route && state.draft.trim() === state.route;
  $("version").textContent = state.version ? "Versión " + state.version : "";
  $("decision").textContent = token ? "Versión " + state.accepted + " aceptada en esta sesión."
    : state.accepted ? "Versión " + state.accepted + " aceptada anteriormente. Confirma de nuevo para buscar."
    : "Aceptación pendiente.";
  for (const button of document.querySelectorAll(".choose-route")) button.disabled = busy || !state.comparison;
  $("save").disabled = busy || !state.draft.trim() || !!saved;
  $("accept").disabled = busy || !saved || !!token;
  $("research").disabled = busy || !complete || !connection.model || !connection.search;
  $("propose").disabled = busy || !complete || !connection.model;
  $("adjust").disabled = busy || !complete || !connection.model || !saved;
  $("services").disabled = busy || !token || !saved || !connection.model || !connection.search;
  $("service-preferences").hidden = !token || !saved;
  $("service-questions").hidden = !token || !saved || !Object.keys(missingServices).length;
  for (const field of $("service-questions").elements) field.disabled = busy;
  $("service-criterion").disabled = busy;
  $("service-requirements").disabled = busy;
  $("summary").disabled = busy;
  $("route").disabled = busy;
  $("note").disabled = busy;
  for (const input of document.querySelectorAll(".review-control")) input.disabled = busy;
  for (const input of sheetForm.elements) input.disabled = busy;
}

const reviewLabels = {
  ritmo: "Ritmo y reparto de noches",
  descanso: "Equilibrio entre actividades y descanso",
  imprescindibles: "Imprescindibles y actividades propuestas",
  presupuesto: "Presupuesto estimado"
};
const reviewQuestions = {
  ritmo: "¿Te encajan el ritmo y el reparto de noches?",
  descanso: "¿Te encaja el equilibrio entre actividades y descanso?",
  imprescindibles: "¿Están tus imprescindibles? ¿Sobra alguna propuesta?",
  presupuesto: "¿Te encaja el presupuesto estimado y lo que queda por comprobar?"
};

function renderReview() {
  $("review").hidden = !state.route;
  $("route-summary").textContent = state.routeSummary ||
    state.route.split("\n").filter((line) => line.trim()).slice(0, 3).join("\n").slice(0, 360);
  const items = $("review-items");
  items.replaceChildren();
  for (const [key, question] of Object.entries(reviewQuestions)) {
    const row = document.createElement(state.review[key] ? "p" : "label");
    row.className = "review-item";
    if (state.review[key]) {
      const change = document.createElement("button");
      change.type = "button";
      change.className = "secondary review-control";
      change.textContent = "Revisar";
      row.append(document.createTextNode(state.review[key] + " "), change);
      change.onclick = () => {
        delete state.review[key];
        invalidate();
        persist();
        renderReview();
        controls();
      };
    } else {
      const confirm = document.createElement("input");
      confirm.type = "checkbox";
      confirm.className = "review-control";
      confirm.setAttribute("aria-label", question);
      confirm.onchange = () => {
        state.review[key] = reviewLabels[key] + " confirmado";
        persist();
        renderReview();
        controls();
      };
      row.append(confirm, question);
    }
    items.append(row);
  }
  $("history").hidden = !state.acceptedRoutes.length;
  const history = $("accepted-routes");
  history.replaceChildren();
  for (const entry of [...state.acceptedRoutes].reverse()) {
    const card = document.createElement("details");
    const title = document.createElement("summary");
    title.textContent = "Versión " + entry.version + (entry.date ? " · " + new Date(entry.date).toLocaleString("es") : "");
    const route = document.createElement("p");
    route.textContent = entry.route;
    card.append(title, route);
    for (const decision of Object.values(entry.review)) {
      const item = document.createElement("p");
      item.textContent = decision;
      card.append(item);
    }
    history.append(card);
  }
}

function render() {
  const log = $("messages");
  log.replaceChildren();
  const messages = state.messages.length ? state.messages : [{
    label: "RevisaViajes", text: "Te acompaño desde la ficha hasta la comparación de servicios. Puedes responder aquí o editar la ficha directamente."
  }];
  for (const message of messages) {
    const container = document.createElement("article");
    container.className = "message" + (message.label === "Tú" ? " user" : "");
    const label = document.createElement("strong");
    label.textContent = message.label;
    const body = document.createElement("p");
    body.textContent = message.text;
    container.append(label, body);
    if (message.sources?.length) {
      const list = document.createElement("ol");
      for (const source of message.sources) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        let url;
        try { url = new URL(source.url); } catch { continue; }
        if (!["https:", "http:"].includes(url.protocol)) continue;
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title;
        const extract = document.createElement("details");
        const heading = document.createElement("summary");
        heading.textContent = "Ver extracto recuperado";
        const text = document.createElement("p");
        text.textContent = source.excerpt;
        extract.append(heading, text);
        item.append(link);
        const metadata = [];
        if (source.consulted) metadata.push("Consulta: " + source.consulted);
        if (source.published) metadata.push("Publicación indicada por la fuente: " + source.published);
        if (source.platform) metadata.push(source.platform + " · fragmento del buscador");
        if (metadata.length) {
          const details = document.createElement("p");
          details.textContent = metadata.join(" · ");
          item.append(details);
        }
        item.append(extract);
        list.append(item);
      }
      container.append(list);
    }
    if (message.routes?.length) {
      const active = state.comparison === message.comparison;
      message.routes.forEach((route, index) => {
        const details = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = route.title + (index + 1 === message.recommended ? " · Recomendada" : "");
        const itinerary = document.createElement("p");
        itinerary.textContent = route.text;
        details.append(title, itinerary);
        if (active) {
          const choose = document.createElement("button");
          choose.type = "button";
          choose.className = "secondary choose-route";
          choose.textContent = "Elegir esta ruta";
          choose.onclick = () => {
            if (busy || state.comparison !== message.comparison) return;
            const carried = message.revision
              ? Object.fromEntries(Object.entries(state.review).filter(([key]) => !route.review_again?.includes(key)))
              : {};
            state.review = carried;
            state.routeSummary = route.summary || route.title;
            state.draft = route.text;
            state.route = route.text;
            $("route").value = route.text;
            state.version++;
            state.comparison = null;
            invalidate();
            add("Propuesta · versión " + state.version,
              route.title + ". Revisa la ruta y acéptala para habilitar la búsqueda de servicios.");
          };
          details.append(choose);
        }
        details.open = index + 1 === message.recommended;
        container.append(details);
      });
    }
    log.append(container);
  }
  log.scrollTop = log.scrollHeight;
  renderReview();
  controls();
}

function add(label, text, sources = [], extra = {}) {
  state.messages.push({label, text, sources, ...extra});
  persist();
  render();
}

function invalidate() {
  token = "";
  state.accepted = 0;
  state.services = null;
  missingServices = {};
  delete state.serviceDetails.respuesta;
  delete state.serviceDetails.fechas;
}

sheetForm.oninput = (event) => {
  state.sheet[event.target.name] = event.target.value;
  state.research = null;
  state.comparison = null;
  state.review = {};
  invalidate();
  persist();
  renderReview();
  controls();
};
$("route").oninput = () => {
  state.draft = $("route").value;
  state.comparison = null;
  invalidate();
  persist();
  controls();
};
$("save").onclick = () => {
  state.route = state.draft.trim();
  state.routeSummary = "";
  state.review = {};
  state.version++;
  invalidate();
  add("Propuesta · versión " + state.version, state.route);
};

async function request(action) {
  const response = await fetch("/api/action", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({action, sheet: state.sheet, route: state.route, note: $("note").value, token, research: state.research, decisions: state.review, service_details: state.serviceDetails})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "La consulta no se pudo completar.");
  return data;
}
async function run(action) {
  if (busy) return;
  busy = true;
  controls();
  status(action === "investigar" ? "Investigando por ciclos. Puede tardar varios minutos." : "Procesando…");
  try {
    const submittedNote = $("note").value;
    const result = await request(action);
    if (action === "servicios" && result.missing) {
      missingServices = result.missing;
      renderServiceQuestions();
      status("Completa solo los datos que faltan.");
      return;
    }
    if (action === "aceptar") {
      token = result.token;
      state.accepted = state.version;
      const entry = {version: state.version, route: state.route, date: new Date().toISOString(),
        review: {...state.review}};
      const last = state.acceptedRoutes.at(-1);
      if (!last || last.version !== entry.version || last.route !== entry.route ||
          JSON.stringify(last.review) !== JSON.stringify(entry.review)) state.acceptedRoutes.push(entry);
      add("Decisión aceptada", "Ruta versión " + state.version +
        ". La aceptación no implica una reserva ni garantiza disponibilidad.");
    } else {
      if (action === "ajustar") {
        add("Tú", submittedNote);
        $("note").value = "";
      }
      if (action === "investigar") {
        state.research = {text: result.text.slice(0, 24000), sources: result.sources.slice(0, 60)};
        state.comparison = null;
      }
      if (action === "servicios") {
        state.services = result;
        missingServices = {};
        renderServiceQuestions();
      }
      if (result.routes) {
        state.comparison = crypto.randomUUID();
        add("Comparación de rutas", result.text, result.sources, {
          routes: result.routes, recommended: result.recommended, comparison: state.comparison,
          revision: action === "ajustar"
        });
      } else {
        add("Resultados de búsqueda", result.text, result.sources);
      }
    }
    status("");
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    controls();
  }
}
$("accept").onclick = () => run("aceptar");
$("research").onclick = () => run("investigar");
$("propose").onclick = () => run("proponer");
$("services").onclick = () => run("servicios");
$("service-questions").onsubmit = (event) => {
  event.preventDefault();
  run("servicios");
};
$("chat").onsubmit = (event) => { event.preventDefault(); run("ajustar"); };
$("summary").onclick = () => {
  const route = state.route || "Por definir";
  const decision = state.accepted ? "Versión " + state.accepted + " aceptada" : "Aceptación pendiente";
  const current = state.services;
  add("Propuesta conjunta",
    "Ruta · " + decision + "\n" + route +
    "\n\nServicios\n" + (current?.text || "Pendientes de búsqueda") +
    "\n\nComprobaciones pendientes\n" + (state.questions || "Horarios, disponibilidad, precios y condiciones aplicables.") +
    (state.assumptions ? "\nSupuestos: " + state.assumptions : "") +
    "\n\nReservas documentadas: ninguna registrada.", current?.sources);
};

render();
fetch("/api/status").then((response) => response.json()).then((value) => {
  connection = value;
  $("connection").textContent = !value.model ? "Modo guiado · Gemini pendiente"
    : value.search ? "Gemini y búsqueda configurados" : "Gemini configurado · búsqueda pendiente";
  controls();
}).catch(() => { $("connection").textContent = "Servidor local no disponible"; });
