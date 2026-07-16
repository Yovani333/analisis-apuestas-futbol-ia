import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_STATUS } from "../server/constants/source-catalog.js";
import { createSourceResult } from "../server/services/sources/source-adapter.js";
import { getSofaScoreSportsData } from "../server/services/sources/sofascore.service.js";
import { getOddspediaMarketData } from "../server/services/sources/oddspedia.service.js";
import { getFotMobContextData } from "../server/services/sources/fotmob.service.js";
import { getWhoScoredAbsenceData } from "../server/services/sources/whoscored.service.js";
import { getFbrefXgData } from "../server/services/sources/fbref.service.js";
import { getWeatherContextData } from "../server/services/sources/weather.service.js";
import { getSoccerwayFallbackData } from "../server/services/sources/soccerway.service.js";

test("SofaScore desactivado no realiza solicitudes de red", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("No debe llamarse"); };
  try {
    const result = await getSofaScoreSportsData({ fixture: { id: 100, home: "A", away: "B" } }, { accessMode: "disabled" });
    assert.equal(result.status, SOURCE_STATUS.NOT_CONFIGURED);
    assert.equal(fetchCalls, 0);
    assert.match(result.notes.join(" "), /no se realizaron solicitudes/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SofaScore bloquea modos sin conector aprobado", async () => {
  const result = await getSofaScoreSportsData({ fixture: { id: 100 } }, { accessMode: "unofficial" });
  assert.equal(result.status, SOURCE_STATUS.BLOCKED);
  assert.equal(result.data.matchIdentity.fixtureId, "100");
});

test("el contrato comun rechaza estados desconocidos", () => {
  assert.throws(() => createSourceResult({ source: "prueba", status: "inventado" }), /Estado de fuente no valido|Estado de fuente no v.lido/);
});

test("fuentes secundarias desactivadas no usan proveedor externo", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const matchData = { fixture: { id: 10, status: "scheduled", home: "A", away: "B" }, confirmed: {}, marketAnalysis: [] };

  const results = await Promise.all([
    getOddspediaMarketData(matchData, { accessMode: "enabled", client }),
    getFotMobContextData(matchData, { accessMode: "enabled", client }),
    getWhoScoredAbsenceData(matchData, { accessMode: "enabled", client }),
    getFbrefXgData(matchData, { accessMode: "enabled", client }),
    getSoccerwayFallbackData(matchData, { accessMode: "enabled", client })
  ]);

  assert.equal(calls, 0);
  assert.deepEqual(results.map((result) => result.status), [
    SOURCE_STATUS.BLOCKED,
    SOURCE_STATUS.NOT_CONFIGURED,
    SOURCE_STATUS.NOT_CONFIGURED,
    SOURCE_STATUS.NOT_CONFIGURED,
    SOURCE_STATUS.NOT_CONFIGURED
  ]);
});

test("Open-Meteo explica cuando falta ubicacion del estadio", async () => {
  let calls = 0;
  const result = await getWeatherContextData(
    { fixture: { id: 41, status: "scheduled", utcDateTime: "2026-08-01T20:00:00Z" } },
    { fetchImpl: async () => { calls += 1; } }
  );
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.match(result.notes[0], /falta ubicaci.n del estadio/i);
  assert.equal(calls, 0);
});

test("Open-Meteo normaliza un pronostico horario programado", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ hourly: { time: ["2026-06-25T20:00"], temperature_2m: [22], relative_humidity_2m: [55], precipitation_probability: [10], precipitation: [0], weather_code: [2], wind_speed_10m: [14] } }) };
  };
  const result = await getWeatherContextData({
    fixture: { id: 42, status: "scheduled", utcDateTime: "2026-06-25T20:00:00Z", stadium: "Estadio", city: "Los Angeles", country: "USA", latitude: 34.05, longitude: -118.24 }
  }, { fetchImpl, now: new Date("2026-06-22T12:00:00Z"), forceRefresh: true });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.temperature, 22);
  assert.equal(result.data.rainProbability, 10);
  assert.match(result.data.pitchNotes, /estimada seca/i);
  assert.match(requestedUrl, /api\.open-meteo\.com\/v1\/forecast/);
});

test("Open-Meteo usa clima actual para un partido en vivo", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({
    current: { time: "2026-06-25T20:00", temperature_2m: 24, relative_humidity_2m: 60, precipitation: 0.4, weather_code: 61, wind_speed_10m: 11 },
    hourly: { time: ["2026-06-25T20:00"], precipitation_probability: [65] }
  }) });
  const result = await getWeatherContextData({
    fixture: { id: 43, status: "live", utcDateTime: "2026-06-25T20:00:00Z", city: "Los Angeles", latitude: 34.05, longitude: -118.24 }
  }, { fetchImpl, forceRefresh: true });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.temperature, 24);
  assert.equal(result.data.rainProbability, 65);
  assert.equal(result.data.retrieval, "open_meteo_current");
});

test("Open-Meteo permite reemplazar un pronostico cacheado cuando cambia el clima", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const temperature = calls === 1 ? 19 : 23;
    return { ok: true, json: async () => ({ hourly: {
      time: ["2026-07-20T20:00"], temperature_2m: [temperature], relative_humidity_2m: [58],
      precipitation_probability: [calls === 1 ? 15 : 70], precipitation: [calls === 1 ? 0 : 2.2],
      weather_code: [calls === 1 ? 2 : 61], wind_speed_10m: [12]
    } }) };
  };
  const matchData = { fixture: {
    id: 4501, status: "scheduled", utcDateTime: "2026-07-20T20:00:00Z",
    city: "Los Angeles", country: "USA", latitude: 34.05, longitude: -118.24
  } };
  const now = new Date("2026-07-20T12:00:00Z");
  const first = await getWeatherContextData(matchData, { fetchImpl, now, forceRefresh: true });
  const cached = await getWeatherContextData(matchData, { fetchImpl, now });
  const refreshed = await getWeatherContextData(matchData, { fetchImpl, now, forceRefresh: true });
  assert.equal(first.data.temperature, 19);
  assert.equal(cached.data.temperature, 19);
  assert.equal(refreshed.data.temperature, 23);
  assert.equal(refreshed.data.rainProbability, 70);
  assert.equal(calls, 2);
});
