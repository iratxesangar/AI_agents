import assert from "node:assert/strict";
import test from "node:test";
import {Script} from "node:vm";
import worker, {safeOfferUrl, salaryValues} from "../worker/index.js";

const base = {
  company: "Empresa de prueba", title: "Data Engineer", country: "España",
  remote_mode: "remote", eligible_from_spain: true,
};

const cases = [
  ["importe publicado inferior", {salary_min_eur: 52000}, "excluir", 0],
  ["importe exactamente en el umbral", {salary_min_eur: 55000}, "verificada", 100],
  ["rango que cruza el umbral", {salary_min_eur: 52000, salary_max_eur: 60000}, "por confirmar", 50],
  ["rango incoherente", {salary_min_eur: 60000, salary_max_eur: 50000}, "por confirmar", 50],
  ["estimación no publicada", {salary_min_eur: 42000, salary_max_eur: 50000, salary_published: false}, "por confirmar", 50],
  ["híbrido en España", {salary_min_eur: 60000, remote_mode: "hybrid", office_days_per_week: 3}, "verificada", 100],
  ["híbrido internacional sin días", {salary_min_eur: 60000, country: "Germany", remote_mode: "hybrid"}, "por confirmar", 100],
  ["híbrido internacional con tres días", {salary_min_eur: 60000, country: "Germany", remote_mode: "hybrid", office_days_per_week: 3}, "excluir", 100],
  ["remoto inelegible desde España", {salary_min_eur: 60000, eligible_from_spain: false}, "excluir", 100],
];

for (const [name, fields, classification, salaryScore] of cases) {
  test(name, async () => {
    const response = await worker.fetch(new Request("https://radar.test/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {name: "score_job_offer", arguments: {...base, ...fields}},
      }),
    }));
    const {result} = await response.json();
    const offer = JSON.parse(result.content[0].text);
    assert.equal(offer.classification, classification);
    assert.equal(offer.components.salary, salaryScore);
    assert.ok(offer.flags.length);
  });
}

test("normaliza enlaces HTTP y bloquea otros esquemas", () => {
  assert.equal(safeOfferUrl(" HTTPS://jobs.example/oferta "), "https://jobs.example/oferta");
  for (const value of ["javascript:void(0)", "data:text/plain,x", "//jobs.example", "https://user@jobs.example"]) {
    assert.equal(safeOfferUrl(value), "");
  }
});

test("rechaza enlaces inválidos antes de acceder a la base de datos", async () => {
  const response = await worker.fetch(new Request("https://radar.test/api/offers", {
    method: "POST",
    body: JSON.stringify({offers: [{...base, url: "javascript:void(0)"}]}),
  }), {DB: {prepare() { assert.fail("No debe acceder a D1"); }}});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /HTTP o HTTPS/);
});

test("conserva decimales con k y evita comparar moneda o periodicidad incompatibles", () => {
  assert.deepEqual(salaryValues("1.5k"), [1500, 1500]);
  assert.deepEqual(salaryValues("52–60k EUR"), [52000, 60000]);
  assert.deepEqual(salaryValues("55.000 €"), [55000, 55000]);
  assert.equal(salaryValues("1,5k €/mes"), null);
  assert.equal(salaryValues("70k USD"), null);
  assert.equal(salaryValues("60k–50k"), null);
});

test("la página genera JavaScript válido con configuración ausente o privada", async () => {
  for (const env of [{}, {RADAR_SALARY_BANDS: JSON.stringify({"Data Architect": [55000, 70000]})}]) {
    const response = await worker.fetch(new Request("https://radar.test/"), env);
    const script = (await response.text()).match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new Script(script));
  }
});
