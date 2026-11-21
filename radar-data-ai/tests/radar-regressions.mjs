import {normalizeCompany} from "../worker/company-search.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../worker/index.js',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'').replace(/^export \{.*?\};\n/m,'').replace('export default {','const worker = {');
const context={URL,Response,Date,companyDirectory:[],normalizeCompany};
vm.createContext(context);
vm.runInContext(source+';globalThis.api={score,deduplicate,validateSearchOffer,call};',context);
const {score,deduplicate,validateSearchOffer,call}=context.api;
for(const country of ['España','Spain','ES','ESP','espana']){
 const r=score({company:'Amadeus',title:'AI Delivery Manager',country,remote_mode:'hybrid',eligible_from_spain:true,salary_published:false});
 assert(!r.flags.some(x=>x.includes('internacional')),country);
 assert.equal(r.classification,'por confirmar');
}
assert.equal(score({country:'France',remote_mode:'hybrid',office_days_per_week:3}).classification,'excluir');
assert.equal(score({country:'France',remote_mode:'hybrid'}).classification,'por confirmar');
assert.equal(score({salary_min_eur:50000,salary_published:true}).classification,'excluir');
const original={company:'Safeguard Global',title:'Senior Data Engineer',url:'https://example.com/jobs/123?utm_source=old'};
assert.equal(deduplicate({offers:[{...original,url:'https://linkedin.com/jobs/456'}]},[original]).unique_count,1);
assert.equal(deduplicate({offers:[original,{company:'Other',title:'Alias',url:'https://example.com/jobs/123/apply?utm_source=new'}]}).unique_count,1);
const db={prepare(){return {all:async()=>({results:[{offer_json:JSON.stringify(original),status:'Aplicado',date_applied:'2026-11-10'}]})}}};
const result=JSON.parse((await call('deduplicate_offer_batch',{offers:[original]}, {DB:db})).content[0].text);
assert.equal(result.unique_count,0);assert.equal(result.applied_match_count,1);
const now=Date.now(),o={company:'A',title:'B',published_at:new Date(now-86400000).toISOString(),checked_at:new Date(now).toISOString(),url:'https://example.com/jobs/1',source_urls:['https://example.com/jobs/1'],role_family:'Data Engineer',salary_comparison:'No confirmado',score_percent:70,verification:{open:true,application_active:true,eligible_from_spain:true,application_url:'https://example.com/jobs/1/apply'}};
assert.equal(validateSearchOffer(o,now).length,0);
assert(validateSearchOffer({...o,published_at:new Date(now-8*86400000).toISOString()},now).length);
assert(validateSearchOffer({...o,verification:{}},now).length);
assert(validateSearchOffer({...o,salary_min_eur:50000},now).length);
console.log('Passed: country aliases, hybrid limits, minimum salary, batch/history/application deduplication, verification and recency gates.');

const relevant={title:"Applied AI Engineer",company:"Empresa ficticia",remote_mode:"remote",
 fit_percent:95,career_growth_percent:95,salary_min_eur:65000,salary_published:true,
 verification:{open:true,application_active:true},skills_match:["Python","Evaluación de LLM"]};
const pending=score(relevant);
const confirmed=score({...relevant,eligible_from_spain:true,eligibility_evidence:"Remote within Spain"});
assert.equal(pending.interest_score,confirmed.interest_score);
assert.equal(pending.certainty,"pendiente");
assert.equal(confirmed.certainty,"confirmada");
assert.equal(confirmed.priority,true);
assert.equal(score({...relevant,vacancy_status:"Cerrada"}).certainty,"excluida");
assert.equal(score({...relevant,eligible_from_spain:false}).certainty,"excluida");
assert.equal(score({...relevant,salary_published:false,salary_min_eur:45000}).salary_published,false);
assert.notEqual(score({...relevant,salary_published:false,salary_min_eur:45000}).certainty,"excluida");
