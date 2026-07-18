import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
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

test("Auditoria aprovecha el ancho y permite continuar el scroll de pagina", () => {
  assert.match(html, /class="utility-view audit-view" data-view-panel="audit"/);
  assert.match(styles, /\.audit-view \{ width: min\(1500px, 100%\); \}/);
  assert.match(styles, /\.audit-table-wrap \{[^}]*max-height: none;[^}]*overflow-x: auto;[^}]*overflow-y: visible;[^}]*overscroll-behavior-y: auto;/);
  assert.match(styles, /@media \(min-width: 1280px\)[\s\S]*\.audit-view \.evidence-readiness-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(app, /data-evaluate-evidence=/);
  assert.match(app, /pendingEvidenceForCompetition\(allEvidenceSnapshots\(\), competitionKey\)/);
  assert.match(app, /audit-option--evaluated/);
  assert.match(styles, /#audit-fixture option\.audit-option--evaluated/);
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

test("Mis apuestas separa picks, resultados por origen, parlays y papelera", () => {
  assert.match(html, /data-saved-tab="individual"[^>]*>Picks individuales/);
  assert.match(html, /data-saved-tab="origins"[^>]*>Resultados por origen/);
  assert.match(html, /id="saved-individual-section"[\s\S]*id="update-individual-results"/);
  assert.match(html, /id="origin-results-section"[\s\S]*id="update-origin-results"/);
  assert.match(html, /id="saved-parlays-section"[\s\S]*id="update-parlay-results"/);
  assert.match(app, /calculateOriginPerformance\(state\.savedPicks, state\.savedParlays\)/);
});

test("En vivo permite scroll vertical interno y continuar en la pagina", () => {
  assert.match(styles, /\.live-data-content \.detail-table-wrap \{[^}]*max-height: min\(72vh, 720px\)[^}]*overflow: auto[^}]*overscroll-behavior-y: auto/);
});
