import {normalizeCompany,companyKey,companyScope} from "./company-search.js";
import {startRun,readRun,listRuns,beginRun,recordRun,saveRun,pendingLinks,actOnPending} from "./search-runs.js";
import { companyDirectory } from "./company-directory.js";
const roleTargets = [{"family": "Technical Project Manager — Data & AI", "titles": ["technical project manager data ai", "technical project manager", "data ai project manager", "ai technical project manager", "ai program manager", "data project manager"]}, {"family": "Analytics Engineer / Senior Analytics Engineer", "titles": ["senior analytics engineer", "analytics engineer"]}, {"family": "Data Delivery Manager / Data Program Manager", "titles": ["data delivery manager", "data program manager", "data delivery lead"]}, {"family": "Senior Data Engineer", "titles": ["senior data engineer"]}, {"family": "Technical Program Manager — Data & AI", "titles": ["technical program manager data ai", "technical program manager"]}, {"family": "Data Product Owner / Technical Product Owner", "titles": ["data product owner", "technical product owner"]}, {"family": "AI Delivery Lead / AI Project Lead / AI Delivery Manager", "titles": ["ai delivery lead", "ai project lead", "ai delivery manager", "ai program manager"]}, {"family": "Data Solutions Architect / Analytics Architect", "titles": ["data solutions architect", "analytics architect"]}, {"family": "Data Architect / Data Platform Architect / Cloud Data Architect", "titles": ["cloud data architect", "data platform architect", "data architect"]}, {"family": "Data Platform Engineer", "titles": ["data platform engineer"]}, {"family": "Data Engineering Lead / Tech Lead", "titles": ["data engineering lead", "engineering tech lead", "tech lead"]}, {"family": "Applied AI Engineer / LLM Engineer", "titles": ["applied ai engineer", "ai engineer", "machine learning engineer", "llm engineer"]}, {"family": "AI Solutions Lead / AI Solutions Architect", "titles": ["ai solutions lead", "ai solutions architect"]}, {"family": "MLOps / ML Platform Engineer", "titles": ["ml platform engineer", "mlops engineer", "mlops"]}];
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

function configuredRoles(env) {
  const bands = readConfig(env?.RADAR_SALARY_BANDS);
  return roleTargets.map(role => {
    const band = bands[role.family];
    if (!Array.isArray(band) || band.length !== 2 ||
        !band.every(value => Number.isFinite(value) && value > 0) || band[0] > band[1]) return role;
    return {...role, min: band[0], max: band[1]};
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}

function safeOfferUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return "";
  try {
    const url = new URL(value.trim());
    return url.username || url.password ? "" : url.href;
  } catch {
    return "";
  }
}

function canonicalOfferUrl(value) {
  const safe = safeOfferUrl(value);
  if (!safe) return "";
  const url = new URL(safe);
  for (const name of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$)/i.test(name)) url.searchParams.delete(name);
  }
  const generic = url.pathname === "/" || /\/(?:careers?|jobs?|employment|vacancies|empleo|search)\/?$/i.test(url.pathname);
  const jobParam = [...url.searchParams.keys()].some(name => /^(?:job_?id|gh_jid|requisition_?id|posting_?id|vacancy_?id)$/i.test(name));
  if (generic && !url.hash && !jobParam) return "";
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/(?:apply|application|thanks)\/?$/i, "").replace(/\/$/, "") || "/";
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
  if (a.offer_id && b.offer_id && (a.offer_id === b.offer_id ||
    a.previous_offer_ids?.includes(b.offer_id) || b.previous_offer_ids?.includes(a.offer_id))) return true;
  const aliases = new Set(offerUrls(a).map(canonicalOfferUrl).filter(Boolean));
  return offerUrls(b).some(url => aliases.has(canonicalOfferUrl(url)));
}

function duplicateReasons(a, b) {
  const left = requisitionKey(a), right = requisitionKey(b);
  const norm = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if ((left && right && left !== right) || !norm(a.company) || norm(a.company) !== norm(b.company)) return [];
  const terms = value => new Set(norm(value).match(/[\p{L}\p{N}]{3,}/gu) || []);
  const x = terms(a.description || a.requirements), y = terms(b.description || b.requirements);
  const overlap = [...x].filter(word => y.has(word)).length;
  const reasons = [];
  if (norm(a.title) && norm(a.title) === norm(b.title)) reasons.push("Misma empresa y título");
  if (overlap >= 6 && overlap / (x.size + y.size - overlap) >= 0.7) reasons.push("Descripción similar");
  if (reasons.length && norm(a.location) && norm(a.location) === norm(b.location)) reasons.push("Misma ubicación");
  return reasons;
}

function reviewPairs(offers) {
  const pairs = [];
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i], b = offers[j];
      const reasons = duplicateReasons(a, b);
      if (reasons.length) pairs.push({a, b, reasons});
    }
  }
  return pairs;
}

function detectedApplication(offer) {
  if (["Aplicado","En curso","Rechazado"].includes(offer.application_status)) return offer.application_status;
  const status=String(offer.status||"");
  if(/rechaz|rejected/i.test(status))return "Rechazado";
  if(/en curso|entrevist|interview/i.test(status))return "En curso";
  if(/aplicad|applied|enviad|submitted/i.test(status)||offer.dateApplied||offer.applied===true)return "Aplicado";
  return null;
}
function applicationState(offer) {
  return !!detectedApplication(offer);
}

function mergeOffer(prior, next, allowStatusEdit = false) {
  const previousApplication=detectedApplication(prior);
  const incomingApplication=detectedApplication(next);
  const application=previousApplication && !allowStatusEdit ? previousApplication : incomingApplication || previousApplication;
  const changed=application && application!==previousApplication;
  const keepApplication=previousApplication && !allowStatusEdit;
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
    application_status: application,
    application_status_changed_at: changed ? new Date().toISOString() : prior.application_status_changed_at || null,
    status: keepApplication ? prior.status : next.status || prior.status || "Nueva",
    dateApplied: (wasApplication && prior.dateApplied) || next.dateApplied || "",
  };
}

function deduplicateOffers(offers, history) {
  const unique = [], duplicates = [], appliedMatches = [], possibleDuplicates = [];
  for (const offer of offers) {
    const matches = unique.map((item, index) => sameOffer(item, offer) ? index : -1).filter(index => index !== -1);
    if (matches.length === 1) {
      const index = matches[0];
      unique[index] = mergeOffer(unique[index], offer);
      duplicates.push(offer);
    } else {
      const similar = [...unique, ...history].filter(item =>
        duplicateReasons(item, offer).length && !sameOffer(item, offer));
      if (similar.length || matches.length > 1) possibleDuplicates.push({offer, candidates: similar.concat(matches.map(index => unique[index])), reasons: [...new Set(similar.flatMap(item => duplicateReasons(item, offer)))]});
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
function deduplicate(args, history = []) {
  const batch = deduplicateOffers(args.offers || [], []);
  const unique = [], historyMatches = [], appliedMatches = [];
  for (const offer of batch.unique) {
    const previous = history.find(item => sameOffer(item, offer));
    const application = [...history.filter(applicationState), ...(args.already_applied || [])]
      .find(item => sameOffer(item, offer));
    if (previous) historyMatches.push({new_offer: offer, previous_offer: previous});
    if (application) appliedMatches.push({new_offer: offer, previous_application: application});
    if (!previous && !application) unique.push(offer);
    const similar = history.filter(item => !sameOffer(item, offer) &&
      duplicateReasons(item, offer).length);
    if (similar.length) batch.possible_duplicates.push({offer, candidates: similar, reasons: [...new Set(similar.flatMap(item => duplicateReasons(item, offer)))]});
  }
  return {...batch, unique, unique_count: unique.length, new_not_applied: unique,
    history_matches: historyMatches, already_applied_matches: appliedMatches,
    applied_match_count: appliedMatches.length,
    duplicate_count: batch.duplicate_count + batch.unique.length - unique.length};
}

const page = (env) => String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f4ef"><title>Radar Data & AI</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;color:#172b36;background:#f5f4ef;--green:#16735a;--muted:#657780;--line:#e5e9e5;--mint:#e5f3eb}*{box-sizing:border-box}body{margin:0}.app{min-height:100vh;display:grid;grid-template-columns:230px 1fr}aside{background:#142a35;color:#edf5f0;padding:26px 18px;display:flex;flex-direction:column;gap:28px}.brand{font-weight:800;font-size:15px;display:flex;gap:10px;align-items:center}.mark{background:#80cfaa;color:#102d25;border-radius:10px;padding:9px}.brand small{display:block;font-weight:400;color:#a9bbb6;font-size:10px;margin-top:3px}.nav{display:grid;gap:6px}.nav button{border:0;text-align:left;background:none;color:#bdcbc7;padding:11px;border-radius:9px}.nav button.active,.nav button:hover{background:#25414b;color:white}.sideNote{margin-top:auto;border:1px solid #38515a;border-radius:12px;padding:13px;color:#b9cbc6;font-size:11px;line-height:1.55}.sideNote b{display:block;color:white;margin-bottom:5px}.main{padding:32px clamp(18px,4vw,55px);max-width:1450px;width:100%;margin:auto}.top{display:flex;justify-content:space-between;gap:15px;align-items:center}.eyebrow{color:var(--green);font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase}.title{font-size:30px;letter-spacing:-1px;margin:7px 0}.sub{color:var(--muted);font-size:13px;margin:0}.actions{display:flex;gap:8px}.btn{border:1px solid var(--line);background:white;color:#172b36;border-radius:9px;padding:10px 13px;font-weight:700;font-size:11px;cursor:pointer}.btn.primary{background:var(--green);border-color:var(--green);color:white}.banner{background:#fff8e9;border:1px solid #efdfbf;border-radius:12px;padding:13px 15px;margin:20px 0;display:flex;justify-content:space-between;align-items:center;gap:12px}.banner strong{font-size:12px}.banner p{font-size:11px;color:#796747;margin:4px 0 0}.banner a{font-size:11px;font-weight:800;color:#795413;white-space:nowrap;text-decoration:none}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:17px 0}.stat,.panel{background:white;border:1px solid var(--line);border-radius:13px;padding:17px;box-shadow:0 10px 34px #172b3608}.stat label{font-size:10px;color:var(--muted)}.stat b{display:block;font-size:25px;margin:6px 0}.stat small{color:var(--muted);font-size:10px}.grid{display:grid;grid-template-columns:1.25fr .75fr;gap:14px}.head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.head h2{font-size:14px;margin:0}.head p{font-size:10px;color:var(--muted);margin:5px 0 0;line-height:1.5}.tag{font-size:9px;font-weight:800;background:var(--mint);color:#17684c;border-radius:99px;padding:5px 8px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:9px}.card{background:white;border:1px solid var(--line);border-radius:10px;padding:13px;text-align:left;cursor:pointer}.card:hover{border-color:#7dbb9a;background:#fbfefc}.card i{display:grid;place-items:center;width:27px;height:27px;background:var(--mint);color:var(--green);border-radius:8px;font-style:normal;margin-bottom:8px}.card b{font-size:11px;display:block}.card span{font-size:10px;line-height:1.4;color:var(--muted);display:block;margin-top:4px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.field label{display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:5px}.field input,.field select{width:100%;border:1px solid var(--line);border-radius:8px;background:#fbfcfa;padding:9px;font:inherit;font-size:11px}.field input:focus{outline:2px solid #d8efe1}.formline{display:flex;gap:8px;align-items:end;margin-top:10px}.formline .field{flex:1}.plan{display:none;background:#f3f7f4;border:1px solid #deebe2;border-radius:10px;margin-top:14px;padding:13px}.plan.show{display:block}.plan b{font-size:12px}.plan ol{font-size:10px;line-height:1.6;color:#52656a;padding-left:19px}.links{display:flex;flex-wrap:wrap;gap:7px}.links a{font-size:10px;color:#185e4b;text-decoration:none;background:white;border:1px solid #c9e4d3;border-radius:7px;padding:7px}.cycle{display:flex;gap:8px;align-items:end;margin-top:11px}.cycle .field{width:110px}.cycle small{font-size:10px;color:var(--muted);align-self:center}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:13px 0 20px}.chip{font-size:10px;background:#eff4f0;color:#3d5b50;border-radius:99px;padding:6px 8px}.steps{display:grid;gap:11px}.step{display:flex;gap:9px}.step i{font-style:normal;border-radius:50%;width:22px;height:22px;background:var(--mint);color:var(--green);font-size:10px;font-weight:800;display:grid;place-items:center;flex:none}.step b{font-size:11px}.step p{font-size:10px;color:var(--muted);margin:3px 0;line-height:1.4}.tableBox{overflow:auto;margin-top:12px}.table{width:100%;border-collapse:collapse;min-width:640px}.table th{text-align:left;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;padding:9px;border-bottom:1px solid var(--line)}.table td{font-size:10px;padding:11px 9px;border-bottom:1px solid #eff1ee}.table a{font-weight:700;color:#17634f;text-decoration:none}.empty{text-align:center;padding:26px 10px;color:var(--muted);font-size:11px}.view.hidden{display:none}.modalBg{display:none;position:fixed;inset:0;background:#0d263477;z-index:4;place-items:center;padding:15px}.modalBg.show{display:grid}.modal{background:white;border-radius:14px;padding:20px;width:min(490px,100%)}.modal h2{font-size:15px;margin:0 0 12px}.modal .field{margin:10px 0}.modal .field input,.modal .field select{padding:10px}.modalTop{display:flex;justify-content:space-between}.close{border:0;border-radius:50%;width:27px;height:27px;cursor:pointer}.toast{position:fixed;bottom:20px;right:20px;background:#183a31;color:white;padding:10px 14px;border-radius:8px;opacity:0;font-size:11px;transition:.2s}.toast.show{opacity:1}.foot{font-size:10px;color:#829096;margin-top:18px;line-height:1.5}.manualNote{font-size:14px;line-height:1.55;color:#657780;margin:12px 0 0}.manualMeta{font-size:14px;line-height:1.5;color:#52656a}.manualTable{min-width:780px}.manualTable td{font-size:14px;line-height:1.45;vertical-align:top}.manualTable th{font-size:12px}.manualStatus{display:inline-block;border-radius:99px;padding:5px 8px;background:#fff4df;color:#765317;font-weight:700;font-size:12px}.nav button[data-view="manual"]{white-space:nowrap}.hidden{display:none!important}.companyDetails{margin-top:14px}.companySource{border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px}.companySource h3{font-size:12px;margin:0 0 10px}.companyFields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.companyField{font-size:10px;line-height:1.5;overflow-wrap:anywhere}.companyField b{display:block;color:var(--muted);font-size:9px}.companyField a{color:#17634f}.companyActions{white-space:nowrap}.companyBadge{font-size:9px;color:#17684c;background:var(--mint);padding:4px 7px;border-radius:99px;white-space:nowrap}@media(max-width:620px){.companyFields{grid-template-columns:1fr}}
@media(max-width:850px){.app{grid-template-columns:1fr}aside{padding:12px 15px;flex-direction:row;align-items:center;justify-content:space-between;gap:10px}.nav{display:flex}.nav button{font-size:0;padding:8px}.nav button:after{content:attr(data-icon);font-size:14px}.sideNote{display:none}.main{padding:24px 16px}}@media(max-width:620px){.top{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.cards{grid-template-columns:1fr}.fields{grid-template-columns:1fr}.banner{align-items:flex-start;flex-direction:column}.formline{align-items:stretch;flex-direction:column}.cycle{align-items:stretch;flex-wrap:wrap}.cycle .field{width:100%}}
</style></head><body>
<div class="app"><aside><div class="brand"><span class="mark">R</span><span>Radar Data & AI<small>Tu agente de oportunidades</small></span></div><nav class="nav"><button class="active" data-view="home" data-icon="◫">Inicio</button><button data-view="companies" data-icon="⌂">Empresas</button><button data-view="search" data-icon="⌕">Búsqueda</button><button data-view="results" data-icon="▤">Resultados</button><button data-view="manual" data-icon="⌕">Búsqueda manual <span id="manualCount" class="tag" style="float:right;padding:3px 6px">2</span></button><button data-view="apps" data-icon="✓">Candidaturas</button><button data-view="settings" data-icon="⚙">Criterios</button></nav><div class="sideNote"><b>Perfil activo</b>Data Engineer → AI Engineering, arquitectura y liderazgo técnico.<br><br>El directorio combina inventarios verificados y empresas de tus ofertas guardadas.</div></aside>
<main class="main"><section class="view" id="view-home">
<div class="top"><div><div class="eyebrow">Tu radar profesional</div><h1 class="title">${privateProfile(env).display_name ? "Buenos días, " + escapeHtml(privateProfile(env).display_name) : "Radar de ofertas"}</h1><p class="sub">Empresas, puestos y palabras clave en un mismo espacio.</p></div><div class="actions"><button class="btn" id="reloadHistory">Actualizar historial</button><button class="btn" id="export">Exportar</button><button class="btn primary" id="addOpen">＋ Añadir resultado</button></div></div>
<div class="banner"><div><strong>LinkedIn: incorpora ofertas mediante alertas</strong><p>La búsqueda directa desde tu cuenta aún no está disponible. Puedes revisar alertas de LinkedIn y guardar aquí las vacantes.</p></div><a href="https://www.linkedin.com/jobs/" target="_blank" rel="noopener">Abrir LinkedIn Jobs ↗</a></div>
<div class="stats"><div class="stat"><label>Ofertas guardadas</label><b id="jobs">—</b><small>en el historial de Radar</small></div><div class="stat"><label>Candidaturas registradas</label><b id="applicationsCount">—</b><small>aplicadas o con respuesta</small></div><div class="stat"><label>Pendientes de revisar</label><b id="pending">—</b><small>estado, salario o elegibilidad</small></div><div class="stat"><label>Prioritarias</label><b id="priorityCount">—</b><small>más de 55.000 € publicados</small></div><div class="stat"><label>Búsquedas iniciadas</label><b id="rounds">0</b><small>se actualiza al abrir cada consulta</small></div></div><div id="dataStatus" role="status" aria-live="polite" style="font-size:11px;color:#657780;margin:-5px 0 14px">Cargando historial guardado…</div>
<div class="grid"><div class="panel"><div class="head"><div><h2>Inicia una búsqueda</h2><p>Elige el tipo de búsqueda. Prepara consultas y un plan para ampliar resultados por ciclos.</p></div><span class="tag">ITERATIVA</span></div>
<div class="cards"><button class="card" data-mode="offers"><i>▣</i><b>Ofertas por puesto</b><span>Data, IA, arquitectura y liderazgo de proyectos.</span></button><button class="card" data-mode="keywords"><i>⌗</i><b>Ofertas por palabras clave</b><span>Coincidencias y variantes en español e inglés.</span></button></div><p class="sub" style="margin-top:10px">Para descubrir empresas y buscar sus vacantes, ve a <button class="btn" data-goto="companies">Empresas</button>.</p>
<div class="fields"><div class="field"><label>Puesto o sector</label><input id="role" placeholder="Ej. AI Engineer, Data Architect"></div><div class="field"><label>Palabras clave</label><input id="keywords" placeholder="Ej. AI agents, RAG, Databricks"></div></div><div class="formline"><div class="field"><label>Ubicación</label><input id="location" value="España, Europa; remoto global viable"></div><button class="btn primary" id="prepare">Preparar búsqueda ↗</button></div>
<div class="panel"><h2>Ejecuciones de búsqueda</h2><div class="actions"><button class="btn" id="refreshRuns">Actualizar ejecuciones</button><input id="runLookup" aria-label="ID de ejecución" placeholder="ID de ejecución"><button class="btn" id="findRun">Consultar ID</button></div><p id="runStatus" aria-live="polite"></p><div id="runs"></div><div id="runHandoff" hidden><label for="handoffText">Copia estas instrucciones en ChatGPT</label><textarea id="handoffText" readonly rows="6"></textarea><a href="https://chatgpt.com/" target="_blank" rel="noopener">Abrir ChatGPT</a></div></div>
<div class="plan" id="plan"><b id="planTitle">Plan de búsqueda</b><ol id="planSteps"></ol><div class="links" id="queryLinks"></div><div class="cycle"><button class="btn" id="handoff">Preparar búsqueda en ChatGPT</button><small id="loopStatus">Cada enlace abre una consulta y suma una búsqueda. Añade manualmente las empresas u ofertas que quieras conservar.</small></div></div></div>
<div class="panel"><div class="head"><div><h2>Criterios activos</h2><p>Filtros usados para clasificar resultados.</p></div><button class="btn" data-goto="settings">Editar</button></div><div class="chips" id="chips"></div><div class="steps"><div class="step"><i>1</i><div><b>Buscar por ciclos</b><p>Amplía títulos, idiomas, países, sectores y fuentes.</p></div></div><div class="step"><i>2</i><div><b>Verificar y deduplicar</b><p>Prioriza vacantes abiertas y páginas oficiales.</p></div></div><div class="step"><i>3</i><div><b>Comprobar encaje</b><p>Valida salario, modalidad y elegibilidad desde España.</p></div></div></div></div></div>
<div class="panel" style="margin-top:14px"><div class="head"><div><h2>Últimos resultados</h2><p>Ofertas y empresas que has guardado.</p></div><button class="btn" data-goto="results">Ver todos</button></div><div id="recent"></div></div>
<p class="foot">El directorio global se construye por etapas y no se presenta como un censo exhaustivo. La web no envía candidaturas ni contacta con empresas.</p></section>
<section class="view hidden" id="view-companies"><div class="top"><div><div class="eyebrow">Directorio de empresas</div><h1 class="title">Empresas</h1><p class="sub">Inventario de España y directorio global, unidos con las empresas ya presentes en tus ofertas.</p></div><div class="actions"><button class="btn" id="addCompany">＋ Añadir empresa</button></div></div><div class="panel" style="margin-top:17px"><div class="head"><div><h2>Ampliar el directorio</h2><p>Las fichas importadas incluyen portales oficiales y todos los campos disponibles en los dos inventarios.</p></div><span class="tag">DIRECTORIO CARGADO</span></div><div class="cards"><button class="card" data-company-campaign="companies_es"><i>⌂</i><b>Buscar más empresas en España</b><span>Explora sectores y ciudades adicionales.</span></button><button class="card" data-company-campaign="companies_global"><i>◎</i><b>Buscar más empresas globales</b><span>Explora otras regiones con contratación internacional.</span></button></div><div class="links" id="companyCampaignLinks" style="margin-top:12px"></div><p id="companySearchStatus" class="sub" role="status" aria-live="polite" style="margin-top:10px">El directorio cargado contiene 123 empresas únicas procedentes de 132 filas, con nueve coincidencias entre los dos inventarios.</p></div><div class="panel" style="margin-top:14px"><div class="head"><div><h2>Directorio integrado</h2><p id="companyCount">Cargando fichas…</p></div><button class="btn" data-goto="results">Ver ofertas guardadas</button></div><div class="field"><label>Filtrar por empresa, sector, ubicación, región o portal</label><input id="companyFilter" placeholder="Ej. IA, España, Airalo, careers"></div><div id="companiesList" class="tableBox"></div></div><div id="companyDetails" class="panel companyDetails hidden"></div><p class="foot">Datos procedentes de los inventarios comprobados el 13 de noviembre de 2026. La modalidad, elegibilidad y vacantes pueden variar por puesto; la ficha conserva los valores y límites tal como aparecen en las fuentes.</p></section>
<section class="view hidden" id="view-search"><div class="top"><div><div class="eyebrow">Explorar fuentes</div><h1 class="title">Búsqueda</h1><p class="sub">Prepara consultas para puestos y palabras clave.</p></div></div><div class="panel"><div class="cards"><button class="card" data-mode="offers"><i>▣</i><b>Puestos concretos</b><span>Ofertas y elegibilidad.</span></button><button class="card" data-mode="keywords"><i>⌗</i><b>Palabras clave</b><span>Frases exactas y equivalentes.</span></button></div><p class="sub" style="margin:15px 0">Para buscar empresas y sus vacantes, usa la pestaña Empresas.</p><button class="btn" data-goto="home">Abrir formulario</button><button class="btn" data-goto="companies">Ir a Empresas</button></div></section>
<section class="view hidden" id="view-results"><div class="top"><div><div class="eyebrow">Tu pipeline</div><h1 class="title">Resultados guardados</h1><p class="sub">Importa el historial de Ofertas como CSV o JSON; las candidaturas quedarán marcadas.</p></div><div class="actions"><button class="btn" id="import">Importar Ofertas</button><button class="btn primary" id="addOpen2">＋ Añadir</button><input class="hidden" id="file" type="file" accept=".csv,.json,text/csv,application/json"></div></div><div class="panel" style="margin-top:17px"><p class="sub">Desde iCloud Drive, exporta el archivo como CSV o JSON y selecciónalo aquí. La web no tiene conexión directa a iCloud Drive.</p><label class="sub" style="display:block;margin-top:8px"><input type="checkbox" id="markImportedApplied" checked> Si una fila no trae estado, marcarla como «Aplicada» al importar.</label><div class="fields"><div class="field"><label>Filtrar</label><input id="filter" placeholder="Empresa, puesto o ubicación"></div><div class="field"><label>Tipo</label><select id="typeFilter"><option value="all">Todo</option><option value="job">Ofertas</option><option value="company">Empresas</option></select></div></div><div class="actions"><label>Familia <select id="rankingFamily"><option value="">Todas</option></select></label><label>Vista <select id="rankingView"><option value="active">Oportunidades</option><option value="all">Todo el historial</option><option value="excluded">Excluidas</option></select></label></div><p id="rankingCheck" aria-live="polite"></p><div id="all" class="tableBox"></div><h3>Coincidencias para revisar</h3><div id="duplicateReview"></div></div></section>
<section class="view hidden" id="view-apps"><div class="top"><div><div class="eyebrow">Historial de candidaturas</div><h1 class="title">Ya has aplicado</h1><p class="sub">El radar comprobará cada nueva vacante frente a este historial.</p></div><div class="actions"><button class="btn" id="importApps">Importar Ofertas</button><button class="btn primary" id="addApplied">＋ Registrar candidatura</button></div></div><div class="panel" style="margin-top:17px"><p class="sub">Se avisa por URL y coincidencia normalizada de empresa + puesto. Las coincidencias aproximadas quedan marcadas para que puedas revisarlas.</p><div id="applications" class="tableBox"></div></div></section>
<section class="view hidden" id="view-manual">
<div class="top"><div><div class="eyebrow">Pendientes de completar</div><h1 class="title">Búsqueda manual</h1><p class="sub">Candidatos relevantes que no se han podido verificar con las fuentes disponibles. Las ofertas que solo necesitan una categoría permanecen en Resultados.</p></div></div>
<div class="panel" style="margin-top:17px"><div class="head"><div><h2>Ofertas pendientes de verificación</h2><p>Solo aparecen aquí cuando falta un dato esencial y no se puede confirmar con otra fuente. Las ofertas gestionables siguen en Resultados.</p></div><span class="tag">REVISIÓN MANUAL</span></div><div id="manualCandidates" class="tableBox"></div><h3>Enlaces pendientes</h3><div id="pendingLinks" class="tableBox"></div></div>
</section>
<section class="view hidden" id="view-settings"><div class="top"><div><div class="eyebrow">Configuración</div><h1 class="title">Tus criterios</h1><p class="sub">Se guardan localmente en este navegador.</p></div></div><div class="panel" style="margin-top:17px"><h2 style="font-size:14px">Filtros profesionales</h2><div class="fields"><div class="field"><label>Salario objetivo mínimo (€ brutos/año)</label><input id="salarySet" type="number"></div><div class="field"><label>Objetivo de resultados</label><input id="targetSet" type="number"></div></div><div class="field" style="margin-top:12px"><label>Puestos objetivo (separados por comas)</label><input id="rolesSet"></div><div class="field" style="margin-top:12px"><label>Ubicaciones y modalidad</label><input id="locationsSet"></div><div class="field" style="margin-top:12px"><label>Palabras clave</label><input id="keywordsSet"></div><button class="btn primary" style="margin-top:13px" id="saveSettings">Guardar criterios</button></div><div class="panel" style="margin-top:14px"><h2 style="font-size:14px">Bandas salariales esperadas por familia</h2><p class="sub">Rangos de salario fijo bruto anual del documento de estrategia; en cada oferta se compara el salario publicado con esta banda y, por separado, con el objetivo general de más de 55.000 €.</p><div id="salaryBands" class="tableBox"></div></div><div class="panel" style="margin-top:14px"><h2 style="font-size:14px">Reglas de clasificación</h2><div class="steps" style="margin-top:14px"><div class="step"><i>1</i><div><b>Salario</b><p>Excluir bandas inferiores; marcar «por confirmar» las que cruzan el umbral.</p></div></div><div class="step"><i>2</i><div><b>Elegibilidad</b><p>Confirmar que una oferta remota internacional permite contratar desde España.</p></div></div><div class="step"><i>3</i><div><b>Híbrido</b><p>Fuera de España, aceptar solo 1–2 días presenciales por semana.</p></div></div><div class="step"><i>4</i><div><b>Puntuación de encaje</b><p>Experiencia 30%, evolución 25%, salario 20%, modalidad 15%, aprendizaje 10%.</p></div></div></div></div></section></main></div>
<div class="modalBg" id="modal"><form class="modal" id="form"><div class="modalTop"><h2>Añadir resultado</h2><button type="button" class="close" id="close">×</button></div><div class="field"><label>Tipo</label><select id="kind"><option value="job">Oferta</option><option value="company">Empresa</option></select></div><div class="field"><label>Empresa</label><input id="company" required></div><div class="field" id="titleField"><label>Puesto</label><input id="title"></div><div class="field"><label>Ubicación y modalidad</label><input id="place" placeholder="España · remoto"></div><div class="field"><label>Salario publicado</label><input id="salary" placeholder="Ej. 60.000–70.000 €/año"></div><div class="field"><label>URL de la fuente</label><input id="url" type="url" placeholder="https://..."></div><div class="field"><label>Estado</label><select id="status"><option>Verificada</option><option>Por confirmar</option><option>Seguimiento</option><option>Aplicada</option></select></div><div class="field hidden" id="dateAppliedWrap"><label>Fecha de candidatura</label><input id="dateApplied" type="date"></div><div id="duplicateNotice" class="hidden" style="background:#fff5df;border:1px solid #eed9a8;padding:10px;border-radius:8px;font-size:11px;color:#765315;margin:10px 0"></div><button class="btn primary">Guardar</button></form></div><div class="toast" id="toast"></div>
<script>
${safeOfferUrl.toString()}
${canonicalOfferUrl.toString()}
${requisitionKey.toString()}
${offerUrls.toString()}
${sameOffer.toString()}
${duplicateReasons.toString()}
${reviewPairs.toString()}
${detectedApplication.toString()}
${applicationState.toString()}
${mergeOffer.toString()}
${deduplicateOffers.toString()}
${deduplicate.toString()}
${score.toString()}
const ROLE_TARGETS=${JSON.stringify(configuredRoles(env))};const DEFAULT={salary:55000,target:50,roles:ROLE_TARGETS.map(x=>x.family),roleCatalogVersion:2,locations:"España y Europa, remoto prioritario; remoto global si contrata desde España; híbrido internacional solo 1–2 días/semana",keywords:[]};const KEY="radar-data-ai-v1";let data;try{data=JSON.parse(localStorage.getItem(KEY))||{settings:DEFAULT,items:[],rounds:[]}}catch{data={settings:DEFAULT,items:[],rounds:[]}}if(data.settings&&data.settings.roleCatalogVersion!==2){data.settings={...DEFAULT,...data.settings,roles:DEFAULT.roles,roleCatalogVersion:2};localStorage.setItem(KEY,JSON.stringify(data))}for(const item of data.items){if(!item.offer_id)item.offer_id="local:"+crypto.randomUUID()}let mode="offers",quiet=0,activeSearchRun=null,directoryRecords=[],manualCandidates=[];
function save(){localStorage.setItem(KEY,JSON.stringify(data));draw();fetch("/api/offers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({offers:data.items.filter(x=>x.company&&x.title)})}).then(r=>{if(!r.ok)throw new Error("Error al guardar")}).catch(()=>say("Cambios locales pendientes de sincronizar"))}function esc(v){return String(v||"").replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]))}function say(t){let e=document.querySelector("#toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2200)}
function go(v){document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));document.querySelector("#view-"+v).classList.remove("hidden");document.querySelectorAll(".nav button").forEach(x=>x.classList.toggle("active",x.dataset.view===v));drawTables();drawManual();drawCompanies();drawApplications()}document.querySelectorAll(".nav button").forEach(x=>x.onclick=()=>go(x.dataset.view));document.querySelectorAll("[data-goto]").forEach(x=>x.onclick=()=>go(x.dataset.goto));
function setInputs(){document.querySelector("#salarySet").value=data.settings.salary;document.querySelector("#targetSet").value=data.settings.target;document.querySelector("#rolesSet").value=data.settings.roles.join(", ");document.querySelector("#locationsSet").value=data.settings.locations;document.querySelector("#keywordsSet").value=(data.settings.keywords||[]).join(", ")}document.querySelector("#saveSettings").onclick=()=>{data.settings={salary:Number(document.querySelector("#salarySet").value)||55000,target:Number(document.querySelector("#targetSet").value)||50,roles:document.querySelector("#rolesSet").value.split(",").map(x=>x.trim()).filter(Boolean),locations:document.querySelector("#locationsSet").value,keywords:document.querySelector("#keywordsSet").value.split(",").map(x=>x.trim()).filter(Boolean)};save();say("Criterios guardados")};
function searchUrl(q){return "https://www.google.com/search?q="+encodeURIComponent(q)}
function launchSearch(url,label){
  window.open(url,"_blank","noopener,noreferrer");
  document.querySelector("#loopStatus").textContent="Consulta externa abierta: "+label+". El Radar no recibe sus resultados.";
}
function prepare(m){mode=m||mode;go("home");let selectedRole=document.querySelector("#role").value.trim(),roles=selectedRole?[selectedRole]:data.settings.roles,role=selectedRole||"todas las familias priorizadas",kw=document.querySelector("#keywords").value.trim()||(data.settings.keywords||[]).join(" "),loc=document.querySelector("#location").value.trim()||"España";let titles={companies_es:"Empresas tecnológicas en España · búsqueda inicial por sectores y regiones",companies_global:"Empresas tecnológicas globales · búsqueda inicial por mercados",offers:"Ofertas para "+(selectedRole||roles.length+" familias prioritarias"),keywords:"Ofertas con palabras clave: "+(kw||role)};document.querySelector("#planTitle").textContent=titles[mode];let company=mode.startsWith("companies"),steps=company?["Empieza con las consultas por sector y mercado que aparecen abajo; cada clic abre una búsqueda nueva.","Revisa los sitios de empleo oficiales y comprueba vacantes, ubicación, modalidad y contratación desde España.","Guarda las empresas u ofertas útiles con «Añadir resultado»; el directorio se amplía por ciclos y no es un censo cerrado."]:["Cada clic abre una consulta nueva. Empieza por las últimas 24 horas y amplía después a 72 horas y 7 días.","Comprueba en la fuente original que la oferta sigue abierta, su salario y si puedes trabajar desde España.","Guarda solo resultados nuevos y deduplica; para tras dos ciclos sin novedades verificadas."];document.querySelector("#planSteps").innerHTML=steps.map(x=>"<li>"+esc(x)+"</li>").join("");let queries=[];if(mode==="companies_es"){let sectors=["inteligencia artificial datos machine learning", "software SaaS cloud", "ciberseguridad", "fintech banca digital", "telecomunicaciones centros de datos", "consultoría tecnológica", "comercio electrónico marketplaces", "healthtech tecnología sanitaria", "movilidad logística", "robótica industria 4.0"];queries=sectors.map(s=>["España · "+s,"empresas tecnológicas "+s+" España empleo careers"]);["Madrid","Barcelona","Valencia","Málaga","Sevilla","Bilbao","Zaragoza","A Coruña"].forEach(city=>queries.push(["España · empresas en "+city,"empresas tecnológicas "+city+" careers empleo"]));queries.push(["España · directorios de empresas tecnológicas","directorio empresas tecnológicas startups España asociaciones clústeres"])}else if(mode==="companies_global"){[["Europa · remoto desde España","technology companies Europe remote hiring Spain careers data AI"],["Reino Unido e Irlanda","technology companies UK Ireland jobs remote Spain careers"],["Alemania, Francia y Benelux","technology companies Germany France Netherlands Belgium careers data AI"],["Nórdicos","technology companies Nordics Sweden Denmark Finland Norway careers remote"],["Estados Unidos y Canadá","technology companies US Canada remote hiring Spain international careers"],["Latinoamérica","technology companies Latin America careers remote international"],["India","technology companies India careers remote international data AI"],["Asia-Pacífico","technology companies Asia Pacific Australia Singapore careers remote international"],["Startups tecnológicas globales","global technology startups careers remote Spain"],["Empresas de IA y datos","global AI data infrastructure companies careers remote Spain"]].forEach(x=>queries.push(x))}else{let q=mode==="keywords"?(kw||role)+" jobs "+loc:roles.map(x=>'"'+x+'"').join(" OR ")+" jobs "+loc;let since24=new Date(Date.now()-86400000).toISOString().slice(0,10),since72=new Date(Date.now()-3*86400000).toISOString().slice(0,10),since7=new Date(Date.now()-7*86400000).toISOString().slice(0,10);queries=[["Web · últimas 24 h",q+" after:"+since24],["Páginas de empleo · últimas 72 h",q+" (careers OR jobs) after:"+since72],["Web · últimos 7 días",q+" after:"+since7],["LinkedIn · últimas 24 h",q+" site:linkedin.com/jobs/view after:"+since24],["Greenhouse y Lever · últimos 7 días",q+" (site:boards.greenhouse.io OR site:jobs.lever.co) after:"+since7]]}let urls=queries.map(x=>[x[0],searchUrl(x[1])]);document.querySelector("#queryLinks").innerHTML=urls.map(x=>'<a target="_blank" rel="noopener" href="'+x[1]+'" data-search-label="'+esc(x[0])+'">'+esc(x[0])+' ↗</a>').join("");document.querySelectorAll("#queryLinks a").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();launchSearch(a.href,a.dataset.searchLabel)}));document.querySelector("#plan").classList.add("show");document.querySelector("#loopStatus").textContent=urls.length+" consultas externas listas. Para registrar una ejecución con resultados, elige «Preparar búsqueda en ChatGPT».";document.querySelector("#plan").scrollIntoView({behavior:"smooth",block:"nearest"})}
document.querySelectorAll(".card[data-mode]").forEach(x=>x.onclick=()=>prepare(x.dataset.mode));document.querySelectorAll(".card[data-company-campaign]").forEach(x=>x.onclick=()=>runCompanyCampaign(x.dataset.companyCampaign));document.querySelector("#prepare").onclick=()=>prepare(mode);document.querySelector("#handoff").onclick=prepareHandoff;
function runCompanyCampaign(kind){let queries=[];if(kind==="companies_es"){["inteligencia artificial y datos","software SaaS y cloud","ciberseguridad","fintech y banca digital","telecomunicaciones y centros de datos","consultoría tecnológica","comercio electrónico y marketplaces","healthtech","movilidad y logística","robótica e industria 4.0"].forEach(s=>queries.push(["España · "+s,"empresas tecnológicas "+s+" España empleo careers"]));["Madrid","Barcelona","Valencia","Málaga","Sevilla","Bilbao","Zaragoza","A Coruña"].forEach(city=>queries.push(["España · "+city,"empresas tecnológicas "+city+" careers empleo"]));queries.push(["España · directorios y clústeres","directorio empresas tecnológicas startups España asociaciones clústeres"])}else{[["Europa · remoto desde España","technology companies Europe remote hiring Spain careers data AI"],["Reino Unido e Irlanda","technology companies UK Ireland jobs remote Spain careers"],["Alemania, Francia y Benelux","technology companies Germany France Netherlands Belgium careers data AI"],["Países nórdicos","technology companies Nordics Sweden Denmark Finland Norway careers remote"],["Estados Unidos y Canadá","technology companies US Canada remote hiring Spain international careers"],["Latinoamérica","technology companies Latin America careers remote international"],["India","technology companies India careers remote international data AI"],["Asia-Pacífico","technology companies Asia Pacific Australia Singapore careers remote international"],["Startups tecnológicas globales","global technology startups careers remote Spain"],["Empresas globales de IA y datos","global AI data infrastructure companies careers remote Spain"]].forEach(x=>queries.push(x))}let links=queries.map(x=>[x[0],searchUrl(x[1])]);document.querySelector("#companyCampaignLinks").innerHTML=links.map(x=>'<a href="'+x[1]+'" data-company-query="'+esc(x[0])+'">'+esc(x[0])+" ↗</a>").join("");document.querySelectorAll("#companyCampaignLinks a").forEach(a=>a.onclick=e=>{e.preventDefault();launchSearch(a.href,a.dataset.companyQuery)});document.querySelector("#companySearchStatus").textContent=links.length+" consultas disponibles. La primera se abre ahora; abre las demás por sector o mercado para ampliar el directorio.";launchSearch(links[0][1],links[0][0])}
async function runsApi(suffix="",options){
  const r=await fetch("/api/search-runs"+suffix,options);
  const value=await r.json();
  if(!r.ok)throw new Error(value.error||"No se pudo consultar la ejecución");
  return value;
}
function showRuns(runs){
  const list=document.createDocumentFragment();
  const states={prepared:"Pendiente de iniciar en ChatGPT",searching:"Buscando",saving:"Guardando",
    save_errors:"Guardado con errores",completed:"Completada"};
  for(const run of runs){
    const item=document.createElement("details"),title=document.createElement("summary"),body=document.createElement("p");
    title.textContent=new Date(run.created_at).toLocaleString("es-ES")+" · "+(run.origin==="manual"?"Manual":"Programada")+" · "+states[run.status]+" · "+run.id;
    const stats=run.summary;
    body.textContent=(run.filters.company?run.filters.company.name+" · ":"")+run.filters.location+" · "+run.filters.roles.join(", ")+(run.filters.keywords?" · "+run.filters.keywords:"")+" · Objetivo "+run.filters.target+
      (stats?" | Candidatas: "+run.found+" · Verificadas: "+run.verified+" · Nuevas: "+stats.created+
        " · Duplicadas: "+(run.batch_duplicates+stats.updated)+" · Pendientes de evidencia: "+run.pending.length+
        " · Errores de guardado: "+stats.errors:"");
    item.append(title,body);
    const notes=[...(run.limits||[]),...(run.pending||[]).map(x=>x.url+" · "+x.reason),
      ...(run.sources||[]).map(url=>"Fuente revisada: "+url),
      ...(run.entries||[]).filter(x=>x.status==="error").map(x=>x.offer.title+" · "+x.message)];
    for(const note of notes){const p=document.createElement("p");p.textContent=note;item.append(p)}
    if(run.status==="save_errors"||run.status==="saving"){
      const button=document.createElement("button");button.className="btn";button.textContent="Reintentar solo guardado";
      button.onclick=async()=>{button.disabled=true;try{showRuns([await runsApi("/"+run.id,{method:"POST"})]);await loadOffers()}
        catch(e){document.querySelector("#runStatus").textContent=e.message;button.disabled=false}};
      item.append(button);
    }
    list.append(item);
  }
  document.querySelector("#runs").replaceChildren(runs.length?list:document.createTextNode("Todavía no hay ejecuciones registradas"));

}
async function refreshRuns(){
  try{const result=await runsApi();showRuns(result.runs);document.querySelector("#rounds").textContent=result.runs.length;document.querySelector("#runStatus").textContent="";await loadOffers()}
  catch(e){document.querySelector("#runStatus").textContent=e.message}
}
async function prepareHandoff(company){
  company=company?.key?company:null;
  const button=document.querySelector("#handoff");
  button.disabled=true;
  try{
    const single=document.querySelector("#role").value.trim();
    const run=await runsApi("",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({filters:{
      mode:company?"company":mode,company:company?{name:company.name}:null,roles:company?[]:single?[single]:data.settings.roles,keywords:document.querySelector("#keywords").value.trim(),
      location:document.querySelector("#location").value.trim(),target:data.settings.target}})});
    document.querySelector("#runLookup").value=run.id;
    document.querySelector("#handoffText").value="Usa el Radar Data & AI privado. Consulta get_search_run con run_id "+run.id+
      ". Después llama a begin_search_run con el mismo ID. Usa sus filtros. Busca primero páginas oficiales de empleo y ATS; después portales y variantes de puestos e idiomas. "+
      "Comprueba fecha original, fecha de revisión, apertura, enlace de candidatura y elegibilidad desde España; copia la evidencia y marca estimaciones salariales. "+
      "Registra resultados con finish_search_run para este mismo ID, incluyendo offers, sources, pending, found y limits. "+
      "Cuenta como nuevas solo las confirmadas por summary.created. Si hay un fallo de escritura, usa retry_search_save con el mismo ID sin repetir la búsqueda.";
    if(company){
      document.querySelector("#handoffText").value+=" Esta ejecución es exclusivamente para "+company.name+
        ". Empieza por su portal oficial: "+(company.employment||"localízalo desde su web oficial")+
        ". Recorre páginas, filtros de ubicación y botones de continuación accesibles. Registra en sources cada página consultada y en limits las restricciones de acceso, paginación o cobertura observadas. "+
        "En offers usa el nombre del inventario como company y conserva ubicaciones. Registra evidencia empresarial aparte en company_eligibility (status, URL y cita textual) solo si una fuente respalda esa conclusión. Comprueba por separado la elegibilidad de cada vacante. No conviertas presencia en España en evidencia de contratación remota.";
      go("home");
    }
    document.querySelector("#runHandoff").hidden=false;
    showRuns([run]);
    document.querySelector("#runHandoff").scrollIntoView({block:"nearest"});
  }catch(e){document.querySelector("#runStatus").textContent=e.message}
  finally{button.disabled=false}
}
document.querySelector("#refreshRuns").onclick=refreshRuns;
document.querySelector("#findRun").onclick=async()=>{
  try{showRuns([await runsApi("/"+encodeURIComponent(document.querySelector("#runLookup").value.trim()))]);await loadOffers()}
  catch(e){document.querySelector("#runStatus").textContent=e.message}
};
function normalized(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(s\.?a\.?|s\.?l\.?|inc|ltd|limited|gmbh|group|company|the)\b/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function applied(x){return applicationState(x)}
function applicationStatus(x){return detectedApplication(x)||"Aplicado"}
function titleOverlap(a,b){let aa=new Set(normalized(a).split(" ").filter(x=>x.length>2)),bb=new Set(normalized(b).split(" ").filter(x=>x.length>2));if(!aa.size||!bb.size)return false;let both=[...aa].filter(x=>bb.has(x)).length;return both/Math.min(aa.size,bb.size)>=.65}
function priorApplication(company,title,url){return data.items.find(x=>applied(x)&&sameOffer(x,{company,title,url}))}
function roleTarget(title){let t=normalized(title);return ROLE_TARGETS.map(x=>({target:x,score:Math.max(0,...x.titles.map(a=>t.includes(normalized(a))?normalized(a).length:0))})).sort((a,b)=>b.score-a.score).find(x=>x.score)?.target||null}function salaryValues(text){let raw=String(text||"").toLowerCase(),matches=[...raw.matchAll(/(\d[\d.,]*)(\s*k)?/g)].map(m=>{let n=Number(m[1].replace(/[.,]/g,""));return m[2]?n*1000:(n<1000?n*1000:n)}).filter(Number.isFinite);return matches.length?[matches[0],matches[1]??matches[0]]:null}function salaryComparison(text,title){let target=roleTarget(title);if(!target||target.min==null)return "Familia sin banda";let n=salaryValues(text);if(!n)return "Salario sin dato";let [lo,hi]=n;if(hi<target.min)return "Por debajo de banda";if(lo>target.max)return "Por encima de banda";if(lo>=target.min&&hi<=target.max)return "Dentro de banda";return "Coincide parcialmente"}function moneyBand(x){return (x/1000).toLocaleString("es-ES")+"k €"}function renderSalaryBands(){let e=document.querySelector("#salaryBands");if(!e)return;e.innerHTML='<table class="table"><thead><tr><th>Familia prioritaria</th><th>Expectativa fija bruta anual</th></tr></thead><tbody>'+ROLE_TARGETS.map(x=>'<tr><td>'+esc(x.family)+'</td><td>'+(x.min==null?'Sin configurar':moneyBand(x.min)+'–'+moneyBand(x.max))+'</td></tr>').join("")+'</tbody></table>'}function table(items,canDelete=true,editableStatus=false){if(!items.length)return '<div class="empty">Aún no hay resultados guardados. Importa Ofertas o añade una candidatura para empezar.</div>';let statusCell=(x,i)=>editableStatus?'<select class="statusSelect" data-status="'+i+'">'+["Rechazado","Aplicado","En curso"].map(v=>'<option value="'+v+'"'+(applicationStatus(x)===v?' selected':'')+'>'+v+'</option>').join("")+ '</select><br><small>Vacante: '+esc(x.vacancy_status||"sin confirmar")+
  (x.application_status_changed_at?'<br>Estado actualizado: '+esc(new Date(x.application_status_changed_at).toLocaleString("es-ES")):"")+
  '</small>':esc(x.vacancy_status||x.status||"Seguimiento");return '<table class="table"><thead><tr><th>Empresa / puesto</th><th>Tipo</th><th>Ubicación</th><th>Estado</th><th>Fuente</th>'+(canDelete?'<th>Acciones</th>':'')+'</tr></thead><tbody>'+items.map((x,i)=>'<tr><td><b>'+esc(x.company)+'</b>'+(x.title?'<br>'+esc(x.title):"")+(canDelete&&x.type!=="company"?rankingDetails(x):"")+(x.dateApplied?'<br><small>Aplicada: '+esc(x.dateApplied)+'</small>':"")+'</td><td>'+(x.type==="company"?"Empresa":"Oferta")+'</td><td>'+esc(x.location||"—")+(x.salary?'<br>'+esc(x.salary):"")+(roleTarget(x.title)?'<br><small>Expectativa: '+moneyBand(roleTarget(x.title).min)+'–'+moneyBand(roleTarget(x.title).max)+' · '+salaryComparison(x.salary,x.title)+' · objetivo general &gt; 55k €</small>':"")+'</td><td>'+statusCell(x,i)+'</td><td>'+(safeOfferUrl(x.url)?'<a href="'+esc(safeOfferUrl(x.url))+'" target="_blank" rel="noopener">Abrir ↗</a>':"—")+'</td>'+(canDelete?'<td style="white-space:nowrap">'+(x.type!=="company"&&x.updated_at?
  '<label>Preferencia <select data-preference="'+i+'">'+["sin etiqueta","prioritaria","interesante","descartar"].map(label=>
  '<option'+((x.ranking_preference||"sin etiqueta")===label?' selected':'')+'>'+label+'</option>').join("")+'</select></label><br>':"")+(x.type!=="company"&&!applied(x)?'<button class="btn" data-applied="'+i+'">Marcar aplicada</button> ':'')+'<button class="btn" data-del="'+i+'">Eliminar</button></td>':'')+'</tr>').join("")+'</tbody></table>'}
function rankingDetails(offer){
  const rank=score(offer,ROLE_TARGETS),c=rank.components;
  const salary=rank.salary_published?(offer.salary_max_eur&&offer.salary_max_eur!==offer.salary_min_eur?
    Number(offer.salary_min_eur).toLocaleString("es-ES")+"–"+Number(offer.salary_max_eur).toLocaleString("es-ES"):
    Number(offer.salary_min_eur).toLocaleString("es-ES"))+" € publicados":"Salario sin confirmar";
  const mode=({remote:"Remoto",hybrid:"Híbrido",onsite:"Presencial"})[offer.remote_mode]||"Modalidad desconocida";
  const detail=[rank.role_family,mode+(rank.eligibility_confirmed?" · España confirmada":""),salary,...rank.skills_match].filter(Boolean).join(" · ");
  return '<br><small>'+esc(detail)+'</small><br><b>Encaje '+rank.interest_score+'/100</b> · '+esc(rank.certainty)+
    '<details><summary>Desglose</summary><small>Experiencia '+c.experience_fit+' · Transición '+c.career_growth+
      ' · Salario '+c.salary+' · Modalidad '+c.modality+' · Aprendizaje '+c.learning+'</small>'+
    (rank.exclusions.length||rank.unknowns.length?'<p>'+esc([...rank.exclusions,...rank.unknowns].join(" · "))+'</p>':'')+
    (rank.eligibility_evidence?'<p>'+esc(rank.eligibility_evidence)+'</p>':'')+'</details>';
}
function rankResults(items){
  const view=document.querySelector("#rankingView").value;
  const select=document.querySelector("#rankingFamily");
  if(select.options.length===1)for(const {family} of ROLE_TARGETS)select.add(new Option(family,family));
  const family=select.value;
  const rows=items.map((item,index)=>({item,index,score:score(item,ROLE_TARGETS)}))
    .filter(({item,score})=>(!family||score.role_family===family)&&
      (view==="all"||(item.type!=="company"&&(view==="excluded"?score.certainty==="excluida":score.certainty!=="excluida"&&!applied(item)))));
  rows.sort((a,b)=>Number(a.score.certainty==="excluida")-Number(b.score.certainty==="excluida")||
    b.score.interest_score-a.score.interest_score||a.index-b.index);
  const top=rows.filter(x=>x.item.type!=="company"&&x.score.certainty!=="excluida"&&!applied(x.item)).slice(0,10);
  const count=label=>top.filter(x=>x.item.ranking_preference===label).length;
  const labels=count("prioritaria")+count("interesante")+count("descartar");
  document.querySelector("#rankingCheck").textContent=top.length?
    "Primeras "+top.length+" · "+labels+" etiquetadas · "+count("prioritaria")+" prioritarias · "+count("interesante")+
    " interesantes · "+count("descartar")+" para descartar":"Sin oportunidades en esta vista";
  return rows.map(x=>x.item);
}
function drawTables(){let items=[...data.items].reverse();let recent=items.slice(0,5);let r=document.querySelector("#recent");if(r)r.innerHTML=table(recent,false);let f=(document.querySelector("#filter")?.value||"").toLowerCase(),t=(document.querySelector("#typeFilter")?.value||"all");let all=items.filter(x=>(t==="all"||x.type===t)&&(x.company+" "+(x.title||"")+" "+(x.location||"")).toLowerCase().includes(f));all=rankResults(all);let target=document.querySelector("#all");if(target)target.innerHTML=table(all,true);
document.querySelectorAll("#all [data-preference]").forEach(select=>select.onchange=async()=>{
  const item=all[Number(select.dataset.preference)],previous=item.ranking_preference;
  select.disabled=true;
  try{const r=await fetch("/api/ranking-preference",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({offer_id:item.offer_id,preference:select.value})});const result=await r.json();
    if(!r.ok)throw new Error(result.error);Object.assign(item,result.offer);localStorage.setItem(KEY,JSON.stringify(data));draw();say("Preferencia guardada");
  }catch(e){select.value=previous||"sin etiqueta";select.disabled=false;say(e.message);}
});document.querySelectorAll("#all [data-applied]").forEach(b=>b.onclick=()=>{let item=all[Number(b.dataset.applied)];if(!item)return;item.status="Aplicado";item.application_status="Aplicado";item.dateApplied=new Date().toISOString().slice(0,10);save();say("Candidatura registrada")});document.querySelectorAll("#all [data-del]").forEach(b=>b.onclick=()=>{let item=all[Number(b.dataset.del)];data.items=data.items.filter(x=>x!==item);save();say("Resultado eliminado")})}
function drawManual(){let pending=document.querySelector("#manualCandidates"),count=document.querySelector("#manualCount");if(!pending)return;let rows=manualCandidates.map(x=>'<tr><td><b>'+esc(x.company)+'</b><br>'+esc(x.title)+'<br><small>'+esc(x.jobId||"")+'</small></td><td>'+esc(x.location||"—")+(x.requirements?'<br><span class="manualMeta">'+esc(x.requirements)+'</span>':"")+'</td><td>'+esc(x.salary||"No publicado / pendiente de confirmar")+'</td><td>'+esc(x.published_at||"No confirmada")+'</td><td><span class="manualStatus">'+esc(x.status||"Pendiente de verificación")+'</span>'+(x.notes?'<br><span class="manualMeta">'+esc(x.notes)+'</span>':"")+'</td><td>'+(safeOfferUrl(x.url)?'<a href="'+esc(safeOfferUrl(x.url))+'" target="_blank" rel="noopener">Ficha de oferta ↗</a>':"—")+'</td></tr>').join("");pending.innerHTML=rows?'<table class="table manualTable"><thead><tr><th>Empresa / puesto</th><th>Ubicación / requisito</th><th>Salario</th><th>Publicación</th><th>Estado</th><th>Enlace</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="empty">No hay candidatos que requieran búsqueda manual.</div>';if(count)count.textContent=String(manualCandidates.length)}
 function companyOffersUrl(item,profileOnly){let domain="";try{domain=new URL(item.url).hostname.replace(/^www\./,"")}catch{}let org=domain?"site:"+domain:'"'+String(item.company||"").replace(/"/g," ").trim()+'"',q=org+" (jobs OR careers OR vacancies OR openings OR empleo OR vacantes)";if(profileOnly){let roles=[...new Set(ROLE_TARGETS.flatMap(x=>x.titles))],terms=[...roles,...(data.settings.keywords||[])].filter(Boolean).map(x=>'"'+x+'"');q+=" ("+terms.join(" OR ")+")"}return searchUrl(q)}
async function showCompanyReview(company){
  const target=document.querySelector("#companyReview");
  const identity=document.createElement("p");
  identity.textContent=[company.domain,company.country,company.sector].filter(Boolean).join(" · ");
  target.append(identity);
  const button=document.createElement("button");button.className="btn";button.textContent="Buscar ofertas de esta empresa";
  button.onclick=()=>prepareHandoff(company);target.append(button);
  try{
    const {runs}=await runsApi("?company="+encodeURIComponent(company.key));
    const latest=runs.find(run=>run.completed_at);
    const status=document.createElement("p");
    status.textContent=latest?"Última revisión: "+new Date(latest.completed_at).toLocaleString("es-ES")+
      " · "+latest.verified+" vacantes abiertas y elegibles verificadas · "+latest.sources.length+
      " fuentes consultadas · "+latest.pending.length+" enlaces pendientes":"Aún no hay una revisión completada";
    target.append(status);
    const evidence=runs.find(run=>run.company_eligibility)?.company_eligibility;
    if(evidence){const p=document.createElement("p");p.textContent="Evidencia de empresa ("+
      ({confirmed:"confirmada",restricted:"restringida",unknown:"sin confirmar"})[evidence.status]+
      "): "+evidence.quote+" ";const a=document.createElement("a");a.href=evidence.url;
      a.target="_blank";a.rel="noopener";a.textContent="Fuente";p.append(a);target.append(p)}
    if(latest){
      const details=document.createElement("button");details.className="btn";details.textContent="Ver fuentes, pendientes y límites";
      details.onclick=async()=>{try{showRuns([await runsApi("/"+latest.id)]);go("home")}
        catch(e){say(e.message)}};target.append(details);
    }
  }catch(e){const p=document.createElement("p");p.textContent=e.message;target.append(p)}
}
function drawCompanies(){let list=document.querySelector("#companiesList");if(!list)return;let byName=new Map();for(let record of directoryRecords){let key=normalized(record.name),entry=byName.get(key);if(!entry){entry={company:record.name,directory:record,offers:[],location:"",sector:"",url:"",employment:"",explicit:false};byName.set(key,entry)}else if(!entry.directory)entry.directory=record;let sources=record.sources||[],spain=sources.find(x=>x.source==="España")?.fields||{},global=sources.find(x=>x.source==="Global")?.fields||{};entry.location=spain["Presencia / ciudades en España"]||global["Ubicaciones principales (representativas)"]||global["País sede"]||"";entry.sector=spain["Sector principal"]||global["Sector"]||"";entry.url=spain["Web oficial"]||global["Web"]||"";entry.employment=record.employment||"";entry.url=record.web||entry.url}for(let item of data.items){if(!item.company)continue;let key=normalized(item.company),entry=byName.get(key);if(!entry){entry={company:item.company,directory:null,offers:[],location:item.location||"",sector:"",url:item.type==="company"?(item.url||""):(item.url||""),employment:"",explicit:item.type==="company"};byName.set(key,entry)}if(item.type==="company"){entry.explicit=true;entry.url=item.url||entry.url}else if(item.type!=="company"){entry.offers.push(item);if(!entry.location)entry.location=item.location||""}}let all=[...byName.values()].sort((a,b)=>a.company.localeCompare(b.company,"es")),filter=normalized(document.querySelector("#companyFilter")?.value||"");let companies=all.filter(x=>!filter||normalized([x.company,x.location,x.sector,x.url,x.employment,JSON.stringify(x.directory?.sources||[]),...x.offers.map(o=>o.title)].join(" ")).includes(filter));let count=document.querySelector("#companyCount");if(count)count.textContent=companies.length+" de "+all.length+" empresas · "+directoryRecords.length+" fichas en los dos inventarios · "+all.filter(x=>x.offers.length).length+" con ofertas guardadas en Radar.";if(!companies.length){list.innerHTML='<div class="empty">No hay coincidencias con ese filtro.</div>';return}list.innerHTML='<table class="table"><thead><tr><th>Empresa</th><th>Sector</th><th>Ubicación / región</th><th>Origen</th><th>Empleo</th><th>Ficha</th></tr></thead><tbody>'+companies.map((x,i)=>{let sourceLabels=(x.directory?.sources||[]).map(s=>s.source),origin=sourceLabels.length?sourceLabels.join(" + ")+(x.offers.length?" + Radar":""):(x.explicit?"Añadida en Radar":"Solo en ofertas de Radar");let portal=safeOfferUrl(x.employment)?'<a href="'+esc(safeOfferUrl(x.employment))+'" target="_blank" rel="noopener">Portal oficial ↗</a>':'—';return '<tr><td><b>'+esc(x.company)+'</b>'+(x.offers.length?'<br><small>'+x.offers.length+' oferta'+(x.offers.length===1?"":"s")+' en Radar</small>':'')+'</td><td>'+esc(x.sector||"—")+'</td><td>'+esc(x.location||"—")+'</td><td>'+esc(origin)+'</td><td>'+portal+'</td><td class="companyActions">'+(safeOfferUrl(x.url)?'<a href="'+esc(safeOfferUrl(x.url))+'" target="_blank" rel="noopener">Web ↗</a> ':'')+'<button class="btn" data-company-detail="'+i+'">Ver ficha</button>'+(x.directory?.key?'<button class="btn" data-company-search="'+i+'">Buscar ofertas de esta empresa</button>':'')+'</td></tr>'}).join("")+'</tbody></table>';list.querySelectorAll("[data-company-search]").forEach(button=>button.onclick=()=>prepareHandoff(companies[Number(button.dataset.companySearch)].directory));list.querySelectorAll("[data-company-detail]").forEach(b=>b.onclick=()=>{let x=companies[Number(b.dataset.companyDetail)];if(!x)return;let panel=document.querySelector("#companyDetails");let showValue=v=>{if(v==null||v==="")return '<span style="color:#829096">No consta</span>';let text=String(v);return /^https?:\/\//i.test(text)?'<a href="'+esc(text)+'" target="_blank" rel="noopener">'+esc(text)+' ↗</a>':esc(text)};let sources=x.directory?.sources||[];let records=sources.map(src=>'<div class="companySource"><h3>'+esc(src.source)+" · datos del inventario"+'</h3><div class="companyFields">'+Object.entries(src.fields||{}).map(([k,v])=>'<div class="companyField"><b>'+esc(k)+'</b>'+showValue(v)+'</div>').join("")+'</div></div>').join("");let offerList=x.offers.length?'<div class="companySource"><h3>Ofertas ya guardadas en Radar</h3><div class="companyFields">'+x.offers.map(o=>'<div class="companyField"><b>'+esc(o.title||"Oferta")+'</b>'+esc([o.location,o.status].filter(Boolean).join(" · ")||"Estado sin registrar")+(safeOfferUrl(o.url)?'<br><a href="'+esc(safeOfferUrl(o.url))+'" target="_blank" rel="noopener">Abrir fuente ↗</a>':"")+'</div>').join("")+'</div></div>':"";panel.innerHTML='<div class="head"><div><h2>'+esc(x.company)+'</h2><p>Ficha consolidada · fuentes y campos conservados por separado.</p></div><button class="btn" id="closeCompanyDetails">Cerrar ficha</button></div>'+'<div id="companyReview"></div>'+(records||'<p class="sub">Empresa registrada en Radar; los inventarios no contienen ficha adicional.</p>')+offerList;panel.classList.remove("hidden");if(x.directory?.key)showCompanyReview(x.directory);document.querySelector("#closeCompanyDetails").onclick=()=>panel.classList.add("hidden");panel.scrollIntoView({behavior:"smooth",block:"start"})});}
 document.querySelector("#companyFilter").oninput=drawCompanies;document.querySelector("#addCompany").onclick=()=>{open();document.querySelector("#kind").value="company";document.querySelector("#titleField").classList.add("hidden");document.querySelector("#company").focus()};
 function drawApplications(){let target=document.querySelector("#applications");if(!target)return;let apps=data.items.filter(applied).slice().reverse();target.innerHTML=table(apps,false,true);target.querySelectorAll("[data-status]").forEach(sel=>sel.onchange=async()=>{let item=apps[Number(sel.dataset.status)];if(!item)return;let previous=item.status,previousApplication=item.application_status;item.status=sel.value;item.application_status=sel.value;localStorage.setItem(KEY,JSON.stringify(data));draw();try{let r=await fetch("/api/offers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({offers:[{offer_id:item.offer_id,company:item.company,title:item.title,url:item.url,application_status:sel.value,status:sel.value,dateApplied:item.dateApplied}],edit_application:true})}),v=await r.json();if(!r.ok)throw new Error(v.error||("HTTP "+r.status));Object.assign(item,v.offers[0]);localStorage.setItem(KEY,JSON.stringify(data));draw();say("Estado de candidatura guardado")}catch(e){item.status=previous;item.application_status=previousApplication;localStorage.setItem(KEY,JSON.stringify(data));draw();say("No se pudo guardar el estado; inténtalo de nuevo")}})}
function drawDuplicateReview(){
  const target=document.querySelector("#duplicateReview");
  const pairs=reviewPairs(data.items.filter(item=>item.type!=="company" && item.offer_id && item.updated_at));
  const list=document.createDocumentFragment();
  for(const {a,b,reasons} of pairs){
    const row=document.createElement("p");
    row.textContent=a.company+" · "+reasons.join(", ")+" ";
    for(const item of [a,b]){
      const link=document.createElement(safeOfferUrl(item.url)?"a":"span");
      link.textContent=item.title+" ("+(item.location||"ubicación sin confirmar")+")";
      if(link.tagName==="A"){link.href=safeOfferUrl(item.url);link.target="_blank";link.rel="noopener";}
      row.append(link," · ");
    }
    const button=document.createElement("button");
    button.className="btn";
    button.textContent="Confirmar misma vacante";
    button.onclick=async()=>{
      if(!confirm("¿Has comprobado que las dos fichas corresponden a la misma vacante?"))return;
      button.disabled=true;
      try{
        const r=await fetch("/api/offers/merge",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({first:a.offer_id,second:b.offer_id})});
        const result=await r.json();
        if(!r.ok)throw new Error(result.error);
        data.items=data.items.filter(item=>![a,b].some(old=>old.offer_id===item.offer_id));
        data.items.push(result.offer);
        localStorage.setItem(KEY,JSON.stringify(data));
        draw();
        say("Fuentes reunidas");
      }catch(error){button.disabled=false;say(error.message||"No se pudo confirmar la coincidencia");}
    };
    row.append(button);list.append(row);
  }
  target.replaceChildren(pairs.length?list:document.createTextNode("Sin coincidencias pendientes"));
}
 function draw(){let offers=data.items.filter(x=>x.type!=="company");document.querySelector("#jobs").textContent=offers.length;document.querySelector("#priorityCount").textContent=offers.filter(x=>!applied(x)&&score(x,ROLE_TARGETS).priority).length;document.querySelector("#applicationsCount").textContent=offers.filter(applied).length;document.querySelector("#pending").textContent=offers.filter(x=>!applied(x)&&/confirm|desconoc|no publicado|pendiente/i.test([x.status,x.salary,x.salary_comparison,x.salary_vs_general_target].filter(Boolean).join(" "))).length;document.querySelector("#chips").innerHTML='<span class="chip">Salario &gt; '+Number(data.settings.salary).toLocaleString("es-ES")+' €</span><span class="chip">'+data.settings.roles.length+' familias profesionales</span><span class="chip">España · Europa · remoto viable</span><span class="chip">'+data.settings.target+' resultados objetivo</span>';setInputs();renderSalaryBands();drawTables();drawManual();drawCompanies();drawApplications()}
document.querySelector("#rankingFamily").onchange=drawTables;document.querySelector("#rankingView").onchange=drawTables;document.querySelector("#filter").oninput=drawTables;document.querySelector("#typeFilter").onchange=drawTables;
function open(){document.querySelector("#titleField").classList.toggle("hidden",document.querySelector("#kind").value==="company");document.querySelector("#modal").classList.add("show");document.querySelector("#duplicateNotice").classList.add("hidden")}function close(){document.querySelector("#modal").classList.remove("show");document.querySelector("#form").reset();document.querySelector("#titleField").classList.remove("hidden");document.querySelector("#dateAppliedWrap").classList.add("hidden");document.querySelector("#duplicateNotice").classList.add("hidden")}document.querySelector("#addOpen").onclick=open;document.querySelector("#addOpen2").onclick=open;document.querySelector("#addApplied").onclick=()=>{open();document.querySelector("#kind").value="job";document.querySelector("#status").value="Aplicada";document.querySelector("#dateAppliedWrap").classList.remove("hidden");document.querySelector("#dateApplied").value=new Date().toISOString().slice(0,10)};document.querySelector("#close").onclick=close;document.querySelector("#kind").onchange=e=>document.querySelector("#titleField").classList.toggle("hidden",e.target.value==="company");document.querySelector("#status").onchange=e=>{let show=e.target.value==="Aplicada";document.querySelector("#dateAppliedWrap").classList.toggle("hidden",!show);if(show&&!document.querySelector("#dateApplied").value)document.querySelector("#dateApplied").value=new Date().toISOString().slice(0,10)};
function updateDuplicateNotice(){let match=priorApplication(document.querySelector("#company").value,document.querySelector("#title").value,document.querySelector("#url").value);let box=document.querySelector("#duplicateNotice");if(match){box.textContent="⚠ Ya consta una candidatura a «"+(match.title||"este puesto")+"» en "+match.company+(match.dateApplied?" ("+match.dateApplied+")":"")+". Comprueba la ficha antes de guardar otra fuente.";box.classList.remove("hidden")}else box.classList.add("hidden")}
document.querySelector("#company").addEventListener("input",updateDuplicateNotice);document.querySelector("#title").addEventListener("input",updateDuplicateNotice);document.querySelector("#url").addEventListener("input",updateDuplicateNotice);
document.querySelector("#form").onsubmit=e=>{e.preventDefault();let url=document.querySelector("#url").value.trim(),company=document.querySelector("#company").value.trim(),title=document.querySelector("#title").value.trim(),status=document.querySelector("#status").value,type=document.querySelector("#kind").value;if(url&&!safeOfferUrl(url)){say("Introduce un enlace HTTP o HTTPS válido");return}if(url&&data.items.some(x=>x.url===url)){say("Esta URL ya está guardada");return}let match=type==="job"?priorApplication(company,title,url):null;if(match&&status!=="Aplicada"&&!confirm("Ya aplicaste a «"+(match.title||title)+"» en "+match.company+(match.dateApplied?" el "+match.dateApplied:"")+". ¿Quieres guardar igualmente esta fuente como referencia?"))return;let dateApplied=status==="Aplicada"?(document.querySelector("#dateApplied").value||new Date().toISOString().slice(0,10)):"";const item={offer_id:"local:"+crypto.randomUUID(),type,company,title,location:document.querySelector("#place").value.trim(),salary:document.querySelector("#salary").value.trim(),url,status,dateApplied,date:new Date().toISOString()};const existing=data.items.findIndex(old=>sameOffer(old,item));if(existing===-1)data.items.push(item);else data.items[existing]=mergeOffer(data.items[existing],{...item,offer_id:data.items[existing].offer_id});save();close();say(match?"Aviso de candidatura revisado":"Resultado guardado")};
function parseCSV(text){let first=text.split(/\r?\n/,1)[0]||"",delims=[",",";","\t"],delimiter=delims.sort((a,b)=>first.split(b).length-first.split(a).length)[0],rows=[],row=[],field="",quoted=false;for(let i=0;i<text.length;i++){let c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"')quoted=true;else if(c===delimiter){row.push(field);field=""}else if(c==="\n"){row.push(field);rows.push(row);row=[];field=""}else if(c!=="\r")field+=c}if(field||row.length){row.push(field);rows.push(row)}if(!rows.length)return[];let heads=rows.shift().map(x=>normalized(x));return rows.filter(r=>r.some(x=>String(x).trim())).map(r=>Object.fromEntries(heads.map((h,i)=>[h,String(r[i]||"").trim()]))) }
function getField(row,names){for(let n of names){let v=row[normalized(n)];if(v)return v}return ""}function toImportItem(x,forceApplied){let company=getField(x,["company","empresa","compania","organizacion","employer","organization"]),title=getField(x,["title","puesto","cargo","position","job title","vacante","role"]),url=getField(x,["url","enlace","link","job url","oferta"]),rawStatus=getField(x,["status","estado","application status","estado candidatura"]),dateApplied=getField(x,["date applied","fecha aplicacion","fecha de aplicacion","application date","applied on","applied date"]),status=forceApplied?(detectedApplication({status:rawStatus,dateApplied})||"Aplicado"):(rawStatus||(dateApplied?"Aplicado":"Seguimiento"));if(/applied|aplicad|enviad|submitted/i.test(status))status="Aplicada";return company?{offer_id:x["offer id"]||"local:"+crypto.randomUUID(),requisition_source:getField(x,["requisition source"]),requisition_id:getField(x,["requisition id"]),type:"job",company,title,location:getField(x,["location","ubicacion","localizacion"]),salary:getField(x,["salary","salario","compensacion"]),url,status,dateApplied,application_status:detectedApplication({status,dateApplied}),date:new Date().toISOString()}:null}
function importRows(rows){let n=0,dups=0,invalidUrls=0,force=document.querySelector("#markImportedApplied")?.checked!==false;for(let x of rows){let item=toImportItem(x,force);if(!item)continue;if(item.url&&!safeOfferUrl(item.url)){invalidUrls++;continue}let index=data.items.findIndex(old=>sameOffer(old,item));if(index!==-1){let old=data.items[index];data.items[index]=mergeOffer(old,{...item,offer_id:old.offer_id});dups++;continue}data.items.push(item);n++}save();say(n+" candidaturas importadas · "+dups+" duplicadas omitidas · "+invalidUrls+" enlaces inválidos omitidos")}
document.querySelector("#export").onclick=()=>{let a=document.createElement("a"),u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.href=u;a.download="radar-data-ai-resultados.json";a.click();URL.revokeObjectURL(u)};document.querySelector("#import").onclick=()=>document.querySelector("#file").click();document.querySelector("#importApps").onclick=()=>document.querySelector("#file").click();document.querySelector("#file").onchange=async e=>{try{let file=e.target.files[0];if(!file)return;let text=await file.text(),rows;if(file.name.toLowerCase().endsWith(".csv")){rows=parseCSV(text)}else{let j=JSON.parse(text);rows=Array.isArray(j)?j:(j.applications||j.items||j.offers||[]);rows=rows.map(x=>({"offer id":x.offer_id,"requisition source":x.requisition_source,"requisition id":x.requisition_id,company:x.company||x.empresa||x.employer,title:x.title||x.puesto||x.position||x.role,url:x.url||x.link||x.enlace,status:x.application_status||x.applicationStatus||x.status||x.estado,"date applied":x.dateApplied||x.applicationDate||x.fechaAplicacion,location:x.location||x.ubicacion,salary:x.salary||x.salario}))}importRows(rows)}catch{say("No se pudo leer el archivo. Usa CSV o JSON.")}e.target.value=""};
function validateSearchOffer(o,now=Date.now()){
 const errors=[],parsed=Date.parse(o.published_at),checked=Date.parse(o.checked_at);
 if(!o.company||!o.title)errors.push("Faltan empresa o puesto");
 if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(o.published_at||"")||!Number.isFinite(parsed)||parsed>now||now-parsed>7*86400000)errors.push("Publicación no confirmada dentro de los últimos 7 días");
 if(!Number.isFinite(checked)||checked>now+60000||now-checked>86400000)errors.push("Comprobación ausente o no reciente");
 if(o.verification?.open!==true||o.verification?.application_active!==true||o.verification?.eligible_from_spain!==true)errors.push("Falta evidencia explícita de apertura, candidatura activa o elegibilidad desde España");
 if(!canonicalOfferUrl(o.url)||!canonicalOfferUrl(o.verification?.application_url)||!o.source_urls?.length)errors.push("Faltan enlaces de oferta, candidatura o fuentes");
 if(!o.role_family||!o.salary_comparison||!Number.isFinite(o.score_percent))errors.push("Faltan familia, comparación salarial o puntuación");
 if(o.salary_published!==false&&o.salary_min_eur!=null&&(o.salary_max_eur??o.salary_min_eur)<55000)errors.push("Salario inferior al objetivo");
 if(/cerrad|closed|filled/i.test(o.vacancy_status||o.status||""))errors.push("Vacante cerrada");
 return errors;
}


async function loadPendingLinks(){
  const target=document.querySelector("#pendingLinks");
  try{
    const response=await fetch("/api/pending-links",{cache:"no-store"});
    const pending=await response.json();
    if(!response.ok)throw new Error(pending.error);
    const grid=document.createElement("table");grid.className="table";
    grid.innerHTML="<thead><tr><th>Empresa</th><th>Puesto</th><th>Fuente</th><th>Motivo</th><th>Último intento</th><th>Estado</th><th>Acciones</th></tr></thead>";
    const body=grid.createTBody();
    for(const item of pending.rows){
      const row=body.insertRow();
      row.insertCell().textContent=item.company||"—";
      row.insertCell().textContent=item.title||"—";
      const source=row.insertCell();
      if(safeOfferUrl(item.url)){const link=document.createElement("a");link.href=safeOfferUrl(item.url);
        link.target="_blank";link.rel="noopener";link.textContent="Abrir fuente";source.append(link)}
      row.insertCell().textContent=item.reason;
      row.insertCell().textContent=new Date(item.last_attempt_at).toLocaleString("es-ES");
      const state=row.insertCell();
      state.textContent=({pending:"Pendiente",reviewed:"Revisado",retrying:"Reintento preparado",resolved:"Resuelto"})[item.state];
      if(item.offer_id) {const button=document.createElement("button");button.className="btn";button.textContent="Ver vacante guardada";
        button.onclick=()=>{const offer=data.items.find(offer=>offer.offer_id===item.offer_id);if(offer){go("results");document.querySelector("#filter").value=offer.title;drawTables()}};
        state.append(" ",button)}
      const actions=row.insertCell();
      if(item.state==="resolved")continue;
      for(const [action,label] of [["retry",item.kind==="save"?"Reintentar guardado":"Reintentar verificación"],["review","Marcar como revisado"]]){
        const button=document.createElement("button");button.className="btn";button.textContent=label;
        button.disabled=action==="review"&&item.state==="reviewed";
        button.onclick=async()=>{button.disabled=true;try{
          const r=await fetch("/api/pending-links",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({run_id:item.run_id,index:item.index,kind:item.kind,action})});
          const info=await r.json();if(!r.ok)throw new Error(info.error);
          if(info.retry){
            go("home");document.querySelector("#runLookup").value=info.retry.id;
            document.querySelector("#handoffText").value="En el Radar Data & AI privado consulta get_search_run y llama a begin_search_run con el ID "+info.retry.id+
              ". Revisa solo la URL de retry_source, con fuentes alternativas si es necesario. Conserva su URL original en source_urls cuando verifiques la misma vacante. Registra el resultado con finish_search_run para este ID, incluyendo evidence en eligibility_evidence, o pending con el motivo si sigue sin verificarse.";
            document.querySelector("#runHandoff").hidden=false;document.querySelector("#runHandoff").scrollIntoView();
          }
          if(info.run)await loadOffers();
          await loadPendingLinks();
        }catch(e){say(e.message);button.disabled=false}};
        actions.append(button);
      }
    }
    target.replaceChildren(pending.rows.length?grid:document.createTextNode("Sin enlaces pendientes registrados"));
  }catch(e){target.textContent=e.message||"No se pudieron cargar los enlaces pendientes"}
}
async function loadManualCandidates(){try{const r=await fetch("/api/manual-candidates",{cache:"no-store"}),v=await r.json();if(!r.ok)throw new Error(v.error||("Error HTTP "+r.status));manualCandidates=Array.isArray(v.candidates)?v.candidates:[];drawManual()}catch(e){console.error("Radar: no se pudo cargar Búsqueda manual",e)}}
async function loadOffers(){let status=document.querySelector("#dataStatus");if(status)status.textContent="Cargando ofertas del historial guardado…";try{let r=await fetch("/api/offers",{cache:"no-store"}),v=await r.json();if(!r.ok)throw new Error(v.error||("Error HTTP "+r.status));if(!Array.isArray(v.offers))throw new Error("La respuesta del historial no contiene una lista de ofertas");const all=v.offers.map(x=>({...x,type:x.type||"job"}));for(const x of data.items){const index=all.findIndex(old=>sameOffer(old,x));if(index===-1)all.push(x);else all[index]=mergeOffer(x,all[index],true)}data.items=all;localStorage.setItem(KEY,JSON.stringify(data));draw();if(status)status.textContent="Historial sincronizado · "+data.items.filter(x=>x.type!=="company").length+" ofertas disponibles"}catch(e){if(status)status.textContent="No se pudo cargar el historial guardado. Comprueba tu conexión y pulsa «Actualizar historial».";console.error("Radar: no se pudo cargar /api/offers",e)}}
draw();document.querySelector("#reloadHistory").onclick=loadOffers;loadOffers();loadManualCandidates();loadPendingLinks();runsApi().then(v=>{showRuns(v.runs);document.querySelector("#rounds").textContent=v.runs.length}).catch(e=>{document.querySelector("#runStatus").textContent=e.message});fetch("/api/companies",{cache:"no-store"}).then(r=>r.json()).then(v=>{directoryRecords=Array.isArray(v.companies)?v.companies:[];drawCompanies()}).catch(e=>{console.error("Radar: no se pudo cargar el directorio",e);let c=document.querySelector("#companyCount");if(c)c.textContent="No se pudo cargar el directorio importado; las ofertas guardadas siguen disponibles."});
</script></body></html>`;

const normalizedDirectory=companyDirectory.map(normalizeCompany);
function resolveCompanyFilters(input) {
  const key=companyKey(input.filters?.company?.name);
  if(!key)return {...input,filters:{...input.filters,company:null}};
  const company=normalizedDirectory.find(record=>record.key===key);
  if(!company)throw new Error("La empresa no está en el inventario");
  return {...input,filters:{...input.filters,company:companyScope(company)}};
}

const toolDefinitions = [
 {name:"start_search_run",description:"Registra una nueva búsqueda programada y devuelve su ID para asociar el resultado.",inputSchema:{type:"object",properties:{filters:{type:"object",additionalProperties:true}},additionalProperties:false}},
 {name:"begin_search_run",description:"Marca como iniciada una búsqueda manual preparada.",inputSchema:{type:"object",properties:{run_id:{type:"string"}},required:["run_id"],additionalProperties:false}},
 {name:"get_search_run",description:"Consulta filtros y resultado de una búsqueda registrada.",inputSchema:{type:"object",properties:{run_id:{type:"string"}},required:["run_id"],additionalProperties:false}},
 {name:"finish_search_run",description:"Registra las fuentes, verificaciones y límites de una ejecución y guarda el lote. Reutiliza el ID de la ejecución.",inputSchema:{type:"object",properties:{run_id:{type:"string"},offers:{type:"array",items:{type:"object",additionalProperties:true}},sources:{type:"array",items:{type:"string"}},pending:{type:"array",items:{type:"object",additionalProperties:true}},found:{type:"integer"},limits:{type:"array",items:{type:"string"}},company_eligibility:{type:"object",properties:{status:{type:"string",enum:["confirmed","restricted","unknown"]},url:{type:"string"},quote:{type:"string"}},required:["status","url","quote"],additionalProperties:false}},required:["run_id","offers"],additionalProperties:false}},
 {name:"retry_search_save",description:"Reintenta solo el guardado de fichas verificadas de una ejecución.",inputSchema:{type:"object",properties:{run_id:{type:"string"}},required:["run_id"],additionalProperties:false}},

 {name:"get_search_profile",description:"Devuelve los criterios configurados para las búsquedas de empleo.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"build_search_plan",description:"Genera consultas y un protocolo iterativo para buscar empresas u ofertas.",inputSchema:{type:"object",properties:{mode:{type:"string",enum:["companies_es","companies_global","offers","keywords"]},roles:{type:"array",items:{type:"string"}},keywords:{type:"array",items:{type:"string"}},location:{type:"string"},target_count:{type:"integer",minimum:1,maximum:100}},required:["mode"],additionalProperties:false}},
 {name:"get_offer_history",description:"Devuelve ofertas guardadas y candidaturas ya registradas para comprobar duplicados entre ciclos.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"store_job_offers",description:"Guarda ofertas verificadas en Resultados. Para candidatos sin datos suficientes, acepta manual_only:true y los guarda separadamente en Búsqueda manual; nunca los cuenta como ofertas verificadas.",inputSchema:{type:"object",properties:{offers:{type:"array",items:{type:"object",properties:{company:{type:"string"},title:{type:"string"},url:{type:"string"},requisition_source:{type:"string"},requisition_id:{type:"string"},offer_id:{type:"string"},eligibility_evidence:{type:"string"},vacancy_status:{type:"string"},source_urls:{type:"array",items:{type:"string"}},location:{type:"string"},salary:{type:"string"},salary_min_eur:{type:"number"},salary_max_eur:{type:"number"},role_family:{type:"string"},published_at:{type:"string"},checked_at:{type:"string"},salary_comparison:{type:"string"},verification:{type:"object",properties:{open:{type:"boolean"},application_active:{type:"boolean"},eligible_from_spain:{type:"boolean"},application_url:{type:"string"}},required:["open","application_active","eligible_from_spain","application_url"]},status:{type:"string"},dateApplied:{type:"string"},manual_only:{type:"boolean"},jobId:{type:"string"},requirements:{type:"string"},score_percent:{type:"number"}},required:["company","title"],additionalProperties:true}}},required:["offers"],additionalProperties:false}},
 {name:"mark_offer_applied",description:"Registra una candidatura para evitar que vuelva a aparecer como nueva.",inputSchema:{type:"object",properties:{offer_id:{type:"string"},url:{type:"string"},company:{type:"string"},title:{type:"string"},dateApplied:{type:"string"}},additionalProperties:false}},
 {name:"score_job_offer",description:"Clasifica una oferta según salario, elegibilidad y encaje profesional.",inputSchema:{type:"object",properties:{title:{type:"string"},company:{type:"string"},country:{type:"string"},remote_mode:{type:"string",enum:["remote","hybrid","onsite","unknown"]},eligible_from_spain:{type:"boolean"},salary_min_eur:{type:"number"},salary_max_eur:{type:"number"},salary_published:{type:"boolean"},fit_percent:{type:"number",minimum:0,maximum:100},career_growth_percent:{type:"number",minimum:0,maximum:100},learning_percent:{type:"number",minimum:0,maximum:100},office_days_per_week:{type:"number"},status:{type:"string"},vacancy_status:{type:"string"},eligibility_evidence:{type:"string"},verification:{type:"object",additionalProperties:true},skills_match:{type:"array",items:{type:"string"}},role_family:{type:"string"}},required:["title","company"],additionalProperties:false}},
 {name:"deduplicate_offer_batch",description:"Deduplica automáticamente frente al lote y al historial persistente por requisición del ATS o URL específica. Incluye coincidencias con candidaturas registradas y already_applied.",inputSchema:{type:"object",properties:{offers:{type:"array",items:{type:"object",properties:{company:{type:"string"},title:{type:"string"},url:{type:"string"},location:{type:"string"},status:{type:"string"}},required:["company","title"],additionalProperties:true}},already_applied:{type:"array",items:{type:"object",properties:{company:{type:"string"},title:{type:"string"},url:{type:"string"},dateApplied:{type:"string"}},required:["company","title"],additionalProperties:true}}},required:["offers"],additionalProperties:false}}
];
const profile={location:"España",current_role:"Data Engineer",career_goals:["AI Engineer","AI Lead con liderazgo de proyectos y criterio técnico","Data Architect"],salary_target_min_eur:55000,roles:roleTargets.map(x=>x.family),geography:{priority:["España","Europa"],remote:"Global si acepta contratación desde España y horario compatible",hybrid_outside_spain:"Solo 1–2 días presenciales por semana"},salary_rules:{exclude_below_target:true,crossing_band:"por confirmar",unpublished:"admitir si está verificada; salario no confirmado y menor prioridad"},score_weights:{experience_fit:30,career_growth:25,salary:20,modality:15,learning:10},delivery:{target:50,never_invent:true,explain_shortfall:true,deduplicate:true},actions_prohibited:["enviar candidaturas","contactar empresas"]};
const ok=value=>({content:[{type:"text",text:JSON.stringify(value)}]});
function searchPlan(a){let roles=a.roles?.length?a.roles:roleTargets.map(x=>x.family),keys=a.keywords||[],loc=a.location||"España y Europa; remoto prioritario",target=a.target_count||50,now=new Date(),windows=[24,72,168].map(hours=>({hours,since:new Date(now.getTime()-hours*3600000).toISOString()})),norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),selected=roles.flatMap(r=>{let family=roleTargets.find(x=>norm(x.family)===norm(r));if(family)return family.titles;return String(r).split(/\s*(?:\/|—|,|\bor\b|\by\b)\s*/i).filter(x=>x.length>2)}),titles=[...new Set(selected.map(x=>String(x).trim()).filter(Boolean))],groups=[];for(let i=0;i<titles.length;i+=6)groups.push(titles.slice(i,i+6));if(!groups.length)groups.push(keys);let geo='("Spain" OR "España" OR "Europe" OR "remote" OR "remoto")',day7=windows[2].since.slice(0,10),queryGroups=[];for(const w of windows){const day=w.since.slice(0,10);groups.forEach((g,i)=>{let terms=g.map(x=>'"'+x+'"').join(" OR "),query='('+terms+') '+geo+' (jobs OR careers OR empleo OR vacantes) after:'+day;queryGroups.push({window_hours:w.hours,title_group:i+1,titles:g,query})})}let queryText=keys.length?keys.join(" "):titles.join(" OR "),li="https://www.linkedin.com/jobs/search/?keywords="+encodeURIComponent(queryText)+"&location="+encodeURIComponent("Spain");if(a.mode==="companies_es")queryGroups=[{window_hours:168,title_group:1,titles:[],query:"empresas tecnológicas IA datos España careers empleo after:"+day7}];else if(a.mode==="companies_global")queryGroups=[{window_hours:168,title_group:1,titles:[],query:"technology companies hiring data AI remote from Spain careers after:"+day7}];else if(a.mode==="keywords")queryGroups=windows.map(w=>({window_hours:w.hours,title_group:1,titles:keys,query:'('+keys.map(x=>'"'+x+'"').join(" OR ")+') '+geo+' jobs after:'+w.since.slice(0,10)}));return {mode:a.mode,target_count:target,roles,title_synonyms:titles,requested_location:loc,recency_windows:windows,queries:queryGroups.map(x=>x.query),query_groups:queryGroups,linkedin_jobs_urls:{last_24_hours:li+"&f_TPR=r86400",last_72_hours:li+"&f_TPR=r259200",last_7_days:li+"&f_TPR=r604800"},iterations:["Busca por grupos de títulos equivalentes en español e inglés; no uses el nombre compuesto de una familia como si fuese un título literal.","Empieza por 24 horas y amplía por separado a 72 horas y hasta 7 días; ejecuta todos los grupos de títulos antes de concluir.","Combina búsquedas web con portales ATS y páginas oficiales de empresas; registra fuentes ya cubiertas y prioriza las no revisadas.","Verifica en la página de empresa la elegibilidad desde España, que la vacante sigue abierta y el enlace de candidatura.","Salario publicado inferior a 55.000 €: excluir. Salario no publicado: conservar si está verificada y encaja; marcar como no confirmado y darle menor prioridad que a salarios publicados.","Guarda vacantes con fecha, apertura y candidatura verificables en Resultados. Tras consultar fuentes alternativas, reserva manual_only:true para candidatos cuyo estado, fecha original, enlace de candidatura o elegibilidad no puedan verificarse, o cuya familia no pueda inferirse con confianza. La falta de salario por sí sola o una familia que pueda deducirse del título no justifican enviarlos a Búsqueda manual.","Deduplica por URL normalizada, ID del ATS y empresa+puesto. Cuenta confirmadas y pendientes por separado; nunca inventes campos."],rules:profile.salary_rules,claim_exhaustive:false}}
function score(a,roles=roleTargets){const eligible=a.eligible_from_spain??a.verification?.eligible_from_spain;
const evidence=a.eligibility_evidence?.trim?.()||"";
const salaryValid=Number.isFinite(a.salary_min_eur)&&a.salary_min_eur>0&&
  (a.salary_max_eur==null||(Number.isFinite(a.salary_max_eur)&&a.salary_max_eur>=a.salary_min_eur));
const published=salaryValid&&a.salary_published!==false;
let flags=[],excluded=false,smin=published?a.salary_min_eur:null,smax=published?a.salary_max_eur:null,min=55000,norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),family=a.role_family?roles.find(x=>norm(x.family)===norm(a.role_family)):null;if(!family){let title=norm(a.title);family=roles.map(x=>({x,score:Math.max(0,...x.titles.map(t=>title.includes(norm(t))?norm(t).length:0))})).sort((x,y)=>y.score-x.score).find(x=>x.score)?.x||null}let expectedSalary=family?.min!=null?{min:family.min,max:family.max}:null,offerMax=smax??smin,salaryComparison="salario no publicado";if(expectedSalary&&smin!=null&&a.salary_published!==false){salaryComparison=offerMax<expectedSalary.min?"por debajo de banda":smin>expectedSalary.max?"por encima de banda":smin>=expectedSalary.min&&offerMax<=expectedSalary.max?"dentro de banda":"coincide parcialmente"}let salaryVsTarget=smin==null||a.salary_published===false?"no confirmado":offerMax<min?"inferior a 55.000 €":smin<min?"la banda cruza 55.000 €; por confirmar":smin===min?"alcanza 55.000 €":"supera 55.000 €";if(a.salary_published===false||smin==null)flags.push("Salario no confirmado");else if(offerMax<min){excluded=true;flags.push("Salario inferior al objetivo")}else if(smin<min)flags.push("Banda cruza el umbral: por confirmar");else flags.push("Salario publicado por encima del umbral");if(eligible===false){excluded=true;flags.push("No elegible desde España")}else if(eligible==null)flags.push("Elegibilidad desde España pendiente");const country=norm(a.country),isSpain=["spain","espana","es","esp"].includes(country);if(a.remote_mode==="hybrid"){if(!country)flags.push("País del puesto pendiente");else if(!isSpain){if(a.office_days_per_week==null)flags.push("Presencialidad internacional pendiente");else if(a.office_days_per_week>2){excluded=true;flags.push("Híbrido internacional superior a 1–2 días presenciales")}}if(a.office_days_per_week==null)flags.push("Días presenciales pendientes")}if(!a.remote_mode||a.remote_mode==="unknown")flags.push("Modalidad pendiente");if(/cerrad|closed|filled/i.test(a.vacancy_status||a.status||"")){excluded=true;flags.push("Vacante cerrada")}let v=(x,d)=>Math.max(0,Math.min(100,typeof x==="number"&&Number.isFinite(x)?x:d)),components={experience_fit:v(a.fit_percent,50),career_growth:v(a.career_growth_percent,50),salary:published&&smin>=min?100:50,modality:a.remote_mode==="remote"?100:a.remote_mode==="hybrid"?75:50,learning:v(a.learning_percent,50)};let total=Math.round(components.experience_fit*.3+components.career_growth*.25+components.salary*.2+components.modality*.15+components.learning*.1),classification=excluded?"excluir":flags.some(x=>/pendiente|confirmar|no confirmado/.test(x))?"por confirmar":"verificada";const exclusions=flags.filter(flag=>/inferior al objetivo|No elegible|superior a 1|Vacante cerrada/.test(flag));
const unknowns=flags.filter(flag=>/pendiente|confirmar|no confirmado/.test(flag));
if(eligible===true&&!evidence)unknowns.push("Falta la cita de elegibilidad");
if(a.verification?.open!==true&&!exclusions.includes("Vacante cerrada"))unknowns.push("Apertura sin confirmar");
if(a.verification?.application_active!==true)unknowns.push("Enlace de candidatura sin confirmar");
const certainty=exclusions.length?"excluida":unknowns.length?"pendiente":"confirmada";
return {interest_score:total,certainty,exclusions,unknowns,
  salary_published:published,eligibility_confirmed:eligible===true&&!!evidence,
  skills_match:Array.isArray(a.skills_match)?a.skills_match.filter(x=>typeof x==="string").slice(0,8):[],
  company:a.company,title:a.title,role_family:family?.family||null,expected_salary_min_eur:expectedSalary?.min??null,expected_salary_max_eur:expectedSalary?.max??null,salary_comparison:salaryComparison,salary_vs_general_target:salaryVsTarget,score_percent:total,components,classification,priority:certainty==="confirmada" && published && smin>min,eligibility_evidence:a.eligibility_evidence||null,verification_required:true,flags}}

function validateSearchOffer(o,now=Date.now()){
 const errors=[],parsed=Date.parse(o.published_at),checked=Date.parse(o.checked_at);
 if(!o.company||!o.title)errors.push("Faltan empresa o puesto");
 if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(o.published_at||"")||!Number.isFinite(parsed)||parsed>now||now-parsed>7*86400000)errors.push("Publicación no confirmada dentro de los últimos 7 días");
 if(!Number.isFinite(checked)||checked>now+60000||now-checked>86400000)errors.push("Comprobación ausente o no reciente");
 if(o.verification?.open!==true||o.verification?.application_active!==true||o.verification?.eligible_from_spain!==true)errors.push("Falta evidencia explícita de apertura, candidatura activa o elegibilidad desde España");
 if(!canonicalOfferUrl(o.url)||!canonicalOfferUrl(o.verification?.application_url)||!o.source_urls?.length)errors.push("Faltan enlaces de oferta, candidatura o fuentes");
 if(!o.role_family||!o.salary_comparison||!Number.isFinite(o.score_percent))errors.push("Faltan familia, comparación salarial o puntuación");
 if(o.salary_published!==false&&o.salary_min_eur!=null&&(o.salary_max_eur??o.salary_min_eur)<55000)errors.push("Salario inferior al objetivo");
 if(/cerrad|closed|filled/i.test(o.vacancy_status||o.status||""))errors.push("Vacante cerrada");
 return errors;
}

function storedOffer(row) {
  const offer={...JSON.parse(row.offer_json), offer_id: row.id,
    status: row.status, dateApplied: row.date_applied || ""};
  return {...offer,application_status:detectedApplication(offer),
    vacancy_status:offer.vacancy_status||(!detectedApplication(offer)?offer.status:null)};
}

async function persistOffer(env, offer, editApplication = false, receipt, preference) {
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
    const {results} = await env.DB.prepare("SELECT id,offer_json,status,date_applied,updated_at FROM offers WHERE id NOT LIKE 'manual::%' AND json_extract(offer_json,'$._merged_into') IS NULL").all();
    const matches = (results ?? []).filter(row => sameOffer(storedOffer(row), offer));
    if (matches.length > 1) throw new Error("Identidad ambigua: revisa las ofertas coincidentes");
    const row = matches[0];
    const prior = row ? storedOffer(row) : {};
    const receiptKey = receipt ? receipt.run+":"+receipt.entry : null;
    const receipts = prior._search_receipts || {};
    if (receiptKey && Object.hasOwn(receipts,receiptKey)) return {offer:prior,created:receipts[receiptKey]};
    const id = row?.id ?? proposedId;
    if (!row && (results ?? []).some(candidate => candidate.id === id)) {
      throw new Error("Identificador de vacante en conflicto");
    }
    const updatedAt = new Date().toISOString();
    const merged = {...mergeOffer(prior, offer, editApplication),
      _search_receipts: receiptKey ? {...receipts,[receiptKey]:!row} : prior._search_receipts,
      offer_id: id, canonical_url: canonicalOfferUrl(offer.url || (row ? storedOffer(row).url : "")) || null, previous_offer_ids: row ? storedOffer(row).previous_offer_ids : undefined,
      ranking_preference:preference??prior.ranking_preference??null,
      _merged_into: undefined, updated_at: updatedAt};
    const values = [JSON.stringify(merged), merged.status, merged.dateApplied || null, updatedAt];
    const write = row
      ? await env.DB.prepare("UPDATE offers SET offer_json=?,status=?,date_applied=?,updated_at=? WHERE id=? AND offer_json=? AND status=? AND date_applied IS ?")
          .bind(...values, id, row.offer_json, row.status, row.date_applied).run()
      : await env.DB.prepare("INSERT INTO offers (offer_json,status,date_applied,updated_at,id) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM offers WHERE id NOT LIKE 'manual::%' AND json_extract(offer_json,'$._merged_into') IS NULL)=? ON CONFLICT(id) DO NOTHING")
          .bind(...values, id, results.length).run();
    if (write.meta.changes === 1) return {offer: merged, created: !row};
  }
  throw new Error("La oferta cambió durante el guardado. Reintenta la operación");
}

async function getOffers(env, applicationsOnly = false) {
  if (!env?.DB) return [];
  const {results} = await env.DB.prepare("SELECT id,offer_json,status,date_applied FROM offers WHERE id NOT LIKE 'manual::%' AND json_extract(offer_json,'$._merged_into') IS NULL ORDER BY updated_at DESC").all();
  const offers = (results ?? []).map(storedOffer);
  return applicationsOnly ? offers.filter(applicationState) : offers;
}

async function confirmDuplicate(env, first, second) {
  if (typeof first !== "string" || typeof second !== "string" || first === second)
    throw new Error("Selecciona dos vacantes distintas");
  const {results} = await env.DB.prepare("SELECT * FROM offers WHERE id IN (?,?) AND id NOT LIKE 'manual::%' AND json_extract(offer_json,'$._merged_into') IS NULL").bind(first,second).all();
  if (results.length !== 2) throw new Error("Las vacantes han cambiado. Actualiza el historial");
  const [primary, secondary] = results.sort((a,b) =>
    Number(applicationState(storedOffer(b))) - Number(applicationState(storedOffer(a))) ||
    a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
  const a = storedOffer(primary), b = storedOffer(secondary);
  if (!duplicateReasons(a,b).length) throw new Error("La coincidencia requiere evidencia adicional o tiene requisiciones distintas");
  if (applicationState(a) && applicationState(b) && (a.status !== b.status || a.dateApplied !== b.dateApplied))
    throw new Error("Las candidaturas tienen estados o fechas distintos. Revisa ambos registros");
  const now = new Date().toISOString();
  const merged = {...mergeOffer(a,b),ranking_preference:a.ranking_preference||b.ranking_preference||null,_search_receipts:{...a._search_receipts,...b._search_receipts},offer_id: a.offer_id, canonical_url: canonicalOfferUrl(b.url || a.url) || null, updated_at: now,
    previous_offer_ids: [...new Set([...(a.previous_offer_ids||[]),b.offer_id,...(b.previous_offer_ids||[])])]};
  const archived = {...b,_merged_into: a.offer_id};
  // Both rows change in one SQLite statement, only if both snapshots still match.
  const outcome = await env.DB.prepare(`WITH current AS MATERIALIZED (
     SELECT count(*) AS n FROM offers WHERE
     (id=? AND offer_json=? AND status=? AND date_applied IS ?) OR
     (id=? AND offer_json=? AND status=? AND date_applied IS ?)
   ) UPDATE offers SET
     offer_json=CASE WHEN id=? THEN ? ELSE ? END,
     status=CASE WHEN id=? THEN ? ELSE status END,
     date_applied=CASE WHEN id=? THEN ? ELSE date_applied END, updated_at=?
   WHERE id IN (?,?) AND (SELECT n FROM current)=2`)
    .bind(primary.id,primary.offer_json,primary.status,primary.date_applied,
      secondary.id,secondary.offer_json,secondary.status,secondary.date_applied,
      primary.id,JSON.stringify(merged),JSON.stringify(archived),primary.id,merged.status,
      primary.id,merged.dateApplied||null,now,primary.id,secondary.id).run();
  if (outcome.meta.changes!==2) throw new Error("Las vacantes han cambiado. Actualiza el historial");
  return merged;
}

async function saveOffers(env, offers, editApplication = false) {
  const saved = [];
  for (const offer of offers) saved.push(await persistOffer(env, offer, editApplication));
  const created = saved.filter(item => item.created).length;
  return {saved_count: saved.length, created_count: created,
    updated_count: saved.length - created, offers: saved.map(item => item.offer)};
}

function manualCandidateId(o){const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");return "manual::"+[o.company,o.title,o.jobId||o.url||""].map(norm).join("::")}async function persistManualCandidate(env,o){if(!env?.DB)throw new Error("La base de datos persistente del sitio aún no está disponible");if(!o?.company||!o?.title)throw new Error("Cada candidato manual necesita empresa y puesto");const id=manualCandidateId(o),row=await env.DB.prepare("SELECT offer_json,status FROM offers WHERE id=?").bind(id).first(),prior=row?.offer_json?JSON.parse(row.offer_json):{},sourceUrls=[...new Set([...(prior.source_urls||[]),prior.url,o.url,...(o.source_urls||[])].filter(Boolean))],merged={...prior,...o,type:"manual",manual_only:true,source_urls:sourceUrls,status:o.status||prior.status||"Pendiente de verificación",updated_at:new Date().toISOString()};await env.DB.prepare("INSERT INTO offers (id,offer_json,status,date_applied,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET offer_json=excluded.offer_json,status=excluded.status,updated_at=excluded.updated_at").bind(id,JSON.stringify(merged),merged.status,null,merged.updated_at).run();return merged}async function call(name,a,env){
 if(name==="start_search_run")return ok(await startRun(env,resolveCompanyFilters(a),"scheduled"));
 if(name==="begin_search_run")return ok(await beginRun(env,a.run_id));
 if(name==="get_search_run")return ok(await readRun(env,a.run_id));
 if(name==="finish_search_run"){
   await recordRun(env,a,offer=>{
     const reasons=validateSearchOffer(offer);
     if(typeof offer.eligibility_evidence!=="string" || !offer.eligibility_evidence.trim()) reasons.push("Falta la evidencia textual de ubicación o elegibilidad");
     return reasons;
   },offers=>deduplicateOffers(offers,[]));
   return ok(await saveRun(env,a.run_id,persistOffer));
 }
 if(name==="retry_search_save")return ok(await saveRun(env,a.run_id,persistOffer));
if(name==="get_search_profile"){
  const personal = privateProfile(env);
  return ok({...profile, ...personal, location:personal.location||profile.location,
    role_targets:configuredRoles(env).map(({family,min,max})=>({
      family,expected_salary_min_eur:min??null,expected_salary_max_eur:max??null,
    }))});
}if(name==="get_offer_history")return ok({offers:await getOffers(env),applications:(await getOffers(env,true))});if(name==="store_job_offers"){
  const saved=[], manualSaved=[], rejected=[];
  let created=0;
  for(const offer of a.offers||[]){
    try {
      if(offer.manual_only===true){
        if((await getOffers(env)).some(old=>sameOffer(old,offer))) throw new Error("La oferta ya está en Resultados");
        manualSaved.push(await persistManualCandidate(env,offer));
        continue;
      }
      const reasons=validateSearchOffer(offer);
      if(reasons.length){rejected.push({company:offer.company,title:offer.title,reasons});continue}
      const stored=await persistOffer(env,offer);
      saved.push(stored.offer);
      created+=Number(stored.created);
    } catch(error) {
      rejected.push({company:offer.company,title:offer.title,reasons:[error.message]});
    }
  }
  return ok({saved_count:saved.length,created_count:created,updated_count:saved.length-created,
    offers:saved,manual_saved_count:manualSaved.length,manual_candidates:manualSaved,rejected});
}if(name==="mark_offer_applied"){
  const matches=(await getOffers(env)).filter(offer=>sameOffer(offer,a));
  if(matches.length!==1)return ok({updated:false,reason:"Indica offer_id o URL específica de una única vacante"});
  const {offer}=await persistOffer(env,{...matches[0],status:"Aplicada",application_status:"Aplicado",dateApplied:a.dateApplied||new Date().toISOString().slice(0,10)},true);
  return ok({updated:true,offer});
}if(name==="build_search_plan")return ok(searchPlan(a));if(name==="score_job_offer")return ok(score(a,configuredRoles(env)));if(name==="deduplicate_offer_batch")return ok(deduplicate(a,await getOffers(env)));return{content:[{type:"text",text:"Herramienta desconocida"}],isError:true}}
function response(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store"}})}
export {canonicalOfferUrl, duplicateReasons, reviewPairs, requisitionKey, storedOffer};
export default {async fetch(request,env){let u=new URL(request.url);
 if(u.pathname==="/api/ranking-preference"&&request.method==="POST"){
   try{
     const {offer_id,preference}=await request.json();
     if(!["prioritaria","interesante","descartar","sin etiqueta"].includes(preference))throw new Error("Etiqueta no válida");
     const offer=(await getOffers(env)).find(item=>item.offer_id===offer_id);
     if(!offer)throw new Error("La oferta no está guardada");
     const saved=await persistOffer(env,{offer_id,company:offer.company,title:offer.title},false,undefined,preference);
     return response({offer:saved.offer});
   }catch(e){return response({error:e.message},400)}
 }
 if(u.pathname==="/api/pending-links"){
   try{
     if(request.method==="GET")return response({rows:await pendingLinks(env,await getOffers(env),sameOffer)});
     if(request.method==="POST")return response(await actOnPending(env,await request.json(),persistOffer));
     return response({error:"Método no permitido"},405);
   }catch(e){return response({error:e.message},400)}
 }
 if(u.pathname==="/api/search-runs"||u.pathname.startsWith("/api/search-runs/")){
   try{
     const id=u.pathname.split("/")[3];
     if(request.method==="GET")return response(id?await readRun(env,id):{runs:await listRuns(env,u.searchParams.get("company"))});
     if(request.method==="POST")return response(id?await saveRun(env,id,persistOffer):await startRun(env,resolveCompanyFilters(await request.json()),"manual"));
     return response({error:"Método no permitido"},405);
   }catch(e){return response({error:e.message},400)}
 }
if(u.pathname==="/api/companies"&&request.method==="GET")return response({companies:normalizedDirectory,source_date:"2026-11-13"});if(u.pathname==="/api/offers"&&request.method==="GET")return response({offers:await getOffers(env)});if(u.pathname==="/api/manual-candidates"&&request.method==="GET")return response({candidates:await getManualCandidates(env)});if(u.pathname==="/api/offers/merge"&&request.method==="POST"){try{const b=await request.json();return response({offer:await confirmDuplicate(env,b.first,b.second)})}catch(e){return response({error:e.message},409)}}if(u.pathname==="/api/offers"&&request.method==="POST"){try{const b=await request.json();return response(await saveOffers(env,b.offers||[],b.edit_application===true))}catch(e){return response({error:e.message},400)}}if(u.pathname==="/health")return response({ok:true,service:"Radar Data & AI",mcp:true});if(u.pathname==="/mcp"&&request.method==="POST"){let b;try{b=await request.json()}catch{return response({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}},400)}let id=b.id,method=b.method,p=b.params||{};if(method==="server/discover")return response({jsonrpc:"2.0",id,result:{supportedVersions:["2026-07-28"],capabilities:{tools:{}}}});if(method==="tools/list")return response({jsonrpc:"2.0",id,result:{tools:toolDefinitions}});if(method==="tools/call"){try{return response({jsonrpc:"2.0",id,result:await call(p.name,p.arguments||{},env)})}catch(e){return response({jsonrpc:"2.0",id,result:{content:[{type:"text",text:e.message}],isError:true}})}}return response({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}},404)}if(u.pathname!=="/")return new Response("Not found",{status:404});return new Response(page(env),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store"}})}};

