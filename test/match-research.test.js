import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_STATUS, DATA_STATUS, MODULE_WEIGHTS } from "../server/constants/match-research.js";
import { calculateMatchConfidenceScore, detectMissingCriticalData, scoreModule } from "../server/services/match-confidence.service.js";
import { buildOpenAIPromptFromMatchData, normalizeMatchResearchData } from "../server/services/match-research.service.js";

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
      date: "2026-06-22", time: "18:00", stadium: "Estadio de prueba", city: "Ciudad de prueba"
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
      lineups: [lineup(10, "Equipo Local"), lineup(20, "Equipo Visitante")]
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
});

test("un módulo fallido no impide normalizar los demás", () => {
  const dataset = datasetFixture();
  dataset.confirmed.standings = { formato: "inesperado" };
  const normalized = normalizeMatchResearchData(dataset);
  assert.equal(normalized.standings.status, DATA_STATUS.FAILED);
  assert.equal(normalized.statsForm.status, DATA_STATUS.AVAILABLE);
  assert.equal(normalized.standings.message, "El módulo no pudo procesarse.");
});
