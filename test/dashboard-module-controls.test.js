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

test("la busqueda del dia oculta encuentros finalizados o programados ya pasados", () => {
  const searchBody = app.match(/async function searchFixtures\(event\)[\s\S]+?function handleFilterChange/)[0];
  assert.match(app, /function filterPastTodayFixtures/);
  assert.match(app, /fixture\.status === "live"/);
  assert.match(app, /fixture\.status === "finished"/);
  assert.match(app, /fixtureKickoffTime\(fixture\)/);
  assert.match(searchBody, /const filteredResults = filterPastTodayFixtures\(searchResults, filters\)/);
  assert.match(searchBody, /state\.fixtures = filteredResults\.fixtures/);
});

test("Catálogo de mercados se actualiza solo mediante su botón manual", () => {
  assert.match(app, /showSpecificMarkets\.addEventListener\("click", \(\) => loadSpecificMarkets\(true\)\)/);
  assert.match(app, /showSpecificMarkets\.textContent = "Actualizar mercados"/);
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
  assert.match(app, /saveParlay\.disabled = count < 1/);
  assert.match(app, /state\.parlayDraft\.length === 1[\s\S]*createSavedPick/);
  assert.match(app, /parlayFab\.addEventListener\("click", \(\) => renderParlayDraft\(true, false\)\)/);
});

test("guardar desde el cupon permanece en la vista actual", () => {
  const saveCurrentParlay = app.slice(app.indexOf("function saveCurrentParlay()"), app.indexOf("function oddsUpdateHtml"));
  assert.match(saveCurrentParlay, /renderSavedPicks\(\)/);
  assert.match(saveCurrentParlay, /renderSavedParlays\(\)/);
  assert.doesNotMatch(saveCurrentParlay, /switchView\("saved"\)/);
  assert.match(saveCurrentParlay, /showNotice\("Pick agregado a individuales\."\)/);
  assert.match(saveCurrentParlay, /showNotice\("Parlay guardado\. Ya puedes registrar sus resultados\."\)/);
});

test("Dashboard prioriza la calidad canonica y no convierte datos ausentes en cero", () => {
  const qualityBody = app.match(/function fixtureQualityView[\s\S]+?function renderMatches/)[0];
  assert.match(qualityBody, /const score = baseScore \?\? researchScore/);
  assert.match(qualityBody, /value === null \|\| value === undefined \|\| value === ""/);
});

test("Sugerencia H2H ofrece un boton para agregar el pick al cupon", () => {
  assert.match(app, /data-add-h2h-pick/);
  assert.match(app, /data-add-xg-btts-pick/);
  assert.match(app, /addXgBttsRecommendationToParlay/);
  assert.match(app, /sourceLabel: "xG \/ xGA"/);
  assert.match(app, /function h2hRecommendationLeg/);
  assert.match(app, /Pick H2H agregado a Mi parlay/);
  assert.match(app, /sourceModule: "h2h"/);
});

test("Datos del partido resume confianza y permite agregar los tres picks contextuales", () => {
  assert.match(app, /<th>Confianza<\/th>/);
  assert.match(app, /researchRecommendationSummary\(moduleKey, evaluateResearchRecommendation/);
  assert.match(app, /pick-add-icon--table[\s\S]*data-add-h2h-pick/);
  assert.match(app, /pick-add-icon--table[\s\S]*data-add-recent-form-pick/);
  assert.match(app, /pick-add-icon--table[\s\S]*data-add-xg-btts-pick/);
  assert.match(app, /metricLabel: "cumplimiento"/);
  assert.match(app, /metricLabel: "respaldo"/);
});

test("Estadisticas/Forma muestra la division del rival en partidos recientes", () => {
  const statsFormBody = app.match(/moduleKey === "statsForm"[\s\S]+?moduleKey === "injuriesSuspensions"/)[0];
  assert.match(statsFormBody, /const matchDivision/);
  assert.match(statsFormBody, /match\?\.competition/);
  assert.match(statsFormBody, /match\?\.leagueName/);
  assert.match(statsFormBody, /\["Equipo", "Fecha", "Rival", "División", "Sede", "Marcador", "Resultado"\]/);
  assert.match(statsFormBody, /displayValue\(matchDivision\(match\)\)/);
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

test("frontend conserva estado en vivo si el detalle llega programado o parcial", () => {
  const mergeBody = services.match(/function mergeFixtureData[\s\S]+?function buildMockAnalysis/)[0];
  assert.match(services, /function isLiveFixtureState/);
  assert.match(services, /label\.includes\("en vivo"\)/);
  assert.match(services, /Number\.isFinite\(elapsed\)/);
  assert.match(mergeBody, /isLiveFixtureState\(previousFixture\)/);
  assert.match(mergeBody, /!nextIsActive && !nextIsFinal/);
  assert.match(mergeBody, /merged\.status = "live"/);
  assert.match(mergeBody, /merged\.statusLabel = previousFixture\.statusLabel \|\| "En vivo"/);
  assert.match(mergeBody, /nextIsFinal = \["finished", "postponed", "cancelled", "suspended"\]/);
});

test("Dashboard hidrata fixtures y modulos desde evidencia prepartido guardada", () => {
  assert.match(app, /function hydrateFixtureFromEvidence/);
  assert.match(app, /function hydrateModulesFromEvidence/);
  assert.match(app, /Evidencia prepartido disponible: se conserva snapshot/);
  assert.match(app, /hydrateFixtureFromEvidence\(await footballDataService\.getFixtureData\(fixtureBeforeDetail\)\)/);
  assert.match(app, /state\.dataPicksByFixture\.set\(fixture\.id, modules\.dataPicks\)/);
});

test("seleccionar partido conserva marcador y minuto en vivo aunque el detalle venga atrasado", () => {
  const selectFixtureBody = app.match(/async function selectFixture[\s\S]+?async function analyzeSelectedFixture/)[0];
  assert.match(app, /function fixtureLooksLive/);
  assert.match(app, /function preserveSelectedLiveFixtureState/);
  assert.match(app, /label\.includes\("en vivo"\)/);
  assert.match(app, /status: "live"/);
  assert.match(app, /elapsed: previousFixture\.elapsed \?\? nextFixture\.elapsed/);
  assert.match(app, /score: previousFixture\.score \|\| nextFixture\.score/);
  assert.match(selectFixtureBody, /const fixtureBeforeDetail = selectedFixture\(\)/);
  assert.match(selectFixtureBody, /preserveSelectedLiveFixtureState\(\s*fixtureBeforeDetail,/);
});

test("la busqueda muestra solo encuentros validos sin exponer errores de ligas vacias", () => {
  const searchBody = app.match(/async function searchFixtures\(event\)[\s\S]+?function handleFilterChange/)[0];
  assert.match(searchBody, /encuentros válidos/);
  assert.doesNotMatch(searchBody, /Datos no disponibles en la API/);
  assert.match(searchBody, /elements\.filterError\.hidden = true/);
});

test("la busqueda omite competiciones desactivadas por historial", () => {
  const searchBody = app.match(/async function searchFixtures\(event\)[\s\S]+?function handleFilterChange/)[0];
  assert.match(app, /function disabledCompetitionQuerySlugs/);
  assert.match(app, /league\.slug === "world-cup"/);
  assert.match(app, /row\.queryStatus === "disabled"/);
  assert.match(app, /function activeCompetitionLeaguesForSearch/);
  assert.match(searchBody, /const selectedLeagues = competitionLeagues\(\)/);
  assert.match(searchBody, /const queryLeagues = activeCompetitionLeaguesForSearch\(selectedLeagues\)/);
  assert.match(searchBody, /leagues: queryLeagues/);
  assert.match(searchBody, /competiciones desactivadas omitidas/);
});
