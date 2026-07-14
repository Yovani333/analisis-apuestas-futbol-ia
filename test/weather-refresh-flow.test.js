import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const services = readFileSync(new URL("../public/services.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../server/routes/api.routes.js", import.meta.url), "utf8");

test("el clima usa un endpoint ligero separado del dataset completo", () => {
  assert.match(routes, /\/fixtures\/:fixtureId\/weather/);
  assert.match(services, /getWeatherData[\s\S]+?\/weather/);
  const weatherRefresh = app.match(/async function refreshWeatherData[\s\S]+?async function refreshLiveDataNow/)[0];
  assert.match(weatherRefresh, /getWeatherData\(fixture\.id, true\)/);
  assert.doesNotMatch(weatherRefresh, /getFixtureData|getResearchData/);
});

test("Transparencia actualiza clima periodicamente solo con la pagina visible", () => {
  assert.match(app, /WEATHER_REFRESH_INTERVAL_MS = 10 \* 60 \* 1000/);
  assert.match(app, /state\.currentView !== "transparency"/);
  assert.match(app, /document\.visibilityState === "visible"/);
  assert.match(app, /refreshWeatherData\(\{ silent: true \}\)/);
});

test("los partidos finalizados no quedan en sondeo meteorologico", () => {
  assert.match(app, /fixture\.status === "finished"\) return false/);
});
