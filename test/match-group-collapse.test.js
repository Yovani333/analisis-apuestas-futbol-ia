import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("los resultados se agrupan minimizados con controles de mostrar y ocultar", () => {
  assert.match(app, /expandedMatchGroups: new Set\(\)/);
  assert.match(app, /data-toggle-league=/);
  assert.match(app, /aria-expanded="\$\{expanded\}"/);
  assert.match(app, /class="league-group__matches" \$\{expanded \? "" : "hidden"\}/);
  assert.match(app, /\$\{expanded \? "−" : "\+"\}/);
});

test("cada busqueda nueva vuelve a minimizar todas las categorias", () => {
  assert.match(app, /async function searchFixtures[\s\S]*state\.expandedMatchGroups\.clear\(\)/);
  assert.match(app, /const groupToggle = event\.target\.closest\("\[data-toggle-league\]"\)/);
});

test("el control desplegable conserva dimensiones estables y foco visible", () => {
  assert.match(styles, /\.league-group__toggle\s*\{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(styles, /\.league-group__toggle:focus-visible/);
  assert.match(styles, /\.league-group__matches\s*\{[\s\S]*display: grid;/);
});
