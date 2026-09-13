const RECENCY_WEIGHTS = Object.freeze([1, 0.9, 0.8, 0.7, 0.6]);
const VALID_RESULTS = new Set(["W", "D", "L"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

function normalized(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameCompetition(match, context) {
  if (context.leagueId !== null && context.leagueId !== undefined && match.competitionId !== null && match.competitionId !== undefined) {
    return String(match.competitionId) === String(context.leagueId);
  }
  const matchName = normalized(match.competition || match.leagueName);
  const contextName = normalized(context.leagueName);
  return Boolean(matchName && contextName && matchName === contextName);
}

function teamMatches(id, name, expected = {}) {
  if (id !== null && id !== undefined && expected.id !== null && expected.id !== undefined) {
    return String(id) === String(expected.id);
  }
  return Boolean(normalized(name) && normalized(name) === normalized(expected.name));
}

function regulationGoals(match, side) {
  const explicitValue = match?.[`regulation${side === "home" ? "Home" : "Away"}Goals`];
  const explicit = explicitValue === null || explicitValue === undefined || explicitValue === "" ? null : Number(explicitValue);
  if (explicit !== null && Number.isFinite(explicit) && explicit >= 0) return explicit;
  const status = String(match?.statusShort || "FT").toUpperCase();
  if (!FINISHED_STATUSES.has(status) || ["AET", "PEN"].includes(status)) return null;
  const fallbackValue = match?.[`${side}Goals`];
  const fallback = fallbackValue === null || fallbackValue === undefined || fallbackValue === "" ? null : Number(fallbackValue);
  return fallback !== null && Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
}

function opponentContext(h2hMatches, {
  side, leagueId, leagueName, currentFixtureId, currentFixtureDate, currentHomeTeam, currentAwayTeam, minimumSample
}) {
  const tracked = side === "away" ? currentAwayTeam : currentHomeTeam;
  const opponent = side === "away" ? currentHomeTeam : currentAwayTeam;
  if (!tracked || !opponent) return null;
  const expectedRole = side === "away" ? "away" : "home";
  const cutoff = Date.parse(currentFixtureDate || "");
  const seen = new Set();
  const sample = [...(Array.isArray(h2hMatches) ? h2hMatches : [])]
    .filter((match) => {
      if (!match || String(match.fixtureId || "") === String(currentFixtureId || "")) return false;
      const playedAt = Date.parse(match.date || "");
      if (!Number.isFinite(playedAt) || !Number.isFinite(cutoff) || playedAt >= cutoff) return false;
      if (!sameCompetition({ competitionId: match.leagueId, competition: match.leagueName }, { leagueId, leagueName })) return false;
      const trackedIsHome = teamMatches(match.homeTeamId, match.homeTeam, tracked);
      const trackedIsAway = teamMatches(match.awayTeamId, match.awayTeam, tracked);
      const opponentIsHome = teamMatches(match.homeTeamId, match.homeTeam, opponent);
      const opponentIsAway = teamMatches(match.awayTeamId, match.awayTeam, opponent);
      if (expectedRole === "home" ? !(trackedIsHome && opponentIsAway) : !(trackedIsAway && opponentIsHome)) return false;
      return regulationGoals(match, "home") !== null && regulationGoals(match, "away") !== null;
    })
    .sort((a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""))
    .filter((match) => {
      const key = String(match.fixtureId || `${match.date}:${match.homeTeam}:${match.awayTeam}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, RECENCY_WEIGHTS.length);
  if (sample.length < minimumSample) return null;

  const weights = sample.map((_, index) => RECENCY_WEIGHTS[index]);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let wins = 0; let draws = 0; let losses = 0;
  sample.forEach((match, index) => {
    const trackedGoals = regulationGoals(match, expectedRole);
    const opponentGoals = regulationGoals(match, expectedRole === "home" ? "away" : "home");
    if (trackedGoals > opponentGoals) wins += weights[index];
    else if (trackedGoals < opponentGoals) losses += weights[index];
    else draws += weights[index];
  });
  const winRate = wins / totalWeight;
  const drawRate = draws / totalWeight;
  const lossRate = losses / totalWeight;
  return {
    sampleSize: sample.length,
    winRate,
    drawRate,
    lossRate,
    strength: (winRate - lossRate) * (sample.length / (sample.length + 3))
  };
}

export function calculateVenueFormSignal(matches = [], {
  side = "home", leagueId = null, leagueName = "", competitionType = "league", h2hMatches = [],
  currentFixtureId = null, currentFixtureDate = "", currentHomeTeam = null, currentAwayTeam = null
} = {}) {
  const venue = side === "away" ? "Visitante" : "Local";
  const seen = new Set();
  const sample = [...matches]
    .filter((match) => match && VALID_RESULTS.has(match.result) && match.venue === venue && sameCompetition(match, { leagueId, leagueName }))
    .sort((a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""))
    .filter((match) => {
      const key = String(match.fixtureId || `${match.date}:${match.opponent}:${match.venue}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, RECENCY_WEIGHTS.length);

  const strictTournament = ["cup", "qualifying"].includes(competitionType);
  const minimumSample = strictTournament ? 4 : 3;
  if (sample.length < minimumSample) {
    return { status: "insufficient", signal: "none", sampleSize: sample.length, minimumSample, reason: `Se requieren ${minimumSample} partidos comparables en ${venue.toLowerCase()} dentro de la misma competición.` };
  }

  const weights = sample.map((_, index) => RECENCY_WEIGHTS[index]);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const weighted = (result) => sample.reduce((sum, match, index) => sum + (match.result === result ? weights[index] : 0), 0) / totalWeight;
  const venueWinRate = weighted("W");
  const venueDrawRate = weighted("D");
  const venueLossRate = weighted("L");
  const sampleReliability = sample.length / (sample.length + 3);
  const baseVenueStrength = (venueWinRate - venueLossRate) * sampleReliability;
  const h2h = opponentContext(h2hMatches, {
    side, leagueId, leagueName, currentFixtureId, currentFixtureDate,
    currentHomeTeam, currentAwayTeam, minimumSample
  });
  const venueWeight = h2h ? 0.75 : 1;
  const h2hWeight = h2h ? 0.25 : 0;
  const winRate = (venueWinRate * venueWeight) + ((h2h?.winRate || 0) * h2hWeight);
  const drawRate = (venueDrawRate * venueWeight) + ((h2h?.drawRate || 0) * h2hWeight);
  const lossRate = (venueLossRate * venueWeight) + ((h2h?.lossRate || 0) * h2hWeight);
  const venueStrength = (baseVenueStrength * venueWeight) + ((h2h?.strength || 0) * h2hWeight);
  const dominantThreshold = strictTournament ? 0.6 : 0.55;
  const oppositeLimit = strictTournament ? 0.25 : 0.3;
  const strengthThreshold = strictTournament ? 0.16 : 0.12;
  const green = winRate >= dominantThreshold && lossRate <= oppositeLimit && venueStrength >= strengthThreshold;
  const red = lossRate >= dominantThreshold && winRate <= oppositeLimit && venueStrength <= -strengthThreshold;
  const signal = green ? "positive" : red ? "negative" : "none";
  const h2hEffect = !h2h ? "not_applied"
    : Math.abs(h2h.strength) < 0.05 ? "neutral"
      : Math.sign(h2h.strength) === Math.sign(baseVenueStrength) ? "confirms" : "contradicts";

  return {
    status: signal === "none" ? "neutral" : "available",
    signal,
    sampleSize: sample.length,
    minimumSample,
    weightedWinRatePct: Number((winRate * 100).toFixed(1)),
    weightedDrawRatePct: Number((drawRate * 100).toFixed(1)),
    weightedLossRatePct: Number((lossRate * 100).toFixed(1)),
    venueWeightedWinRatePct: Number((venueWinRate * 100).toFixed(1)),
    venueWeightedDrawRatePct: Number((venueDrawRate * 100).toFixed(1)),
    venueWeightedLossRatePct: Number((venueLossRate * 100).toFixed(1)),
    venueStrength: Number(venueStrength.toFixed(3)),
    h2hApplied: Boolean(h2h),
    h2hSampleSize: h2h?.sampleSize || 0,
    h2hWeightedWinRatePct: h2h ? Number((h2h.winRate * 100).toFixed(1)) : null,
    h2hWeightedDrawRatePct: h2h ? Number((h2h.drawRate * 100).toFixed(1)) : null,
    h2hWeightedLossRatePct: h2h ? Number((h2h.lossRate * 100).toFixed(1)) : null,
    h2hEffect,
    weights: { venue: venueWeight, h2h: h2hWeight },
    competitionScope: leagueName,
    reason: signal === "positive"
      ? `Tendencia favorable como ${venue.toLowerCase()} en la misma competición.`
      : signal === "negative"
        ? `Tendencia desfavorable como ${venue.toLowerCase()} en la misma competición.`
        : "La muestra comparable no presenta dominio suficiente de victorias o derrotas."
  };
}
