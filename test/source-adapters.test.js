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

test("el contrato común rechaza estados desconocidos", () => {
  assert.throws(() => createSourceResult({ source: "prueba", status: "inventado" }), /Estado de fuente no válido/);
});

test("Oddspedia desactivado no llama a OpenAI", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getOddspediaMarketData({ fixture: { id: 1 }, marketAnalysis: [] }, { accessMode: "disabled", client });
  assert.equal(result.status, SOURCE_STATUS.BLOCKED);
  assert.equal(calls, 0);
});

test("Oddspedia no se consulta si API-Football ya tiene mercados", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getOddspediaMarketData({ fixture: { id: 1 }, marketAnalysis: [{ market: "Cuota existente" }] }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(calls, 0);
});

test("Oddspedia acepta únicamente coincidencia exacta con fuente del dominio", async () => {
  let request;
  const client = { responses: { parse: async (input) => {
    request = input;
    return {
      output_parsed: {
        match_found: true, identity_confirmed: true, matched_home_team: "A", matched_away_team: "B",
        event_url: "https://oddspedia.com/mx/futbol/a-b", observed_at: "2026-06-21T18:00:00Z",
        markets: [{ market: "Ganador", selection: "A", decimal_odds: 1.8, bookmaker: "Casa" }], notes: []
      },
      output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://oddspedia.com/mx/futbol/a-b" }] } }]
    };
  } } };
  const result = await getOddspediaMarketData({ fixture: { id: 2, home: "A", away: "B", date: "2026-06-22", leagueName: "Liga" }, marketAnalysis: [] }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.markets[0].decimalOdds, 1.8);
  assert.equal(result.data.markets[0].requiresReview, true);
  assert.deepEqual(request.tools[0].filters.allowed_domains, ["oddspedia.com"]);
});

test("Oddspedia descarta cuotas sin una URL verificable del dominio", async () => {
  const client = { responses: { parse: async () => ({
    output_parsed: {
      match_found: true, identity_confirmed: true, matched_home_team: "A", matched_away_team: "B",
      event_url: "https://example.com/a-b", observed_at: null,
      markets: [{ market: "Ganador", selection: "A", decimal_odds: 1.8, bookmaker: null }], notes: []
    },
    output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://example.com/a-b" }] } }]
  }) } };
  const result = await getOddspediaMarketData({ fixture: { id: 3, home: "A", away: "B", date: "2026-06-22" }, marketAnalysis: [] }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(result.data, null);
});

test("FotMob desactivado no llama a OpenAI", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getFotMobContextData({ fixture: { id: 10, status: "scheduled" }, confirmed: {} }, { accessMode: "disabled", client });
  assert.equal(result.status, SOURCE_STATUS.NOT_CONFIGURED);
  assert.equal(calls, 0);
});

test("FotMob no consulta partidos iniciados o finalizados", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getFotMobContextData({ fixture: { id: 11, status: "finished" }, confirmed: {} }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(calls, 0);
});

test("FotMob normaliza únicamente datos prepartido con fuente verificable", async () => {
  let request;
  const client = { responses: { parse: async (input) => {
    request = input;
    return {
      output_parsed: {
        match_found: true, identity_confirmed: true, event_url: "https://www.fotmob.com/matches/a-vs-b/123", observed_at: "2026-06-21T18:00:00Z",
        home_absences: [{ player: "Jugador A", type: "injury", reason: "Lesión muscular" }], away_absences: [],
        lineups_confirmed: false, home_starting_xi: [], away_starting_xi: [],
        home_probable_xi: [{ name: "Jugador B", position: "M" }], away_probable_xi: [{ name: "Jugador C", position: "D" }],
        home_formation: "4-3-3", away_formation: "4-4-2", xg_scope: "season_average",
        home_xg: 1.5, home_xga: 1.1, away_xg: 1.2, away_xga: 1.4, notes: []
      },
      output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://www.fotmob.com/matches/a-vs-b/123" }] } }]
    };
  } } };
  const result = await getFotMobContextData({
    fixture: { id: 12, status: "scheduled", home: "A", away: "B", date: "2026-06-22", time: "18:00", leagueName: "Liga" },
    confirmed: { injuries: [], lineups: [] }
  }, { accessMode: "openai_web_search", apiKey: "test", model: "test-model", client });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.injuriesSuspensions.home.injuries[0].requiresReview, true);
  assert.equal(result.data.lineups.probableHomeXI[0].name, "Jugador B");
  assert.equal(result.data.xgXga.homeXG, 1.5);
  assert.deepEqual(request.tools[0].filters.allowed_domains, ["fotmob.com"]);
});

test("WhoScored desactivado no llama a OpenAI", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getWhoScoredAbsenceData({ fixture: { id: 20, status: "scheduled" }, confirmed: {} }, { accessMode: "disabled", client });
  assert.equal(result.status, SOURCE_STATUS.NOT_CONFIGURED);
  assert.equal(calls, 0);
});

test("WhoScored no duplica búsqueda cuando FotMob ya cubrió módulos", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const fotmobResult = {
    data: {
      injuriesSuspensions: { home: { injuries: [{ name: "A" }] }, away: {} },
      lineups: { probableHomeXI: [{ name: "A" }], probableAwayXI: [{ name: "B" }] }
    }
  };
  const result = await getWhoScoredAbsenceData({ fixture: { id: 21, status: "scheduled" }, confirmed: { injuries: [], lineups: [] } }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client, fotmobResult
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(calls, 0);
});

test("WhoScored normaliza bajas y alineaciones probables con fuente verificable", async () => {
  let request;
  const client = { responses: { parse: async (input) => {
    request = input;
    return {
      output_parsed: {
        match_found: true, identity_confirmed: true, event_url: "https://www.whoscored.com/matches/123/preview", observed_at: "2026-06-21T18:00:00Z",
        home_absences: [{ player: "Jugador A", type: "suspension", reason: "Tarjeta roja" }], away_absences: [],
        home_probable_xi: [{ name: "Jugador B", position: "M" }], away_probable_xi: [{ name: "Jugador C", position: "D" }],
        home_formation: "4-3-3", away_formation: "4-4-2", tactical_notes: ["Presión alta probable"], notes: []
      },
      output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://www.whoscored.com/matches/123/preview" }] } }]
    };
  } } };
  const result = await getWhoScoredAbsenceData({
    fixture: { id: 22, status: "scheduled", home: "A", away: "B", date: "2026-06-22", time: "18:00", leagueName: "Liga" },
    confirmed: { injuries: [], lineups: [] }
  }, { accessMode: "openai_web_search", apiKey: "test", model: "test-model", client, fotmobResult: null });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.injuriesSuspensions.home.suspensions[0].requiresReview, true);
  assert.equal(result.data.lineups.probableHomeXI[0].name, "Jugador B");
  assert.deepEqual(request.tools[0].filters.allowed_domains, ["whoscored.com"]);
});

test("FBref desactivado no llama a OpenAI", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getFbrefXgData({ fixture: { id: 30, status: "scheduled" } }, { accessMode: "disabled", client });
  assert.equal(result.status, SOURCE_STATUS.NOT_CONFIGURED);
  assert.equal(calls, 0);
});

test("FBref no duplica búsqueda cuando FotMob ya aportó xG", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const fotmobResult = { data: { xgXga: { scope: "season_average", homeXG: 1.4, homeXGA: 1.1, awayXG: 1.2, awayXGA: 1.3 } } };
  const result = await getFbrefXgData({ fixture: { id: 31, status: "scheduled" } }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client, fotmobResult
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(calls, 0);
});

test("FBref normaliza promedios de temporada con fuentes verificables", async () => {
  let request;
  const homeUrl = "https://fbref.com/en/squads/111/Team-A-Stats";
  const awayUrl = "https://fbref.com/en/squads/222/Team-B-Stats";
  const client = { responses: { parse: async (input) => {
    request = input;
    return {
      output_parsed: {
        competition_found: true, teams_confirmed: true, season: "2025-2026", observed_at: "2026-06-21T18:00:00Z",
        scope: "season_per_match",
        home: { team: "A", xg_per_match: 1.55, xga_per_match: 1.02, npxg_per_match: 1.31, matches_played: 30, source_url: homeUrl },
        away: { team: "B", xg_per_match: 1.2, xga_per_match: 1.4, npxg_per_match: 1.05, matches_played: 30, source_url: awayUrl },
        notes: []
      },
      output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: homeUrl }, { type: "url", url: awayUrl }] } }]
    };
  } } };
  const result = await getFbrefXgData({
    fixture: { id: 32, status: "scheduled", home: "A", away: "B", date: "2026-06-22", leagueName: "Liga", season: "2025-2026" }
  }, { accessMode: "openai_web_search", apiKey: "test", model: "test-model", client });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.home.xg, 1.55);
  assert.equal(result.data.away.npxg, 1.05);
  assert.deepEqual(request.tools[0].filters.allowed_domains, ["fbref.com"]);
});

test("FBref descarta métricas sin URL verificable para los equipos", async () => {
  const client = { responses: { parse: async () => ({
    output_parsed: {
      competition_found: true, teams_confirmed: true, season: "2025-2026", observed_at: null, scope: "season_per_match",
      home: { team: "A", xg_per_match: 1.5, xga_per_match: 1, npxg_per_match: 1.3, matches_played: 20, source_url: "https://example.com/a" },
      away: { team: "B", xg_per_match: 1.2, xga_per_match: 1.4, npxg_per_match: 1, matches_played: 20, source_url: "https://example.com/b" },
      notes: []
    }, output: []
  }) } };
  const result = await getFbrefXgData({ fixture: { id: 33, status: "scheduled", home: "A", away: "B" } }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(result.data, null);
});

test("Open-Meteo desactivado no realiza solicitudes", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; };
  const result = await getWeatherContextData({ fixture: { id: 40, status: "scheduled" } }, { accessMode: "disabled", fetchImpl });
  assert.equal(result.status, SOURCE_STATUS.NOT_CONFIGURED);
  assert.equal(calls, 0);
});

test("Open-Meteo explica cuando falta ubicación del estadio", async () => {
  let calls = 0;
  const result = await getWeatherContextData({ fixture: { id: 41, status: "scheduled", utcDateTime: "2026-08-01T20:00:00Z" } }, { fetchImpl: async () => { calls += 1; } });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.match(result.notes[0], /falta ubicación del estadio/i);
  assert.equal(calls, 0);
});

test("Open-Meteo normaliza un pronóstico horario programado", async () => {
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
  assert.equal(result.data.condition, "Parcialmente nublado");
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
  assert.match(result.data.pitchNotes, /húmeda/i);
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
  assert.match(refreshed.data.pitchNotes, /mojada/i);
  assert.equal(calls, 2);
});

test("Open-Meteo usa condiciones actuales si el fixture programado ya comenzo", async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /current=/);
    return { ok: true, json: async () => ({
      current: { time: "2026-07-20T20:30", temperature_2m: 25, relative_humidity_2m: 50, precipitation: 0, weather_code: 0, wind_speed_10m: 8 },
      hourly: { time: ["2026-07-20T20:00"], precipitation_probability: [5] }
    }) };
  };
  const result = await getWeatherContextData({ fixture: {
    id: 4502, status: "scheduled", utcDateTime: "2026-07-20T20:00:00Z",
    city: "Los Angeles", latitude: 34.05, longitude: -118.24
  } }, { fetchImpl, now: new Date("2026-07-20T20:30:00Z"), forceRefresh: true });
  assert.equal(result.data.retrieval, "open_meteo_current");
  assert.equal(result.data.temperature, 25);
});

test("Open-Meteo usa archivo histórico sin inventar probabilidad de lluvia", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ hourly: { time: ["2025-06-25T20:00"], temperature_2m: [20], relative_humidity_2m: [70], precipitation: [1.2], weather_code: [61], wind_speed_10m: [9] } }) });
  const result = await getWeatherContextData({
    fixture: { id: 44, status: "finished", utcDateTime: "2025-06-25T20:00:00Z", city: "Los Angeles", latitude: 34.05, longitude: -118.24 }
  }, { fetchImpl, now: new Date("2026-06-28T12:00:00Z"), forceRefresh: true });
  assert.equal(result.data.retrieval, "open_meteo_historical");
  assert.equal(result.data.rainProbability, null);
});

test("Soccerway desactivado no llama a OpenAI", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getSoccerwayFallbackData({ fixture: { id: 50, status: "scheduled" } }, { accessMode: "disabled", client });
  assert.equal(result.status, SOURCE_STATUS.NOT_CONFIGURED);
  assert.equal(calls, 0);
});

test("Soccerway no duplica datos ya cubiertos por API-Football", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getSoccerwayFallbackData({
    fixture: { id: 51, status: "scheduled" },
    confirmed: { standings: [{}], h2h: [{}] }
  }, { accessMode: "openai_web_search", apiKey: "test", model: "test-model", client });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(calls, 0);
});

test("Soccerway normaliza clasificación y H2H anteriores con fuentes verificables", async () => {
  let request;
  const tableUrl = "https://int.soccerway.com/national/test/standings";
  const matchUrl = "https://int.soccerway.com/matches/2025/01/01/a-b";
  const client = { responses: { parse: async (input) => {
    request = input;
    return {
      output_parsed: {
        match_found: true, identity_confirmed: true, competition_confirmed: true,
        competition_url: tableUrl, observed_at: "2026-06-22T12:00:00Z",
        home_standing: { team: "A", rank: 1, points: 30, played: 15, wins: 9, draws: 3, losses: 3, goals_for: 28, goals_against: 14, goal_difference: 14, source_url: tableUrl },
        away_standing: { team: "B", rank: 4, points: 22, played: 15, wins: 6, draws: 4, losses: 5, goals_for: 20, goals_against: 18, goal_difference: 2, source_url: tableUrl },
        h2h_matches: [{ date: "2025-01-01", home_team: "A", away_team: "B", home_goals: 2, away_goals: 1, source_url: matchUrl }], notes: []
      },
      output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: tableUrl }, { type: "url", url: matchUrl }] } }]
    };
  } } };
  const result = await getSoccerwayFallbackData({
    fixture: { id: 52, status: "scheduled", home: "A", away: "B", date: "2026-06-25", leagueName: "Liga", season: "2026" },
    confirmed: { standings: [], h2h: [] }
  }, { accessMode: "openai_web_search", apiKey: "test", model: "test-model", client });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.standings.home.rank, 1);
  assert.equal(result.data.h2h.length, 1);
  assert.equal(result.data.h2h[0].requiresReview, true);
  assert.deepEqual(request.tools[0].filters.allowed_domains, ["soccerway.com"]);
});

test("Soccerway descarta H2H de la fecha actual o futura", async () => {
  const matchUrl = "https://int.soccerway.com/matches/2026/06/25/a-b";
  const client = { responses: { parse: async () => ({
    output_parsed: {
      match_found: true, identity_confirmed: true, competition_confirmed: false,
      competition_url: null, observed_at: null, home_standing: null, away_standing: null,
      h2h_matches: [{ date: "2026-06-25", home_team: "A", away_team: "B", home_goals: 2, away_goals: 1, source_url: matchUrl }], notes: []
    },
    output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: matchUrl }] } }]
  }) } };
  const result = await getSoccerwayFallbackData({
    fixture: { id: 53, status: "scheduled", home: "A", away: "B", date: "2026-06-25" }, confirmed: { standings: [], h2h: [] }
  }, { accessMode: "openai_web_search", apiKey: "test", model: "test-model", client });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(result.data, null);
});

test("Soccerway descarta datos pertenecientes a otros equipos", async () => {
  const sourceUrl = "https://int.soccerway.com/matches/2025/01/01/c-d";
  const client = { responses: { parse: async () => ({
    output_parsed: {
      match_found: true, identity_confirmed: true, competition_confirmed: false,
      competition_url: null, observed_at: null, home_standing: null, away_standing: null,
      h2h_matches: [{ date: "2025-01-01", home_team: "C", away_team: "D", home_goals: 1, away_goals: 0, source_url: sourceUrl }], notes: []
    },
    output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: sourceUrl }] } }]
  }) } };
  const result = await getSoccerwayFallbackData({
    fixture: { id: 54, status: "scheduled", home: "A", away: "B", date: "2026-06-25" }, confirmed: { standings: [], h2h: [] }
  }, { accessMode: "openai_web_search", apiKey: "test", model: "test-model", client });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(result.data, null);
});
