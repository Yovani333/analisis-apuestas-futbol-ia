import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNeuralDatasetExploratoryReport, neuralExploratoryInternals } from "../server/services/audit/neural-dataset-exploratory.service.js";

const routes = readFileSync(new URL("../server/routes/api.routes.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const cloud = readFileSync(new URL("../public/cloud-sync.js", import.meta.url), "utf8");
const cloudService = readFileSync(new URL("../server/services/cloud-sync.service.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function row(index, overrides = {}) {
  const target = index % 3 === 0 ? 0 : 1;
  return {
    rowId: `row-${index}`,
    snapshotId: `snapshot-${index}`,
    fixtureId: String(1000 + index),
    capturedAt: new Date(Date.UTC(2026, 0, index + 1, 16)).toISOString(),
    kickoffAt: new Date(Date.UTC(2026, 0, index + 1, 18)).toISOString(),
    leagueId: 253,
    leagueName: "MLS",
    season: 2026,
    market: "Total de goles 2.5",
    marketKey: "total_de_goles_2_5",
    selection: index % 2 ? "Más de 2.5" : "Menos de 2.5",
    selectionKey: index % 2 ? "over_2_5" : "under_2_5",
    sourceModule: "data_picks",
    modelVersion: "picks-data-engine-v3",
    features: { modelProbability: target ? 68 : 42, decimalOdds: 1.9, expectedValue: 8, confidence: 72, dataQuality: 84 },
    missingFeatures: index === 0 ? ["footballConfidence"] : [],
    target,
    targetLabel: target ? "HIT" : "MISS",
    ...overrides
  };
}

function dataset(rows) {
  return {
    schemaVersion: "neural-training-dataset-v1",
    fingerprint: "fingerprint",
    policy: { target: "HIT=1, MISS=0", historicalPicksRecalculated: false },
    summary: { snapshotsSelected: rows.length, exclusions: 12, duplicateSnapshotsIgnored: 0 },
    rows
  };
}

test("separa selecciones opuestas aunque compartan mercado", () => {
  const report = buildNeuralDatasetExploratoryReport(dataset(Array.from({ length: 30 }, (_, index) => row(index))), { now: new Date("2026-08-09T12:00:00Z") });
  assert.equal(report.byMarket.length, 1);
  assert.equal(report.bySelection.length, 2);
  assert.deepEqual(new Set(report.bySelection.map((group) => group.selectionKey)), new Set(["over_2_5", "under_2_5"]));
  assert.equal(report.overall.samples, 30);
  assert.equal(report.checks.futureOrSameFixtureRows, 0);
  assert.equal(report.checks.duplicateRows, 0);
});

test("calcula Brier, Log Loss, ECE, ROI e intervalo de confianza sin NaN", () => {
  const report = buildNeuralDatasetExploratoryReport(dataset(Array.from({ length: 40 }, (_, index) => row(index))));
  assert.ok(Number.isFinite(report.overall.calibration.brierScore));
  assert.ok(Number.isFinite(report.overall.calibration.logLoss));
  assert.ok(Number.isFinite(report.overall.calibration.expectedCalibrationErrorPct));
  assert.ok(Number.isFinite(report.overall.theoreticalRoi.roiPct));
  assert.ok(Number.isFinite(report.overall.confidenceInterval95Pct.lowPct));
  assert.ok(Number.isFinite(report.overall.confidenceInterval95Pct.highPct));
});

test("la validación temporal usa el set antiguo para entrenamiento y el reciente para validación", () => {
  const report = buildNeuralDatasetExploratoryReport(dataset(Array.from({ length: 100 }, (_, index) => row(index))));
  assert.equal(report.temporalValidation.status, "available");
  assert.equal(report.temporalValidation.training.samples, 70);
  assert.equal(report.temporalValidation.validation.samples, 30);
  assert.equal(report.decision, "collect_more_evidence");
});

test("cien observaciones de una misma selección habilitan solo exploración", () => {
  const rows = Array.from({ length: 100 }, (_, index) => row(index, { selection: "Más de 1.5", selectionKey: "over_1_5", market: "Total de goles 1.5", marketKey: "total_de_goles_1_5" }));
  const report = buildNeuralDatasetExploratoryReport(dataset(rows));
  assert.equal(report.bySelection[0].samples, 100);
  assert.equal(report.decision, "exploratory_by_selection");
  assert.equal(report.dataset.historicalPicksRecalculated, false);
});

test("el reporte es determinista salvo la fecha explícita y no modifica filas", () => {
  const rows = Array.from({ length: 25 }, (_, index) => row(index));
  const before = structuredClone(rows);
  const options = { now: new Date("2026-08-09T12:00:00Z") };
  assert.deepEqual(buildNeuralDatasetExploratoryReport(dataset(rows), options), buildNeuralDatasetExploratoryReport(dataset(rows), options));
  assert.deepEqual(rows, before);
  assert.equal(neuralExploratoryInternals.temporalValidation(rows).samples, 25);
});

test("la matriz cruza competición, origen, mercado, selección y versión sin mezclar grupos", () => {
  const rows = [
    row(1, { selection: "Más de 2.5", selectionKey: "over_2_5" }),
    row(2, { selection: "Más de 2.5", selectionKey: "over_2_5" }),
    row(3, { selection: "Más de 2.5", selectionKey: "over_2_5", sourceModule: "h2h" }),
    row(4, { leagueId: 262, leagueName: "Liga MX", selection: "Más de 1.5", selectionKey: "over_1_5", market: "Total de goles 1.5", marketKey: "total_de_goles_1_5" })
  ];
  const report = buildNeuralDatasetExploratoryReport(dataset(rows));
  assert.equal(report.performanceMatrix.length, 3);
  const mlsDataPicks = report.performanceMatrix.find((group) => group.leagueId === 253 && group.sourceModule === "data_picks");
  assert.equal(mlsDataPicks.samples, 2);
  assert.equal(mlsDataPicks.uniqueFixtures, 2);
  assert.equal(mlsDataPicks.sampleMaturity.key, "insufficient");
  assert.equal(report.matrixPolicy.exposureCountsIncluded, false);
  assert.equal(mlsDataPicks.individualPicks, null);
  assert.equal(mlsDataPicks.parlaySelections, null);
});

test("clasifica la madurez de cada celda sin confundirla con el porcentaje de acierto", () => {
  const cases = [[9, "insufficient"], [10, "preliminary"], [20, "useful"], [40, "solid"], [70, "broad"]];
  for (const [samples, expected] of cases) {
    const rows = Array.from({ length: samples }, (_, index) => row(index, { selection: "Más de 1.5", selectionKey: "over_1_5", market: "Total de goles 1.5", marketKey: "total_de_goles_1_5" }));
    const report = buildNeuralDatasetExploratoryReport(dataset(rows));
    assert.equal(report.performanceMatrix.reduce((largest, group) => group.samples > largest.samples ? group : largest).sampleMaturity.key, expected);
  }
});

test("filtra por mes de kickoff y conserva los periodos disponibles", () => {
  const rows = [
    row(1, { kickoffAt: "2026-07-10T18:00:00.000Z" }),
    row(2, { kickoffAt: "2026-08-10T18:00:00.000Z" }),
    row(3, { kickoffAt: "2026-08-12T18:00:00.000Z" })
  ];
  const report = buildNeuralDatasetExploratoryReport(dataset(rows), { period: { year: 2026, month: 8 } });
  assert.equal(report.period.key, "2026-08");
  assert.equal(report.overall.samples, 2);
  assert.equal(report.dataset.totalSamples, 3);
  assert.deepEqual(report.period.available.map((period) => period.key), ["2026-08", "2026-07"]);
});

test("un periodo inválido usa todo el historial sin alterar las filas", () => {
  const rows = [row(1), row(2)];
  const before = structuredClone(rows);
  const report = buildNeuralDatasetExploratoryReport(dataset(rows), { period: { year: "x", month: 30 } });
  assert.equal(report.period.mode, "all");
  assert.equal(report.overall.samples, 2);
  assert.deepEqual(rows, before);
});

test("la auditoría exploratoria es manual, autenticada y no consulta API-Football", () => {
  assert.match(routes, /apiRouter\.get\("\/audit\/neural-dataset\/exploratory-report"/);
  assert.match(routes, /buildNeuralDatasetExploratoryReport\(dataset, \{/);
  assert.match(routes, /apiFootballRequests: 0/);
  assert.match(cloud, /neuralDatasetExploratoryReport\(\{ year = null, month = null \} = \{\}\)/);
  assert.match(html, /id="run-neural-exploratory-audit"/);
  assert.match(app, /runNeuralExploratoryAudit\.addEventListener\("click", \(\) => runNeuralExploratoryAudit\(\)\)/);
  assert.doesNotMatch(app, /setInterval\([^)]*runNeuralExploratoryAudit/);
});

test("la matriz reutiliza la ruta exploratoria y no agrega consultas a API-Football", () => {
  assert.match(routes, /period: \{ year: req\.query\.year, month: req\.query\.month \}/);
  assert.match(routes, /apiFootballRequests: 0/);
  assert.match(app, /Matriz de rendimiento histórico/);
  assert.match(app, /data-apply-audit-matrix-period/);
  assert.match(app, /Las exposiciones en picks individuales y parlays no se mezclan/);
});

test("la auditoria exploratoria carga solo etiquetas decisivas y snapshots minimos", () => {
  assert.match(routes, /listCloudEvidenceAuditLabels\(authorization, \{ outcomes: \["HIT", "MISS"\] \}\)/);
  assert.match(routes, /listCloudNeuralEvidenceSnapshots\(authorization, snapshotIds\)/);
  assert.match(cloudService, /outcome=in\.\(\$\{outcomes\.join\(","\)\}\)/);
  assert.match(cloudService, /data_picks:snapshot->modules->dataPicks/);
  assert.match(cloudService, /snapshot->>id=in\.\(\$\{snapshotFilter\}\)/);
});
