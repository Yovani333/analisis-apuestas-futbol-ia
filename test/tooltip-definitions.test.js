import test from "node:test";
import assert from "node:assert/strict";
import { infoTooltip, labelWithTooltip } from "../public/info-tooltip.js";
import { TOOLTIP_DEFINITIONS } from "../public/tooltip-definitions.js";

const required = ["xg", "xga", "ev", "implied_probability", "model_probability", "poisson", "asian_handicap", "over_under", "btts", "double_chance", "corners", "confidence", "risk", "odds", "picks", "parlays", "pick_origin"];

test("centraliza todas las definiciones técnicas requeridas", () => {
  required.forEach((key) => {
    assert.ok(TOOLTIP_DEFINITIONS[key]);
    assert.ok(TOOLTIP_DEFINITIONS[key].meaning);
    assert.ok(TOOLTIP_DEFINITIONS[key].warning);
  });
});

test("genera un disparador accesible y reutilizable", () => {
  assert.match(infoTooltip("ev"), /data-tooltip-key="ev"/);
  assert.match(infoTooltip("ev"), /aria-expanded="false"/);
  assert.match(labelWithTooltip("EV"), /term-with-help/);
});
