import { resolveModuleQuality } from "./module-quality.service.js";

const RECENCY_WEIGHTS = [1, 0.9, 0.8, 0.7, 0.6];
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

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

function selectPreviousFixtures(rows, fixture, teamId, limit = 5) {
  const targetDateMs = Date.parse(fixture?.utcDateTime || fixture?.date || fixture?.fixture?.date || "");
  if (!Number.isFinite(targetDateMs)) return [];
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isFinishedPrevious(row, targetDateMs, fixture?.id))
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

  rows.forEach((row, index) => {
    const id = fixtureIdOf(row);
    const events = eventsByFixture.get(id) || [];
    let matchFirst = 0;
    let matchSecond = 0;
    let teamFirst = 0;
    let teamSecond = 0;
    for (const event of events) {
      if (!isGoalEvent(event)) continue;
      const half = eventHalf(event);
      if (!half) continue;
      const isTeamGoal = String(event?.team?.id || "") === String(teamId || "");
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
    fixturesUsed
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
      modelVersion: "goal-half-events-v1",
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
  const warnings = [];
  const minSample = Math.min(home.useful, away.useful);
  if (minSample < 3) {
    return {
      status: "not_available",
      source: "API-Football fixture events",
      sourceModule: "goal_half_projection",
      modelVersion: "goal-half-events-v1",
      fixtureId,
      teams: { home, away },
      projection: null,
      quality: resolveModuleQuality({ status: "not_available" }),
      warning: "Gol por mitad no disponible: se requieren al menos 3 partidos oficiales previos por equipo con eventos.",
      generatedAt: new Date().toISOString()
    };
  }
  if (minSample < 5) warnings.push("Muestra menor a 5 partidos oficiales; interpretar como tendencia contextual.");
  if (home.excludedNoEvents || away.excludedNoEvents) warnings.push("Algunos partidos no devolvieron eventos de API-Football.");
  const projection = buildProjection(home, away);
  const confidenceScore = Math.min(86, Math.max(45, 42 + minSample * 6 + projection.difference));
  const status = minSample >= 5 && projection.selectedHalf !== "Sin tendencia clara" ? "available" : "partial";
  return {
    status,
    source: "API-Football fixture events + modelo interno",
    sourceModule: "goal_half_projection",
    modelVersion: "goal-half-events-v1",
    fixtureId,
    teams: { home, away },
    projection,
    confidenceScore,
    quality: resolveModuleQuality({ score: confidenceScore, status, notes: warnings }),
    warnings,
    warning: warnings.join(" "),
    generatedAt: new Date().toISOString()
  };
}
