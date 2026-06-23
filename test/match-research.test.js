import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_STATUS, DATA_STATUS, MODULE_WEIGHTS } from "../server/constants/match-research.js";
import { calculateMatchConfidenceScore, detectMissingCriticalData, scoreModule } from "../server/services/match-confidence.service.js";
import { buildOpenAIPromptFromMatchData, normalizeMatchResearchData } from "../server/services/match-research.service.js";
import { applyResearchGuardrails } from "../server/services/openai.service.js";
import { buildEstimatedXgFromDataset } from "../server/services/xg/estimated-xg.service.js";

function lineup(teamId, name) {
  return { team: { id: teamId, name }, formation: "4-3-3", startXI: [{ player: { id: teamId * 10, name: `${name} 1`, number: 1, pos: "G" } }], substitutes: [] };
}

function datasetFixture() {
  const recent = (team, opponent) => Array.from({ length: 5 }, (_, index) => ({
    fixtureId: String(index + 1), date: `2026-06-${10 - index}`, opponent, venue: index % 2 ? "Local" : "Visitante",
    goalsFor: 2, goalsAgainst: index === 0 ? 0 : 1, result: "W", over25: true, btts: index !== 0
  }));
  return {
    source: "api-football", fetchedAt: "2026-06-21T12:00:00.000Z",
    fixture: {
      id: "100", leagueId: 1, leagueName: "Copa Mundial FIFA", season: 2026, country: "Mundial",
      homeTeamId: 10, home: "Equipo Local", awayTeamId: 20, away: "Equipo Visitante",
      date: "2026-06-22", time: "18:00", stadium: "Estadio de prueba", city: "Ciudad de prueba",
      neutralVenue: true, timezone: "America/Los_Angeles", utcDateTime: "2026-06-23T01:00:00.000Z"
    },
    confirmed: {
      standings: [{ league: { standings: [[
        { rank: 1, points: 6, team: { id: 10 }, all: { played: 2, win: 2, draw: 0, lose: 0, goals: { for: 4, against: 1 } } },
        { rank: 2, points: 3, team: { id: 20 }, all: { played: 2, win: 1, draw: 0, lose: 1, goals: { for: 2, against: 2 } } }
      ]] } }],
      h2h: [{ fixture: { id: 9, date: "2025-01-01T12:00:00Z" }, teams: { home: { id: 10, name: "Equipo Local" }, away: { id: 20, name: "Equipo Visitante" } }, goals: { home: 1, away: 0 } }],
      injuries: [
        { team: { id: 10 }, player: { id: 1, name: "Jugador A", type: "Knee injury", reason: "Injury" } },
        { team: { id: 20 }, player: { id: 2, name: "Jugador B", type: "Suspended", reason: "Red card" } }
      ],
      lineups: [lineup(10, "Equipo Local"), lineup(20, "Equipo Visitante")],
      events: [{ time: { elapsed: 25 }, team: { id: 10, name: "Equipo Local" }, player: { id: 1, name: "Jugador Secreto" }, type: "Goal", detail: "Normal Goal" }],
      players: [{ team: { id: 10, name: "Equipo Local" }, players: [{ player: { id: 1, name: "Jugador Secreto" }, statistics: [{ games: { minutes: 90, position: "F", rating: "7.5" }, shots: { total: 3, on: 2 }, goals: { total: 1, assists: 0 }, passes: { total: 20, key: 2 }, tackles: { total: 1, interceptions: 0 }, cards: { yellow: 0, red: 0 } }] }] }],
      teamStatistics: {
        cutoffDate: "2026-06-21",
        home: { team: { id: 10, name: "Equipo Local" }, form: "WWD", fixtures: { played: { total: 3 }, wins: { total: 2 }, draws: { total: 1 }, loses: { total: 0 } }, goals: { for: { total: { total: 6 }, average: { total: "2.0" } }, against: { total: { total: 2 }, average: { total: "0.7" } } }, clean_sheet: { total: 2 }, failed_to_score: { total: 0 }, penalty: { scored: { total: 1 }, missed: { total: 0 } }, lineups: [{ formation: "4-3-3", played: 2 }] },
        away: { team: { id: 20, name: "Equipo Visitante" }, form: "LDW", fixtures: { played: { total: 3 }, wins: { total: 1 }, draws: { total: 1 }, loses: { total: 1 } }, goals: { for: { total: { total: 3 }, average: { total: "1.0" } }, against: { total: { total: 4 }, average: { total: "1.3" } } }, clean_sheet: { total: 1 }, failed_to_score: { total: 1 }, penalty: { scored: { total: 0 }, missed: { total: 0 } }, lineups: [] }
      }
    },
    preMatch: {
      home: { team: "Equipo Local", played: 5, goalsFor: 10, goalsAgainst: 4, winRate: 80, restDays: 4, matches: recent("Equipo Local", "Rival A") },
      away: { team: "Equipo Visitante", played: 5, goalsFor: 8, goalsAgainst: 5, winRate: 60, restDays: 5, matches: recent("Equipo Visitante", "Rival B") },
      odds: { bookmaker: "Casa", updatedAt: "2026-06-21T11:00:00Z" }
    },
    marketAnalysis: Array.from({ length: 4 }, (_, index) => ({ marketKey: "btts", selectionKey: `s${index}`, market: "Mercado", selection: `Selección ${index}`, decimalOdds: 1.9 }))
  };
}

test("los pesos de investigación suman 100", () => {
  assert.equal(Object.values(MODULE_WEIGHTS).reduce((total, weight) => total + weight, 0), 100);
});

test("un módulo parcial aporta la mitad de su peso", () => {
  assert.equal(scoreModule(DATA_STATUS.AVAILABLE, 18), 18);
  assert.equal(scoreModule(DATA_STATUS.PARTIAL, 18), 9);
  assert.equal(scoreModule(DATA_STATUS.FAILED, 18), 0);
});

test("tres módulos críticos ausentes fuerzan needs_review", () => {
  const matchData = Object.fromEntries(Object.keys(MODULE_WEIGHTS).map((key) => [key, { status: DATA_STATUS.AVAILABLE }]));
  matchData.injuriesSuspensions.status = DATA_STATUS.NOT_AVAILABLE;
  matchData.lineups.status = DATA_STATUS.FAILED;
  matchData.xgXga.status = DATA_STATUS.NOT_AVAILABLE;
  const score = calculateMatchConfidenceScore(matchData);
  assert.equal(detectMissingCriticalData(matchData).length, 3);
  assert.equal(score.analysisStatus, ANALYSIS_STATUS.NEEDS_REVIEW);
});

test("normaliza datos disponibles y conserva faltantes explícitos", () => {
  const normalized = normalizeMatchResearchData(datasetFixture());
  assert.equal(normalized.matchId, "100");
  assert.equal(normalized.statsForm.status, DATA_STATUS.AVAILABLE);
  assert.equal(normalized.injuriesSuspensions.home.injuries.length, 1);
  assert.equal(normalized.injuriesSuspensions.away.suspensions.length, 1);
  assert.equal(normalized.lineups.confirmed, true);
  assert.equal(normalized.xgXga.status, DATA_STATUS.NOT_AVAILABLE);
  assert.equal(normalized.weatherPitch.status, DATA_STATUS.NOT_AVAILABLE);
  assert.equal(normalized.supportingData.fixtureEvents.summary.goals, 1);
  assert.equal(normalized.supportingData.playerPerformance.teams[0].players[0].rating, 7.5);
  assert.equal(normalized.supportingData.teamSeasonStatistics.home.played, 3);
  assert.equal(normalized.supportingData.teamSeasonStatistics.cutoffDate, "2026-06-21");
  assert.equal(normalized.sources.apiFootball.status, "available");
  assert.equal(normalized.sources.sofaScore.status, "not_configured");
  assert.equal(normalized.sources.oddspedia.status, "blocked");
  assert.equal(normalized.sourceCoverage.length, 9);
  const oddsCoverage = normalized.sourceCoverage.find((item) => item.module === "odds");
  assert.deepEqual(oddsCoverage.primarySources, ["Oddspedia"]);
  assert.deepEqual(oddsCoverage.activeSources, ["API-Football"]);
  assert.ok(normalized.missingData.some((item) => item.module === "xgXga"));
  assert.equal(normalized.analysisStatus, ANALYSIS_STATUS.COMPLETE);
});

test("el constructor para OpenAI usa solo matchData normalizado", () => {
  const normalized = normalizeMatchResearchData(datasetFixture());
  normalized.lineups.errorCode = "INTERNAL_TEST";
  const prompt = buildOpenAIPromptFromMatchData(normalized);
  assert.match(prompt.instructions, /No inventes datos deportivos/);
  assert.match(prompt.input, /"matchData"/);
  assert.doesNotMatch(prompt.input, /INTERNAL_TEST/);
  assert.doesNotMatch(prompt.input, /Jugador Secreto/);
  assert.match(prompt.input, /Detalle excluido del análisis prepartido/);
  assert.match(prompt.input, /teamSeasonStatistics/);
});

test("un módulo fallido no impide normalizar los demás", () => {
  const dataset = datasetFixture();
  dataset.confirmed.standings = { formato: "inesperado" };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.standings.status, DATA_STATUS.FAILED);
  assert.equal(normalized.statsForm.status, DATA_STATUS.AVAILABLE);
  assert.equal(normalized.standings.message, "El módulo no pudo procesarse.");
});

test("Oddspedia solo complementa cuotas faltantes y obliga revisión", () => {
  const dataset = datasetFixture();
  dataset.marketAnalysis = [];
  dataset.externalSources = {
    oddspedia: {
      source: "oddspedia", status: "partial", updatedAt: "2026-06-21T12:30:00Z",
      notes: ["Referencia externa"],
      data: { markets: [{ market: "Ganador", selection: "Equipo Local", decimalOdds: 1.8, bookmaker: "Casa", sourceUrl: "https://oddspedia.com/evento", requiresReview: true }] }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.odds.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.odds.source, "oddspedia");
  assert.equal(normalized.odds.markets[0].requiresReview, true);
  assert.equal(normalized.odds.markets[0].expectedValuePct, null);
  assert.equal(normalized.sources.oddspedia.status, "partial");
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "odds").activeSources, ["Oddspedia"]);
});

test("FotMob complementa módulos críticos como parciales sin confirmar alineaciones", () => {
  const dataset = datasetFixture();
  dataset.confirmed.injuries = [];
  dataset.confirmed.lineups = [];
  dataset.externalSources = {
    fotmob: {
      source: "fotmob", status: "partial", updatedAt: "2026-06-21T13:00:00Z", notes: ["Referencia externa"],
      data: {
        eventUrl: "https://www.fotmob.com/matches/a-vs-b/123",
        injuriesSuspensions: {
          home: { injuries: [{ name: "Jugador A", type: "injury", reason: "Lesión", requiresReview: true }], suspensions: [], doubts: [] },
          away: { injuries: [], suspensions: [], doubts: [] }
        },
        lineups: {
          reportedConfirmed: false, homeStartingXI: [], awayStartingXI: [],
          probableHomeXI: [{ name: "Jugador B", position: "M", requiresReview: true }], probableAwayXI: [{ name: "Jugador C", position: "D", requiresReview: true }],
          homeFormation: "4-3-3", awayFormation: "4-4-2"
        },
        xgXga: { scope: "season_average", homeXG: 1.5, homeXGA: 1.1, awayXG: 1.2, awayXGA: 1.4 }
      }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.injuriesSuspensions.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.lineups.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.lineups.confirmed, false);
  assert.equal(normalized.xgXga.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.sources.fotmob.status, "partial");
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "xgXga").activeSources, ["FotMob"]);
});

test("WhoScored actúa como respaldo parcial de bajas y alineaciones", () => {
  const dataset = datasetFixture();
  dataset.confirmed.injuries = [];
  dataset.confirmed.lineups = [];
  dataset.externalSources = {
    whoScored: {
      source: "whoScored", status: "partial", updatedAt: "2026-06-21T14:00:00Z", notes: ["Referencia externa"],
      data: {
        eventUrl: "https://www.whoscored.com/matches/123/preview",
        injuriesSuspensions: {
          home: { injuries: [], suspensions: [{ name: "Jugador A", type: "suspension", reason: "Tarjeta", requiresReview: true }], doubts: [] },
          away: { injuries: [], suspensions: [], doubts: [] }
        },
        lineups: {
          probableHomeXI: [{ name: "Jugador B", position: "M", requiresReview: true }],
          probableAwayXI: [{ name: "Jugador C", position: "D", requiresReview: true }],
          homeFormation: "4-3-3", awayFormation: "4-4-2"
        }
      }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.injuriesSuspensions.source, "whoScored");
  assert.equal(normalized.injuriesSuspensions.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.lineups.source, "whoScored");
  assert.equal(normalized.lineups.confirmed, false);
  assert.equal(normalized.sources.whoScored.status, "partial");
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "lineups").activeSources, ["WhoScored"]);
});

test("FBref complementa xG y xGA como datos parciales de temporada", () => {
  const dataset = datasetFixture();
  dataset.externalSources = {
    fbref: {
      source: "fbref", status: "partial", updatedAt: "2026-06-21T15:00:00Z", notes: ["Referencia externa"],
      data: {
        scope: "season_per_match", season: "2025-2026",
        home: { xg: 1.55, xga: 1.02, npxg: 1.31, matchesPlayed: 30, sourceUrl: "https://fbref.com/equipo-a" },
        away: { xg: 1.2, xga: 1.4, npxg: 1.05, matchesPlayed: 30, sourceUrl: "https://fbref.com/equipo-b" }
      }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.xgXga.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.xgXga.source, "fbref");
  assert.equal(normalized.xgXga.homeXG, 1.55);
  assert.equal(normalized.xgXga.awayNPXG, 1.05);
  assert.equal(normalized.sources.fbref.status, "partial");
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "xgXga").activeSources, ["FBref"]);
});

test("el clima verificable permanece parcial mientras falte el estado de cancha", () => {
  const dataset = datasetFixture();
  dataset.externalSources = {
    weather: {
      source: "weather", status: "partial", updatedAt: "2026-06-22T12:00:00Z", notes: ["Pronóstico horario"],
      data: {
        temperature: 22, rainProbability: 10, windSpeed: 14, humidity: 55,
        condition: "Parcialmente nublado", matchedLocation: "Los Angeles, CA",
        forecastTime: "2026-06-23T01:00:00Z", sourceUrl: "https://weather.com/test",
        pitchNotes: "Sin reporte reciente de estado de cancha."
      }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.weatherPitch.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.weatherPitch.source, "weather");
  assert.equal(normalized.weatherPitch.temperature, 22);
  assert.match(normalized.weatherPitch.pitchNotes, /Sin reporte/);
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "weatherPitch").activeSources, ["Clima"]);
});

test("Soccerway complementa clasificación y H2H sin volverlos confirmados", () => {
  const dataset = datasetFixture();
  dataset.confirmed.standings = [];
  dataset.confirmed.h2h = [];
  dataset.externalSources = {
    soccerway: {
      source: "soccerway", status: "partial", updatedAt: "2026-06-22T12:00:00Z", notes: ["Respaldo"],
      data: {
        competitionUrl: "https://int.soccerway.com/standings",
        standings: {
          home: { team: "Equipo Local", rank: 1, points: 30, requiresReview: true },
          away: { team: "Equipo Visitante", rank: 4, points: 22, requiresReview: true }
        },
        h2h: [{ date: "2025-01-01", homeTeam: "Equipo Local", awayTeam: "Equipo Visitante", homeGoals: 2, awayGoals: 1, requiresReview: true }]
      }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.standings.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.standings.source, "soccerway");
  assert.equal(normalized.h2h.status, DATA_STATUS.PARTIAL);
  assert.equal(normalized.h2h.homeWins, 1);
  assert.equal(normalized.sources.soccerway.status, "partial");
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "h2h").activeSources, ["Soccerway"]);
});

function completeFixtureStatistics(teamId, name, totalShots, shotsOnGoal) {
  return {
    team: { id: teamId, name },
    statistics: [
      { type: "Total Shots", value: totalShots }, { type: "Shots on Goal", value: shotsOnGoal },
      { type: "Shots insidebox", value: 7 }, { type: "Shots outsidebox", value: 4 },
      { type: "Corner Kicks", value: 5 }, { type: "Blocked Shots", value: 3 }
    ]
  };
}

test("integra xG estimado del mismo fixture únicamente cuando el partido inició", () => {
  const dataset = datasetFixture();
  dataset.fixture.status = "live";
  dataset.confirmed.statistics = [
    completeFixtureStatistics(10, "Equipo Local", 11, 5),
    completeFixtureStatistics(20, "Equipo Visitante", 9, 3)
  ];
  dataset.estimatedXg = buildEstimatedXgFromDataset(dataset);
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.xgXga.type, "fixture_estimated");
  assert.equal(normalized.xgXga.scope, "current_fixture");
  assert.equal(normalized.xgXga.source, "api-football-internal-model");
  assert.equal(normalized.xgXga.analysisUse, "live_match_context_only");
  assert.equal(normalized.xgXga.modelVersion, "fixture-estimated-xg-v1");
  assert.match(normalized.xgXga.message, /fixture actual/i);
  assert.match(normalized.xgXga.warning, /No corresponde a xG oficial/);
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "xgXga").activeSources, ["API-Football + modelo interno"]);
});

test("no usa estadísticas del fixture como xG prepartido", () => {
  const dataset = datasetFixture();
  dataset.fixture.status = "scheduled";
  dataset.confirmed.statistics = [
    completeFixtureStatistics(10, "Equipo Local", 11, 5),
    completeFixtureStatistics(20, "Equipo Visitante", 9, 3)
  ];
  dataset.estimatedXg = buildEstimatedXgFromDataset(dataset);
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.xgXga.status, DATA_STATUS.NOT_AVAILABLE);
  assert.equal(normalized.xgXga.type, "not_available");
});

test("integra xG/xGA histórico estimado para un partido programado", () => {
  const dataset = datasetFixture();
  dataset.fixture.status = "scheduled";
  dataset.historicalEstimatedXg = {
    status: "available",
    type: "historical_estimated",
    source: "api-football-internal-model",
    modelVersion: "historical-estimated-xg-v1",
    scope: "previous_matches",
    updatedAt: dataset.fetchedAt,
    warning: "xG/xGA histórico estimado con partidos anteriores. No corresponde a xG oficial ni al xG del partido actual.",
    confidence: { score: 90, label: "high", notes: [] },
    homeTeam: {
      historicalEstimatedXGAvg: 1.45, historicalEstimatedXGAAvg: 1.1, sampleSize: 5,
      fixturesUsed: [{ fixtureId: "1", opponent: "Rival A", estimatedXG: 1.4, estimatedXGA: 1 }],
      missingFields: [], confidence: { score: 90, label: "high", notes: [] }
    },
    awayTeam: {
      historicalEstimatedXGAvg: 1.2, historicalEstimatedXGAAvg: 1.35, sampleSize: 5,
      fixturesUsed: [{ fixtureId: "2", opponent: "Rival B", estimatedXG: 1.2, estimatedXGA: 1.3 }],
      missingFields: [], confidence: { score: 90, label: "high", notes: [] }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.xgXga.type, "historical_estimated");
  assert.equal(normalized.xgXga.scope, "previous_matches");
  assert.equal(normalized.xgXga.homeXG, 1.45);
  assert.equal(normalized.xgXga.sampleSize, 5);
  assert.equal(normalized.xgXga.analysisUse, "pre_match_context");
  assert.match(normalized.xgXga.message, /no requiere H2H/i);
  assert.deepEqual(normalized.sourceCoverage.find((item) => item.module === "xgXga").activeSources, ["API-Football + modelo interno"]);
});

test("xG especializado conserva prioridad sobre el modelo interno", () => {
  const dataset = datasetFixture();
  dataset.fixture.status = "live";
  dataset.confirmed.statistics = [
    completeFixtureStatistics(10, "Equipo Local", 11, 5),
    completeFixtureStatistics(20, "Equipo Visitante", 9, 3)
  ];
  dataset.estimatedXg = buildEstimatedXgFromDataset(dataset);
  dataset.externalSources = {
    fbref: {
      source: "fbref", status: "partial", updatedAt: dataset.fetchedAt, notes: [],
      data: { scope: "season_per_match", home: { xg: 1.4, xga: 1.1 }, away: { xg: 1.2, xga: 1.3 } }
    }
  };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.xgXga.type, "official");
  assert.equal(normalized.xgXga.source, "fbref");
  assert.equal(normalized.xgXga.homeXG, 1.4);
});

test("el prompt explica el tratamiento obligatorio del xG estimado", () => {
  const dataset = datasetFixture();
  dataset.fixture.status = "live";
  dataset.confirmed.statistics = [
    completeFixtureStatistics(10, "Equipo Local", 11, 5),
    completeFixtureStatistics(20, "Equipo Visitante", 9, 3)
  ];
  dataset.estimatedXg = buildEstimatedXgFromDataset(dataset);
  const prompt = buildOpenAIPromptFromMatchData(normalizeMatchResearchData(dataset));
  assert.match(prompt.instructions, /llámalo siempre "xG\/xGA estimado del partido"/);
  assert.match(prompt.instructions, /live_match_context_only/);
  assert.match(prompt.input, /fixture-estimated-xg-v1/);
});

test("las guardas corrigen cualquier mención de xG oficial cuando es estimado", () => {
  const researchData = normalizeMatchResearchData(datasetFixture());
  researchData.xgXga = { type: "fixture_estimated", confidenceLabel: "medium", analysisUse: "live_match_context_only" };
  const guarded = applyResearchGuardrails({
    estado_analisis: "Necesita revisión", datos_faltantes: [],
    resumen_partido: "El xG oficial favorece al equipo.", mercados_sugeridos: [],
    apto_para_parlay: { respuesta: "No", razonamiento: "El dato oficial de xG es limitado." }
  }, { researchData, dataQuality: { canSuggest: false }, preMatch: {}, marketAnalysis: [] });
  assert.match(guarded.resumen_partido, /xG estimado/);
  assert.doesNotMatch(JSON.stringify(guarded), /xG oficial/i);
  assert.doesNotMatch(JSON.stringify(guarded), /dato oficial de xG/i);
});

test("las guardas identifican el histórico estimado y su confianza baja", () => {
  const researchData = normalizeMatchResearchData(datasetFixture());
  researchData.xgXga = {
    status: "partial", type: "historical_estimated", source: "api-football-internal-model",
    scope: "previous_matches", confidenceLabel: "low", sampleSize: 2,
    warning: "Modo Mundial: muestra estadística limitada.", analysisUse: "pre_match_context"
  };
  const guarded = applyResearchGuardrails({
    estado_analisis: "Necesita revisión", datos_faltantes: [],
    resumen_partido: "El xG del partido actual favorece al equipo.",
    analisis_cuantitativo: { xg_xga: "El xG oficial confirma una ventaja fuerte." },
    mercados_sugeridos: [], apto_para_parlay: { respuesta: "No", razonamiento: "" }
  }, { researchData, dataQuality: { canSuggest: false }, preMatch: {}, marketAnalysis: [] });
  assert.match(guarded.resumen_partido, /xG histórico estimado/);
  assert.match(guarded.analisis_cuantitativo.xg_xga, /no requiere H2H/i);
  assert.match(guarded.analisis_cuantitativo.xg_xga, /referencia secundaria/i);
  assert.match(guarded.analisis_cuantitativo.xg_xga, /Modo Mundial/i);
  assert.doesNotMatch(JSON.stringify(guarded), /xG oficial confirma/i);
});

test("las guardas describen fixture estimado con confianza media y fuente interna", () => {
  const researchData = normalizeMatchResearchData(datasetFixture());
  researchData.xgXga = {
    status: "partial", type: "fixture_estimated", source: "api-football-internal-model",
    scope: "current_fixture", confidenceLabel: "medium", analysisUse: "live_match_context_only"
  };
  const guarded = applyResearchGuardrails({
    estado_analisis: "Necesita revisión", datos_faltantes: [],
    analisis_cuantitativo: { xg_xga: "" }, mercados_sugeridos: [],
    apto_para_parlay: { respuesta: "No", razonamiento: "" }
  }, { researchData, dataQuality: { canSuggest: false }, preMatch: {}, marketAnalysis: [] });
  assert.match(guarded.analisis_cuantitativo.xg_xga, /estimado del partido/i);
  assert.match(guarded.analisis_cuantitativo.xg_xga, /API-Football/);
  assert.match(guarded.analisis_cuantitativo.xg_xga, /confianza es media/i);
});

test("las guardas no permiten inferir xG cuando el módulo no está disponible", () => {
  const researchData = normalizeMatchResearchData(datasetFixture());
  researchData.xgXga = {
    status: "not_available", type: "not_available", source: "",
    confidenceLabel: "not_available", analysisUse: "pre_match_context"
  };
  const guarded = applyResearchGuardrails({
    estado_analisis: "Necesita revisión", datos_faltantes: [],
    analisis_cuantitativo: { xg_xga: "Por los goles, el xG debe ser 2.5." },
    mercados_sugeridos: [], apto_para_parlay: { respuesta: "No", razonamiento: "" }
  }, { researchData, dataQuality: { canSuggest: false }, preMatch: {}, marketAnalysis: [] });
  assert.match(guarded.analisis_cuantitativo.xg_xga, /No hay información suficiente/i);
});

test("las guardas conservan la atribución cuando el xG sí es oficial", () => {
  const researchData = normalizeMatchResearchData(datasetFixture());
  researchData.xgXga = {
    status: "available", type: "official", source: "fbref",
    confidenceLabel: "", analysisUse: "pre_match_context"
  };
  const guarded = applyResearchGuardrails({
    estado_analisis: "Completo", datos_faltantes: [],
    analisis_cuantitativo: { xg_xga: "Dato publicado por la fuente." },
    mercados_sugeridos: [], apto_para_parlay: { respuesta: "No", razonamiento: "" }
  }, { researchData, dataQuality: { canSuggest: false }, preMatch: {}, marketAnalysis: [] });
  assert.match(guarded.analisis_cuantitativo.xg_xga, /oficial atribuido a fbref/i);
});

test("OpenAI no puede convertir un research parcial en análisis completo", () => {
  const researchData = normalizeMatchResearchData(datasetFixture());
  researchData.analysisStatus = ANALYSIS_STATUS.PARTIAL;
  researchData.missingData = [{ label: "xG / xGA", status: DATA_STATUS.NOT_AVAILABLE, message: "No disponible" }];
  const dataset = {
    researchData,
    dataQuality: { canSuggest: true }, preMatch: {},
    marketAnalysis: [{ marketKey: "btts", selectionKey: "btts_yes", market: "Ambos anotan", selection: "Sí", decimalOdds: 1.9, estimatedProbabilityPct: 55, expectedValuePct: 4.5, positiveValue: true, requiresReview: false }]
  };
  const parsed = {
    estado_analisis: "Completo", datos_faltantes: [], resumen_partido: "El local tiene ventaja sobre el visitante.",
    mercados_sugeridos: [{ codigo_mercado: "btts", codigo_seleccion: "btts_yes", mercado: "Otro", seleccion: "Otra", cuota_decimal: 9, probabilidad_modelo: 99, valor_esperado: 999, requiere_revision: false }],
    apto_para_parlay: { respuesta: "Sí", razonamiento: "Prueba" }
  };
  const guarded = applyResearchGuardrails(parsed, dataset);
  assert.equal(guarded.estado_analisis, "Necesita revisión");
  assert.equal(guarded.mercados_sugeridos[0].cuota_decimal, 1.9);
  assert.equal(guarded.mercados_sugeridos[0].requiere_revision, true);
  assert.equal(guarded.apto_para_parlay.respuesta, "No");
  assert.equal(guarded.resumen_partido, "El Equipo Local tiene ventaja sobre el Equipo Visitante.");
  assert.match(guarded.datos_faltantes[0], /xG/);
});

test("research needs_review elimina mercados aunque el modelo los sugiera", () => {
  const researchData = normalizeMatchResearchData(datasetFixture());
  researchData.analysisStatus = ANALYSIS_STATUS.NEEDS_REVIEW;
  const guarded = applyResearchGuardrails({ estado_analisis: "Completo", datos_faltantes: [], mercados_sugeridos: [{ codigo_mercado: "btts", codigo_seleccion: "btts_yes" }], apto_para_parlay: { respuesta: "Sí", razonamiento: "" } }, {
    researchData, dataQuality: { canSuggest: true }, preMatch: {}, marketAnalysis: []
  });
  assert.equal(guarded.mercados_sugeridos.length, 0);
  assert.equal(guarded.apto_para_parlay.respuesta, "No");
});
