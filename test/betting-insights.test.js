import test from "node:test";
import assert from "node:assert/strict";
import { buildStatisticalAssistantReport, calculateOutcome1x2Performance, wilsonLowerBound } from "../public/betting-insights.js";

const pick = (id, result, probability, extra = {}) => ({ id, result, modelProbability: probability, sourceModule: "outcome_1x2", date: "2026-09-10", league: "MLS", market: "Resultado 1X2", ...extra });

test("Wilson evita que 3 de 3 sea más sólido que 35 de 40", () => {
  assert.ok(wilsonLowerBound(3, 3) < wilsonLowerBound(35, 40));
});

test("agrupa Selector 1X2 por rangos y separa individual de parlay", () => {
  const rows = calculateOutcome1x2Performance(
    [pick("a", "won", 64), pick("b", "lost", 61)],
    [{ id: "p", legs: [pick("c", "won", 67)] }],
    { month: "2026-09" }
  );
  assert.equal(rows[0].label, "60-69.9%");
  assert.deepEqual({ won: rows[0].won, lost: rows[0].lost, individual: rows[0].individual, parlay: rows[0].parlay }, { won: 2, lost: 1, individual: 2, parlay: 1 });
});

test("filtra por mes y excluye pruebas", () => {
  const rows = calculateOutcome1x2Performance([pick("a", "won", 75), pick("b", "lost", 75, { date: "2026-08-01" }), pick("c", "lost", 75, { isTest: true })], [], { month: "2026-09" });
  assert.equal(rows[0].evaluated, 1);
  assert.equal(rows[0].won, 1);
});

test("el asistente usa resultados guardados y omite muestras menores a tres", () => {
  const picks = [pick("a", "won", 60), pick("b", "won", 60), pick("c", "lost", 60), pick("d", "won", 60, { league: "Liga breve" })];
  const report = buildStatisticalAssistantReport({ picks, sections: ["competitions", "markets", "origins"], month: "2026-09" });
  assert.equal(report.evaluated, 4);
  assert.equal(report.sections[0].rows[0].label, "MLS");
  assert.equal(report.sections[0].rows[0].evaluated, 3);
  assert.equal(report.sections[0].insufficient, 1);
});

test("el análisis repetido conserva el mismo ranking", () => {
  const input = { picks: [pick("a", "won", 60), pick("b", "lost", 60), pick("c", "won", 60)], sections: ["markets"] };
  const first = buildStatisticalAssistantReport(input).sections;
  const second = buildStatisticalAssistantReport(input).sections;
  assert.deepEqual(first, second);
});
