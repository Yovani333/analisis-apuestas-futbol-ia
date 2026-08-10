import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("../server/routes/api.routes.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const services = readFileSync(new URL("../public/services.js", import.meta.url), "utf8");
const cloud = readFileSync(new URL("../public/cloud-sync.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("backfill es manual, autenticado y limitado a diez fixtures", () => {
  assert.match(routes, /apiRouter\.post\("\/audit\/neural-dataset\/backfill"/);
  assert.match(routes, /Math\.max\(1, Math\.min\(10,/);
  assert.match(routes, /listCloudEvidenceAuditLabels\(authorization\)/);
  assert.match(routes, /kickoffTime < Date\.now\(\)/);
  assert.match(routes, /expected > stored/);
});

test("backfill liquida el snapshot congelado y no regenera picks", () => {
  assert.match(routes, /runSavedEvidenceBacktest\(candidate\.snapshot, fixtureResult\)/);
  assert.doesNotMatch(routes, /backfill[\s\S]{0,1500}generateDataPicks/);
  assert.match(routes, /saveEvidenceAuditLabels\(authorization, candidate\.snapshot, audit\)/);
});

test("la auditoría envía el token únicamente para persistir etiquetas de la cuenta", () => {
  assert.match(services, /auditFixture\(fixtureId, evidence = null, token = ""\)/);
  assert.match(services, /Authorization: `Bearer \$\{token\}`/);
  assert.match(app, /cloudSyncClient\.accessToken\(\)/);
});

test("la interfaz requiere acción manual y muestra consumo del lote", () => {
  assert.match(html, /id="prepare-neural-dataset"/);
  assert.match(app, /prepareNeuralDataset\.addEventListener\("click", prepareNextNeuralDatasetBatch\)/);
  assert.match(app, /fixtureResultChecks/);
  assert.doesNotMatch(app, /setInterval\([^)]*prepareNextNeuralDatasetBatch/);
  assert.match(cloud, /backfillNeuralDataset\(\{ limit = 5, dryRun = false \} = \{\}\)/);
});

test("el panel distingue muestra agotada, exclusiones y grupos por versión", () => {
  assert.match(html, /id="neural-dataset-details"/);
  assert.match(app, /Evidencias disponibles agotadas/);
  assert.match(app, /Revisar más tarde/);
  assert.match(app, /summary\.readiness/);
  assert.match(app, /summary\.exclusionSummary/);
  assert.match(app, /Resultados sin etiqueta nueva/);
  assert.match(styles, /\.neural-dataset-detail-grid/);
});
