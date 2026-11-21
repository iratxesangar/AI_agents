const roleTargets = [
  {
    "family": "Technical Project Manager — Data & AI",
    "titles": [
      "technical project manager data ai",
      "technical project manager",
      "data ai project manager"
    ]
  },
  {
    "family": "Analytics Engineer / Senior Analytics Engineer",
    "titles": [
      "senior analytics engineer",
      "analytics engineer"
    ]
  },
  {
    "family": "Data Delivery Manager / Data Program Manager",
    "titles": [
      "data delivery manager",
      "data program manager"
    ]
  },
  {
    "family": "Senior Data Engineer",
    "titles": [
      "senior data engineer"
    ]
  },
  {
    "family": "Technical Program Manager — Data & AI",
    "titles": [
      "technical program manager data ai",
      "technical program manager"
    ]
  },
  {
    "family": "Data Product Owner / Technical Product Owner",
    "titles": [
      "data product owner",
      "technical product owner"
    ]
  },
  {
    "family": "AI Delivery Lead / AI Project Lead / AI Delivery Manager",
    "titles": [
      "ai delivery lead",
      "ai project lead",
      "ai delivery manager",
      "ai program manager"
    ]
  },
  {
    "family": "Data Solutions Architect / Analytics Architect",
    "titles": [
      "data solutions architect",
      "analytics architect"
    ]
  },
  {
    "family": "Data Architect / Data Platform Architect / Cloud Data Architect",
    "titles": [
      "cloud data architect",
      "data platform architect",
      "data architect"
    ]
  },
  {
    "family": "Data Platform Engineer",
    "titles": [
      "data platform engineer"
    ]
  },
  {
    "family": "Data Engineering Lead / Tech Lead",
    "titles": [
      "data engineering lead",
      "engineering tech lead",
      "tech lead"
    ]
  },
  {
    "family": "Applied AI Engineer / LLM Engineer",
    "titles": [
      "applied ai engineer",
      "llm engineer"
    ]
  },
  {
    "family": "AI Solutions Lead / AI Solutions Architect",
    "titles": [
      "ai solutions lead",
      "ai solutions architect"
    ]
  },
  {
    "family": "MLOps / ML Platform Engineer",
    "titles": [
      "ml platform engineer",
      "mlops engineer",
      "mlops"
    ]
  }
];

function salaryBands(env) {
  try {
    const config = JSON.parse(env?.RADAR_SALARY_BANDS ?? "{}");
    return Object.fromEntries(roleTargets.flatMap(({family}) => {
      const band = config?.[family];
      return Array.isArray(band) && band.length === 2 &&
        band.every(value => Number.isFinite(value) && value > 0) && band[0] <= band[1]
        ? [[family, band]] : [];
    }));
  } catch {
    return {};
  }
}

export function safeOfferUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return "";
  try {
    const url = new URL(value.trim());
    return url.username || url.password ? "" : url.href;
  } catch {
    return "";
  }
}

export function salaryValues(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (/(?:[$£]|\b(?:usd|gbp|chf|cad|aud)\b|\b(?:mensual|mes|monthly|hourly|hora|semanal|weekly)\b|\/\s*(?:h|mo|month|hr|mes)\b)/.test(text)) return null;
  const parts = text.match(/^([\d.,]+)\s*(k)?(?:\s*[-–—]\s*([\d.,]+)\s*(k)?)?\s*(?:€|eur)?(?:\s*(?:anuales?|brutos?|\/año))*$/);
  if (!parts) return null;
  const amount = (token, thousands) => {
    if (thousands) return /^\d+(?:[.,]\d+)?$/.test(token) ? Number(token.replace(",", ".")) * 1000 : NaN;
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(token)) return Number(token.replace(/[.,]/g, ""));
    return /^\d+$/.test(token) ? Number(token) : NaN;
  };
  const low = amount(parts[1], parts[2] || parts[4]);
  const high = parts[3] ? amount(parts[3], parts[4]) : low;
  return Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low ? [low, high] : null;
}

function readConfig(value) {
  try { return JSON.parse(value ?? "{}") ?? {}; }
  catch { return {}; }
}

function privateProfile(env) {
  const config = readConfig(env?.RADAR_PRIVATE_PROFILE);
  return {
    display_name: typeof config.display_name === "string" ? config.display_name.trim() : "",
    location: typeof config.location === "string" ? config.location.trim() : "",
    salary_current_eur: Number.isFinite(config.salary_current_eur) && config.salary_current_eur > 0
      ? config.salary_current_eur : null,
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}

function canonicalOfferUrl(value) {
  const safe = safeOfferUrl(value);
  if (!safe) return "";
  const url = new URL(safe);
  for (const name of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$)/i.test(name)) url.searchParams.delete(name);
  }
  if (!url.search && !url.hash && (url.pathname === "/" || /\/(?:careers?|jobs?|employment|vacancies|empleo)\/?$/i.test(url.pathname))) return "";
  url.searchParams.sort();
  // Some boards route to a vacancy through the fragment.
  return url.href;
}

function requisitionKey(offer) {
  const source = String(offer.requisition_source ?? "").trim().toLowerCase();
  const id = String(offer.requisition_id ?? "").trim();
  return source && id ? JSON.stringify([source, id]) : "";
}

function offerUrls(offer) {
  return [...new Set([offer.url, ...(offer.source_urls ?? [])].filter(safeOfferUrl))];
}

function sameOffer(a, b) {
  const left = requisitionKey(a), right = requisitionKey(b);
  if (left && right) return left === right;
  if (a.offer_id && a.offer_id === b.offer_id) return true;
  const aliases = new Set(offerUrls(a).map(canonicalOfferUrl).filter(Boolean));
  return offerUrls(b).some(url => aliases.has(canonicalOfferUrl(url)));
}

function applicationState(offer) {
  return /aplicad|applied|rechaz|en curso|entrevist|rejected|interview/i.test(offer.status || "") || !!offer.dateApplied;
}

function mergeOffer(prior, next, allowStatusEdit = false) {
  const keepApplication = applicationState(prior) && !allowStatusEdit;
  const wasApplication = applicationState(prior);
  const vacancyStatus = next.vacancy_status ||
    (!applicationState(next) ? next.status : null) || prior.vacancy_status;
  return {
    ...prior, ...next,
    requisition_source: requisitionKey(next) ? next.requisition_source : prior.requisition_source,
    requisition_id: requisitionKey(next) ? next.requisition_id : prior.requisition_id,
    url: next.url || prior.url,
    source_urls: [...new Set([...offerUrls(prior), ...offerUrls(next)])],
    vacancy_status: vacancyStatus,
    status: keepApplication ? prior.status : next.status || prior.status || "Nueva",
    dateApplied: (wasApplication && prior.dateApplied) || next.dateApplied || "",
  };
}

const page = (bands, personal) => String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f4ef"><title>Radar Data & AI</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;color:#172b36;background:#f5f4ef;--green:#16735a;--muted:#657780;--line:#e5e9e5;--mint:#e5f3eb}*{box-sizing:border-box}body{margin:0}.app{min-height:100vh;display:grid;grid-template-columns:230px 1fr}aside{background:#142a35;color:#edf5f0;padding:26px 18px;display:flex;flex-direction:column;gap:28px}.brand{font-weight:800;font-size:15px;display:flex;gap:10px;align-items:center}.mark{background:#80cfaa;color:#102d25;border-radius:10px;padding:9px}.brand small{display:block;font-weight:400;color:#a9bbb6;font-size:10px;margin-top:3px}.nav{display:grid;gap:6px}.nav button{border:0;text-align:left;background:none;color:#bdcbc7;padding:11px;border-radius:9px}.nav button.active,.nav button:hover{background:#25414b;color:white}.sideNote{margin-top:auto;border:1px solid #38515a;border-radius:12px;padding:13px;color:#b9cbc6;font-size:11px;line-height:1.55}.sideNote b{display:block;color:white;margin-bottom:5px}.main{padding:32px clamp(18px,4vw,55px);max-width:1450px;width:100%;margin:auto}.top{display:flex;justify-content:space-between;gap:15px;align-items:center}.eyebrow{color:var(--green);font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase}.title{font-size:30px;letter-spacing:-1px;margin:7px 0}.sub{color:var(--muted);font-size:13px;margin:0}.actions{display:flex;gap:8px}.btn{border:1px solid var(--line);background:white;color:#172b36;border-radius:9px;padding:10px 13px;font-weight:700;font-size:11px;cursor:pointer}.btn.primary{background:var(--green);border-color:var(--green);color:white}.banner{background:#fff8e9;border:1px solid #efdfbf;border-radius:12px;padding:13px 15px;margin:20px 0;display:flex;justify-content:space-between;align-items:center;gap:12px}.banner strong{font-size:12px}.banner p{font-size:11px;color:#796747;margin:4px 0 0}.banner a{font-size:11px;font-weight:800;color:#795413;white-space:nowrap;text-decoration:none}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:17px 0}.stat,.panel{background:white;border:1px solid var(--line);border-radius:13px;padding:17px;box-shadow:0 10px 34px #172b3608}.stat label{font-size:10px;color:var(--muted)}.stat b{display:block;font-size:25px;margin:6px 0}.stat small{color:var(--muted);font-size:10px}.grid{display:grid;grid-template-columns:1.25fr .75fr;gap:14px}.head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.head h2{font-size:14px;margin:0}.head p{font-size:10px;color:var(--muted);margin:5px 0 0;line-height:1.5}.tag{font-size:9px;font-weight:800;background:var(--mint);color:#17684c;border-radius:99px;padding:5px 8px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:9px}.card{background:white;border:1px solid var(--line);border-radius:10px;padding:13px;text-align:left;cursor:pointer}.card:hover{border-color:#7dbb9a;background:#fbfefc}.card i{display:grid;place-items:center;width:27px;height:27px;background:var(--mint);color:var(--green);border-radius:8px;font-style:normal;margin-bottom:8px}.card b{font-size:11px;display:block}.card span{font-size:10px;line-height:1.4;color:var(--muted);display:block;margin-top:4px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.field label{display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:5px}.field input,.field select{width:100%;border:1px solid var(--line);border-radius:8px;background:#fbfcfa;padding:9px;font:inherit;font-size:11px}.field input:focus{outline:2px solid #d8efe1}.formline{display:flex;gap:8px;align-items:end;margin-top:10px}.formline .field{flex:1}.plan{display:none;background:#f3f7f4;border:1px solid #deebe2;border-radius:10px;margin-top:14px;padding:13px}.plan.show{display:block}.plan b{font-size:12px}.plan ol{font-size:10px;line-height:1.6;color:#52656a;padding-left:19px}.links{display:flex;flex-wrap:wrap;gap:7px}.links a{font-size:10px;color:#185e4b;text-decoration:none;background:white;border:1px solid #c9e4d3;border-radius:7px;padding:7px}.cycle{display:flex;gap:8px;align-items:end;margin-top:11px}.cycle .field{width:110px}.cycle small{font-size:10px;color:var(--muted);align-self:center}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:13px 0 20px}.chip{font-size:10px;background:#eff4f0;color:#3d5b50;border-radius:99px;padding:6px 8px}.steps{display:grid;gap:11px}.step{display:flex;gap:9px}.step i{font-style:normal;border-radius:50%;width:22px;height:22px;background:var(--mint);color:var(--green);font-size:10px;font-weight:800;display:grid;place-items:center;flex:none}.step b{font-size:11px}.step p{font-size:10px;color:var(--muted);margin:3px 0;line-height:1.4}.tableBox{overflow:auto;margin-top:12px}.table{width:100%;border-collapse:collapse;min-width:640px}.table th{text-align:left;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;padding:9px;border-bottom:1px solid var(--line)}.table td{font-size:10px;padding:11px 9px;border-bottom:1px solid #eff1ee}.table a{font-weight:700;color:#17634f;text-decoration:none}.empty{text-align:center;padding:26px 10px;color:var(--muted);font-size:11px}.view.hidden{display:none}.modalBg{display:none;position:fixed;inset:0;background:#0d263477;z-index:4;place-items:center;padding:15px}.modalBg.show{display:grid}.modal{background:white;border-radius:14px;padding:20px;width:min(490px,100%)}.modal h2{font-size:15px;margin:0 0 12px}.modal .field{margin:10px 0}.modal .field input,.modal .field select{padding:10px}.modalTop{display:flex;justify-content:space-between}.close{border:0;border-radius:50%;width:27px;height:27px;cursor:pointer}.toast{position:fixed;bottom:20px;right:20px;background:#183a31;color:white;padding:10px 14px;border-radius:8px;opacity:0;font-size:11px;transition:.2s}.toast.show{opacity:1}.foot{font-size:10px;color:#829096;margin-top:18px;line-height:1.5}.hidden{display:none!important}
@media(max-width:850px){.app{grid-template-columns:1fr}aside{padding:12px 15px;flex-direction:row;align-items:center;justify-content:space-between;gap:10px}.nav{display:flex}.nav button{font-size:0;padding:8px}.nav button:after{content:attr(data-icon);font-size:14px}.sideNote{display:none}.main{padding:24px 16px}}@media(max-width:620px){.top{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.cards{grid-template-columns:1fr}.fields{grid-template-columns:1fr}.banner{align-items:flex-start;flex-direction:column}.formline{align-items:stretch;flex-direction:column}.cycle{align-items:stretch;flex-wrap:wrap}.cycle .field{width:100%}}
</style></head><body>
<div class="app"><aside><div class="brand"><span class="mark">R</span><span>Radar Data & AI<small>Tu agente de oportunidades</small></span></div><nav class="nav"><button class="active" data-view="home" data-icon="◫">Inicio</button><button data-view="search" data-icon="⌕">Búsqueda</button><button data-view="results" data-icon="▤">Resultados</button><button data-view="apps" data-icon="✓">Candidaturas</button><button data-view="settings" data-icon="⚙">Criterios</button></nav><div class="sideNote"><b>Perfil activo</b>Data Engineer → AI Engineering, arquitectura y liderazgo técnico.<br><br>Los datos se guardan en este navegador. Exporta copias para conservarlos.</div></aside>
<main class="main"><section class="view" id="view-home">
<div class="top"><div><div class="eyebrow">Tu radar profesional</div><h1 class="title">${personal.display_name ? "Buenos días, " + escapeHtml(personal.display_name) : "Radar de ofertas"}</h1><p class="sub">Empresas, puestos y palabras clave en un mismo espacio.</p></div><div class="actions"><button class="btn" id="reloadHistory">Actualizar historial</button><button class="btn" id="export">Exportar</button><button class="btn primary" id="addOpen">＋ Añadir resultado</button></div></div>
<div class="banner"><div><strong>LinkedIn: incorpora ofertas mediante alertas</strong><p>La búsqueda directa desde tu cuenta aún no está disponible. Puedes revisar alertas de LinkedIn y guardar aquí las vacantes.</p></div><a href="https://www.linkedin.com/jobs/" target="_blank" rel="noopener">Abrir LinkedIn Jobs ↗</a></div>
<div class="stats"><div class="stat"><label>Ofertas guardadas</label><b id="jobs">—</b><small>en el historial de Radar</small></div><div class="stat"><label>Candidaturas registradas</label><b id="applicationsCount">—</b><small>aplicadas o con respuesta</small></div><div class="stat"><label>Pendientes de revisar</label><b id="pending">—</b><small>estado, salario o elegibilidad</small></div><div class="stat"><label>Prioritarias</label><b id="priorityCount">—</b><small>más de 55.000 € publicados</small></div><div class="stat"><label>Rondas anotadas</label><b id="rounds">0</b><small>manuales; la tarea horaria se ve en ChatGPT</small></div></div><div id="dataStatus" role="status" aria-live="polite" style="font-size:11px;color:#657780;margin:-5px 0 14px">Cargando historial guardado…</div>
<div class="grid"><div class="panel"><div class="head"><div><h2>Inicia una búsqueda</h2><p>Elige el tipo de búsqueda. Prepara consultas y un plan para ampliar resultados por ciclos.</p></div><span class="tag">ITERATIVA</span></div>
<div class="cards"><button class="card" data-mode="companies_es"><i>⌂</i><b>Empresas tecnológicas en España</b><span>Por sectores, regiones y páginas oficiales de empleo.</span></button><button class="card" data-mode="companies_global"><i>◎</i><b>Empresas tecnológicas globales</b><span>Comprueba remoto y contratación desde España.</span></button><button class="card" data-mode="offers"><i>▣</i><b>Ofertas por puesto</b><span>Data, IA, arquitectura y liderazgo de proyectos.</span></button><button class="card" data-mode="keywords"><i>⌗</i><b>Ofertas por palabras clave</b><span>Coincidencias y variantes en español e inglés.</span></button></div>
<div class="fields"><div class="field"><label>Puesto o sector</label><input id="role" placeholder="Ej. AI Engineer, Data Architect"></div><div class="field"><label>Palabras clave</label><input id="keywords" placeholder="Ej. AI agents, RAG, Databricks"></div></div><div class="formline"><div class="field"><label>Ubicación</label><input id="location" value="España, Europa; remoto global viable"></div><button class="btn primary" id="prepare">Preparar búsqueda ↗</button></div>
<div class="plan" id="plan"><b id="planTitle">Plan de búsqueda</b><ol id="planSteps"></ol><div class="links" id="queryLinks"></div><div class="cycle"><div class="field"><label>Nuevos resultados en esta ronda</label><input id="newCount" type="number" min="0" value="0"></div><button class="btn" id="logRound">Registrar ronda</button><small id="loopStatus">Dos rondas consecutivas sin novedades detienen la búsqueda.</small></div></div></div>
<div class="panel"><div class="head"><div><h2>Criterios activos</h2><p>Filtros usados para clasificar resultados.</p></div><button class="btn" data-goto="settings">Editar</button></div><div class="chips" id="chips"></div><div class="steps"><div class="step"><i>1</i><div><b>Buscar por ciclos</b><p>Amplía títulos, idiomas, países, sectores y fuentes.</p></div></div><div class="step"><i>2</i><div><b>Verificar y deduplicar</b><p>Prioriza vacantes abiertas y páginas oficiales.</p></div></div><div class="step"><i>3</i><div><b>Comprobar encaje</b><p>Valida salario, modalidad y elegibilidad desde España.</p></div></div></div></div></div>
<div class="panel" style="margin-top:14px"><div class="head"><div><h2>Últimos resultados</h2><p>Ofertas y empresas que has guardado.</p></div><button class="btn" data-goto="results">Ver todos</button></div><div id="recent"></div></div>
<p class="foot">El directorio global se construye por etapas y no se presenta como un censo exhaustivo. La web no envía candidaturas ni contacta con empresas.</p></section>
<section class="view hidden" id="view-search"><div class="top"><div><div class="eyebrow">Explorar fuentes</div><h1 class="title">Búsqueda</h1><p class="sub">Prepara consultas, abre las fuentes y registra cada ciclo.</p></div></div><div class="panel"><div class="cards"><button class="card" data-mode="companies_es"><i>⌂</i><b>Empresas en España</b><span>Directorio por sector y región.</span></button><button class="card" data-mode="companies_global"><i>◎</i><b>Empresas globales</b><span>Empresas y política de remoto.</span></button><button class="card" data-mode="offers"><i>▣</i><b>Puestos concretos</b><span>Ofertas y elegibilidad.</span></button><button class="card" data-mode="keywords"><i>⌗</i><b>Palabras clave</b><span>Frases exactas y equivalentes.</span></button></div><p class="sub" style="margin:15px 0">El panel prepara enlaces externos de búsqueda; añade después los resultados que quieras seguir.</p><button class="btn" data-goto="home">Abrir formulario</button></div></section>
<section class="view hidden" id="view-results"><div class="top"><div><div class="eyebrow">Tu pipeline</div><h1 class="title">Resultados guardados</h1><p class="sub">Importa el historial de Ofertas como CSV o JSON; las candidaturas quedarán marcadas.</p></div><div class="actions"><button class="btn" id="import">Importar Ofertas</button><button class="btn primary" id="addOpen2">＋ Añadir</button><input class="hidden" id="file" type="file" accept=".csv,.json,text/csv,application/json"></div></div><div class="panel" style="margin-top:17px"><p class="sub">Desde iCloud Drive, exporta el archivo como CSV o JSON y selecciónalo aquí. La web no tiene conexión directa a iCloud Drive.</p><label class="sub" style="display:block;margin-top:8px"><input type="checkbox" id="markImportedApplied" checked> Si una fila no trae estado, marcarla como «Aplicada» al importar.</label><div class="fields"><div class="field"><label>Filtrar</label><input id="filter" placeholder="Empresa, puesto o ubicación"></div><div class="field"><label>Tipo</label><select id="typeFilter"><option value="all">Todo</option><option value="job">Ofertas</option><option value="company">Empresas</option></select></div></div><div id="all" class="tableBox"></div></div></section>
<section class="view hidden" id="view-apps"><div class="top"><div><div class="eyebrow">Historial de candidaturas</div><h1 class="title">Ya has aplicado</h1><p class="sub">El radar comprobará cada nueva vacante frente a este historial.</p></div><div class="actions"><button class="btn" id="importApps">Importar Ofertas</button><button class="btn primary" id="addApplied">＋ Registrar candidatura</button></div></div><div class="panel" style="margin-top:17px"><p class="sub">Se avisa por URL y coincidencia normalizada de empresa + puesto. Las coincidencias aproximadas quedan marcadas para que puedas revisarlas.</p><div id="applications" class="tableBox"></div></div></section>
<section class="view hidden" id="view-settings"><div class="top"><div><div class="eyebrow">Configuración</div><h1 class="title">Tus criterios</h1><p class="sub">Se guardan localmente en este navegador.</p></div></div><div class="panel" style="margin-top:17px"><h2 style="font-size:14px">Filtros profesionales</h2><div class="fields"><div class="field"><label>Salario objetivo mínimo (€ brutos/año)</label><input id="salarySet" type="number"></div><div class="field"><label>Objetivo de resultados</label><input id="targetSet" type="number"></div></div><div class="field" style="margin-top:12px"><label>Puestos objetivo (separados por comas)</label><input id="rolesSet"></div><div class="field" style="margin-top:12px"><label>Ubicaciones y modalidad</label><input id="locationsSet"></div><div class="field" style="margin-top:12px"><label>Palabras clave</label><input id="keywordsSet"></div><button class="btn primary" style="margin-top:13px" id="saveSettings">Guardar criterios</button></div><div class="panel" style="margin-top:14px"><h2 style="font-size:14px">Bandas salariales esperadas por familia</h2><p class="sub">Rangos de salario fijo bruto anual del documento de estrategia; en cada oferta se compara el salario publicado con esta banda y, por separado, con el objetivo general de más de 55.000 €.</p><div id="salaryBands" class="tableBox"></div></div><div class="panel" style="margin-top:14px"><h2 style="font-size:14px">Reglas de clasificación</h2><div class="steps" style="margin-top:14px"><div class="step"><i>1</i><div><b>Salario</b><p>Excluir bandas inferiores; marcar «por confirmar» las que cruzan el umbral.</p></div></div><div class="step"><i>2</i><div><b>Elegibilidad</b><p>Confirmar que una oferta remota internacional permite contratar desde España.</p></div></div><div class="step"><i>3</i><div><b>Híbrido</b><p>Fuera de España, aceptar solo 1–2 días presenciales por semana.</p></div></div><div class="step"><i>4</i><div><b>Puntuación de encaje</b><p>Experiencia 30%, evolución 25%, salario 20%, modalidad 15%, aprendizaje 10%.</p></div></div></div></div></section></main></div>
<div class="modalBg" id="modal"><form class="modal" id="form"><div class="modalTop"><h2>Añadir resultado</h2><button type="button" class="close" id="close">×</button></div><div class="field"><label>Tipo</label><select id="kind"><option value="job">Oferta</option><option value="company">Empresa</option></select></div><div class="field"><label>Empresa</label><input id="company" required></div><div class="field" id="titleField"><label>Puesto</label><input id="title"></div><div class="field"><label>Ubicación y modalidad</label><input id="place" placeholder="España · remoto"></div><div class="field"><label>Salario publicado</label><input id="salary" placeholder="Ej. 60.000–70.000 €/año"></div><div class="field"><label>URL de la fuente</label><input id="url" type="url" placeholder="https://..."></div><div class="field"><label>Estado</label><select id="status"><option>Verificada</option><option>Por confirmar</option><option>Seguimiento</option><option>Aplicada</option></select></div><div class="field hidden" id="dateAppliedWrap"><label>Fecha de candidatura</label><input id="dateApplied" type="date"></div><div id="duplicateNotice" class="hidden" style="background:#fff5df;border:1px solid #eed9a8;padding:10px;border-radius:8px;font-size:11px;color:#765315;margin:10px 0"></div><button class="btn primary">Guardar</button></form></div><div class="toast" id="toast"></div>
<script>
${safeOfferUrl.toString().replace(/^export /, "")}
${canonicalOfferUrl.toString()}
${requisitionKey.toString()}
${offerUrls.toString()}
${sameOffer.toString()}
${applicationState.toString()}
${mergeOffer.toString()}
${score.toString()}
${salaryValues.toString().replace(/^export /, "")}
const ROLE_TARGETS=${JSON.stringify(roleTargets.map(role => ({...role, min: bands[role.family]?.[0], max: bands[role.family]?.[1]})))};const roleTargets=ROLE_TARGETS;const DEFAULT={salary:55000,target:50,roles:ROLE_TARGETS.map(x=>x.family),roleCatalogVersion:2,locations:"España y Europa, remoto prioritario; remoto global si contrata desde España; híbrido internacional solo 1–2 días/semana",keywords:[]};const KEY="radar-data-ai-v1";let data;try{data=JSON.parse(localStorage.getItem(KEY))||{settings:DEFAULT,items:[],rounds:[]}}catch{data={settings:DEFAULT,items:[],rounds:[]}}if(data.settings&&data.settings.roleCatalogVersion!==2){data.settings={...DEFAULT,...data.settings,roles:DEFAULT.roles,roleCatalogVersion:2};localStorage.setItem(KEY,JSON.stringify(data))}for(const item of data.items){if(!item.offer_id)item.offer_id="local:"+crypto.randomUUID()}let mode="offers",quiet=0;
function save(){localStorage.setItem(KEY,JSON.stringify(data));draw();fetch("/api/offers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({offers:data.items.filter(x=>x.company&&x.title)})}).then(r=>{if(!r.ok)throw new Error("Error al guardar")}).catch(()=>say("Cambios locales pendientes de sincronizar"))}function esc(v){return String(v||"").replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]))}function say(t){let e=document.querySelector("#toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2200)}
function go(v){document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));document.querySelector("#view-"+v).classList.remove("hidden");document.querySelectorAll(".nav button").forEach(x=>x.classList.toggle("active",x.dataset.view===v));drawTables();drawApplications()}document.querySelectorAll(".nav button").forEach(x=>x.onclick=()=>go(x.dataset.view));document.querySelectorAll("[data-goto]").forEach(x=>x.onclick=()=>go(x.dataset.goto));
function setInputs(){document.querySelector("#salarySet").value=data.settings.salary;document.querySelector("#targetSet").value=data.settings.target;document.querySelector("#rolesSet").value=data.settings.roles.join(", ");document.querySelector("#locationsSet").value=data.settings.locations;document.querySelector("#keywordsSet").value=(data.settings.keywords||[]).join(", ")}document.querySelector("#saveSettings").onclick=()=>{data.settings={salary:Number(document.querySelector("#salarySet").value)||55000,target:Number(document.querySelector("#targetSet").value)||50,roles:document.querySelector("#rolesSet").value.split(",").map(x=>x.trim()).filter(Boolean),locations:document.querySelector("#locationsSet").value,keywords:document.querySelector("#keywordsSet").value.split(",").map(x=>x.trim()).filter(Boolean)};save();say("Criterios guardados")};
function prepare(m){mode=m||mode;go("home");let selectedRole=document.querySelector("#role").value.trim(),roles=selectedRole?[selectedRole]:data.settings.roles,role=selectedRole||"todas las familias priorizadas",kw=document.querySelector("#keywords").value.trim()||(data.settings.keywords||[]).join(" "),loc=document.querySelector("#location").value.trim()||"Spain";let titles={companies_es:"Empresas tecnológicas en España",companies_global:"Empresas globales y contratación remota",offers:"Ofertas para "+(selectedRole||roles.length+" familias prioritarias"),keywords:"Ofertas con palabras clave: "+(kw||role)};document.querySelector("#planTitle").textContent=titles[mode];let company=mode.startsWith("companies"),steps=company?["Divide la búsqueda por sector y región; empieza por directorios y fuentes oficiales.","Comprueba página de empleo, modalidad y vacantes actuales.","Registra cada empresa y deduplica por dominio; señala la cobertura pendiente."]:["Ciclo 1: prioriza ofertas publicadas en las últimas 24 horas; amplía a 72 horas y después a 7 días si faltan resultados.","Abre cada fuente: confirma fecha, estado abierto y enlace/formulario que acepte candidaturas.","Deduplica, puntúa y repite consultas; detente tras dos ciclos consecutivos sin nuevas ofertas verificadas."];document.querySelector("#planSteps").innerHTML=steps.map(x=>"<li>"+esc(x)+"</li>").join("");let q=mode==="companies_es"?"empresas tecnológicas España "+kw:mode==="companies_global"?"technology companies hiring remote from Spain "+kw:mode==="keywords"?(kw||role)+" jobs "+loc:roles.map(x=>"\""+x+"\"").join(" OR ")+" jobs "+loc;let q2=company?q+" careers remote":q+" site:linkedin.com/jobs/view OR site:jobs.lever.co OR site:boards.greenhouse.io";let kwLI=mode==="keywords"?(kw||role):roles.map(x=>"\""+x+"\"").join(" OR ");let since7=new Date(Date.now()-7*86400000).toISOString().slice(0,10),liBase="https://www.linkedin.com/jobs/search/?keywords="+encodeURIComponent(kwLI)+"&location="+encodeURIComponent(loc),urls=[["Web · últimos 7 días","https://www.google.com/search?q="+encodeURIComponent(q+" after:"+since7)],["Páginas de empleo · últimos 7 días","https://www.google.com/search?q="+encodeURIComponent(q2+" after:"+since7)],["LinkedIn · últimas 24 h",liBase+"&f_TPR=r86400"],["LinkedIn · últimas 72 h",liBase+"&f_TPR=r259200"],["LinkedIn · últimos 7 días",liBase+"&f_TPR=r604800"]];document.querySelector("#queryLinks").innerHTML=urls.map(x=>'<a target="_blank" rel="noopener" href="'+x[1]+'">'+x[0]+' ↗</a>').join("");document.querySelector("#plan").classList.add("show");document.querySelector("#loopStatus").textContent="Ventanas: 24 h → 72 h → 7 días. Confirma que cada candidatura sigue abierta; objetivo: "+data.settings.target+" ofertas. Para tras dos rondas sin novedades.";document.querySelector("#plan").scrollIntoView({behavior:"smooth",block:"nearest"})}
document.querySelectorAll(".card").forEach(x=>x.onclick=()=>prepare(x.dataset.mode));document.querySelector("#prepare").onclick=()=>prepare(mode);document.querySelector("#logRound").onclick=()=>{let n=Math.max(0,Number(document.querySelector("#newCount").value)||0);data.rounds.push({date:new Date().toISOString(),mode:mode,newItems:n});quiet=n===0?quiet+1:0;save();document.querySelector("#loopStatus").textContent=quiet>=2?"Parada: dos rondas consecutivas sin novedades.":"Ronda guardada · "+n+" nuevos · "+quiet+"/2 sin novedades.";say("Ronda registrada")};
function normalized(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(s\.?a\.?|s\.?l\.?|inc|ltd|limited|gmbh|group|company|the)\b/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function applied(x){let s=(x?.status||"").toLowerCase();return x&&(s.includes("aplicad")||s.includes("applied")||s.includes("en curso")||s.includes("rechaz")||s.includes("rejected")||s.includes("entrevist")||s.includes("interview")||s.includes("enviad")||s.includes("submitted")||x.applied===true||!!x.dateApplied)}
function applicationStatus(x){let s=String(x?.status||"").toLowerCase();if(s.includes("rechaz"))return "Rechazado";if(s.includes("curso")||s.includes("entrevist"))return "En curso";return "Aplicado"}
function titleOverlap(a,b){let aa=new Set(normalized(a).split(" ").filter(x=>x.length>2)),bb=new Set(normalized(b).split(" ").filter(x=>x.length>2));if(!aa.size||!bb.size)return false;let both=[...aa].filter(x=>bb.has(x)).length;return both/Math.min(aa.size,bb.size)>=.65}
function priorApplication(company,title,url){return data.items.find(x=>applied(x)&&sameOffer(x,{company,title,url}))}
function roleTarget(title){let t=normalized(title);return ROLE_TARGETS.map(x=>({target:x,score:Math.max(0,...x.titles.map(a=>t.includes(normalized(a))?normalized(a).length:0))})).sort((a,b)=>b.score-a.score).find(x=>x.score)?.target||null}function salaryComparison(text,title){let target=roleTarget(title);if(!target||target.min==null||target.max==null)return "Familia sin banda";let n=salaryValues(text);if(!n)return "Salario sin dato";let [lo,hi]=n;if(hi<target.min)return "Por debajo de banda";if(lo>target.max)return "Por encima de banda";if(lo>=target.min&&hi<=target.max)return "Dentro de banda";return "Coincide parcialmente"}function moneyBand(x){return (x/1000).toLocaleString("es-ES")+"k €"}function renderSalaryBands(){let e=document.querySelector("#salaryBands");if(!e)return;e.innerHTML='<table class="table"><thead><tr><th>Familia prioritaria</th><th>Expectativa fija bruta anual</th></tr></thead><tbody>'+ROLE_TARGETS.map(x=>'<tr><td>'+esc(x.family)+'</td><td>'+moneyBand(x.min)+'–'+moneyBand(x.max)+'</td></tr>').join("")+'</tbody></table>'}function table(items,canDelete=true,editableStatus=false){if(!items.length)return '<div class="empty">Aún no hay resultados guardados. Importa Ofertas o añade una candidatura para empezar.</div>';let statusCell=(x,i)=>editableStatus?'<select class="statusSelect" data-status="'+i+'">'+["Rechazado","Aplicado","En curso"].map(v=>'<option value="'+v+'"'+(applicationStatus(x)===v?' selected':'')+'>'+v+'</option>').join("")+'</select>':esc(x.status||"Seguimiento");return '<table class="table"><thead><tr><th>Empresa / puesto</th><th>Tipo</th><th>Ubicación</th><th>Estado</th><th>Fuente</th>'+(canDelete?'<th>Acciones</th>':'')+'</tr></thead><tbody>'+items.map((x,i)=>'<tr><td><b>'+esc(x.company)+'</b>'+(x.title?'<br>'+esc(x.title):"")+(x.dateApplied?'<br><small>Aplicada: '+esc(x.dateApplied)+'</small>':"")+'</td><td>'+(x.type==="company"?"Empresa":"Oferta")+'</td><td>'+esc(x.location||"—")+(x.salary?'<br>'+esc(x.salary):"")+(roleTarget(x.title)?'<br><small>Expectativa: '+moneyBand(roleTarget(x.title).min)+'–'+moneyBand(roleTarget(x.title).max)+' · '+salaryComparison(x.salary,x.title)+' · objetivo general &gt; 55k €</small>':"")+'</td><td>'+statusCell(x,i)+'</td><td>'+(safeOfferUrl(x.url)?'<a href="'+esc(safeOfferUrl(x.url))+'" target="_blank" rel="noopener">Abrir ↗</a>':"—")+'</td>'+(canDelete?'<td style="white-space:nowrap">'+(x.type!=="company"&&!applied(x)?'<button class="btn" data-applied="'+i+'">Marcar aplicada</button> ':'')+'<button class="btn" data-del="'+i+'">Eliminar</button></td>':'')+'</tr>').join("")+'</tbody></table>'}
function drawTables(){let items=[...data.items].reverse();let recent=items.slice(0,5);let r=document.querySelector("#recent");if(r)r.innerHTML=table(recent,false);let f=(document.querySelector("#filter")?.value||"").toLowerCase(),t=(document.querySelector("#typeFilter")?.value||"all");let all=items.filter(x=>(t==="all"||x.type===t)&&(x.company+" "+(x.title||"")+" "+(x.location||"")).toLowerCase().includes(f));let target=document.querySelector("#all");if(target)target.innerHTML=table(all,true);document.querySelectorAll("#all [data-applied]").forEach(b=>b.onclick=()=>{let item=all[Number(b.dataset.applied)];if(!item)return;item.status="Aplicado";item.dateApplied=new Date().toISOString().slice(0,10);save();say("Candidatura registrada")});document.querySelectorAll("#all [data-del]").forEach(b=>b.onclick=()=>{let item=all[Number(b.dataset.del)];data.items=data.items.filter(x=>x!==item);save();say("Resultado eliminado")})}
function drawApplications(){let target=document.querySelector("#applications");if(!target)return;let apps=data.items.filter(applied).slice().reverse();target.innerHTML=table(apps,false,true);target.querySelectorAll("[data-status]").forEach(sel=>sel.onchange=async()=>{let item=apps[Number(sel.dataset.status)];if(!item)return;let previous=item.status;item.status=sel.value;localStorage.setItem(KEY,JSON.stringify(data));draw();try{let r=await fetch("/api/offers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({offers:[item],edit_application:true})}),v=await r.json();if(!r.ok)throw new Error(v.error||("HTTP "+r.status));say("Estado de candidatura guardado")}catch(e){item.status=previous;localStorage.setItem(KEY,JSON.stringify(data));draw();say("No se pudo guardar el estado; inténtalo de nuevo")}})}
function draw(){let offers=data.items.filter(x=>x.type!=="company");document.querySelector("#jobs").textContent=offers.length;document.querySelector("#priorityCount").textContent=offers.filter(x=>!applied(x)&&score(x).priority).length;document.querySelector("#applicationsCount").textContent=offers.filter(applied).length;document.querySelector("#pending").textContent=offers.filter(x=>!applied(x)&&/confirm|desconoc|no publicado|pendiente/i.test([x.status,x.salary,x.salary_comparison,x.salary_vs_general_target].filter(Boolean).join(" "))).length;document.querySelector("#rounds").textContent=data.rounds.length;document.querySelector("#chips").innerHTML='<span class="chip">Salario &gt; '+Number(data.settings.salary).toLocaleString("es-ES")+' €</span><span class="chip">'+data.settings.roles.length+' familias profesionales</span><span class="chip">España · Europa · remoto viable</span><span class="chip">'+data.settings.target+' resultados objetivo</span>';setInputs();renderSalaryBands();drawTables();drawApplications()}
document.querySelector("#filter").oninput=drawTables;document.querySelector("#typeFilter").onchange=drawTables;
function open(){document.querySelector("#modal").classList.add("show");document.querySelector("#duplicateNotice").classList.add("hidden")}function close(){document.querySelector("#modal").classList.remove("show");document.querySelector("#form").reset();document.querySelector("#dateAppliedWrap").classList.add("hidden");document.querySelector("#duplicateNotice").classList.add("hidden")}document.querySelector("#addOpen").onclick=open;document.querySelector("#addOpen2").onclick=open;document.querySelector("#addApplied").onclick=()=>{open();document.querySelector("#kind").value="job";document.querySelector("#status").value="Aplicada";document.querySelector("#dateAppliedWrap").classList.remove("hidden");document.querySelector("#dateApplied").value=new Date().toISOString().slice(0,10)};document.querySelector("#close").onclick=close;document.querySelector("#kind").onchange=e=>document.querySelector("#titleField").classList.toggle("hidden",e.target.value==="company");document.querySelector("#status").onchange=e=>{let show=e.target.value==="Aplicada";document.querySelector("#dateAppliedWrap").classList.toggle("hidden",!show);if(show&&!document.querySelector("#dateApplied").value)document.querySelector("#dateApplied").value=new Date().toISOString().slice(0,10)};
function updateDuplicateNotice(){let match=priorApplication(document.querySelector("#company").value,document.querySelector("#title").value,document.querySelector("#url").value);let box=document.querySelector("#duplicateNotice");if(match){box.textContent="⚠ Ya consta una candidatura a «"+(match.title||"este puesto")+"» en "+match.company+(match.dateApplied?" ("+match.dateApplied+")":"")+". Comprueba la ficha antes de guardar otra fuente.";box.classList.remove("hidden")}else box.classList.add("hidden")}
document.querySelector("#company").addEventListener("input",updateDuplicateNotice);document.querySelector("#title").addEventListener("input",updateDuplicateNotice);document.querySelector("#url").addEventListener("input",updateDuplicateNotice);
document.querySelector("#form").onsubmit=e=>{e.preventDefault();let url=document.querySelector("#url").value.trim(),company=document.querySelector("#company").value.trim(),title=document.querySelector("#title").value.trim(),status=document.querySelector("#status").value,type=document.querySelector("#kind").value;if(url&&!safeOfferUrl(url)){say("Introduce un enlace HTTP o HTTPS válido");return}if(url&&data.items.some(x=>x.url===url)){say("Esta URL ya está guardada");return}let match=type==="job"?priorApplication(company,title,url):null;if(match&&status!=="Aplicada"&&!confirm("Ya aplicaste a «"+(match.title||title)+"» en "+match.company+(match.dateApplied?" el "+match.dateApplied:"")+". ¿Quieres guardar igualmente esta fuente como referencia?"))return;let dateApplied=status==="Aplicada"?(document.querySelector("#dateApplied").value||new Date().toISOString().slice(0,10)):"";const item={offer_id:"local:"+crypto.randomUUID(),type,company,title,location:document.querySelector("#place").value.trim(),salary:document.querySelector("#salary").value.trim(),url,status,dateApplied,date:new Date().toISOString()};const existing=data.items.findIndex(old=>sameOffer(old,item));if(existing===-1)data.items.push(item);else data.items[existing]=mergeOffer(data.items[existing],{...item,offer_id:data.items[existing].offer_id});save();close();say(match?"Aviso de candidatura revisado":"Resultado guardado")};
function parseCSV(text){let first=text.split(/\r?\n/,1)[0]||"",delims=[",",";","\t"],delimiter=delims.sort((a,b)=>first.split(b).length-first.split(a).length)[0],rows=[],row=[],field="",quoted=false;for(let i=0;i<text.length;i++){let c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"')quoted=true;else if(c===delimiter){row.push(field);field=""}else if(c==="\n"){row.push(field);rows.push(row);row=[];field=""}else if(c!=="\r")field+=c}if(field||row.length){row.push(field);rows.push(row)}if(!rows.length)return[];let heads=rows.shift().map(x=>normalized(x));return rows.filter(r=>r.some(x=>String(x).trim())).map(r=>Object.fromEntries(heads.map((h,i)=>[h,String(r[i]||"").trim()]))) }
function getField(row,names){for(let n of names){let v=row[normalized(n)];if(v)return v}return ""}function toImportItem(x,forceApplied){let company=getField(x,["company","empresa","compania","organizacion","employer","organization"]),title=getField(x,["title","puesto","cargo","position","job title","vacante","role"]),url=getField(x,["url","enlace","link","job url","oferta"]),rawStatus=getField(x,["status","estado","application status","estado candidatura"]),dateApplied=getField(x,["date applied","fecha aplicacion","fecha de aplicacion","application date","applied on","applied date"]),status=rawStatus||((dateApplied||forceApplied)?"Aplicada":"Seguimiento");if(/applied|aplicad|enviad|submitted/i.test(status))status="Aplicada";return company?{offer_id:x["offer id"]||"local:"+crypto.randomUUID(),requisition_source:getField(x,["requisition source"]),requisition_id:getField(x,["requisition id"]),type:"job",company,title,location:getField(x,["location","ubicacion","localizacion"]),salary:getField(x,["salary","salario","compensacion"]),url,status,dateApplied,date:new Date().toISOString()}:null}
function importRows(rows){let n=0,dups=0,invalidUrls=0,force=document.querySelector("#markImportedApplied")?.checked!==false;for(let x of rows){let item=toImportItem(x,force);if(!item)continue;if(item.url&&!safeOfferUrl(item.url)){invalidUrls++;continue}let index=data.items.findIndex(old=>sameOffer(old,item));if(index!==-1){let old=data.items[index];data.items[index]=mergeOffer(old,{...item,offer_id:old.offer_id});dups++;continue}data.items.push(item);n++}save();say(n+" candidaturas importadas · "+dups+" duplicadas omitidas · "+invalidUrls+" enlaces inválidos omitidos")}
document.querySelector("#export").onclick=()=>{let a=document.createElement("a"),u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.href=u;a.download="radar-data-ai-resultados.json";a.click();URL.revokeObjectURL(u)};document.querySelector("#import").onclick=()=>document.querySelector("#file").click();document.querySelector("#importApps").onclick=()=>document.querySelector("#file").click();document.querySelector("#file").onchange=async e=>{try{let file=e.target.files[0];if(!file)return;let text=await file.text(),rows;if(file.name.toLowerCase().endsWith(".csv")){rows=parseCSV(text)}else{let j=JSON.parse(text);rows=Array.isArray(j)?j:(j.applications||j.items||j.offers||[]);rows=rows.map(x=>({"offer id":x.offer_id,"requisition source":x.requisition_source,"requisition id":x.requisition_id,company:x.company||x.empresa||x.employer,title:x.title||x.puesto||x.position||x.role,url:x.url||x.link||x.enlace,status:x.status||x.estado||x.applicationStatus,"date applied":x.dateApplied||x.applicationDate||x.fechaAplicacion,location:x.location||x.ubicacion,salary:x.salary||x.salario}))}importRows(rows)}catch{say("No se pudo leer el archivo. Usa CSV o JSON.")}e.target.value=""};
async function loadOffers(){let status=document.querySelector("#dataStatus");if(status)status.textContent="Cargando ofertas del historial guardado…";try{let r=await fetch("/api/offers",{cache:"no-store"}),v=await r.json();if(!r.ok)throw new Error(v.error||("Error HTTP "+r.status));if(!Array.isArray(v.offers))throw new Error("La respuesta del historial no contiene una lista de ofertas");const all=v.offers.map(x=>({...x,type:x.type||"job"}));for(const x of data.items){const index=all.findIndex(old=>sameOffer(old,x));if(index===-1)all.push(x);else all[index]=mergeOffer(x,all[index],true)}data.items=all;localStorage.setItem(KEY,JSON.stringify(data));draw();if(status)status.textContent="Historial sincronizado · "+data.items.filter(x=>x.type!=="company").length+" ofertas disponibles"}catch(e){if(status)status.textContent="No se pudo cargar el historial guardado. Comprueba tu conexión y pulsa «Actualizar historial».";console.error("Radar: no se pudo cargar /api/offers",e)}}
draw();document.querySelector("#reloadHistory").onclick=loadOffers;loadOffers();
</script></body></html>`;

const toolDefinitions = [
 {name:"get_search_profile",description:"Devuelve los criterios configurados para las búsquedas de empleo.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"build_search_plan",description:"Genera consultas y un protocolo iterativo para buscar empresas u ofertas.",inputSchema:{type:"object",properties:{mode:{type:"string",enum:["companies_es","companies_global","offers","keywords"]},roles:{type:"array",items:{type:"string"}},keywords:{type:"array",items:{type:"string"}},location:{type:"string"},target_count:{type:"integer",minimum:1,maximum:100}},required:["mode"],additionalProperties:false}},
 {name:"get_offer_history",description:"Devuelve ofertas guardadas y candidaturas ya registradas para comprobar duplicados entre ciclos.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"store_job_offers",description:"Guarda en la base persistente del Radar las ofertas verificadas por un ciclo de búsqueda.",inputSchema:{type:"object",properties:{offers:{type:"array",items:{type:"object",properties:{company:{type:"string"},title:{type:"string"},url:{type:"string"},requisition_source:{type:"string"},requisition_id:{type:"string"},offer_id:{type:"string"},eligibility_evidence:{type:"string"},vacancy_status:{type:"string"},source_urls:{type:"array",items:{type:"string"}},location:{type:"string"},salary:{type:"string"},salary_min_eur:{type:"number"},salary_max_eur:{type:"number"},role_family:{type:"string"},published_at:{type:"string"},checked_at:{type:"string"},status:{type:"string"},dateApplied:{type:"string"},score_percent:{type:"number"}},required:["company","title"],additionalProperties:true}}},required:["offers"],additionalProperties:false}},
 {name:"mark_offer_applied",description:"Registra una candidatura para evitar que vuelva a aparecer como nueva.",inputSchema:{type:"object",properties:{offer_id:{type:"string"},url:{type:"string"},company:{type:"string"},title:{type:"string"},dateApplied:{type:"string"}},additionalProperties:false}},
 {name:"score_job_offer",description:"Clasifica una oferta según salario, elegibilidad y encaje profesional.",inputSchema:{type:"object",properties:{title:{type:"string"},company:{type:"string"},country:{type:"string"},remote_mode:{type:"string",enum:["remote","hybrid","onsite","unknown"]},eligible_from_spain:{type:"boolean"},salary_min_eur:{type:"number"},salary_max_eur:{type:"number"},salary_published:{type:"boolean"},fit_percent:{type:"number",minimum:0,maximum:100},career_growth_percent:{type:"number",minimum:0,maximum:100},learning_percent:{type:"number",minimum:0,maximum:100},office_days_per_week:{type:"number"},status:{type:"string"},vacancy_status:{type:"string"},eligibility_evidence:{type:"string"},role_family:{type:"string"}},required:["title","company"],additionalProperties:false}},
 {name:"deduplicate_offer_batch",description:"Deduplica ofertas por requisición o URL específica y avisa de coincidencias con candidaturas ya enviadas cuando se proporciona already_applied.",inputSchema:{type:"object",properties:{offers:{type:"array",items:{type:"object",properties:{company:{type:"string"},title:{type:"string"},url:{type:"string"},location:{type:"string"},status:{type:"string"}},required:["company","title"],additionalProperties:true}},already_applied:{type:"array",items:{type:"object",properties:{company:{type:"string"},title:{type:"string"},url:{type:"string"},dateApplied:{type:"string"}},required:["company","title"],additionalProperties:true}}},required:["offers"],additionalProperties:false}}
];
const profile={location:"España",salary_target_min_eur:55000,roles:roleTargets.map(x=>x.family),role_targets:roleTargets.map(({family})=>({family,expected_salary_min_eur:null,expected_salary_max_eur:null})),geography:{priority:["España","Europa"],remote:"Global si acepta contratación desde España y horario compatible",hybrid_outside_spain:"Solo 1–2 días presenciales por semana"},salary_rules:{exclude_below_target:true,crossing_band:"por confirmar",unpublished:"no confirmado"},score_weights:{experience_fit:30,career_growth:25,salary:20,modality:15,learning:10},delivery:{target:50,never_invent:true,explain_shortfall:true,deduplicate:true},actions_prohibited:["enviar candidaturas","contactar empresas"]};
const ok=value=>({content:[{type:"text",text:JSON.stringify(value)}]});
function searchPlan(a){let roles=a.roles?.length?a.roles:roleTargets.map(x=>x.family),keys=a.keywords||[],loc=a.location||"Spain remote",target=a.target_count||50,now=new Date(),windows=[24,72,168].map(hours=>({hours,since:new Date(now.getTime()-hours*3600000).toISOString()}));let q=a.mode==="companies_es"?"empresas tecnológicas España "+keys.join(" "):a.mode==="companies_global"?"technology companies hiring remote from Spain "+keys.join(" "):a.mode==="keywords"?keys.join(" OR ")+" jobs "+loc:roles.map(x=>"\""+x+"\"").join(" OR ")+" jobs "+loc;let day24=windows[0].since.slice(0,10),day72=windows[1].since.slice(0,10),day7=windows[2].since.slice(0,10),li="https://www.linkedin.com/jobs/search/?keywords="+encodeURIComponent(a.mode==="keywords"?keys.join(" "):roles.join(" OR "))+"&location="+encodeURIComponent(loc);return {mode:a.mode,target_count:target,roles,recency_windows:windows,queries:[q+" after:"+day24,q+" after:"+day72,q+" after:"+day7,q+" careers OR jobs", "site:linkedin.com/jobs/view "+q+" after:"+day7,q+" remote Spain salary after:"+day7],linkedin_jobs_urls:{last_24_hours:li+"&f_TPR=r86400",last_72_hours:li+"&f_TPR=r259200",last_7_days:li+"&f_TPR=r604800"},iterations:["Ciclo 1: busca vacantes publicadas o actualizadas en las últimas 24 horas.","Ciclo 2: amplía hasta 72 horas, verifica que siguen abiertas y elimina duplicados.","Ciclo 3: amplía como máximo a 7 días si faltan resultados; no rellenes con ofertas más antiguas.","Abre la candidatura y verifica fecha, estado abierto y formulario/enlace activo.","Puntúa las ofertas y compara salario publicado con banda esperada de la familia.","Repite hasta alcanzar el objetivo o dos ciclos consecutivos sin ofertas nuevas verificadas."],rules:profile.salary_rules,claim_exhaustive:false}}
function score(a,bands={}){let flags=[],excluded=false,smin=a.salary_min_eur,smax=a.salary_max_eur,min=55000,norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),family=a.role_family?roleTargets.find(x=>norm(x.family)===norm(a.role_family)):null;if(!family){let title=norm(a.title);family=roleTargets.map(x=>({x,score:Math.max(0,...x.titles.map(t=>title.includes(norm(t))?norm(t).length:0))})).sort((x,y)=>y.score-x.score).find(x=>x.score)?.x||null}const band = bands[family?.family];
const expectedSalary = Array.isArray(band) && band.length === 2 &&
  band.every(value => Number.isFinite(value) && value > 0) && band[0] <= band[1]
  ? {min: band[0], max: band[1]} : null;
const published = a.salary_published !== false && smin != null;
const offerMax = smax ?? smin;
const invalidRange = published && offerMax < smin;
let salaryComparison = "salario no publicado";
if (invalidRange) {
  salaryComparison = "rango salarial incoherente";
} else if (expectedSalary && published) {
  salaryComparison = offerMax < expectedSalary.min ? "por debajo de banda"
    : smin > expectedSalary.max ? "por encima de banda"
    : smin >= expectedSalary.min && offerMax <= expectedSalary.max ? "dentro de banda"
    : "coincide parcialmente";
}
let salaryVsTarget = "no confirmado";
if (!published) {
  flags.push("Salario no confirmado");
} else if (invalidRange) {
  flags.push("Rango salarial incoherente: por confirmar");
} else if (offerMax < min) {
  salaryVsTarget = "inferior a 55.000 €";
  excluded = true;
  flags.push("Salario inferior al objetivo");
} else if (smin < min) {
  salaryVsTarget = "la banda cruza 55.000 €; por confirmar";
  flags.push("Banda cruza el umbral: por confirmar");
} else {
  salaryVsTarget = smin === min ? "alcanza 55.000 €" : "supera 55.000 €";
  flags.push("Salario publicado igual o superior al umbral");
}
if (a.eligible_from_spain === false) {
  excluded = true;
  flags.push("No elegible desde España");
} else if (a.eligible_from_spain == null) {
  flags.push("Elegibilidad desde España pendiente");
}
const spain = ["spain", "espana", "es"].includes(norm(a.country));
if (a.remote_mode === "hybrid" && !spain) {
  if (!a.country || a.office_days_per_week == null) {
    flags.push("Ubicación o presencialidad del híbrido pendiente");
  } else if (a.office_days_per_week > 2) {
    excluded = true;
    flags.push("Híbrido internacional superior a 1–2 días presenciales");
  }
}
if(/cerrad|closed|filled/i.test(a.vacancy_status||a.status||"")){excluded=true;flags.push("Vacante cerrada")}let v=(x,d)=>Math.max(0,Math.min(100,x==null?d:Number(x))),components={experience_fit:v(a.fit_percent,50),career_growth:v(a.career_growth_percent,50),salary:!published||invalidRange?50:(smin>=min?100:(offerMax<min?0:50)),modality:a.eligible_from_spain===false?0:(a.eligible_from_spain==null?50:(a.remote_mode==="remote"?100:a.remote_mode==="hybrid"?75:50)),learning:v(a.learning_percent,50)};let total=Math.round(components.experience_fit*.3+components.career_growth*.25+components.salary*.2+components.modality*.15+components.learning*.1),classification=excluded?"excluir":flags.some(x=>/pendiente|confirmar|no confirmado/.test(x))?"por confirmar":"verificada";return {company:a.company,title:a.title,role_family:family?.family||null,expected_salary_min_eur:expectedSalary?.min??null,expected_salary_max_eur:expectedSalary?.max??null,salary_comparison:salaryComparison,salary_vs_general_target:salaryVsTarget,score_percent:total,components,classification,priority:classification==="verificada" && published && smin>min,eligibility_evidence:a.eligibility_evidence||null,flags}}
function storedOffer(row) {
  return {...JSON.parse(row.offer_json), offer_id: row.id,
    status: row.status, dateApplied: row.date_applied || ""};
}

async function persistOffer(env, offer, editApplication = false) {
  if (!env?.DB) throw new Error("La base de datos persistente del sitio aún no está disponible");
  if (!offer?.company || !offer?.title) throw new Error("Cada oferta necesita empresa y puesto");
  if ((offer.url && !safeOfferUrl(offer.url)) ||
      (offer.source_urls ?? []).some(url => !safeOfferUrl(url))) {
    throw new Error("Introduce enlaces HTTP o HTTPS válidos");
  }
  const canonical = offerUrls(offer).map(canonicalOfferUrl).find(Boolean);
  const requisition = requisitionKey(offer);
  const proposedId = requisition ? "req:" + requisition : canonical ? "url:" + canonical
    : (offer.offer_id?.startsWith("local:") ? offer.offer_id : "local:" + crypto.randomUUID());
  for (let attempt = 0; attempt < 5; attempt++) {
    const {results} = await env.DB.prepare("SELECT id,offer_json,status,date_applied,updated_at FROM offers").all();
    const matches = (results ?? []).filter(row => sameOffer(storedOffer(row), offer));
    if (matches.length > 1) throw new Error("Identidad ambigua: revisa las ofertas coincidentes");
    const row = matches[0];
    const id = row?.id ?? proposedId;
    if (!row && (results ?? []).some(candidate => candidate.id === id)) {
      throw new Error("Identificador de vacante en conflicto");
    }
    const updatedAt = new Date().toISOString();
    const merged = {...mergeOffer(row ? storedOffer(row) : {}, offer, editApplication),
      offer_id: id, updated_at: updatedAt};
    const values = [JSON.stringify(merged), merged.status, merged.dateApplied || null, updatedAt];
    const write = row
      ? await env.DB.prepare("UPDATE offers SET offer_json=?,status=?,date_applied=?,updated_at=? WHERE id=? AND offer_json=? AND status=? AND date_applied IS ?")
          .bind(...values, id, row.offer_json, row.status, row.date_applied).run()
      : await env.DB.prepare("INSERT INTO offers (offer_json,status,date_applied,updated_at,id) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM offers)=? ON CONFLICT(id) DO NOTHING")
          .bind(...values, id, results.length).run();
    if (write.meta.changes === 1) return {offer: merged, created: !row};
  }
  throw new Error("La oferta cambió durante el guardado. Reintenta la operación");
}

async function getOffers(env, applicationsOnly = false) {
  if (!env?.DB) return [];
  const {results} = await env.DB.prepare("SELECT id,offer_json,status,date_applied FROM offers ORDER BY updated_at DESC").all();
  const offers = (results ?? []).map(storedOffer);
  return applicationsOnly ? offers.filter(applicationState) : offers;
}

async function saveOffers(env, offers, editApplication = false) {
  const saved = [];
  for (const offer of offers) saved.push(await persistOffer(env, offer, editApplication));
  const created = saved.filter(item => item.created).length;
  return {saved_count: saved.length, created_count: created,
    updated_count: saved.length - created, offers: saved.map(item => item.offer)};
}

function deduplicateOffers(offers, history) {
  const unique = [], duplicates = [], appliedMatches = [], possibleDuplicates = [];
  const norm = value => String(value ?? "").trim().toLowerCase();
  for (const offer of offers) {
    const matches = unique.map((item, index) => sameOffer(item, offer) ? index : -1).filter(index => index !== -1);
    if (matches.length === 1) {
      const index = matches[0];
      unique[index] = mergeOffer(unique[index], offer);
      duplicates.push(offer);
    } else {
      const similar = [...unique, ...history].filter(item =>
        norm(item.company) === norm(offer.company) && norm(item.title) === norm(offer.title) && !sameOffer(item, offer));
      if (similar.length || matches.length > 1) possibleDuplicates.push({offer, candidates: similar.concat(matches.map(index => unique[index]))});
      unique.push(offer);
    }
  }
  const newOffers = [];
  for (const offer of unique) {
    const match = history.find(item => sameOffer(item, offer));
    if (match) appliedMatches.push({new_offer: offer, previous_application: match});
    else newOffers.push(offer);
  }
  return {unique, duplicates, already_applied_matches: appliedMatches, possible_duplicates: possibleDuplicates,
    new_not_applied: newOffers, unique_count: unique.length, duplicate_count: duplicates.length,
    applied_match_count: appliedMatches.length};
}
async function call(name,a,env){if(name==="get_search_profile"){const personal=privateProfile(env);return ok({...profile,...personal,location:personal.location||profile.location, role_targets:roleTargets.map(({family})=>{const band=salaryBands(env)[family];return {family,expected_salary_min_eur:band?.[0]??null,expected_salary_max_eur:band?.[1]??null}})});}if(name==="get_offer_history")return ok({offers:await getOffers(env),applications:(await getOffers(env,true))});if(name==="store_job_offers")return ok(await saveOffers(env,a.offers||[]));if(name==="mark_offer_applied"){
  const offers=await getOffers(env);
  const matches=offers.filter(x=>sameOffer(x,a));
  if(matches.length!==1)return ok({updated:false,reason:"Indica el offer_id o la URL específica de una única vacante"});
  const {offer}=await persistOffer(env,{...matches[0],status:"Aplicada",dateApplied:a.dateApplied||new Date().toISOString().slice(0,10)},true);
  return ok({updated:true,offer});
}if(name==="build_search_plan")return ok(searchPlan(a));if(name==="score_job_offer")return ok(score(a, salaryBands(env)));if(name==="deduplicate_offer_batch")return ok(deduplicateOffers(a.offers||[],a.already_applied||[]));return{content:[{type:"text",text:"Herramienta desconocida"}],isError:true}}
function response(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store"}})}
export default {async fetch(request,env){let u=new URL(request.url);if(u.pathname==="/api/offers"&&request.method==="GET")return response({offers:await getOffers(env)});if(u.pathname==="/api/offers"&&request.method==="POST"){try{const b=await request.json();return response(await saveOffers(env,b.offers||[],b.edit_application===true))}catch(e){return response({error:e.message},400)}}if(u.pathname==="/health")return response({ok:true,service:"Radar Data & AI",mcp:true});if(u.pathname==="/mcp"&&request.method==="POST"){let b;try{b=await request.json()}catch{return response({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}},400)}let id=b.id,method=b.method,p=b.params||{};if(method==="server/discover")return response({jsonrpc:"2.0",id,result:{supportedVersions:["2026-07-28"],capabilities:{tools:{}}}});if(method==="tools/list")return response({jsonrpc:"2.0",id,result:{tools:toolDefinitions}});if(method==="tools/call"){try{return response({jsonrpc:"2.0",id,result:await call(p.name,p.arguments||{},env)})}catch(e){return response({jsonrpc:"2.0",id,result:{content:[{type:"text",text:e.message}],isError:true}})}}return response({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}},404)}if(u.pathname!=="/")return new Response("Not found",{status:404});return new Response(page(salaryBands(env), privateProfile(env)),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store"}})}};

