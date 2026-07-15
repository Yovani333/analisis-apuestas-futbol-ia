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

test("seleccionar un encuentro difiere los modulos historicos pesados hasta mostrarlos", () => {
  const selectFixtureBody = app.match(/async function selectFixture[\s\S]+?async function analyzeSelectedFixture/)[0];
  assert.doesNotMatch(selectFixtureBody, /loadTeamPerformance\(detailedFixture/);
  assert.doesNotMatch(selectFixtureBody, /loadPlayerGoalCandidates\(detailedFixture/);
  assert.match(app, /!state\.teamPerformanceByFixture\.has\(fixture\.id\)[\s\S]+?loadTeamPerformance\(fixture, false, true\)/);
  assert.match(app, /!state\.playerGoalByFixture\.has\(fixture\.id\)[\s\S]+?loadPlayerGoalCandidates\(fixture, false, true\)/);
});

test("mostrar mercados especificos no se interpreta como actualizacion forzada", () => {
  assert.match(app, /showSpecificMarkets\.addEventListener\("click", \(\) => loadSpecificMarkets\(false\)\)/);
  assert.doesNotMatch(app, /showSpecificMarkets\.addEventListener\("click", loadSpecificMarkets\)/);
});

test("Selector 1X2 ofrece un boton para agregar cada escenario al cupon", () => {
  assert.match(app, /data-add-outcome=/);
  assert.match(app, /outcomeScenarioLeg/);
  assert.match(app, /Pick 1X2 agregado a Mi parlay/);
});

test("Corners esperados se puede guardar o agregar al cupon", () => {
  assert.match(app, /data-save-expected-corners/);
  assert.match(app, /data-add-expected-corners/);
  assert.match(app, /function expectedCornersLeg/);
  assert.match(app, /Pick de corners esperados agregado a Mi parlay/);
});

test("el cupon agregado se abre minimizado y solo el FAB lo maximiza", () => {
  assert.match(app, /function renderParlayDraft\(open = false, minimized = true\)/);
  assert.match(app, /parlayFab\.addEventListener\("click", \(\) => renderParlayDraft\(true, false\)\)/);
});

test("Dashboard prioriza la calidad canonica y no convierte datos ausentes en cero", () => {
  const qualityBody = app.match(/function fixtureQualityView[\s\S]+?function renderMatches/)[0];
  assert.match(qualityBody, /const score = baseScore \?\? researchScore/);
  assert.match(qualityBody, /value === null \|\| value === undefined \|\| value === ""/);
});

test("la busqueda muestra solo encuentros validos sin exponer errores de ligas vacias", () => {
  const searchBody = app.match(/async function searchFixtures\(event\)[\s\S]+?function handleFilterChange/)[0];
  assert.match(searchBody, /encuentros válidos/);
  assert.doesNotMatch(searchBody, /Datos no disponibles en la API/);
  assert.match(searchBody, /elements\.filterError\.hidden = true/);
});
