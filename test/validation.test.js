import test from "node:test";
import assert from "node:assert/strict";
import { parseFixtureId, parseFixtureQuery } from "../server/middleware/validate.js";

test("acepta únicamente las cinco ligas configuradas", () => {
  const result = parseFixtureQuery({ leagues: "la-liga,bundesliga", dateFrom: "2026-06-01", dateTo: "2026-06-30", status: "all", season: "auto" });
  assert.deepEqual(result.leagues, ["la-liga", "bundesliga"]);
});

test("rechaza una liga fuera de la lista", () => {
  assert.throws(() => parseFixtureQuery({ leagues: "premier-league", dateFrom: "2026-06-01", dateTo: "2026-06-30" }), /liga no permitida/i);
});

test("rechaza rangos mayores de 62 días", () => {
  assert.throws(() => parseFixtureQuery({ leagues: "la-liga", dateFrom: "2026-01-01", dateTo: "2026-06-30" }), /62 días/i);
});

test("valida identificadores de fixture", () => {
  assert.equal(parseFixtureId("123"), 123);
  assert.throws(() => parseFixtureId("abc"), /Fixture inválido/i);
});
