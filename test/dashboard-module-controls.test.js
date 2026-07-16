import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const services = readFileSync(new URL("../public/services.js", import.meta.url), "utf8");

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
  assert.doesNotMatch(selectFixtureBody, /loadSpecificMarkets\(/);
  assert.doesNotMatch(selectFixtureBody, /loadDataPicks\(/);
  assert.doesNotMatch(selectFixtureBody, /loadPoisson\(/);
  assert.doesNotMatch(selectFixtureBody, /loadTeamGoals\(/);
  assert.doesNotMatch(selectFixtureBody, /loadOutcomeScenarios\(/);
  assert.match(app, /!state\.teamPerformanceByFixture\.has\(fixture\.id\)[\s\S]+?loadTeamPerformance\(fixture, false, true\)/);
  assert.match(app, /!state\.playerGoalByFixture\.has\(fixture\.id\)[\s\S]+?loadPlayerGoalCandidates\(fixture, false, true\)/);
});

test("mostrar mercados especificos no se interpreta como actualizacion forzada", () => {
  assert.match(app, /showSpecificMarkets\.addEventListener\("click", \(\) => loadSpecificMarkets\(false\)\)/);
  assert.doesNotMatch(app, /showSpecificMarkets\.addEventListener\("click", loadSpecificMarkets\)/);
});

test("Catálogo, Guía y En vivo no tienen intervalos ni refrescos automaticos ocultos", () => {
  assert.doesNotMatch(app, /setInterval\(/);
  const renderFixtureBody = app.match(/function renderFixtureData[\s\S]+?function renderGuideCoverageSummary/)[0];
  assert.doesNotMatch(renderFixtureBody, /loadSpecificMarkets\(/);
  assert.doesNotMatch(renderFixtureBody, /loadDataPicks\(/);
  assert.doesNotMatch(renderFixtureBody, /loadPoisson\(/);
  assert.doesNotMatch(renderFixtureBody, /refreshLiveDataNow\(/);
  assert.match(app, /refreshLiveNow\.addEventListener\("click", refreshLiveDataNow\)/);
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

test("Transparencia muestra cuotas normalizadas si la respuesta cruda viene vacia", () => {
  assert.match(app, /function renderNormalizedOddsDetail\(module\)/);
  assert.match(app, /function renderOddsDetail\(data, normalizedModule = null\)/);
  assert.match(app, /renderNormalizedOddsDetail\(normalizedModule\) \|\| emptyDetail/);
  assert.match(app, /renderOddsDetail\(fixture\.confirmedData\?\.odds \|\| \[\], fixture\.researchData\?\.odds\)/);
  assert.match(app, /renderOddsDetail\(data, fixture\.researchData\?\.odds\)/);
});

test("frontend conserva datos cargados cuando una respuesta nueva llega parcial", () => {
  assert.match(services, /function mergeFixtureData/);
  assert.match(services, /mergeNonEmpty\(previousFixture\.confirmedData, nextFixture\.confirmedData\)/);
  assert.match(services, /respuesta_parcial_no_reemplaza_datos_confirmados/);
  assert.match(services, /return mergeFixtureData\(fixture,/);
});

test("Dashboard hidrata fixtures y modulos desde evidencia prepartido guardada", () => {
  assert.match(app, /function hydrateFixtureFromEvidence/);
  assert.match(app, /function hydrateModulesFromEvidence/);
  assert.match(app, /Evidencia prepartido disponible: se conserva snapshot/);
  assert.match(app, /hydrateFixtureFromEvidence\(await footballDataService\.getFixtureData\(selectedFixture\(\)\)\)/);
  assert.match(app, /state\.dataPicksByFixture\.set\(fixture\.id, modules\.dataPicks\)/);
});

test("la busqueda muestra solo encuentros validos sin exponer errores de ligas vacias", () => {
  const searchBody = app.match(/async function searchFixtures\(event\)[\s\S]+?function handleFilterChange/)[0];
  assert.match(searchBody, /encuentros válidos/);
  assert.doesNotMatch(searchBody, /Datos no disponibles en la API/);
  assert.match(searchBody, /elements\.filterError\.hidden = true/);
});
