import {DatabaseSync} from "node:sqlite";
import {canonicalOfferUrl, requisitionKey, reviewPairs, storedOffer} from "../worker/index.js";

const path = process.argv[2];
if (!path) {
  console.error("Uso: node scripts/audit-history.mjs copia.sqlite");
  process.exit(1);
}
const db = new DatabaseSync(path, {readOnly:true});
const rows = db.prepare("SELECT * FROM offers WHERE id NOT LIKE 'manual::%'").all();
const active = rows.map(storedOffer).filter(offer => !offer._merged_into);
const legacy = active.filter(offer => !/^(?:req:|url:|local:)/.test(offer.offer_id));
const review = reviewPairs(active).map(({a,b,reasons}) => ({ids:[a.offer_id,b.offer_id],reasons}));
for (const offer of legacy) {
  const sources = new Set([offer.url,...(offer.source_urls||[])].map(canonicalOfferUrl).filter(Boolean));
  if (sources.size !== 1 || requisitionKey(offer)) {
    review.push({ids:[offer.offer_id],reasons:["Revisar fuentes históricas antes de atribuir la identidad"]});
  }
}
console.log(JSON.stringify({active:active.length,archived:rows.length-active.length,legacy:legacy.length,review},null,2));
db.close();
