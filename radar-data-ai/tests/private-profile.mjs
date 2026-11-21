import assert from "node:assert/strict";
import {Script} from "node:vm";
import worker from "../worker/index.js";

const env = {
  RADAR_PRIVATE_PROFILE: JSON.stringify({
    display_name: "Nombre <demo>", location: "Ciudad de prueba", salary_current_eur: 42000,
  }),
  RADAR_SALARY_BANDS: JSON.stringify({"Technical Project Manager — Data & AI": [60000, 85000]}),
};
const endpoint = "https://radar.test";
const request = new Request(endpoint + "/mcp", {
  method: "POST",
  body: JSON.stringify({id: 1, method: "tools/call", params: {name: "get_search_profile"}}),
});
const {result} = await (await worker.fetch(request, env)).json();
const profile = JSON.parse(result.content[0].text);
assert.equal(profile.location, "Ciudad de prueba");
assert.equal(profile.salary_current_eur, 42000);
assert.equal(profile.salary_target_min_eur, 55000);
assert.equal(profile.role_targets.find(role => role.family === "Technical Project Manager — Data & AI").expected_salary_max_eur, 85000);
const page = await (await worker.fetch(new Request(endpoint), env)).text();
assert.match(page, /Nombre &lt;demo&gt;/);
assert.doesNotMatch(page, /Ciudad de prueba|42000/);
assert.match(page, /"min":60000,"max":85000/);
new Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
