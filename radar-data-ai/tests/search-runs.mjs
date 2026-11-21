import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "../worker/index.js";

test("ejecución manual por ID, guardado parcial y reintento sin búsqueda",async()=>{
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_offer_history.sql",import.meta.url),"utf8"));
  let fail=true;
  const env={DB:{prepare(sql){
    const stmt=sqlite.prepare(sql);
    function bind(...params){return {
      all:async()=>({results:stmt.all(...params)}),
      first:async()=>stmt.get(...params),
      run:async()=>{
        if (fail && sql.startsWith("INSERT INTO offers") && JSON.parse(params[0]).title==="Fallida") throw new Error("Error temporal");
        return {meta:stmt.run(...params)};
      },
    }}
    return {...bind(),bind};
  }}};
  async function request(path,body){
    const r=await worker.fetch(new Request("https://radar.test"+path,body===undefined?{}:{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
    }),env);
    assert.ok(r.ok,await r.clone().text());
    return r.json();
  }
  async function mcp(name,args){
    const {result}=await request("/mcp",{id:1,method:"tools/call",params:{name,arguments:args}});
    assert.ok(!result.isError,result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  const run=await request("/api/search-runs",{filters:{target:50,roles:["Data Engineer"]}});
  assert.equal(run.status,"prepared");
  assert.equal((await mcp("begin_search_run",{run_id:run.id})).status,"searching");
  const date=new Date(Date.now()-1000).toISOString();
  const offer=(title,id)=>({
    company:"Empresa ficticia",title,url:"https://ats.example/jobs/"+id,
    source_urls:["https://ats.example/jobs/"+id],published_at:date,checked_at:date,
    role_family:"Data Engineer",score_percent:70,salary_comparison:"No confirmado",
    eligibility_evidence:"Contratación desde España",verification:{open:true,application_active:true,
      eligible_from_spain:true,application_url:"https://ats.example/jobs/"+id+"/apply"},
  });
  const a=offer("Primera",1),b=offer("Fallida",2);
  const done=await mcp("finish_search_run",{run_id:run.id,offers:[a,b,{...a,url:a.url+"?utm_source=portal"}],
    pending:[{url:"https://portal.example/3",reason:"Vacante cerrada"}],limits:["Una fuente inaccesible"],found:4});
  assert.equal(done.status,"save_errors");
  assert.deepEqual(done.summary,{created:1,updated:0,errors:1});
  assert.equal(done.batch_duplicates,1);
  assert.equal(done.pending.length,1);
  assert.equal(done.verified,2);
  fail=false;
  const retry=await request("/api/search-runs/"+run.id,{});
  assert.equal(retry.status,"completed");
  assert.deepEqual(retry.summary,{created:2,updated:0,errors:0});
  const again=await mcp("retry_search_save",{run_id:run.id});
  assert.deepEqual(again.summary,retry.summary);
  assert.equal((await request("/api/search-runs")).runs[0].id,run.id);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM offers").get().n,2);
  const list=await request("/api/pending-links");
  const link=list.rows.find(item=>item.kind==="evidence");
  const failed=list.rows.find(item=>item.kind==="save");
  assert.equal(failed.state,"resolved");
  assert.ok(failed.offer_id);
  const action={run_id:link.run_id,index:link.index,kind:link.kind};
  await request("/api/pending-links",{...action,action:"review"});
  assert.equal((await request("/api/pending-links")).rows.find(item=>item.kind==="evidence").state,"reviewed");
  const {retry:child}=await request("/api/pending-links",{...action,action:"retry"});
  assert.equal(child.retry_source.url,link.url);
  await mcp("finish_search_run",{run_id:child.id,offers:[{...offer("Tercera",3),source_urls:[link.url]}]});
  const resolved=(await request("/api/pending-links")).rows.find(item=>item.kind==="evidence");
  assert.equal(resolved.state,"resolved");
  assert.ok(resolved.offer_id);

  const saved=(await request("/api/offers")).offers.find(item=>item.title==="Primera");
  const edit=await request("/api/offers",{edit_application:true,offers:[{
    offer_id:saved.offer_id,company:saved.company,title:saved.title,application_status:"En curso",dateApplied:"2026-10-15",
  }]});
  const changed=edit.offers[0].application_status_changed_at;
  assert.ok(changed);
  await request("/api/offers",{offers:[{...a,status:"Nueva",vacancy_status:"Cerrada",dateApplied:"2026-11-01"}]});
  const reloaded=(await request("/api/offers")).offers.find(item=>item.offer_id===saved.offer_id);
  assert.equal(reloaded.application_status,"En curso");
  assert.equal(reloaded.vacancy_status,"Cerrada");
  assert.equal(reloaded.dateApplied,"2026-10-15");
  assert.equal(reloaded.application_status_changed_at,changed);
  const annotated=await request("/api/ranking-preference",{offer_id:reloaded.offer_id,preference:"prioritaria"});
  assert.equal(annotated.offer.ranking_preference,"prioritaria");
  await request("/api/offers",{offers:[{...a,status:"Nueva",ranking_preference:"descartar"}]});
  const reimported=(await request("/api/offers")).offers.find(item=>item.offer_id===saved.offer_id);
  assert.equal(reimported.ranking_preference,"prioritaria");
  assert.equal(reimported.application_status,"En curso");
  const scheduled=await mcp("start_search_run",{filters:{target:75}});
  assert.equal(scheduled.origin,"scheduled");
  assert.equal(scheduled.filters.target,50);
});

test("búsquedas de empresa: ATS, varias ubicaciones y portal inaccesible",async()=>{
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_offer_history.sql",import.meta.url),"utf8"));
  const env={DB:{prepare(sql){
    const stmt=sqlite.prepare(sql);
    function bind(...params){return {all:async()=>({results:stmt.all(...params)}),
      first:async()=>stmt.get(...params),run:async()=>({meta:stmt.run(...params)})}}
    return {...bind(),bind};
  }}};
  async function request(path,body){
    const r=await worker.fetch(new Request("https://radar.test"+path,body===undefined?{}:{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
    }),env);
    assert.ok(r.ok,await r.clone().text());
    return r.json();
  }
  async function finish(args){
    const {result}=await request("/mcp",{id:1,method:"tools/call",params:{name:"finish_search_run",arguments:args}});
    assert.ok(!result.isError,result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  const {companies}=await request("/api/companies");
  const timestamp=new Date(Date.now()-1000).toISOString();
  for(const [name,count] of [["Airalo",1],["Elastic",2],["Clibrain",0]]){
    const company=companies.find(c=>c.name===name);
    assert.ok(company.employment);
    assert.ok(company.domain);
    const run=await request("/api/search-runs",{filters:{company:{name,employment:"https://wrong.example"}}});
    assert.equal(run.filters.company.employment,company.employment);
    const offers=Array.from({length:count},(_,i)=>{
      const url="https://ats.example/jobs/"+company.key+"-"+i;
      return {company:name,title:"Data Engineer",url,location:i?"Barcelona":"Madrid",
        source_urls:[url],published_at:timestamp,checked_at:timestamp,role_family:"Data Engineer",
        salary_comparison:"No confirmado",score_percent:70,eligibility_evidence:"España",
        verification:{open:true,application_active:true,eligible_from_spain:true,application_url:url+"/apply"}};
    });
    const result=await finish({run_id:run.id,offers,sources:[company.employment],
      limits:count===2?["Paginación: tercera página no accesible"]:count?[]:["Portal inaccesible"],
      pending:count?[]:[{url:company.employment,reason:"ATS inaccesible"}],
      ...(count?{company_eligibility:{status:"confirmed",url:company.employment,quote:"Ejemplo sintético de elegibilidad"}}:{})});
    assert.equal(result.verified,count);
    assert.equal(result.summary.created,count);
    assert.equal(result.pending.length,count?0:1);
    assert.equal(result.company_eligibility?.status,count?"confirmed":undefined);
    const reviewed=(await request("/api/search-runs?company="+company.key)).runs;
    assert.equal(reviewed.length,1);
    assert.equal(reviewed[0].id,run.id);
    assert.deepEqual(reviewed[0].sources,[company.employment]);
    assert.equal(reviewed[0].limits.length,count===1?0:1);
  }
});
