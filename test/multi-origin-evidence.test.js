import test from "node:test";
import assert from "node:assert/strict";
import { buildMultiOriginEvidence } from "../server/services/audit/multi-origin-evidence.service.js";
import { runSavedEvidenceBacktest } from "../server/services/audit/backtest-engine.service.js";

const NOW = new Date("2026-09-06T17:00:00.000Z");

function modules() {
  return {
    dataPicks: {
      modelVersion: "data-v3",
      picks: [{ market: "Total de goles", selection: "Más de 1.5 goles", selectionKey: "over_1_5", modelProbabilityPct: 70, sourceModule: "data_picks" }]
    },
    corners: {
      modelVersion: "corners-v3",
      picks: [{ market: "Total de corners", selection: "Más de 8.5 corners", selectionKey: "over_8_5_corners", modelProbabilityPct: 66 }]
    },
    outcomeScenarios: {
      modelVersion: "outcome-v1",
      scenarios: [{ key: "home", label: "Local gana", decision: "apuesta_recomendada", probabilityPct: 61, footballConfidenceScore: 72 }]
    },
    yellowCards: {
      modelVersion: "cards-v2", confidenceScore: 72, warnings: [],
      projection: { expectedTotal: 4.2, suggestedRange: "3-6" }
    },
    goalHalf: {
      modelVersion: "half-v2", confidenceScore: 75, warnings: [],
      projection: { selectedHalf: "Segunda mitad", firstHalfSupport: 48, secondHalfSupport: 76 }
    }
  };
}

function dataset() {
  return {
    fixture: { id: "900", status: "scheduled", utcDateTime: "2026-09-06T18:00:00.000Z", home: "Local", away: "Visitante", leagueName: "Liga" },
    dataQuality: { score: 80 },
    researchData: {}
  };
}

function formRows(prefix, values, venue) {
  return values.map(([goalsFor, goalsAgainst], index) => ({
    fixtureId: `${prefix}-${index}`,
    date: `2026-08-${String(30 - index).padStart(2, "0")}T18:00:00Z`,
    statusShort: "FT",
    venue: typeof venue === "function" ? venue(index) : venue,
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D"
  }));
}

function xgRows(prefix, values, venue, xga) {
  return values.map((estimatedXG, index) => ({
    fixtureId: `${prefix}-${index}`,
    date: `2026-08-${String(30 - index).padStart(2, "0")}T18:00:00Z`,
    venue,
    estimatedXG,
    estimatedXGA: xga
  }));
}

test("consolida recomendaciones por origen con una identidad auditable única", () => {
  const result = buildMultiOriginEvidence(dataset(), modules(), NOW);
  assert.deepEqual(result.origins.sort(), ["corners", "data_picks", "goal_half_projection", "outcome_1x2", "yellow_cards"]);
  assert.equal(result.picks.length, 4);
  assert.equal(new Set(result.picks.map((pick) => pick.auditPickKey)).size, result.picks.length);
  assert.ok(result.picks.every((pick) => pick.generatedAt === NOW.toISOString()));
});

test("captura las recomendaciones determinísticas de H2H, Forma y xG/xGA", () => {
  const input = dataset();
  input.researchData = {
    matchId: "900",
    dateTime: "2026-09-06T18:00:00.000Z",
    homeTeam: { id: 1, name: "Local" },
    awayTeam: { id: 2, name: "Visitante" },
    h2h: {
      source: "API-Football",
      matches: [1, 2, 3, 4].map((id) => ({
        fixtureId: `h-${id}`, date: `2026-08-${30 - id}T18:00:00Z`, statusShort: "FT",
        homeTeamId: 1, awayTeamId: 2, homeTeam: "Local", awayTeam: "Visitante",
        homeGoals: id % 2 ? 2 : 4, awayGoals: 0, regulationHomeGoals: id % 2 ? 2 : 4, regulationAwayGoals: 0
      }))
    },
    statsForm: {
      homeLastMatches: formRows("fh", [[3, 0], [2, 0], [3, 1], [2, 0], [1, 0]], (index) => index % 2 ? "Visitante" : "Local"),
      awayLastMatches: formRows("fa", [[0, 2], [0, 1], [1, 3], [0, 2], [0, 1]], (index) => index % 2 ? "Local" : "Visitante")
    },
    xgXga: {
      type: "historical_estimated", confidenceScore: 90,
      fixturesUsed: {
        home: xgRows("xh", [1.65, 1.55, 1.6, 1.5, 1.55, 1.6], "home", 1.55),
        away: xgRows("xa", [1.6, 1.5, 1.55, 1.45, 1.5, 1.55], "away", 1.6)
      }
    }
  };
  const result = buildMultiOriginEvidence(input, {}, NOW);
  assert.ok(result.picks.some((pick) => pick.sourceModule === "h2h"), JSON.stringify(result.analysisSummary.h2h));
  assert.ok(result.picks.some((pick) => pick.sourceModule === "recent_form"), JSON.stringify(result.analysisSummary.recentForm));
  assert.ok(result.picks.some((pick) => pick.sourceModule === "xg_btts"), JSON.stringify(result.analysisSummary.xgBtts));
});

test("conserva selecciones iguales cuando proceden de orígenes diferentes", () => {
  const input = modules();
  input.corners.picks = [{ ...input.dataPicks.picks[0], sourceModule: "corners" }];
  const result = buildMultiOriginEvidence(dataset(), input, NOW);
  const supplemental = result.picks.find((pick) => pick.selectionKey === "over_1_5");
  assert.equal(supplemental.auditPickKey, "corners:over_1_5");
});

test("el backtesting usa la colección multi-origen una sola vez y conserva snapshots antiguos", () => {
  const multi = buildMultiOriginEvidence(dataset(), modules(), NOW);
  const base = {
    capturedAt: NOW.toISOString(), currentFixtureStatisticsUsed: false, openAiUsed: false,
    fixture: dataset().fixture, dataQuality: { level: "Alta" }, researchData: {}
  };
  const result = runSavedEvidenceBacktest({ ...base, modules: { dataPicks: modules().dataPicks, auditRecommendations: multi } }, {
    finished: true,
    regulationGoals: { home: 2, away: 1 },
    halftimeScore: { home: 0, away: 0 },
    corners: { home: 5, away: 5 },
    cards: { home: 2, away: 2 }
  });
  assert.equal(result.records.length, multi.picks.length + modules().dataPicks.picks.length);
  assert.equal(result.records.find((row) => row.sourceModule === "goal_half_projection").outcome, "HIT");
  assert.equal(result.records.find((row) => row.sourceModule === "yellow_cards").outcome, "HIT");

  const legacy = runSavedEvidenceBacktest({ ...base, modules: { dataPicks: modules().dataPicks } }, { finished: true, regulationGoals: { home: 1, away: 1 } });
  assert.equal(legacy.records.length, 1);
});
