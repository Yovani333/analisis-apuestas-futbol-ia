import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("las vistas principales siguen el orden Dashboard, Simulacion, Transparencia, Guia, Catalogo, En vivo y Recopilacion", () => {
  assert.match(html, /data-view="dashboard"[\s\S]*data-view="simulation">Simulaci[\s\S]*?n<\/button>\s*<button[^>]+data-view="transparency">Transparencia de datos<\/button>\s*<button[^>]+data-view="guide">Gu[\s\S]*?a de an[\s\S]*?lisis<\/button>\s*<button[^>]+data-view="markets">Cat[\s\S]*?logo de mercados<\/button>\s*<button[^>]+data-view="live">En vivo<\/button>\s*<button[^>]+data-view="pick-collection">Recopilaci[\s\S]*?n para Picks/);
  assert.match(html, /data-view-panel="simulation"[\s\S]*Comparador de equipos con datos reales/);
  assert.match(html, /data-view-panel="markets"/);
  assert.match(html, /data-view-panel="pick-collection"[\s\S]*id="collect-pick-info"[\s\S]*Recabar informaci[\s\S]*?n/);
  const guide = html.slice(html.indexOf('data-view-panel="guide"'), html.indexOf('data-view-panel="markets"'));
  assert.doesNotMatch(guide, /id="specific-markets-panel"/);
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
  assert.match(html, /id="show-specific-markets"[^>]+hidden/);
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
