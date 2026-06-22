import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_STATUS, DATA_STATUS, MODULE_WEIGHTS } from "../server/constants/match-research.js";
import { calculateMatchConfidenceScore, detectMissingCriticalData, scoreModule } from "../server/services/match-confidence.service.js";
import { buildOpenAIPromptFromMatchData, normalizeMatchResearchData } from "../server/services/match-research.service.js";
import { applyResearchGuardrails } from "../server/services/openai.service.js";

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
  assert.equal(normalized.sourceCoverage.length, 10);
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
