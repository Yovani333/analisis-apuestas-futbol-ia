import { resolveModuleQuality } from "./module-quality.service.js";
import { competitionLabel, isSameCompetition } from "./competition-scope.service.js";

const RECENCY_WEIGHTS = [1, 0.9, 0.8, 0.7, 0.6];
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const GOAL_INTERVALS = Object.freeze([
  { key: "0_15", label: "0-15", min: 0, max: 15 },
  { key: "16_30", label: "16-30", min: 16, max: 30 },
  { key: "31_45", label: "31-45+", min: 31, max: 45 },
  { key: "46_60", label: "46-60", min: 46, max: 60 },
  { key: "61_75", label: "61-75", min: 61, max: 75 },
  { key: "76_90", label: "76-90+", min: 76, max: 90 }
]);

const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));
const fixtureIdOf = (row) => String(row?.fixture?.id ?? row?.fixtureId ?? row?.id ?? "");
const fixtureDateOf = (row) => row?.fixture?.date || row?.date || row?.utcDateTime || "";
const fixtureStatusOf = (row) => String(row?.fixture?.status?.short || row?.statusShort || row?.status || "").toUpperCase();
const leagueLabelOf = (row) => `${row?.league?.name || row?.competition || ""} ${row?.league?.type || row?.competitionType || ""}`;
const isFriendly = (row) => /friendly|amistos|exhibition/i.test(leagueLabelOf(row));

function teamName(row, teamId) {
  const id = String(teamId || "");
  if (String(row?.teams?.home?.id || "") === id) return row?.teams?.home?.name || "";
  if (String(row?.teams?.away?.id || "") === id) return row?.teams?.away?.name || "";
  return "";
}

function opponentName(row, teamId) {
  const id = String(teamId || "");
  if (String(row?.teams?.home?.id || "") === id) return row?.teams?.away?.name || "Rival";
  if (String(row?.teams?.away?.id || "") === id) return row?.teams?.home?.name || "Rival";
  return "Rival";
}

function venueFor(row, teamId) {
  const id = String(teamId || "");
  if (String(row?.teams?.home?.id || "") === id) return "Local";
  if (String(row?.teams?.away?.id || "") === id) return "Visitante";
  return "No identificado";
}

function isFinishedPrevious(row, targetDateMs, targetFixtureId) {
  const id = fixtureIdOf(row);
  const dateMs = Date.parse(fixtureDateOf(row));
  if (!id || id === String(targetFixtureId || "")) return false;
  if (!Number.isFinite(dateMs) || dateMs >= targetDateMs) return false;
  if (!FINISHED_STATUSES.has(fixtureStatusOf(row))) return false;
  if (isFriendly(row)) return false;
  return true;
}

function isGoalEvent(event) {
  const type = String(event?.type || "").toLowerCase();
  const detail = String(event?.detail || event?.comments || "").toLowerCase();
  return type === "goal" && !detail.includes("penalty shootout") && !detail.includes("shootout");
}

function eventHalf(event) {
  const elapsed = number(event?.time?.elapsed ?? event?.elapsed);
  if (elapsed === null) return null;
  if (elapsed <= 45) return "first";
  if (elapsed <= 90) return "second";
  return null;
}

function eventInterval(event) {
  const elapsed = number(event?.time?.elapsed ?? event?.elapsed);
  if (elapsed === null || elapsed > 90) return null;
  return GOAL_INTERVALS.find((interval) => elapsed >= interval.min && elapsed <= interval.max)?.key || null;
}

function selectPreviousFixtures(rows, fixture, teamId, limit = 5) {
  const targetDateMs = Date.parse(fixture?.utcDateTime || fixture?.date || fixture?.fixture?.date || "");
  if (!Number.isFinite(targetDateMs)) return [];
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isFinishedPrevious(row, targetDateMs, fixture?.id))
    .filter((row) => isSameCompetition(row, fixture))
    .sort((a, b) => Date.parse(fixtureDateOf(b)) - Date.parse(fixtureDateOf(a)))
    .filter((row) => {
      const id = fixtureIdOf(row);
      if (seen.has(id)) return false;
      seen.add(id);
      return teamName(row, teamId);
    })
    .slice(0, limit);
}

function summarizeRows(rows, teamId, eventsByFixture) {
  const fixturesUsed = [];
  let excludedNoEvents = 0;
  let weightedFirst = 0;
  let weightedSecond = 0;
  let totalWeight = 0;
  let firstGoals = 0;
  let secondGoals = 0;
  const intervalTotals = new Map(GOAL_INTERVALS.map((interval) => [interval.key, { goals: 0, weightedMatches: 0 }]));

  rows.forEach((row, index) => {
    const id = fixtureIdOf(row);
    const events = eventsByFixture.get(id) || [];
    let matchFirst = 0;
    let matchSecond = 0;
    let teamFirst = 0;
    let teamSecond = 0;
    const teamGoalIntervals = new Set();
    for (const event of events) {
      if (!isGoalEvent(event)) continue;
      const half = eventHalf(event);
      if (!half) continue;
      const isTeamGoal = String(event?.team?.id || "") === String(teamId || "");
      const interval = isTeamGoal ? eventInterval(event) : null;
      if (interval) {
        intervalTotals.get(interval).goals += 1;
        teamGoalIntervals.add(interval);
      }
      if (half === "first") {
        matchFirst += 1;
        if (isTeamGoal) teamFirst += 1;
      }
      if (half === "second") {
        matchSecond += 1;
        if (isTeamGoal) teamSecond += 1;
      }
    }
    if (!events.length) excludedNoEvents += 1;
    const weight = RECENCY_WEIGHTS[index] ?? 0.5;
    totalWeight += weight;
    teamGoalIntervals.forEach((interval) => { intervalTotals.get(interval).weightedMatches += weight; });
    if (matchFirst > 0) weightedFirst += weight;
    if (matchSecond > 0) weightedSecond += weight;
    firstGoals += matchFirst;
    secondGoals += matchSecond;
    fixturesUsed.push({
      fixtureId: id,
      date: fixtureDateOf(row)?.slice(0, 10) || "",
      opponent: opponentName(row, teamId),
      venue: venueFor(row, teamId),
      competition: row?.league?.name || row?.competition || "",
      firstHalfGoals: matchFirst,
      secondHalfGoals: matchSecond,
      teamFirstHalfGoals: teamFirst,
      teamSecondHalfGoals: teamSecond
    });
  });

  return {
    useful: rows.length,
    excludedNoEvents,
    firstHalfGoalRate: totalWeight ? round((weightedFirst / totalWeight) * 100, 0) : null,
    secondHalfGoalRate: totalWeight ? round((weightedSecond / totalWeight) * 100, 0) : null,
    firstHalfGoals: firstGoals,
    secondHalfGoals: secondGoals,
    intervals: GOAL_INTERVALS.map((interval) => ({
      key: interval.key,
      label: interval.label,
      goals: intervalTotals.get(interval.key).goals,
      weightedMatchRate: totalWeight ? round(intervalTotals.get(interval.key).weightedMatches / totalWeight * 100, 0) : null
    })),
    fixturesUsed
  };
}

function buildIntervalComparison(home, away) {
  const rows = GOAL_INTERVALS.map((interval) => {
    const homeInterval = home.intervals?.find((row) => row.key === interval.key) || {};
    const awayInterval = away.intervals?.find((row) => row.key === interval.key) || {};
    return {
      key: interval.key,
      label: interval.label,
      homeGoals: homeInterval.goals || 0,
      awayGoals: awayInterval.goals || 0,
      homeWeightedRate: homeInterval.weightedMatchRate ?? 0,
      awayWeightedRate: awayInterval.weightedMatchRate ?? 0,
      combinedSupport: round(((homeInterval.weightedMatchRate ?? 0) + (awayInterval.weightedMatchRate ?? 0)) / 2, 0)
    };
  });
  const strongest = [...rows].sort((a, b) => b.combinedSupport - a.combinedSupport || (b.homeGoals + b.awayGoals) - (a.homeGoals + a.awayGoals))[0];
  const strongestHalf = strongest?.key && strongest.combinedSupport > 0
    ? (["0_15", "16_30", "31_45"].includes(strongest.key) ? "Primera mitad" : "Segunda mitad")
    : null;
  return {
    rows,
    strongestInterval: strongest?.combinedSupport > 0 ? strongest.label : null,
    strongestSupport: strongest?.combinedSupport || 0,
    strongestHalf,
    strongestHalfSelection: strongestHalf === "Primera mitad"
      ? "Gol en el primer tiempo"
      : strongestHalf === "Segunda mitad" ? "Gol en el segundo tiempo" : null
  };
}

function buildProjection(home, away) {
  const homeFirst = number(home.firstHalfGoalRate) ?? 0;
  const awayFirst = number(away.firstHalfGoalRate) ?? 0;
  const homeSecond = number(home.secondHalfGoalRate) ?? 0;
  const awaySecond = number(away.secondHalfGoalRate) ?? 0;
  const firstHalfSupport = round((homeFirst + awayFirst) / 2, 0);
  const secondHalfSupport = round((homeSecond + awaySecond) / 2, 0);
  const difference = Math.abs(firstHalfSupport - secondHalfSupport);
  const selectedHalf = difference < 8
    ? "Sin tendencia clara"
    : firstHalfSupport > secondHalfSupport ? "Primera mitad" : "Segunda mitad";
  return {
    selectedHalf,
    firstHalfSupport,
    secondHalfSupport,
    difference,
    explanation: selectedHalf === "Sin tendencia clara"
      ? "La muestra reciente no muestra una diferencia suficientemente estable entre primera y segunda mitad."
      : `${selectedHalf} concentra mayor frecuencia ponderada de partidos con gol en la muestra reciente de ambos equipos.`
  };
}

export async function calculateGoalHalfModel(fixture = {}, dependencies = {}, options = {}) {
  const getPreviousFixtures = dependencies.getPreviousFixtures;
  const getFixtureEvents = dependencies.getFixtureEvents;
  const fixtureId = String(fixture?.id || "");
  const homeTeamId = fixture?.homeTeamId || fixture?.teams?.home?.id;
  const awayTeamId = fixture?.awayTeamId || fixture?.teams?.away?.id;
  if (typeof getPreviousFixtures !== "function" || typeof getFixtureEvents !== "function" || !fixtureId || !homeTeamId || !awayTeamId) {
    return {
      status: "not_available",
      sourceModule: "goal_half_projection",
      modelVersion: "goal-half-events-v2-same-competition",
      fixtureId,
      quality: resolveModuleQuality({ status: "not_available" }),
      warning: "Gol por mitad no disponible: faltan fixture, equipos o servicios de eventos oficiales.",
      generatedAt: new Date().toISOString()
    };
  }

  const [homeRows, awayRows] = await Promise.all([
    getPreviousFixtures(homeTeamId, options.previousLimit || 10).catch(() => []),
    getPreviousFixtures(awayTeamId, options.previousLimit || 10).catch(() => [])
  ]);
  const homeFixtures = selectPreviousFixtures(homeRows, fixture, homeTeamId, 5);
  const awayFixtures = selectPreviousFixtures(awayRows, fixture, awayTeamId, 5);
  const allFixtureIds = [...new Set([...homeFixtures, ...awayFixtures].map(fixtureIdOf).filter(Boolean))];
  const eventsByFixture = new Map(await Promise.all(allFixtureIds.map(async (id) => [
    id,
    await getFixtureEvents(id).catch(() => [])
  ])));
  const home = summarizeRows(homeFixtures, homeTeamId, eventsByFixture);
  const away = summarizeRows(awayFixtures, awayTeamId, eventsByFixture);
  home.excludedOtherCompetitions = homeRows.filter((row) => !isSameCompetition(row, fixture)).length;
  away.excludedOtherCompetitions = awayRows.filter((row) => !isSameCompetition(row, fixture)).length;
  const warnings = [];
  const minSample = Math.min(home.useful, away.useful);
  if (minSample < 3) {
    return {
      status: "not_available",
      source: "API-Football fixture events",
      sourceModule: "goal_half_projection",
      modelVersion: "goal-half-events-v2-same-competition",
      fixtureId,
      teams: { home, away },
      projection: null,
      quality: resolveModuleQuality({ status: "not_available" }),
      warning: `Gol por mitad no disponible: se requieren al menos 3 partidos previos por equipo en ${competitionLabel(fixture)} con eventos.`,
      generatedAt: new Date().toISOString()
    };
  }
  if (minSample < 5) warnings.push("Muestra menor a 5 partidos oficiales; interpretar como tendencia contextual.");
  if (home.excludedOtherCompetitions || away.excludedOtherCompetitions) warnings.push("Se excluyeron partidos de otras competiciones.");
  if (home.excludedNoEvents || away.excludedNoEvents) warnings.push("Algunos partidos no devolvieron eventos de API-Football.");
  const projection = buildProjection(home, away);
  const intervalComparison = buildIntervalComparison(home, away);
  const confidenceScore = Math.min(86, Math.max(45, 42 + minSample * 6 + projection.difference));
  const status = minSample >= 5 && projection.selectedHalf !== "Sin tendencia clara" ? "available" : "partial";
  return {
    status,
    source: "API-Football fixture events + modelo interno",
    sourceModule: "goal_half_projection",
    modelVersion: "goal-half-events-v2-same-competition",
    fixtureId,
    teams: { home, away },
    projection,
    intervalComparison,
    confidenceScore,
    quality: resolveModuleQuality({ score: confidenceScore, status, notes: warnings }),
    warnings,
    warning: warnings.join(" "),
    generatedAt: new Date().toISOString()
  };
}
