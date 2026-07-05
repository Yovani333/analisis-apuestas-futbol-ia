import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Catálogo de mercados es una vista principal separada de Guía de análisis", () => {
  assert.match(html, /data-view="guide">Guía de análisis<\/button>\s*<button[^>]+data-view="markets">Catálogo de mercados/);
  assert.match(html, /data-view-panel="markets"/);
  const guide = html.slice(html.indexOf('data-view-panel="guide"'), html.indexOf('data-view-panel="markets"'));
  assert.doesNotMatch(guide, /id="specific-markets-panel"/);
});

test("la Guía conserva el orden Cobertura, Ataque, Poisson, Mercado y Decisión", () => {
  const ids = ["guide-coverage-module", "guide-team-goals-module", "guide-poisson-module", "guide-odds-module", "guide-data-picks-module"];
  const positions = ids.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(app, /guide-specific-markets-module/);
});

test("Corners y mercados específicos comparten la vista Catálogo", () => {
  assert.match(html, /id="specific-markets-panel"[\s\S]*id="market-corners-slot"/);
  assert.match(app, /#market-corners-slot/);
});

test("modo oscuro cubre picks individuales y sus métricas", () => {
  assert.match(styles, /data-theme="dark"[^}]*\.saved-pick/);
  assert.match(styles, /data-theme="dark"[^}]*\.saved-market-metrics/);
});
