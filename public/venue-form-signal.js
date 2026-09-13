const RECENCY_WEIGHTS = Object.freeze([1, 0.9, 0.8, 0.7, 0.6]);
const VALID_RESULTS = new Set(["W", "D", "L"]);

function normalized(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameCompetition(match, context) {
  if (context.leagueId !== null && context.leagueId !== undefined && match.competitionId !== null && match.competitionId !== undefined) {
    return String(match.competitionId) === String(context.leagueId);
  }
  return normalized(match.competition) === normalized(context.leagueName);
}

export function calculateVenueFormSignal(matches = [], {
  side = "home", leagueId = null, leagueName = "", competitionType = "league"
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
  const winRate = weighted("W");
  const drawRate = weighted("D");
  const lossRate = weighted("L");
  const sampleReliability = sample.length / (sample.length + 3);
  const venueStrength = (winRate - lossRate) * sampleReliability;
  const dominantThreshold = strictTournament ? 0.6 : 0.55;
  const oppositeLimit = strictTournament ? 0.25 : 0.3;
  const strengthThreshold = strictTournament ? 0.16 : 0.12;
  const green = winRate >= dominantThreshold && lossRate <= oppositeLimit && venueStrength >= strengthThreshold;
  const red = lossRate >= dominantThreshold && winRate <= oppositeLimit && venueStrength <= -strengthThreshold;
  const signal = green ? "positive" : red ? "negative" : "none";

  return {
    status: signal === "none" ? "neutral" : "available",
    signal,
    sampleSize: sample.length,
    minimumSample,
    weightedWinRatePct: Number((winRate * 100).toFixed(1)),
    weightedDrawRatePct: Number((drawRate * 100).toFixed(1)),
    weightedLossRatePct: Number((lossRate * 100).toFixed(1)),
    venueStrength: Number(venueStrength.toFixed(3)),
    competitionScope: leagueName,
    reason: signal === "positive"
      ? `Tendencia favorable como ${venue.toLowerCase()} en la misma competición.`
      : signal === "negative"
        ? `Tendencia desfavorable como ${venue.toLowerCase()} en la misma competición.`
        : `La muestra comparable no presenta dominio suficiente de victorias o derrotas.`
  };
}
