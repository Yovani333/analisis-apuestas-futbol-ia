const FINISHED = new Set(["FT", "AET", "PEN"]);

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sameTeams(row, fixture) {
  const ids = new Set([String(row?.teams?.home?.id || ""), String(row?.teams?.away?.id || "")]);
  return ids.has(String(fixture.homeTeamId)) && ids.has(String(fixture.awayTeamId));
}

function scoreForCurrentSides(row, fixture) {
  const currentHomeWasHome = String(row?.teams?.home?.id) === String(fixture.homeTeamId);
  return {
    home: currentHomeWasHome ? row?.goals?.home ?? null : row?.goals?.away ?? null,
    away: currentHomeWasHome ? row?.goals?.away ?? null : row?.goals?.home ?? null
  };
}

export function buildCompetitionContext(fixture = {}, previousFixtures = []) {
  const cup = ["cup", "qualifying"].includes(fixture.competitionType) || fixture.isKnockoutRound;
  if (!cup) return {
    type: "regular_league",
    round: fixture.round || "No disponible",
    leg: "not_applicable",
    scope: "regular_time_90_minutes",
    aggregateScore: null,
    warnings: []
  };

  const cutoff = timestamp(fixture.utcDateTime);
  const previousLeg = previousFixtures
    .filter((row) => FINISHED.has(row?.fixture?.status?.short))
    .filter((row) => timestamp(row?.fixture?.date) < cutoff)
    .filter((row) => Number(row?.league?.id) === Number(fixture.leagueId))
    .filter((row) => Number(row?.league?.season) === Number(fixture.season))
    .filter((row) => sameTeams(row, fixture))
    .filter((row) => !fixture.round || !row?.league?.round || row.league.round === fixture.round)
    .sort((a, b) => timestamp(b.fixture?.date) - timestamp(a.fixture?.date))[0] || null;

  const previousScore = previousLeg ? scoreForCurrentSides(previousLeg, fixture) : null;
  const currentScore = fixture.score || {};
  const currentPlayed = Number.isFinite(Number(currentScore.home)) && Number.isFinite(Number(currentScore.away));
  const aggregateScore = previousScore && currentPlayed ? {
    home: Number(previousScore.home || 0) + Number(currentScore.home || 0),
    away: Number(previousScore.away || 0) + Number(currentScore.away || 0)
  } : previousScore;
  const warnings = [];
  if (!previousLeg) warnings.push("No se confirmó un partido de ida anterior; puede ser ida o encuentro único.");
  warnings.push("Resultado 1X2 corresponde a 90 minutos; clasificación, prórroga y penales son contextos separados.");

  return {
    type: fixture.competitionType === "qualifying" ? "qualifying_knockout" : "cup_knockout",
    round: fixture.round || "No disponible",
    leg: previousLeg ? "second_leg" : "first_or_single_unconfirmed",
    previousFixtureId: previousLeg ? String(previousLeg.fixture.id) : "",
    previousLegScore: previousScore,
    aggregateScore,
    extraTimePossible: true,
    penaltiesPossible: true,
    scope: "regular_time_90_minutes",
    warnings
  };
}
