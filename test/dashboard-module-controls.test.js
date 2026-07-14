import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("Mostrar de Selector 1X2 y Corners solo cambia visibilidad", () => {
  assert.match(app, /showOutcome\.addEventListener\("click", \(\) => toggleReadyModule\(elements\.showOutcome, elements\.outcomeContent\)\)/);
  assert.match(app, /showCorners\.addEventListener\("click", \(\) => toggleReadyModule\(elements\.showCorners, elements\.cornersContent\)\)/);
});

test("Actualizar datos conserva controladores separados para Selector 1X2 y Corners", () => {
  assert.match(app, /refreshOutcome\.addEventListener\("click", \(\) => loadOutcomeScenarios\(true\)\)/);
  assert.match(app, /refreshCorners\.addEventListener\("click", \(\) => loadCorners\(true\)\)/);
});

test("Selector 1X2 ofrece un boton para agregar cada escenario al cupon", () => {
  assert.match(app, /data-add-outcome=/);
  assert.match(app, /outcomeScenarioLeg/);
  assert.match(app, /Pick 1X2 agregado a Mi parlay/);
});

test("el cupon agregado se abre minimizado y solo el FAB lo maximiza", () => {
  assert.match(app, /function renderParlayDraft\(open = false, minimized = true\)/);
  assert.match(app, /parlayFab\.addEventListener\("click", \(\) => renderParlayDraft\(true, false\)\)/);
});
