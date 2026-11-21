import {companyEvidence,needsCompanyMatch} from "./company-search.js";
const table = `CREATE TABLE IF NOT EXISTS radar_search_runs (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL
)`;

async function dbFor(env) {
  if (!env?.DB) throw new Error("Historial de búsquedas no disponible");
  await env.DB.prepare(table).run();
  return env.DB;
}

function bounded(value, max) {
  return String(value ?? "").trim().slice(0,max);
}

export async function startRun(env, input, origin) {
  const db=await dbFor(env);
  const filters=input.filters||{};
  const run={
    id:crypto.randomUUID(), created_at:new Date().toISOString(), origin,
    filters:{mode:bounded(filters.mode,40),company:filters.company||null,location:bounded(filters.location,200),
      keywords:bounded(filters.keywords,250),roles:Array.isArray(filters.roles)?filters.roles.slice(0,30).map(x=>bounded(x,100)):[],
      target:Math.min(50,Math.max(1,Number.isInteger(filters.target)?filters.target:50))},
    status:origin==="manual"?"prepared":"searching",
    ...(input.retry_source?{retry_source:input.retry_source}:{}),
  };
  await db.prepare("INSERT INTO radar_search_runs VALUES (?,?,?)").bind(run.id,run.created_at,JSON.stringify(run)).run();
  return run;
}

export async function readRun(env,id) {
  const db=await dbFor(env);
  const row=await db.prepare("SELECT data FROM radar_search_runs WHERE id=?").bind(id).first();
  if (!row) throw new Error("No se encontró esa ejecución");
  return JSON.parse(row.data);
}

export async function listRuns(env,companyKey) {
  const db=await dbFor(env);
  const {results}=companyKey
    ? await db.prepare("SELECT data FROM radar_search_runs WHERE json_extract(data,'$.filters.company.key')=? ORDER BY created_at DESC LIMIT 40").bind(companyKey).all()
    : await db.prepare("SELECT data FROM radar_search_runs ORDER BY created_at DESC LIMIT 40").all();
  return results.map(({data})=>{
    const {entries,...summary}=JSON.parse(data);
    return summary;
  });
}

async function replace(env,before,after) {
  const db=await dbFor(env);
  const write=await db.prepare("UPDATE radar_search_runs SET data=? WHERE id=? AND data=?")
    .bind(JSON.stringify(after),before.id,JSON.stringify(before)).run();
  return write.meta.changes===1;
}

export async function beginRun(env,id) {
  const run=await readRun(env,id);
  if(run.status!=="prepared")return run;
  const next={...run,status:"searching",started_at:new Date().toISOString()};
  return await replace(env,run,next)?next:readRun(env,id);
}

export async function recordRun(env,input,validate,deduplicate) {
  const before=await readRun(env,input.run_id);
  if (before.entries) return before;
  if (!Array.isArray(input.offers)||input.offers.length>100) throw new Error("Envía hasta 100 fichas evaluadas");
  const pending=Array.isArray(input.pending)?input.pending.slice(0,100).map(item=>({
    url:bounded(item.url,1500),reason:bounded(item.reason,300),
    company:bounded(item.company,200),title:bounded(item.title,200),
  })):[];
  let duplicated=0;
  const entries=[];
  const limitReasons=Array.isArray(input.limits)?input.limits.slice(0,25).map(x=>bounded(x,400)).filter(Boolean):[];
  const sources=Array.isArray(input.sources)?input.sources.slice(0,100).map(x=>bounded(x,1500)):[];
  const batch=deduplicate(input.offers);
  duplicated=batch.duplicate_count;
  const eligible=[];
  for(const offer of batch.unique){
    const reasons=validate(offer);
    if(needsCompanyMatch(before,offer))reasons.push("La vacante no corresponde a la empresa de esta ejecución");
    if(reasons.length){pending.push({url:bounded(offer.url,1500),reason:bounded(reasons.join(". "),300),company:bounded(offer.company,200),title:bounded(offer.title,200)});continue}
    eligible.push(offer);
  }
  for(const [index,offer] of eligible.slice(0,before.filters.target).entries()) entries.push({index,offer,status:"ready"});
  if(eligible.length>entries.length)limitReasons.push("Se alcanzó el límite de fichas guardadas por ejecución");
  const after={...before,company_eligibility:companyEvidence(before,input),completed_at:new Date().toISOString(),status:entries.length?"saving":"completed",sources,limits:limitReasons,pending,entries,
    found:Math.max(input.offers.length+pending.length-(batch.unique.length-eligible.length),
      Number.isSafeInteger(input.found)?Math.max(0,input.found):0),
    verified:eligible.length, batch_duplicates:duplicated, summary:{created:0,updated:0,errors:0}};
  return await replace(env,before,after)?after:readRun(env,before.id);
}

export async function saveRun(env,id,persist,onlyIndex) {
  let run=await readRun(env,id);
  if(!run.entries) throw new Error("La ejecución aún no tiene un lote verificado");
  const attempts=run.entries.filter(item=>(onlyIndex===undefined||onlyIndex===item.index)&&(item.status==="ready"||item.status==="error")).map(item=>item.index);
  for(const index of attempts){
    run=await readRun(env,id);
    const entry=run.entries[index];
    if(!["ready","error"].includes(entry.status))continue;
    let outcome;
    try{
      const saved=await persist(env,entry.offer,false,{run:id,entry:index});
      outcome={status:saved.created?"created":"updated",offer_id:saved.offer.offer_id,last_attempt_at:new Date().toISOString()};
    }catch(error){outcome={status:"error",message:bounded(error.message,350),last_attempt_at:new Date().toISOString()}}
    for(let attempt=0;attempt<8;attempt++){
      const before=await readRun(env,id);
      if(!["ready","error"].includes(before.entries[index].status))break;
      const entries=before.entries.map(item=>item.index===index?{...item,...outcome}:item);
      const count=status=>entries.filter(item=>item.status===status).length;
      const next={...before,entries,summary:{created:count("created"),updated:count("updated"),errors:count("error")},
        status:count("ready")?"saving":count("error")?"save_errors":"completed"};
      if(await replace(env,before,next))break;
      if(attempt===7)throw new Error("Resultado pendiente de sincronizar. Reintenta el guardado");
    }
  }
  return readRun(env,id);
}

export async function pendingLinks(env,offers,matches) {
  const db=await dbFor(env);
  const {results}=await db.prepare("SELECT data FROM radar_search_runs ORDER BY created_at DESC").all();
  const runs=results.map(row=>JSON.parse(row.data));
  const byId=new Map(runs.map(run=>[run.id,run]));
  const rows=[];
  for(const run of runs){
    for(const [index,item] of (run.pending||[]).entries()){
      if(!item.url)continue;
      const retry=byId.get(item.retry_run_id);
      const matching=offers.filter(offer=>matches(offer,{url:item.url}));
      const saved=matching.length===1?matching[0]:null;
      rows.push({...item,index,run_id:run.id,kind:"evidence",
        last_attempt_at:retry?.completed_at||retry?.started_at||item.last_attempt_at||run.completed_at||run.created_at,
        offer_id:saved?.offer_id||null,
        state:saved?"resolved":item.reviewed_at?"reviewed":retry&&retry.status!=="completed"?"retrying":"pending"});
    }
    for(const entry of run.entries||[]){
      if(!entry.message)continue;
      rows.push({index:entry.index,run_id:run.id,kind:"save",url:entry.offer.url,
        company:entry.offer.company,title:entry.offer.title,reason:"Error de guardado: "+entry.message,
        last_attempt_at:entry.last_attempt_at||run.created_at,offer_id:entry.offer_id||null,
        state:entry.offer_id?"resolved":entry.reviewed_at?"reviewed":"pending"});
    }
  }
  return rows;
}

export async function actOnPending(env,input,persist) {
  const run=await readRun(env,input.run_id);
  const {index,kind,action}=input;
  if(!Number.isInteger(index)||index<0||!["evidence","save"].includes(kind)||!["retry","review"].includes(action))
    throw new Error("Acción pendiente inválida");
  const key=kind==="save"?"entries":"pending";
  const item=run[key]?.[index];
  if(!item || (kind==="save"&&!item.message))throw new Error("No se encontró ese enlace pendiente");
  if(action==="retry"&&kind==="save")return {run:await saveRun(env,run.id,persist,index)};
  let patch={reviewed_at:new Date().toISOString()};
  let retry;
  if(action==="retry"){
    if(item.retry_run_id){
      const current=await readRun(env,item.retry_run_id);
      if(current.status!=="completed")return {retry:current};
    }
    retry=await startRun(env,{filters:{...run.filters,target:1},retry_source:{
      url:item.url,company:item.company,title:item.title,reason:item.reason,
    }},"manual");
    patch={reviewed_at:null,retry_run_id:retry.id,last_attempt_at:retry.created_at};
  }
  const next={...run,[key]:run[key].map((value,i)=>i===index?{...value,...patch}:value)};
  if(!await replace(env,run,next))throw new Error("El enlace cambió. Actualiza la lista");
  return retry?{retry}:{reviewed:true};
}
