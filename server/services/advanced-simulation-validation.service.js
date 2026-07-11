const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function walkNumbers(value, path = "", errors = []) {
  if (value === null || value === undefined) return errors;
  if (typeof value === "number" && !Number.isFinite(value)) errors.push(`${path || "root"} no es finito`);
  if (Array.isArray(value)) value.forEach((item, index) => walkNumbers(item, `${path}[${index}]`, errors));
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) walkNumbers(item, path ? `${path}.${key}` : key, errors);
  }
  return errors;
}

function validateFixtureDates(result = {}, fixtureDate = "") {
  const cutoff = Date.parse(fixtureDate || "");
  if (!Number.isFinite(cutoff)) return [];
  return [
    ...(result.comparison?.teamA?.fixturesUsed || []),
    ...(result.comparison?.teamB?.fixturesUsed || [])
  ].filter((row) => Number.isFinite(Date.parse(row.date || "")) && Date.parse(row.date) >= cutoff)
    .map((row) => `Fixture posterior detectado: ${row.fixtureId}`);
}

export function validateAdvancedSimulationResult(result = {}, input = {}) {
  const errors = [];
  const warnings = [];
  const probabilities = result.finalProbabilities || {};
  const home = number(probabilities.homeWin);
  const draw = number(probabilities.draw);
  const away = number(probabilities.awayWin);
  if ([home, draw, away].some((value) => value === null || value < 0 || value > 100)) errors.push("Probabilidades 1X2 fuera de rango.");
  const total = round((home || 0) + (draw || 0) + (away || 0), 2);
  if (Math.abs(total - 100) > 0.35) errors.push(`Suma 1X2 inválida: ${total}.`);

  const matrix = result.dixonColes?.goalMatrix || [];
  const matrixSum = round(matrix.reduce((sum, row) => sum + Number(row.probability || 0), 0), 4);
  if (matrix.length && Math.abs(matrixSum - 1) > 0.01) errors.push(`Matriz de marcadores no normalizada: ${matrixSum}.`);
  if (!matrix.length) warnings.push("Matriz de marcadores no disponible.");
  if (matrix.some((row) => Number(row.probability) < 0)) errors.push("La matriz contiene probabilidades negativas.");

  for (const row of result.marketComparison || []) {
    const probability = number(row.modelProbabilityPct);
    const odds = number(row.decimalOdds);
    const ev = number(row.expectedValuePct);
    if (probability !== null && odds !== null && ev !== null) {
      const expected = round(probability / 100 * odds * 100 - 100, 1);
      if (Math.abs(expected - ev) > 0.2) errors.push(`EV incoherente en ${row.selectionKey || row.selection}: ${ev} vs ${expected}.`);
    }
  }

  errors.push(...walkNumbers(result));
  errors.push(...validateFixtureDates(result, input.fixtureDate || result.fixtureDate));
  if (result.context?.mode !== "rule_based") warnings.push("Modo contextual no reconocido por la validación actual.");
  return {
    status: errors.length ? "failed" : warnings.length ? "passed_with_warnings" : "passed",
    errors,
    warnings,
    checks: {
      probabilitiesInRange: !errors.some((item) => /1X2|Probabilidades/.test(item)),
      oneXTwoSumPct: total,
      matrixProbabilitySum: matrix.length ? matrixSum : null,
      marketRowsChecked: result.marketComparison?.length || 0,
      noFutureFixtures: !errors.some((item) => /Fixture posterior/.test(item)),
      noNaNOrInfinity: !errors.some((item) => /finito/.test(item))
    }
  };
}
