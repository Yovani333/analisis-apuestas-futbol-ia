const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const METRIC_DEFINITIONS = Object.freeze([
  { key: "shots", label: "Remates", apiNames: ["Total Shots"] },
  { key: "shotsOnGoal", label: "Remates al arco", apiNames: ["Shots on Goal"] },
  { key: "possession", label: "Posesion", apiNames: ["Ball Possession"], suffix: "%" },
  { key: "passes", label: "Pases", apiNames: ["Total passes", "Passes"] },
  { key: "passAccuracy", label: "Precision de pases", apiNames: ["Passes %"], suffix: "%" },
  { key: "fouls", label: "Faltas", apiNames: ["Fouls"] },
  { key: "yellowCards", label: "Tarjetas amarillas", apiNames: ["Yellow Cards"] },
  { key: "redCards", label: "Tarjetas rojas", apiNames: ["Red Cards"] },
  { key: "offsides", label: "Fuera de lugar", apiNames: ["Offsides"] },
  { key: "corners", label: "Tiros de esquina", apiNames: ["Corner Kicks"] }
]);

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const number = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const fixtureTime = (row) => Date.parse(row?.fixture?.date || "") || 0;

function selectHistoryFixtures(rows = [], cutoffDate, limit) {
  const cutoff = Date.parse(cutoffDate || "");
  return rows
    .filter((row) => FINISHED_STATUSES.has(row?.fixture?.status?.short))
    .filter((row) => !Number.isFinite(cutoff) || fixtureTime(row) < cutoff)
    .sort((a, b) => fixtureTime(b) - fixtureTime(a))
    .slice(0, limit);
}

function statValue(statistics = [], teamId, definition) {
  const teamRow = statistics.find((row) => String(row?.team?.id) === String(teamId));
  const rows = teamRow?.statistics || [];
  for (const name of definition.apiNames) {
    const found = rows.find((item) => String(item?.type || "").toLowerCase() === name.toLowerCase());
    const value = number(found?.value);
    if (value !== null) return value;
  }
  return null;
}

async function teamAverages(team, cutoffDate, windowSize, dependencies) {
  const previous = await dependencies.getPreviousFixtures(team.id, Math.max(10, windowSize));
  const selected = selectHistoryFixtures(previous, cutoffDate, windowSize);
  const fixtureStats = await Promise.all(selected.map(async (row) => {
    const fixtureId = String(row.fixture.id);
    const statistics = await dependencies.getFixtureStatistics(fixtureId).catch(() => []);
    return { row, fixtureId, statistics };
  }));
  const useful = fixtureStats.filter((item) => item.statistics.some((row) => String(row?.team?.id) === String(team.id)));
  const totals = Object.fromEntries(METRIC_DEFINITIONS.map((metric) => [metric.key, 0]));
  const availability = Object.fromEntries(METRIC_DEFINITIONS.map((metric) => [metric.key, 0]));
  for (const item of useful) {
    for (const metric of METRIC_DEFINITIONS) {
      const value = statValue(item.statistics, team.id, metric);
      if (value !== null) {
        totals[metric.key] += value;
        availability[metric.key] += 1;
      }
    }
  }
  const metrics = Object.fromEntries(METRIC_DEFINITIONS.map((metric) => [
    metric.key,
    useful.length ? round(totals[metric.key] / useful.length) : null
  ]));
  const missing = METRIC_DEFINITIONS.filter((metric) => availability[metric.key] === 0).map((metric) => metric.label);
  return {
    id: String(team.id),
    name: team.name,
    metrics,
    fixturesUsed: useful.map((item) => ({
      fixtureId: item.fixtureId,
      date: item.row.fixture?.date || "",
      home: item.row.teams?.home?.name || "",
      away: item.row.teams?.away?.name || ""
    })),
    matchesFound: selected.length,
    matchesWithStatistics: useful.length,
    missing
  };
}

export async function getTeamHistoricalStats({ team, cutoffDate = "", windowSize = 5 }, dependencies) {
  const normalizedWindow = [5, 10].includes(Number(windowSize)) ? Number(windowSize) : 5;
  if (!team?.id) {
    return { status: "not_available", message: "El equipo no tiene ID de API-Football.", windowSize: normalizedWindow };
  }
  const summary = await teamAverages(team, cutoffDate, normalizedWindow, dependencies);
  const missingLabels = new Set(summary.missing || []);
  const displayMetrics = Object.fromEntries(METRIC_DEFINITIONS.map((metric) => [
    metric.key,
    missingLabels.has(metric.label) ? null : summary.metrics?.[metric.key] ?? null
  ]));
  const displaySummary = { ...summary, metrics: displayMetrics };
  const availableMetrics = Object.values(displayMetrics).filter((value) => value !== null).length;
  return {
    status: availableMetrics >= 6 ? "available" : availableMetrics > 0 ? "partial" : "not_available",
    source: "API-Football + cache interna",
    modelVersion: "favorite-team-overview-v1",
    windowSize: normalizedWindow,
    team: displaySummary,
    generatedAt: new Date().toISOString(),
    message: summary.matchesWithStatistics
      ? "Promedios calculados con partidos oficiales finalizados."
      : "API-Football no devolvio estadisticas historicas suficientes para este equipo."
  };
}

function metricRows(teamA, teamB) {
  return METRIC_DEFINITIONS.map((metric) => {
    const a = teamA.metrics[metric.key];
    const b = teamB.metrics[metric.key];
    const difference = a !== null && b !== null ? round(a - b) : null;
    const advantage = difference === null ? "No disponible" : Math.abs(difference) < 0.01 ? "Parejo" : difference > 0 ? teamA.name : teamB.name;
    const quality = [a, b].every((value) => value !== null) ? "available" : "partial";
    return {
      key: metric.key,
      label: metric.label,
      suffix: metric.suffix || "",
      teamA: a,
      teamB: b,
      difference,
      advantage,
      quality
    };
  });
}

export async function compareTeamsWithHistoricalStats({ teamA, teamB, fixtureDate = "", windowSize = 5, competition = "" }, dependencies) {
  const normalizedWindow = [5, 10].includes(Number(windowSize)) ? Number(windowSize) : 5;
  if (!teamA?.id || !teamB?.id) {
    return {
      status: "not_available",
      message: "Selecciona dos equipos con ID de API-Football o usa un encuentro seleccionado.",
      windowSize: normalizedWindow,
      metrics: []
    };
  }
  const [a, b] = await Promise.all([
    teamAverages(teamA, fixtureDate, normalizedWindow, dependencies),
    teamAverages(teamB, fixtureDate, normalizedWindow, dependencies)
  ]);
  const rows = metricRows(a, b);
  const completeRows = rows.filter((row) => row.quality === "available").length;
  const status = completeRows >= 7 ? "available" : completeRows > 0 ? "partial" : "not_available";
  const warnings = [];
  if (a.matchesWithStatistics < normalizedWindow || b.matchesWithStatistics < normalizedWindow) warnings.push("Muestra incompleta: API-Football no devolvio estadisticas para todos los partidos seleccionados.");
  if (competition) warnings.push("Se priorizan partidos historicos del equipo. Si no pertenecen a la misma competicion, interpretar con cautela.");
  return {
    status,
    source: "API-Football + cache interna",
    modelVersion: "team-comparator-v1",
    competition,
    windowSize: normalizedWindow,
    teamA: a,
    teamB: b,
    metrics: rows,
    warnings,
    generatedAt: new Date().toISOString()
  };
}
