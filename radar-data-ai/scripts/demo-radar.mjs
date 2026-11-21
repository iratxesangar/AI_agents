import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {DatabaseSync} from "node:sqlite";
import worker from "../worker/index.js";

const base = new DatabaseSync(":memory:");
base.exec(readFileSync(new URL("../drizzle/0000_offer_history.sql",import.meta.url),"utf8"));
const checked=new Date(Date.now()-1000).toISOString();
const destination=id=>"https://ats.example/jobs/"+id;
function offer(id,fields={}){
  const url=destination(id);
  return {company:"Empresa ficticia",title:"Data Engineer",url,source_urls:[url],
    requisition_source:"ats.example/empresa",requisition_id:String(id),
    published_at:checked,checked_at:checked,country:"España",remote_mode:"remote",
    role_family:"Senior Data Engineer",score_percent:80,fit_percent:95-id,
    career_growth_percent:90,salary_comparison:"Publicado",salary_published:true,salary_min_eur:65000,
    eligibility_evidence:"Contratación remota en España",
    verification:{open:true,application_active:true,eligible_from_spain:true,application_url:url+"/apply"},
    ...fields};
}
const legacy=offer(1);
base.prepare("INSERT INTO offers VALUES (?,?,?,?,?)").run("empresa ficticia::data engineer",
  JSON.stringify(legacy),"Rechazado","2026-10-15",checked);
const db=new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../drizzle/0000_offer_history.sql",import.meta.url),"utf8"));
for(const row of base.prepare("SELECT * FROM offers").all()){
  db.prepare("INSERT INTO offers VALUES (?,?,?,?,?)").run(row.id,row.offer_json,row.status,row.date_applied,row.updated_at);
}
let fail=true;
const env={DB:{prepare(sql){
  const stmt=db.prepare(sql);
  function bind(...params){return {
    first:async()=>stmt.get(...params),all:async()=>({results:stmt.all(...params)}),
    run:async()=>{
      if(fail&&sql.startsWith("INSERT INTO offers")&&JSON.parse(params[0]).requisition_id==="3")
        throw new Error("Fallo de escritura simulado");
      return {meta:stmt.run(...params)};
    },
  }}
  return {...bind(),bind};
}}};

async function request(path,body){
  const response=await worker.fetch(new Request("http://radar.test"+path,body===undefined?{}:{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
  }),env);
  assert.ok(response.ok,await response.clone().text());
  return response.json();
}
async function mcp(name,args={}){
  const {result}=await request("/mcp",{id:1,method:"tools/call",params:{name,arguments:args}});
  assert.ok(!result.isError,result.content[0].text);
  return JSON.parse(result.content[0].text);
}
const snapshot=async()=>{
  const {offers,applications}=await mcp("get_offer_history");
  return {offers:offers.length,applications:applications.length,history:applications.map(o=>[o.offer_id,o.application_status,o.dateApplied])};
};
const before={offers:base.prepare("SELECT count(*) AS n FROM offers").get().n,applications:1};
const loaded=await snapshot();
assert.deepEqual({offers:loaded.offers,applications:loaded.applications},before);

const repost=offer(1,{url:"https://portal.example/vacante/1",status:"Nueva"});
const pending=offer(20,{eligibility_evidence:"",remote_mode:"unknown",salary_published:false});
delete pending.salary_min_eur;
delete pending.verification.eligible_from_spain;
const evidence=await mcp("score_job_offer",{...pending,verification:{open:true,application_active:true}});
assert.ok(evidence.unknowns.some(flag=>/salario/i.test(flag)));
assert.ok(evidence.unknowns.some(flag=>/modalidad/i.test(flag)));
assert.ok(evidence.unknowns.some(flag=>/elegibilidad/i.test(flag)));

const batch=[legacy,repost,...Array.from({length:12},(_,i)=>offer(i+2)),pending];
const scheduled=()=>mcp("start_search_run",{filters:{target:50,roles:["Data Engineer"]}});
const finish=run=>mcp("finish_search_run",{run_id:run.id,offers:batch,sources:[destination(1)]});
const firstRun=await scheduled();
const first=await finish(firstRun);
assert.equal(first.batch_duplicates,1);
assert.equal(first.pending.length,1);
assert.deepEqual(first.summary,{created:11,updated:1,errors:1});
fail=false;
const retry=await mcp("retry_search_save",{run_id:firstRun.id});
assert.deepEqual(retry.summary,{created:12,updated:1,errors:0});
const second=await finish(await scheduled());
assert.equal(second.summary.created,0);
await request("/api/offers",{offers:[{...legacy,status:"Nueva"}]});
const after=await snapshot();
assert.equal(after.offers,13);
assert.equal(after.applications,1);
assert.deepEqual(after.history,loaded.history);
assert.equal(db.prepare("SELECT count(*) AS n FROM offers").get().n,before.offers+retry.summary.created);
const {offers}=await request("/api/offers");
assert.equal(new Set(offers.map(o=>o.requisition_id)).size,13);
assert.ok(offers.find(o=>o.requisition_id==="1").source_urls.includes(repost.url));

for(const id of ["2","4","13"]){
  const {offer_id}=offers.find(o=>o.requisition_id===id);
  await request("/api/ranking-preference",{offer_id,preference:"prioritaria"});
}
const ranking=await Promise.all((await request("/api/offers")).offers.filter(o=>!o.application_status)
  .map(async item=>({item,score:await mcp("score_job_offer",item)})));
ranking.sort((a,b)=>b.score.interest_score-a.score.interest_score);
const top=ranking.slice(0,10).filter(x=>x.item.ranking_preference==="prioritaria").length;
assert.equal(top,2);
console.log(JSON.stringify({before,after_load:{offers:loaded.offers,applications:loaded.applications},
  first:first.summary,retry:retry.summary,repeated_batch:second.summary,duplicates:first.batch_duplicates,
  distinct_vacancies_merged:13-after.offers,application_changes:0,pending:first.pending.length,
  after:{offers:after.offers,applications:after.applications},priority_at_10:top/10,
  labelled_priorities_retrieved:top+"/3"},null,2));

if(process.argv.includes("--dom")){
  const {JSDOM,VirtualConsole}=createRequire(import.meta.url)("jsdom");
  const html=await (await worker.fetch(new Request("http://radar.test/"),env)).text();
  const errors=[];
  const console=new VirtualConsole();
  console.on("jsdomError",error=>errors.push(error.message));
  const openPage=()=>new JSDOM(html,{url:"http://radar.test/",runScripts:"dangerously",virtualConsole:console,
    beforeParse(window){
      window.fetch=(path,options)=>worker.fetch(new Request(new URL(path,window.location.href),options),env);
    }});
  async function waitFor(predicate){
    for(let n=0;n<100;n++){
      if(predicate())return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail(errors.join("\n")||"La interfaz no alcanzó el estado esperado");
  }
  let page=openPage();
  const select=selector=>page.window.document.querySelector(selector);
  try{
    select('[data-view="results"]').click();
    await waitFor(()=>/Primeras 10.*2 prioritarias/.test(select("#rankingCheck").textContent));
    select('[data-view="apps"]').click();
    await waitFor(()=>select("#applications select")?.value==="Rechazado");
    const application=select("#applications select");
    application.value="En curso";
    application.dispatchEvent(new page.window.Event("change"));
    await waitFor(()=>select("#toast").textContent==="Estado de candidatura guardado");
    page.window.close();
    page=openPage();
    select('[data-view="apps"]').click();
    await waitFor(()=>select("#applications select")?.value==="En curso");
    select('[data-view="companies"]').click();
    await waitFor(()=>select("#companiesList").textContent.includes("Airalo"));
    select('[data-view="manual"]').click();
    await waitFor(()=>select("#pendingLinks").textContent.includes("Reintentar verificación"));
    assert.deepEqual(errors,[]);
    globalThis.console.log("DOM: ranking, cambio de candidatura, recarga, Empresas y pendientes verificados.");
  }finally{page.window.close()}
}
