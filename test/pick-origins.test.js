import test from "node:test";
import assert from "node:assert/strict";
import { pickOriginDefinition, pickOriginLabel } from "../public/pick-origins.js";

test("convierte orígenes técnicos activos en etiquetas amigables", () => {
  assert.equal(pickOriginLabel("data_picks"), "Picks basados en datos");
  assert.equal(pickOriginLabel("poisson"), "Modelo Poisson");
  assert.equal(pickOriginLabel("team_goal_probability"), "Probabilidad de gol");
});

test("conserva compatibilidad con el origen textual legado", () => {
  assert.equal(pickOriginLabel("Picks basados en datos"), "Picks basados en datos");
  assert.equal(pickOriginDefinition("Picks basados en datos").status, "legacy_alias");
});
