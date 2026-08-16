import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { bestBetCandidateToLeg, buildBestBetsHistoryRecords, filterBestBetCandidates } from "../public/best-bets.js";

test("compacta historial concluido sin incluir pendientes ni duplicados", () => {
  const pick = { fixtureId: 7, leagueId: 253, marketCode: "btts", market: "Ambos anotan", sourceModule: "xg_btts", result: "won" };
  const rows = buildBestBetsHistoryRecords([pick, { ...pick }, { ...pick, result: "pending" }], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, "WON");
  assert.equal(rows[0].originModule, "xg_btts");
});

test("incluye legs concluidos de parlays sin datos personales", () => {
  const rows = buildBestBetsHistoryRecords([], [{ name: "Privado", stake: 99, legs: [{ fixtureId: 8, leagueId: 71, market: "Total", marketCode: "over_under_2_5", result: "lost" }] }]);
  assert.deepEqual(rows, [{ fixtureId: 8, leagueId: 71, market: "Total", marketKey: "over_under_2_5", selectionKey: null, originModule: null, modelVersion: null, result: "LOST" }]);
  assert.equal("stake" in rows[0], false);
});

test("excluye del selector los parlays marcados como prueba", () => {
  const rows = buildBestBetsHistoryRecords([], [{
    id: "test-parlay", isTest: true,
    legs: [{ fixtureId: 9, market: "Total", selection: "Más de 1.5", result: "won" }]
  }]);
  assert.deepEqual(rows, []);
});

test("filtra candidatos por clasificación, liga y mercado", () => {
  const report = { candidates: [
    { id: "a", classification: "APTO", leagueName: "MLS", marketKey: "btts" },
    { id: "b", classification: "DESCARTADO", leagueName: "MLS", marketKey: "match_winner" }
  ] };
  assert.deepEqual(filterBestBetCandidates(report, { classification: "APTO", league: "MLS", market: "btts" }).map((row) => row.id), ["a"]);
});

test("convierte un candidato al contrato existente del cupón", () => {
  const leg = bestBetCandidateToLeg({
    id: "candidate", fixtureId: "12", leagueId: 1, leagueName: "Liga", country: "MX", homeTeam: "A", awayTeam: "B",
    kickoffTime: "2026-08-06T18:00:00Z", market: "Resultado", marketKey: "match_winner", selection: "A gana", selectionKey: "home_win",
    odds: 2.1, modelProbabilityPct: 55, normalizedImpliedProbabilityPct: 48, expectedValuePct: 15.5, classification: "APTO", selectorScore: 80, riskScore: 30
  });
  assert.equal(leg.sourceModule, "best_bets_selector");
  assert.equal(leg.decimalOdds, 2.1);
  assert.equal(leg.fixtureId, "12");
  assert.equal(leg.result, undefined);
});

test("el Dashboard expone ejecución manual y no la dispara al inicializar", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /id="best-bets-panel"/);
  assert.match(html, /id="generate-best-bets"/);
  assert.match(app, /generateBestBets\.addEventListener\("click"/);
  const initializeBody = app.slice(app.indexOf("async function initializeApp()"));
  assert.doesNotMatch(initializeBody, /generateBestBetsReport\(\)/);
});
