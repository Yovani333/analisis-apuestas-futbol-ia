import test from "node:test";
import assert from "node:assert/strict";
import { parseFixtureId, parseFixtureQuery } from "../server/middleware/validate.js";

test("acepta únicamente las competiciones configuradas", () => {
  const result = parseFixtureQuery({ leagues: "la-liga,bundesliga", dateFrom: "2026-06-01", dateTo: "2026-06-30", status: "all", season: "auto" });
  assert.deepEqual(result.leagues, ["la-liga", "bundesliga"]);
});

test("acepta la Copa Mundial 2026", () => {
  const result = parseFixtureQuery({ leagues: "world-cup", dateFrom: "2026-06-11", dateTo: "2026-06-28", status: "all", season: "2026" });
  assert.deepEqual(result.leagues, ["world-cup"]);
  assert.equal(result.season, 2026);
});

test("acepta el filtro de partidos en vivo", () => {
  const result = parseFixtureQuery({ leagues: "world-cup", dateFrom: "2026-06-28", dateTo: "2026-06-28", status: "live", season: "auto" });
  assert.equal(result.status, "live");
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

test("acepta todas las nuevas competiciones confirmadas sin el límite artificial de siete", () => {
  const slugs = ["mls", "brasileirao-serie-a", "liga-profesional-argentina", "liga-mx-femenil", "liga-expansion-mx", "eredivisie", "allsvenskan", "eliteserien", "conmebol-libertadores", "conmebol-sudamericana", "uefa-champions-qualifying", "uefa-europa-qualifying", "uefa-conference-qualifying"];
  const result = parseFixtureQuery({ leagues: slugs.join(","), dateFrom: "2026-07-01", dateTo: "2026-07-31", status: "all", season: "auto" });
  assert.deepEqual(result.leagues, slugs);
});
