import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const services = readFileSync(new URL("../public/services.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("el menu lateral agrupa las vistas en un orden profesional", () => {
  assert.match(html, /id="app-sidebar"[\s\S]*id="nav-main-title">Principal<[\s\S]*id="nav-intelligence-title">Inteligencia<[\s\S]*id="nav-tracking-title">Seguimiento<[\s\S]*id="nav-account-title">Cuenta</);
  const views = ["dashboard", "simulation", "live", "transparency", "guide", "markets", "pick-collection", "saved", "favorite-teams", "audit", "account"];
  const positions = views.map((view) => html.indexOf(`data-view="${view}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(html, /data-view-panel="simulation"[\s\S]*Comparador de equipos con datos reales/);
  assert.match(html, /data-view-panel="markets"/);
  assert.match(html, /data-view-panel="pick-collection"[\s\S]*id="collect-pick-info"[\s\S]*Actualizar picks/);
  assert.match(html, /data-view-panel="favorite-teams"[\s\S]*id="favorite-teams-list"/);
  assert.match(html, /data-view-panel="audit"[\s\S]*id="evidence-readiness-list"[\s\S]*id="audit-fixture"/);
  assert.match(html, /data-view="pick-collection"[\s\S]*Picks recomendados/);
  assert.doesNotMatch(app, /<h3>Datos recopilados<\/h3>/);
  assert.doesNotMatch(html, /data-view="alerts"|data-view-panel="alerts"|>Avisos</);
  const guide = html.slice(html.indexOf('data-view-panel="guide"'), html.indexOf('data-view-panel="markets"'));
  assert.doesNotMatch(guide, /id="specific-markets-panel"/);
});

test("el menu lateral es fijo en escritorio y funciona como cajon accesible en movil", () => {
  assert.match(html, /id="sidebar-toggle"[^>]+aria-controls="app-sidebar"[^>]+aria-expanded="false"/);
  assert.match(html, /id="sidebar-backdrop"[^>]+hidden/);
  assert.match(styles, /--sidebar-width:\s*252px/);
  assert.match(styles, /@media \(min-width: 981px\)[\s\S]*body \{ padding-left: var\(--sidebar-width\); \}[\s\S]*\.app-header \{[\s\S]*position: fixed/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*transform: translateX\(-104%\)[\s\S]*\.app-header\.sidebar-open \{ transform: translateX\(0\); \}/);
  assert.match(app, /function setSidebarOpen\(open/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(html, /id="theme-toggle"[\s\S]*class="nav-label">Modo oscuro/);
  assert.match(app, /themeToggle\.querySelector\("\.nav-label"\)\.textContent/);
});

test("Mis apuestas no actualiza al entrar y conserva el control manual", () => {
  const savedSwitch = app.slice(app.indexOf('if (view === "saved")'), app.indexOf('if (view === "team-goal-insights")'));
  assert.doesNotMatch(savedSwitch, /updateSavedParlayResults/);
  assert.match(app, /function savedLegsNeedingRefresh\(\)/);
  assert.match(app, /elements\.updateParlayResults\.disabled = savedLegsNeedingRefresh\(\)\.length === 0/);
  assert.match(app, /needsFixtureStatusRefresh\(leg\) \|\| needsSettlementRefresh\(leg\)/);
  assert.match(html, /id="update-individual-results"[\s\S]*Actualizar datos/);
  assert.match(html, /id="update-parlay-results"[\s\S]*Actualizar datos/);
  assert.match(app, /class="final-score">Final/);
  assert.match(styles, /\.saved-pick \.final-score \{ color: var\(--success\); font-weight: 800; \}/);
});

test("Mi cuenta muestra conteo API solo para el administrador", () => {
  assert.match(html, /id="api-usage-admin-panel"[^>]+hidden/);
  assert.match(html, /id="refresh-api-usage"[\s\S]*Actualizar conteo/);
  assert.match(html, /id="api-usage-summary"/);
  assert.match(html, /id="api-usage-table"/);
  assert.match(app, /const ADMIN_API_USAGE_EMAIL = "yoyou@hotmail\.es"/);
  assert.match(app, /const ADMIN_API_USAGE_CACHE_KEY/);
  assert.match(app, /function isApiUsageAdmin\(\)/);
  assert.match(app, /function resolveStableApiUsageDaily/);
  assert.match(app, /function mergedApiUsageEndpointRows/);
  assert.match(app, /daily\.persisted/);
  assert.match(app, /cloudSyncClient\.session\?\.user\?\.email/);
  assert.match(app, /runtime\?\.providers\?\.apiFootball\?\.observability/);
  assert.match(app, /footballDataService\.getRuntime\(\{ includeUsage: true \}\)/);
  assert.match(app, /function scheduleApiUsageAdminRefresh\(\)/);
  assert.match(app, /window\.addEventListener\("football-api-request-complete", scheduleApiUsageAdminRefresh\)/);
  assert.match(services, /window\.dispatchEvent\(new CustomEvent\(API_REQUEST_COMPLETE_EVENT/);
  assert.match(app, /El boton solo lee el contador; no consume API-Football/);
  assert.match(app, /API-Football reales/);
  assert.match(app, /Total confirmado por el proveedor/);
  assert.match(app, /Cuenta API-Football \(sin ruta local\)/);
  assert.match(styles, /\.account-api-usage/);
  assert.match(styles, /\.api-usage-summary/);
});

test("Transparencia filtra cuotas por Mejores picks sin incluir corners", () => {
  assert.match(app, /buildPerformanceOddsView\(module\.markets \|\| \[\], performanceRows, bestPicks\)/);
  assert.match(app, /ordenadas de mayor a menor\. Corners est/);
  assert.match(app, /performance-odds-row--\$\{market\.performanceColor\}/);
  assert.match(styles, /performance-odds-badge--green/);
  assert.match(styles, /performance-odds-badge--orange/);
  assert.match(styles, /performance-odds-badge--blue/);
});

test("Auditoria aprovecha el ancho y permite continuar el scroll de pagina", () => {
  assert.match(html, /class="utility-view audit-view" data-view-panel="audit"/);
  assert.match(styles, /\.audit-view \{ width: min\(1500px, 100%\); \}/);
  assert.match(styles, /\.audit-table-wrap \{[^}]*max-height: none;[^}]*overflow-x: auto;[^}]*overflow-y: visible;[^}]*overscroll-behavior-y: auto;/);
  assert.match(styles, /@media \(min-width: 1280px\)[\s\S]*\.audit-view \.evidence-readiness-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(app, /data-evaluate-evidence=/);
  assert.match(app, /pendingEvidenceForCompetition\(allEvidenceSnapshots\(\), competitionKey\)/);
  assert.match(app, /audit-option--evaluated/);
  assert.match(app, /audit-option--pending/);
  assert.match(styles, /#audit-fixture option\.audit-option--evaluated/);
  assert.match(styles, /#audit-fixture option\.audit-option--pending/);
});

test("Auditoria no expone evidencias locales cuando la nube requiere sesion", () => {
  assert.match(app, /function auditEvidenceRequiresSession/);
  assert.match(app, /state\.cloud\.enabled && !cloudSyncClient\.session\?\.accessToken/);
  assert.match(app, /Inicia sesion para ver evidencias/);
  assert.match(app, /Auditoria protegida/);
});

test("la Guia conserva el orden Cobertura, Ataque, Poisson, Mercado y Decision", () => {
  const ids = ["guide-coverage-module", "guide-team-goals-module", "guide-poisson-module", "guide-odds-module", "guide-data-picks-module"];
  const positions = ids.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(app, /guide-specific-markets-module/);
});

test("Corners permanece en Dashboard y el Catalogo conserva picks por intencion visibles", () => {
  const dashboard = html.slice(html.indexOf('data-view-panel="dashboard"'), html.indexOf('data-view-panel="transparency"'));
  assert.match(dashboard, /id="corners-panel"/);
  assert.doesNotMatch(app, /market-corners-slot/);
  assert.match(html, /id="show-specific-markets"[^>]*>Actualizar mercados/);
  assert.doesNotMatch(html, /id="show-specific-markets"[^>]+hidden/);
  assert.match(html, /id="specific-markets-content" aria-live="polite">/);
});

test("Dashboard incluye tarjetas amarillas con actualizacion manual", () => {
  const dashboard = html.slice(html.indexOf('data-view-panel="dashboard"'), html.indexOf('data-view-panel="transparency"'));
  assert.match(dashboard, /id="yellow-cards-panel"/);
  assert.match(html, /id="refresh-yellow-cards"[\s\S]*Actualizar datos/);
  assert.match(html, /id="show-yellow-cards"[\s\S]*Mostrar/);
  assert.match(app, /getYellowCardsModel\(fixture, forceRefresh\)/);
  assert.match(app, /refreshYellowCards\.addEventListener\("click", \(\) => loadYellowCards\(true\)\)/);
});

test("Dashboard incluye gol por mitad con actualizacion manual", () => {
  const dashboard = html.slice(html.indexOf('data-view-panel="dashboard"'), html.indexOf('data-view-panel="transparency"'));
  assert.match(dashboard, /id="goal-half-panel"/);
  assert.match(html, /id="refresh-goal-half"[\s\S]*Actualizar datos/);
  assert.match(html, /id="show-goal-half"[\s\S]*Mostrar/);
  assert.match(app, /getGoalHalfModel\(fixture, forceRefresh\)/);
  assert.match(app, /refreshGoalHalf\.addEventListener\("click", \(\) => loadGoalHalf\(true\)\)/);
});

test("Transparencia siempre visible y En vivo contienen sus modulos correctos", () => {
  const transparency = html.slice(html.indexOf('data-view-panel="transparency"'), html.indexOf('data-view-panel="guide"'));
  assert.match(transparency, /transparency-coverage-slot/);
  assert.match(transparency, /transparency-research-slot/);
  assert.doesNotMatch(html, /id="toggle-research"/);
  assert.match(html, /data-view-panel="live"[\s\S]*id="live-events-content"[\s\S]*id="live-players-content"/);
});

test("temporada se abre desde cada encuentro y la actualizacion de cinco minutos no usa checkbox", () => {
  assert.match(app, /data-action="season">Ver temporada/);
  assert.match(app, /openSupportingDetail\("teamSeasonStatistics"\)/);
  assert.doesNotMatch(html, /id="auto-refresh"|id="account-auto-refresh"/);
  assert.doesNotMatch(app, /setInterval\(runAutomaticRefresh, 5 \* 60 \* 1000\)/);
  assert.doesNotMatch(app, /visibilitychange[\s\S]*runAutomaticRefresh/);
  assert.match(html, /id="refresh-live-now"[\s\S]*Actualizar ahora/);
  assert.match(app, /refreshLiveDataNow/);
});

test("modo oscuro cubre picks individuales y sus metricas", () => {
  assert.match(styles, /data-theme="dark"[^}]*\.saved-pick/);
  assert.match(styles, /data-theme="dark"[^}]*\.saved-market-metrics/);
});

test("Mis apuestas separa picks, resultados por origen, competición, mejores picks, parlays y papelera", () => {
  assert.match(html, /data-saved-tab="individual"[^>]*>Picks individuales/);
  assert.match(html, /id="saved-date-filter" type="date"/);
  assert.match(html, /id="apply-saved-date-filter"[^>]*>Buscar/);
  assert.match(app, /savedDateFilter: pacificToday\(\)/);
  assert.match(app, /clearSavedDateFilter\.textContent = state\.savedDateFilter \? "Mostrar todas" : "Ocultar"/);
  assert.match(app, /data-pick-result/);
  assert.match(app, /pick\.resultSource = "manual"/);
  assert.match(html, /data-saved-tab="origins-won"[^>]*>Resultados por origen Ganados/);
  assert.match(html, /data-saved-tab="origins-lost"[^>]*>Resultados por origen Perdidos/);
  assert.match(html, /data-saved-tab="competitions"[^>]*>Resultados por competici/);
  assert.match(html, /data-saved-tab="origin-recommendations"[^>]*>Mejores picks/);
  assert.match(html, /data-saved-tab="best-combination"[^>]*>Mejor combinaci/);
  assert.match(html, /data-saved-tab="historical-validator"[^>]*>Validador hist/);
  assert.match(html, /id="saved-individual-section"[\s\S]*id="update-individual-results"/);
  assert.match(html, /id="origin-results-section"[\s\S]*id="update-origin-results"/);
  assert.match(html, /id="origin-lost-results-section"[\s\S]*id="update-origin-lost-results"/);
  assert.match(html, /id="competition-results-section"[\s\S]*id="update-competition-results"/);
  assert.match(html, /id="origin-recommendations-section"[\s\S]*id="update-origin-recommendations"/);
  assert.match(html, /id="historical-validator-section"[\s\S]*id="historical-validator"/);
  assert.match(html, /id="saved-parlays-section"[\s\S]*id="update-parlay-results"/);
  assert.match(app, /calculateOriginPerformance\(state\.savedPicks, state\.savedParlays\)/);
  assert.match(app, /calculateCompetitionPerformance\(state\.savedPicks, state\.savedParlays\)/);
  assert.match(app, /<th>Estado<\/th>/);
  assert.match(app, /query-status--\$\{escapeHtml\(row\.queryStatus \|\| "active"\)\}/);
  assert.doesNotMatch(app, /<th>Agregados<\/th>/);
  assert.doesNotMatch(app, /<th>Agregado<\/th>/);
  assert.match(app, /leg\.resultSource = "manual"/);
  assert.match(app, /leg\.settlementVerificationVersion = SETTLEMENT_VERIFICATION_VERSION/);
  assert.match(app, /fixtureIdsNeedingDetails\.has\(String\(fixtureId\)\)/);
  assert.match(app, /Picks ganados/);
  assert.match(app, /Picks perdidos/);
  assert.match(app, /deletedPermanently: true/);
  assert.match(app, /calculateOriginRecommendations\(calculateOriginPerformance\(currentMonth\.picks, currentMonth\.parlays\)\)/);
  assert.match(app, /buildBestCombinationAnalysis\(currentMonth\.picks, currentMonth\.parlays\)/);
  assert.match(app, /buildHistoricalPickValidator\(state\.savedPicks, state\.savedParlays, new Date\(\),/);
  assert.match(app, /historicalValidatorSection\.hidden = state\.savedTab !== "historical-validator"/);
  assert.match(html, /id="competition-main"><option value="all" selected>Todas las competiciones/);
  assert.match(html, /id="origin-picks-dialog"/);
  assert.match(app, /showOriginPicksDialog\(open\.dataset\.viewOriginPicks/);
  assert.match(app, /performancePreviousRanks/);
});

test("forma reciente permite agregar su recomendación al parlay", () => {
  assert.match(app, /data-add-recent-form-pick/);
  assert.match(app, /sourceModule: "recent_form"/);
  assert.match(app, /addRecentFormRecommendationToParlay/);
});

test("parlays muestran marcador y minuto cuando el encuentro está en vivo", () => {
  assert.match(app, /function savedLegScoreHtml\(leg\)/);
  assert.match(app, /applyFixtureStatusUpdate\(leg/);
  assert.match(app, /statusLabel: fixtureResult\?\.statusLabel/);
  assert.match(app, /savedLegScoreHtml\(leg\)/);
  assert.match(app, /hasLiveFixture[\s\S]*parlay-live-badge[\s\S]*En vivo/);
  assert.match(app, /const countryLabel = leg\.country/);
  assert.match(app, /escapeHtml\(leg\.date\)\}\$\{countryLabel\}/);
});

test("parlays pendientes aparecen primero, perdidos al final y muestran porcentaje ganado", () => {
  assert.match(app, /resultOrder = Object\.freeze\(\{ pending: 0, won: 1, void: 2, lost: 3 \}\)/);
  assert.match(app, /calculateParlayWinProgress\(parlay\.legs\)/);
  assert.match(app, /parlay-win-progress/);
  assert.match(app, /state\.expandedParlays\.clear\(\)/);
});

test("En vivo permite scroll vertical interno y continuar en la pagina", () => {
  assert.match(styles, /\.live-data-content \.detail-table-wrap \{[^}]*max-height: min\(72vh, 720px\)[^}]*overflow: auto[^}]*overscroll-behavior-y: auto/);
});

test("la capa movil final adapta controles, pestañas y ventanas al telefono", () => {
  const mobile = styles.slice(styles.lastIndexOf("/* Consolidated phone layout"));
  assert.match(mobile, /@media \(max-width: 640px\)/);
  assert.match(mobile, /\.quick-filters \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /\.panel-actions,[\s\S]*grid-template-columns: 1fr/);
  assert.match(mobile, /\.saved-tabs \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /\.data-dialog \{[\s\S]*height: 100dvh;[\s\S]*max-height: 100dvh/);
  assert.match(mobile, /\.data-dialog__content \{[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain/);
  assert.match(mobile, /\.parlay-slip \{[\s\S]*right: 8px;[\s\S]*left: 8px/);
});

test("Mis apuestas distribuye sus pestañas sin desbordar y renueva la cache movil", () => {
  assert.match(html, /styles\.css\?v=20260815-monthly-picks-v1/);
  assert.match(styles, /\.saved-tabs \{[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(min\(180px, 100%\), 1fr\)\)/);
  assert.match(styles, /\.saved-tabs \.button \{[^}]*width: 100%;[^}]*min-width: 0;[^}]*white-space: normal;/);
});

test("el menú incluye equipos goleadores y goleados con actualización local", () => {
  assert.match(html, /data-view="team-goal-insights"[\s\S]*Equipos goleadores y goleados/);
  assert.match(html, /data-view-panel="team-goal-insights"/);
  assert.match(html, /id="refresh-team-goal-insights"/);
  assert.match(app, /calculateParlayTeamGoalLeaders\(state\.savedParlays/);
  assert.match(app, /if \(view === "team-goal-insights"\) renderTeamGoalInsights\(\)/);
});

test("resultados históricos permiten filtrar por mes y abrir picks por competición", () => {
  assert.match(html, /id="performance-month-filter" type="month"/);
  assert.match(app, /filterPicksByFixtureMonth\(state\.savedPicks, state\.performanceMonthFilter\)/);
  assert.match(app, /filterParlaysByFixtureMonth\(state\.savedParlays, state\.performanceMonthFilter\)/);
  assert.match(app, /data-view-competition-picks/);
  assert.match(app, /showCompetitionPicksDialog/);
  assert.match(app, /<th>Origen<\/th>/);
  assert.match(app, /historical-validator"\]\.includes\(state\.savedTab\)/);
  assert.match(app, /competition-general-summary/);
  assert.match(app, /currentMonthPerformanceData\(\)/);
  assert.match(app, /buildBestCombinationAnalysis\(currentMonth\.picks, currentMonth\.parlays\)/);
});

test("las señales históricas identifican mejores y peores resultados", () => {
  assert.match(app, /performance-signal--best[\s\S]*Mejor desempe/);
  assert.match(app, /performance-signal--worst[\s\S]*Desempe/);
  assert.match(app, /league-performance-badge[\s\S]*Mejor historial/);
  assert.match(app, /unfavorableCompetitionForFixtures[\s\S]*Historial desfavorable/);
  assert.match(app, /groups\.sort\([\s\S]*competitionHistoryOrder/);
  assert.match(app, /favoriteOriginKeys[\s\S]*Origen favorito/);
});

test("Picks recomendados muestra equis roja solo con respaldo histórico desfavorable", () => {
  assert.match(app, /assessPickHistoricalRecommendation\(pick, performanceRows\)/);
  assert.match(app, /collection-pick--historical-avoid/);
  assert.match(app, /Menos recomendado por historial/);
});
