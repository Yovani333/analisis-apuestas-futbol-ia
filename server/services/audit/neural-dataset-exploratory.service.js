const DEFAULT_BINS = 10;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function wilsonInterval(hits, total, z = 1.959963984540054) {
  if (!total) return { lowPct: null, highPct: null };
  const proportion = hits / total;
  const denominator = 1 + (z ** 2 / total);
  const center = (proportion + z ** 2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) / total) + z ** 2 / (4 * total ** 2)) / denominator;
  return { lowPct: rounded(Math.max(0, center - margin) * 100), highPct: rounded(Math.min(1, center + margin) * 100) };
}

function calibration(rows, binCount = DEFAULT_BINS) {
  const valid = rows.map((row) => ({ probability: finite(row.features?.modelProbability), target: finite(row.target) }))
    .filter((row) => row.probability !== null && row.probability > 0 && row.probability < 100 && [0, 1].includes(row.target));
  if (!valid.length) return { samples: 0, brierScore: null, logLoss: null, expectedCalibrationErrorPct: null, bins: [] };
  const bins = Array.from({ length: binCount }, (_, index) => ({ index, minPct: index * 100 / binCount, maxPct: (index + 1) * 100 / binCount, rows: [] }));
  let brier = 0;
  let logLoss = 0;
  for (const row of valid) {
    const probability = row.probability / 100;
    const clipped = Math.min(1 - 1e-15, Math.max(1e-15, probability));
    brier += (probability - row.target) ** 2;
    logLoss += -(row.target * Math.log(clipped) + (1 - row.target) * Math.log(1 - clipped));
    bins[Math.min(binCount - 1, Math.floor(probability * binCount))].rows.push(row);
  }
  let ece = 0;
  const populatedBins = bins.filter((bin) => bin.rows.length).map((bin) => {
    const meanProbabilityPct = average(bin.rows.map((row) => row.probability));
    const observedHitRatePct = average(bin.rows.map((row) => row.target)) * 100;
    const gapPct = Math.abs(meanProbabilityPct - observedHitRatePct);
    ece += (bin.rows.length / valid.length) * gapPct;
    return { minPct: bin.minPct, maxPct: bin.maxPct, samples: bin.rows.length, meanProbabilityPct: rounded(meanProbabilityPct), observedHitRatePct: rounded(observedHitRatePct), gapPct: rounded(gapPct) };
  });
  return { samples: valid.length, brierScore: rounded(brier / valid.length, 4), logLoss: rounded(logLoss / valid.length, 4), expectedCalibrationErrorPct: rounded(ece), bins: populatedBins };
}

function theoreticalRoi(rows) {
  const valid = rows.map((row) => ({ odds: finite(row.features?.decimalOdds), target: finite(row.target) }))
    .filter((row) => row.odds !== null && row.odds > 1 && [0, 1].includes(row.target));
  if (!valid.length) return { samples: 0, roiPct: null, profitUnits: null, averageOdds: null };
  const profit = valid.reduce((sum, row) => sum + (row.target === 1 ? row.odds - 1 : -1), 0);
  return { samples: valid.length, roiPct: rounded(profit / valid.length * 100), profitUnits: rounded(profit), averageOdds: rounded(average(valid.map((row) => row.odds))) };
}

function metricSummary(rows) {
  const hits = rows.filter((row) => Number(row.target) === 1).length;
  const misses = rows.filter((row) => Number(row.target) === 0).length;
  const total = hits + misses;
  const interval = wilsonInterval(hits, total);
  return {
    samples: total,
    hits,
    misses,
    hitRatePct: total ? rounded(hits / total * 100) : null,
    confidenceInterval95Pct: interval,
    averageModelProbabilityPct: rounded(average(rows.map((row) => row.features?.modelProbability))),
    averageConfidence: rounded(average(rows.map((row) => row.features?.confidence))),
    averageDataQuality: rounded(average(rows.map((row) => row.features?.dataQuality))),
    averageExpectedValuePct: rounded(average(rows.map((row) => row.features?.expectedValue))),
    calibration: calibration(rows),
    theoreticalRoi: theoreticalRoi(rows)
  };
}

function groupRows(rows, keyBuilder, limit = 50) {
  const groups = new Map();
  for (const row of rows) {
    const descriptor = keyBuilder(row);
    if (!descriptor?.key) continue;
    if (!groups.has(descriptor.key)) groups.set(descriptor.key, { descriptor, rows: [] });
    groups.get(descriptor.key).rows.push(row);
  }
  return [...groups.values()].map(({ descriptor, rows: group }) => ({ ...descriptor, ...metricSummary(group) }))
    .sort((a, b) => b.samples - a.samples || String(a.key).localeCompare(String(b.key))).slice(0, limit);
}

function temporalValidation(rows) {
  const ordered = [...rows].filter((row) => Number.isFinite(Date.parse(row.kickoffAt || "")))
    .sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt) || String(a.rowId).localeCompare(String(b.rowId)));
  if (ordered.length < 20) return { status: "insufficient", samples: ordered.length, training: null, validation: null, splitAt: null };
  const splitIndex = Math.max(1, Math.min(ordered.length - 1, Math.floor(ordered.length * 0.7)));
  return {
    status: "available",
    samples: ordered.length,
    splitAt: ordered[splitIndex]?.kickoffAt || null,
    training: metricSummary(ordered.slice(0, splitIndex)),
    validation: metricSummary(ordered.slice(splitIndex))
  };
}

function missingFeatureSummary(rows) {
  const counts = new Map();
  for (const row of rows) for (const feature of row.missingFeatures || []) counts.set(feature, (counts.get(feature) || 0) + 1);
  return [...counts.entries()].map(([feature, count]) => ({ feature, count, ratePct: rounded(count / Math.max(1, rows.length) * 100) }))
    .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature));
}

function reportWarnings(report, dataset) {
  const warnings = [];
  if (!report.overall.samples) warnings.push("No existen filas HIT/MISS aptas para la auditoría exploratoria.");
  if (!report.bySelection.some((row) => row.samples >= 100)) warnings.push("Ninguna selección concreta alcanza todavía cien observaciones.");
  if (report.overall.samples && (report.overall.hitRatePct < 35 || report.overall.hitRatePct > 65)) warnings.push("La variable objetivo presenta desequilibrio y requerirá control durante cualquier entrenamiento futuro.");
  if (report.overall.calibration.samples < 100) warnings.push("La calibración global sigue siendo provisional por tamaño de muestra.");
  if (dataset.summary?.duplicateSnapshotsIgnored) warnings.push(`${dataset.summary.duplicateSnapshotsIgnored} snapshot(s) duplicados fueron ignorados antes del análisis.`);
  warnings.push("Los resultados son exploratorios: no autorizan cambios de fórmulas, pesos ni picks reales.");
  return warnings;
}

export function buildNeuralDatasetExploratoryReport(dataset, { now = new Date() } = {}) {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  const overall = metricSummary(rows);
  const report = {
    reportVersion: "neural-exploratory-audit-v1",
    generatedAt: now.toISOString(),
    dataset: {
      schemaVersion: dataset?.schemaVersion || null,
      fingerprint: dataset?.fingerprint || null,
      samples: rows.length,
      snapshotsSelected: Number(dataset?.summary?.snapshotsSelected || 0),
      exclusions: Number(dataset?.summary?.exclusions || 0),
      targetPolicy: dataset?.policy?.target || "HIT=1, MISS=0",
      historicalPicksRecalculated: dataset?.policy?.historicalPicksRecalculated === true
    },
    overall,
    bySelection: groupRows(rows, (row) => ({
      key: `${row.marketKey}:${row.selectionKey || row.selection}:${row.modelVersion}`,
      market: row.market,
      marketKey: row.marketKey,
      selection: row.selection,
      selectionKey: row.selectionKey || null,
      modelVersion: row.modelVersion
    })),
    byMarket: groupRows(rows, (row) => ({ key: `${row.marketKey}:${row.modelVersion}`, market: row.market, marketKey: row.marketKey, modelVersion: row.modelVersion })),
    byLeague: groupRows(rows, (row) => ({ key: `${row.leagueId || row.leagueName}:${row.season ?? "unknown"}`, leagueId: row.leagueId, leagueName: row.leagueName, season: row.season })),
    byOrigin: groupRows(rows, (row) => ({ key: `${row.sourceModule}:${row.modelVersion}`, sourceModule: row.sourceModule, modelVersion: row.modelVersion })),
    byConfidence: groupRows(rows, (row) => {
      const confidence = finite(row.features?.confidence);
      const band = confidence === null ? "No disponible" : confidence >= 70 ? "Alta" : confidence >= 50 ? "Media" : "Baja";
      return { key: band, confidenceBand: band };
    }),
    byVersion: groupRows(rows, (row) => ({ key: row.modelVersion, modelVersion: row.modelVersion })),
    temporalValidation: temporalValidation(rows),
    missingFeatures: missingFeatureSummary(rows),
    checks: {
      uniqueRowIds: new Set(rows.map((row) => row.rowId)).size,
      duplicateRows: rows.length - new Set(rows.map((row) => row.rowId)).size,
      futureOrSameFixtureRows: rows.filter((row) => Date.parse(row.capturedAt || "") >= Date.parse(row.kickoffAt || "")).length,
      nonBinaryTargets: rows.filter((row) => ![0, 1].includes(Number(row.target))).length
    }
  };
  report.warnings = reportWarnings(report, dataset);
  report.decision = report.bySelection.some((row) => row.samples >= 300)
    ? "prototype_validation_possible"
    : report.bySelection.some((row) => row.samples >= 100)
      ? "exploratory_by_selection"
      : "collect_more_evidence";
  return report;
}

export const neuralExploratoryInternals = Object.freeze({ wilsonInterval, calibration, theoreticalRoi, metricSummary, temporalValidation });
