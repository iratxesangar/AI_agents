import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

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
