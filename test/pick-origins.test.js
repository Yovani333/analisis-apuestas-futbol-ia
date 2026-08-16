import test from "node:test";
import assert from "node:assert/strict";
import { pickOriginDefinition, pickOriginKey, pickOriginLabel } from "../public/pick-origins.js";
import { calculateOriginPerformance } from "../public/parlay-store.js";

test("conserva intactos los siete nombres de origen aprobados", () => {
  assert.deepEqual({
    outcome_1x2: pickOriginLabel("outcome_1x2"),
    h2h: pickOriginLabel("h2h"),
    xg_btts: pickOriginLabel("xg_btts"),
    corners: pickOriginLabel("corners"),
    team_average_performance: pickOriginLabel("team_average_performance"),
    player_goal_candidate: pickOriginLabel("player_goal_candidate"),
    odds: pickOriginLabel("odds")
  }, {
    outcome_1x2: "Selector obligatorio 1X2",
    h2h: "Head to head",
    xg_btts: "xG / xGA",
    corners: "Corners",
    team_average_performance: "Rendimiento promedio por equipo",
    player_goal_candidate: "Jugador con posible gol",
    odds: "Cuotas"
  });
});

test("muestra el título principal vigente de los módulos de análisis", () => {
  assert.equal(pickOriginLabel("data_picks"), "Motor de Decisión");
  assert.equal(pickOriginLabel("poisson"), "Motor Poisson");
  assert.equal(pickOriginLabel("team_goal_probability"), "Ataque vs Defensa");
  assert.equal(pickOriginLabel("odds_rule_engine"), "Evaluación predictiva");
});

test("la recomendación de forma conserva el mismo título como origen", () => {
  assert.equal(pickOriginLabel("recent_form"), "Estadísticas / forma");
});

test("identifica los orígenes de tarjetas amarillas y gol por mitad", () => {
  assert.equal(pickOriginLabel("yellow_cards"), "Tarjetas amarillas");
  assert.equal(pickOriginLabel("goal_half_projection"), "Gol por mitad");
});

test("conserva compatibilidad con el origen textual legado", () => {
  assert.equal(pickOriginLabel("Picks basados en datos"), "Picks basados en datos");
  assert.equal(pickOriginDefinition("Picks basados en datos").status, "legacy_alias");
});

test("identifica Picks recomendados y recupera su módulo de respaldo", () => {
  assert.equal(pickOriginLabel({ sourceModule: "pick_analysis_snapshot" }), "Picks recomendados");
  assert.equal(pickOriginLabel({
    sourceModule: "pick_analysis_snapshot",
    originModule: "poisson"
  }), "Picks recomendados → Motor Poisson");
});

test("conserva la ruta completa de un pick del Catálogo de mercados", () => {
  const pick = {
    sourceModule: "poisson",
    originModule: "poisson",
    originMenu: "Catálogo de mercados",
    originSection: "Mercados ofensivos",
    originCategory: "Ambos equipos anotan"
  };
  assert.equal(pickOriginLabel(pick), "Catálogo de mercados → Mercados ofensivos → Ambos equipos anotan");
  assert.match(pickOriginKey(pick), /^poisson::Catálogo de mercados::Mercados ofensivos::Ambos equipos anotan/);
});

test("resultados por origen separa rutas visuales aunque compartan motor", () => {
  const rows = calculateOriginPerformance([
    { id: "direct", sourceModule: "poisson", originMenu: "Guía de análisis", originSection: "Motor Poisson", result: "won", selection: "Más de 1.5" },
    { id: "catalog", sourceModule: "poisson", originMenu: "Catálogo de mercados", originSection: "Mercados ofensivos", originCategory: "Ambos equipos anotan", result: "lost", selection: "Ambos anotan" }
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.originLabel)), new Set([
    "Guía de análisis → Motor Poisson",
    "Catálogo de mercados → Mercados ofensivos → Ambos equipos anotan"
  ]));
});
