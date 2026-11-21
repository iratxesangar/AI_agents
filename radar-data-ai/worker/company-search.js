export function companyKey(value) {
  return String(value??"").normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

function webUrl(value) {
  try {
    const url=new URL(value);
    return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:null;
  }catch{return null}
}

export function normalizeCompany(record) {
  const spain=record.sources.find(x=>x.source==="España")?.fields||{};
  const global=record.sources.find(x=>x.source==="Global")?.fields||{};
  const web=webUrl(spain["Web oficial"])||webUrl(global.Web);
  const headquarters=String(global["País sede"]||spain["Sede global"]||"").trim();
  const country=headquarters.split(",").at(-1)?.trim()||null;
  return {...record,name:record.name.trim(),key:companyKey(record.name),web,
    domain:web?new URL(web).hostname.replace(/^www\./,""):null,country,
    sector:String(spain["Sector principal"]||global.Sector||"").trim()||null,
    employment:webUrl(spain["Portal de empleo"])||webUrl(global["Empleo oficial"]),
    eligibility_reference:{
      presence_source:webUrl(spain["Fuente de presencia / ubicación"]),
      remote_note:String(global["Compatibilidad desde España"]||spain["¿Remoto desde cualquier lugar de España?"]||"").trim(),
    },
  };
}

export function companyScope(company) {
  return {name:company.name,key:company.key,employment:company.employment};
}

export function needsCompanyMatch(run,offer) {
  return !!run.filters.company && companyKey(offer.company)!==run.filters.company.key;
}

export function companyEvidence(run,input) {
  const item=input.company_eligibility;
  if(!run.filters.company||!item||!["confirmed","restricted","unknown"].includes(item.status))return null;
  const url=webUrl(item.url);
  const quote=typeof item.quote==="string"?item.quote.trim().slice(0,1200):"";
  if(!url||!quote)return null;
  return {status:item.status,url,quote,checked_at:new Date().toISOString()};
}
