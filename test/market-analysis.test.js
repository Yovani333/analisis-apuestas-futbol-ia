import test from "node:test";
import assert from "node:assert/strict";
import { calculateDataQuality, calculateMarketAnalysis, normalizeOdds, summarizeRecentFixtures } from "../server/services/market-analysis.service.js";

const fixtureRow = (id, date, teamId, opponentId, goalsFor, goalsAgainst, home = true) => ({
  fixture: { id, date, status: { short: "FT" } },
  teams: home ? { home: { id: teamId, name: "Equipo" }, away: { id: opponentId, name: "Rival" } } : { home: { id: opponentId, name: "Rival" }, away: { id: teamId, name: "Equipo" } },
  goals: home ? { home: goalsFor, away: goalsAgainst } : { home: goalsAgainst, away: goalsFor }
});

test("resume únicamente partidos terminados anteriores al fixture", () => {
  const rows = [fixtureRow(1, "2026-06-10T12:00:00Z", 10, 20, 2, 1), fixtureRow(2, "2026-06-22T12:00:00Z", 10, 30, 3, 0)];
  const summary = summarizeRecentFixtures(rows, 10, "2026-06-20T12:00:00Z");
  assert.equal(summary.played, 1);
  assert.equal(summary.wins, 1);
  assert.equal(summary.bttsRate, 100);
});

test("calcula probabilidad, cuota justa y valor esperado sin IA", () => {
  const form = { played: 5, matches: Array.from({ length: 5 }, () => ({ result: "W", over25: true, btts: true })) };
  const calculations = calculateMarketAnalysis(form, form, { selections: [{ marketKey: "over_under_2_5", selectionKey: "over_2_5", market: "Total", selection: "Más de 2.5", decimalOdds: 1.8 }] });
  assert.equal(calculations.length, 1);
  assert.ok(calculations[0].estimatedProbabilityPct > 80);
  assert.ok(calculations[0].expectedValuePct > 0);
});

test("bloquea sugerencias cuando la cobertura es baja", () => {
  const quality = calculateDataQuality({ homeForm: { played: 1, restDays: null }, awayForm: { played: 1, restDays: null }, odds: { selections: [] }, standings: [], injuries: [], lineups: [], h2h: [] });
  assert.equal(quality.level, "Baja");
  assert.equal(quality.canSuggest, false);
});

test("normaliza cuotas principales y calcula margen de la casa", () => {
  const odds = normalizeOdds([{ bookmakers: [{ name: "Casa", bets: [{ name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.90" }, { value: "Under 2.5", odd: "1.90" }] }] }] }]);
  const form = { played: 5, matches: Array.from({ length: 5 }, () => ({ venue: "Local", result: "W", over25: true, btts: false })) };
  const calculations = calculateMarketAnalysis(form, form, odds);
  assert.equal(odds.selections.length, 2);
  assert.ok(calculations[0].bookmakerMarginPct > 5);
  assert.equal(calculations[0].noVigImpliedProbabilityPct, 50);
});

test("usa nombres de equipos en doble oportunidad sin asumir localía", () => {
  const odds = normalizeOdds([{ bookmakers: [{ name: "Casa", bets: [{ name: "Double Chance", values: [{ value: "Home/Draw", odd: "1.40" }, { value: "Draw/Away", odd: "1.70" }] }] }] }], {
    homeName: "México", awayName: "Japón"
  });
  assert.equal(odds.selections[0].selection, "México o empate (1X)");
  assert.equal(odds.selections[1].selection, "Empate o Japón (X2)");
  assert.doesNotMatch(odds.selections.map((item) => item.selection).join(" "), /local|visitante/i);
});

test("prioriza Caliente y después Playdoit entre bookmakers autorizados", () => {
  const bet = { name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.90" }] };
  const odds = normalizeOdds([{ update: "2026-07-02T10:00:00Z", bookmakers: [
    { id: 1, name: "Casa genérica", bets: [bet] }, { id: 2, name: "Playdoit.mx", bets: [bet] }, { id: 3, name: "Casino Caliente", bets: [bet] }
  ] }]);
  assert.equal(odds.bookmaker, "Casino Caliente");
  assert.equal(odds.preferred, true);
  assert.equal(odds.selections[0].isPreferredBookmaker, true);
});

test("normaliza mercados ampliados desde distintas casas sin asignación ambigua", () => {
  const odds = normalizeOdds([{ update: "2026-07-04T15:00:00Z", bookmakers: [
    { id: 10, name: "10Bet", bets: [
      { name: "Match Winner", values: [{ value: "Home", odd: "2.10" }, { value: "Draw", odd: "3.20" }, { value: "Away", odd: "3.50" }] },
      { name: "Draw No Bet", values: [{ value: "Home", odd: "1.55" }, { value: "Away", odd: "2.25" }] },
      { name: "Goals Over/Under", values: [{ value: "Over 1.5", odd: "1.35" }, { value: "Under 3.5", odd: "1.70" }] }
    ] },
    { id: 20, name: "Playdoit.mx", bets: [
      { name: "Double Chance", values: [{ value: "Home/Away", odd: "1.25" }] },
      { name: "Home Team Total Goals", values: [{ value: "Over 0.5", odd: "1.30" }] }
    ] }
  ] }], { homeName: "Canada", awayName: "Morocco" });
  const byKey = Object.fromEntries(odds.selections.map((item) => [item.selectionKey, item]));
  assert.equal(byKey.home_win.decimalOdds, 2.1);
  assert.equal(byKey.home_dnb.decimalOdds, 1.55);
  assert.equal(byKey.away_dnb.decimalOdds, 2.25);
  assert.equal(byKey.over_1_5.decimalOdds, 1.35);
  assert.equal(byKey.under_3_5.decimalOdds, 1.7);
  assert.equal(byKey["12"].bookmaker, "Playdoit.mx");
  assert.equal(byKey.home_over_0_5.decimalOdds, 1.3);
  assert.equal(odds.bookmaker, "Múltiples casas");
});

test("conserva cuotas ampliadas sin inventar probabilidad ni EV en el análisis base", () => {
  const form = { played: 5, matches: Array.from({ length: 5 }, () => ({ venue: "Local", result: "W", over25: true, btts: true })) };
  const calculations = calculateMarketAnalysis(form, form, { selections: [{ marketKey: "match_winner", selectionKey: "home_win", market: "Resultado 1X2", selection: "Canada", decimalOdds: 2, bookmaker: "Casa" }] });
  assert.equal(calculations[0].impliedProbabilityPct, 50);
  assert.equal(calculations[0].estimatedProbabilityPct, null);
  assert.equal(calculations[0].expectedValuePct, null);
});
