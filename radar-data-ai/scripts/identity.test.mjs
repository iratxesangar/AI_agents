import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import worker from "../worker/index.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_offer_history.sql", import.meta.url), "utf8"));
  return {
    sqlite,
    DB: {prepare(sql) {
      const statement = sqlite.prepare(sql);
      function bind(...params) {
        return {
          all: async () => ({results: statement.all(...params)}),
          run: async () => ({meta: statement.run(...params)}),
        };
      }
      return {...bind(), bind};
    }},
  };
}

async function mcp(env, name, args = {}) {
  const response = await worker.fetch(new Request("https://radar.test/mcp", {
    method: "POST",
    body: JSON.stringify({id: 1, method: "tools/call", params: {name, arguments: args}}),
  }), env);
  const {result} = await response.json();
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const role = {company: "Empresa ficticia", title: "Data Engineer", status: "Nueva"};
const first = {...role, requisition_source: "ats.example/empresa", requisition_id: "101",
  url: "https://ats.example/jobs?jobId=101&utm_source=board"};
const second = {...first, requisition_id: "102", url: "https://ats.example/jobs?jobId=102"};
const repost = {...first, url: "https://board.example/positions/45"};

test("demo: dos ciclos mantienen homónimas, fuentes y candidatura rechazada", async () => {
  const env = database();
  await mcp(env, "store_job_offers", {offers: [{...first, status: "Rechazado", dateApplied: "2026-11-01"}]});
  for (const [cycle, expectedCreated] of [[1, 1], [2, 0]]) {
    const batch = await mcp(env, "deduplicate_offer_batch", {
      offers: [first, second, repost], already_applied: (await mcp(env, "get_offer_history")).applications,
    });
    assert.equal(batch.duplicate_count, 1);
    assert.equal(batch.applied_match_count, 1);
    const saved = await mcp(env, "store_job_offers", {offers: batch.unique});
    assert.equal(saved.created_count, expectedCreated);
    const history = await mcp(env, "get_offer_history");
    assert.equal(history.offers.length, 2);
    assert.equal(history.applications.length, 1);
    const [application] = history.applications;
    assert.equal(application.status, "Rechazado");
    assert.equal(application.dateApplied, "2026-11-01");
    assert.deepEqual(new Set(application.source_urls), new Set([first.url, repost.url]));
    console.log(JSON.stringify({cycle, created: saved.created_count, total: history.offers.length,
      sources: application.source_urls.length, application: application.status}));
  }
});

test("mantiene el histórico legado y conserva parámetros funcionales", async () => {
  const env = database();
  env.sqlite.prepare("INSERT INTO offers VALUES (?,?,?,?,?)").run("empresa ficticia::data engineer",
    JSON.stringify({...role, url: first.url}), "Rechazado", null, "2026-11-01");
  const saved = await mcp(env, "store_job_offers", {offers: [
    {...first, url: "https://ats.example/jobs?jobId=101&fbclid=example"}, second,
  ]});
  assert.equal(saved.created_count, 1);
  assert.equal(saved.offers[0].offer_id, "empresa ficticia::data engineer");
  assert.equal(saved.offers[0].status, "Rechazado");
  assert.equal((await mcp(env, "get_offer_history")).applications.length, 1);
});

test("título, portal genérico y alias contradictorio no colapsan vacantes", async () => {
  const env = database();
  const generic = {...role, url: "https://empresa.example/careers?utm_source=x"};
  for (const offers of [[generic, generic], [first, {...second, url: first.url}]]) {
    const batch = await mcp(env, "deduplicate_offer_batch", {offers});
    assert.equal(batch.unique_count, 2);
    assert.equal(batch.possible_duplicates.length, 1);
  }
  const a = await mcp(env, "store_job_offers", {offers: [first, {...second, url: first.url}]});
  assert.equal(a.created_count, 2);
});

test("dos escrituras simultáneas que comparten URL convergen", async () => {
  const env = database();
  const plain = {...role, url: "https://ats.example/jobs?jobId=101"};
  const writes = await Promise.all([
    mcp(env, "store_job_offers", {offers: [first]}),
    mcp(env, "store_job_offers", {offers: [plain]}),
  ]);
  assert.equal(writes.reduce((total, write) => total + write.created_count, 0), 1);
  const {offers} = await mcp(env, "get_offer_history");
  assert.equal(offers.length, 1);
  assert.equal(offers[0].source_urls.length, 2);
  assert.equal(offers[0].requisition_id, "101");
});
