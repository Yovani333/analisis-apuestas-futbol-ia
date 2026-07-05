const ORIGIN = "team_average_performance";
const SOURCE_LABEL = "Rendimiento promedio por equipo";
export const TEAM_PERFORMANCE_PICK_WEIGHTS = Object.freeze({
  shots: 0.35,
  accuratePasses: 0.30,
  discipline: 0.15,
  tacklesContext: 0.10,
  sampleQuality: 0.10
});

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value).trim().replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function teamInput(team) {
  const metrics = team?.metricas || {};
  const coverage = team?.metricCoverage || {};
  const read = (key) => coverage[key] === false ? null : numberOrNull(metrics[key]);
  return {
    name: String(team?.nombre || "").trim(),
    players: numberOrNull(team?.jugadores),
    shots: read("tiros"),
    passes: read("pases_acertados"),
    cards: read("tarjetas"),
    fouls: read("faltas"),
    tackles: read("entradas")
  };
}

function sampleQuality(players) {
  if (players >= 24) return "acceptable";
  if (players >= 20) return "medium";
  return "weak";
}

function differenceLevel(value, medium, strong) {
  if (value >= strong) return "strong";
  if (value >= medium) return "medium";
  if (value > 0) return "low";
  return "none";
}

function signalScore(difference, medium, strong) {
  if (difference >= strong) return 100;
  if (difference >= medium) return 70;
  if (difference > 0) return 40;
  if (difference > -medium) return 20;
  return 0;
}

function findOdds(odds, selectionKey) {
  return (Array.isArray(odds) ? odds : []).find((item) => item.selectionKey === selectionKey) || null;
}

function confidenceLabel({ bothStrong, oneStrong, color }) {
  if (color === "red") return "Baja";
  if (bothStrong) return "Alta";
  if (oneStrong) return "Media-alta";
  return "Media";
}

function evaluateSide({ match, side, team, opponent, odds, now }) {
  const mainFields = [team.shots, team.passes, opponent.shots, opponent.passes];
  if (!match.id || !match.home || !match.away || !team.name || !opponent.name || mainFields.some((value) => value === null)) return [];

  const shotsDiff = Number((team.shots - opponent.shots).toFixed(2));
  const passesDiff = Number((team.passes - opponent.passes).toFixed(2));
  const shotsLevel = differenceLevel(shotsDiff, 0.05, 0.10);
  const passesLevel = differenceLevel(passesDiff, 1.5, 3.0);
  const shotsMedium = ["medium", "strong"].includes(shotsLevel);
  const passesMedium = ["medium", "strong"].includes(passesLevel);
  const shotsStrong = shotsLevel === "strong";
  const passesStrong = passesLevel === "strong";
  const bothStrong = shotsStrong && passesStrong;
  const oneStrong = shotsStrong || passesStrong;
  const contradictory = (shotsMedium && passesDiff <= -1.5) || (passesMedium && shotsDiff <= -0.05);
  if (contradictory || team.players === null) return [];

  const cardsAvailable = team.cards !== null && opponent.cards !== null;
  const foulsAvailable = team.fouls !== null && opponent.fouls !== null;
  const disciplineAvailable = cardsAvailable && foulsAvailable;
  const cardsExcess = cardsAvailable ? team.cards - opponent.cards : null;
  const foulsExcess = foulsAvailable ? team.fouls - opponent.fouls : null;
  const disciplineAcceptable = disciplineAvailable && cardsExcess <= 0.03 && foulsExcess <= 0.07;
  const disciplineNegative = !disciplineAvailable || cardsExcess > 0.08 || foulsExcess > 0.15;
  const sample = sampleQuality(team.players);
  const bothDominant = shotsMedium && passesMedium;
  const reasonableAdvantage = shotsDiff > 0 && (shotsMedium || passesMedium) && passesDiff > -1.5;

  const disciplineScore = disciplineAcceptable ? 100 : disciplineNegative ? 0 : 50;
  const sampleScore = sample === "acceptable" ? 100 : sample === "medium" ? 60 : 20;
  const tackleContext = team.tackles === null || opponent.tackles === null ? 50 : team.tackles >= opponent.tackles ? 60 : 40;
  const weightedScore = Math.round(
    signalScore(shotsDiff, 0.05, 0.10) * TEAM_PERFORMANCE_PICK_WEIGHTS.shots
    + signalScore(passesDiff, 1.5, 3.0) * TEAM_PERFORMANCE_PICK_WEIGHTS.accuratePasses
    + disciplineScore * TEAM_PERFORMANCE_PICK_WEIGHTS.discipline
    + tackleContext * TEAM_PERFORMANCE_PICK_WEIGHTS.tacklesContext
    + sampleScore * TEAM_PERFORMANCE_PICK_WEIGHTS.sampleQuality
  );
  const color = bothDominant && disciplineAcceptable && sample === "acceptable"
    ? "green" : disciplineNegative || sample === "weak" ? "red" : "orange";
  const confidence = confidenceLabel({ bothStrong, oneStrong, color });
  const reasons = [
    `${team.name} supera a ${opponent.name} en tiros por ${shotsDiff.toFixed(2)}`,
    passesDiff > 0 ? `y en pases acertados por ${passesDiff.toFixed(2)} puntos` : "sin ventaja clara en pases",
    disciplineAcceptable ? "con disciplina aceptable" : disciplineNegative ? "con riesgo disciplinario alto" : "con disciplina que requiere revisión",
    `muestra ${sample === "acceptable" ? "aceptable" : sample === "medium" ? "media" : "débil"} de ${team.players} jugadores`
  ];
  const base = (market, selection, marketKey, selectionKey, explanation, classification = {}) => {
    const price = findOdds(odds, selectionKey);
    const pickColor = classification.color || color;
    const pickConfidence = classification.confidence || confidence;
    return {
      fixtureId: String(match.id), matchId: String(match.id), homeTeam: match.home, awayTeam: match.away,
      teamName: team.name, opponentName: opponent.name, side, market, selection,
      marketKey, selectionKey, confidence: pickConfidence, confidenceScore: weightedScore, color: pickColor,
      explanation, origin: ORIGIN, sourceModule: ORIGIN, sourceLabel: SOURCE_LABEL,
      odds: price?.decimalOdds ?? null, bookmaker: price?.bookmaker || "", createdAt: now,
      canAdd: pickColor !== "red", requiresReview: pickColor !== "green",
      supportingData: reasons, contradictingData: [
        !disciplineAcceptable ? "Disciplina sin validación completa" : "",
        sample !== "acceptable" ? `Calidad de muestra ${sample}` : ""
      ].filter(Boolean),
      diagnostics: { shotsDiff, passesDiff, shotsLevel, passesLevel, disciplineAcceptable, sample, weightedScore, ...classification.diagnostics }
    };
  };

  const candidates = [];
  const doubleChanceKey = side === "home" ? "1X" : "X2";
  const teamGoalKey = side === "home" ? "home_over_0_5" : "away_over_0_5";
  const winKey = side === "home" ? "home_win" : "away_win";
  const dnbKey = side === "home" ? "home_dnb" : "away_dnb";

  const strongLayerEligible = reasonableAdvantage && !(sample === "weak" && !bothStrong) && (shotsMedium || passesMedium);
  if (strongLayerEligible) {
    if (bothDominant && disciplineAcceptable && sample !== "weak") {
      candidates.push(base("Empate no apuesta (DNB)", `${team.name} DNB`, "draw_no_bet", dnbKey,
        `${reasons.slice(0, 3).join(" ")}. DNB reduce el riesgo de un empate.`));
    } else if (bothDominant) {
      candidates.push(base("Doble oportunidad", side === "home" ? `${team.name} o empate (1X)` : `Empate o ${team.name} (X2)`, "double_chance", doubleChanceKey,
        `${team.name} presenta ventaja estadística razonable, pero no suficiente para recomendar ganador directo.`));
    }

    if (shotsStrong || (shotsMedium && passesMedium)) {
      candidates.push(base(`Goles de ${team.name}`, `${team.name} más de 0.5 goles`, side === "home" ? "home_team_goals" : "away_team_goals", teamGoalKey,
        `${team.name} muestra mayor volumen ofensivo reciente que ${opponent.name}; los pases ${passesDiff > 0 ? "respaldan" : "no confirman por completo"} la señal.`));
    }

    if (bothStrong && disciplineAcceptable && sample === "acceptable") {
      candidates.push(base("Resultado 1X2", `${team.name} gana`, "match_winner", winKey,
        `${team.name} domina con diferencia fuerte tiros y pases, mantiene disciplina aceptable y cuenta con muestra suficiente.`));
    }
  }

  if (candidates.length) return candidates.slice(0, 2);

  const moderateSignals = {
    shotsAdvantage: shotsDiff >= 0.04,
    passesAdvantage: passesDiff >= 0.75,
    fewerFouls: foulsAvailable && foulsExcess < 0,
    cardsFavorable: cardsAvailable && cardsExcess <= 0.03,
    betterSample: team.players > opponent.players,
    opponentOnlyTackles: team.tackles !== null && opponent.tackles !== null && team.tackles < opponent.tackles && shotsDiff >= 0 && passesDiff >= 0
  };
  const moderateSignalCount = Object.values(moderateSignals).filter(Boolean).length;
  const moderateEligible = moderateSignalCount >= 4 && sample !== "weak"
    && (moderateSignals.shotsAdvantage || moderateSignals.passesAdvantage)
    && shotsDiff >= 0 && passesDiff >= 0;
  if (!moderateEligible) return [];

  const diagnostic = {
    mode: "moderate_composite_advantage",
    result: "ventaja compuesta moderada → pick naranja",
    signalCount: moderateSignalCount,
    signals: moderateSignals,
    discipline: moderateSignals.fewerFouls && moderateSignals.cardsFavorable ? "favorable" : "aceptable",
    tackles: moderateSignals.opponentOnlyTackles ? "desfavorable; solo contexto" : "neutral",
    sampleComparison: moderateSignals.betterSample ? "favorable" : "neutral"
  };
  const moderateReasons = [
    moderateSignals.shotsAdvantage ? "ventaja moderada en tiros" : "tiros sin desventaja",
    moderateSignals.passesAdvantage ? "ventaja leve en pases acertados" : "pases sin desventaja",
    moderateSignals.fewerFouls && moderateSignals.cardsFavorable ? "mejor disciplina" : moderateSignals.cardsFavorable ? "tarjetas dentro de un margen aceptable" : "disciplina sin ventaja",
    moderateSignals.betterSample ? "mejor muestra reciente" : "muestra suficiente"
  ];
  const tacklesNote = moderateSignals.opponentOnlyTackles ? `, aunque ${opponent.name} domina entradas` : "";
  candidates.push(base("Doble oportunidad", side === "home" ? `${team.name} o empate (1X)` : `Empate o ${team.name} (X2)`, "double_chance", doubleChanceKey,
    `${team.name} presenta ${moderateReasons.join(", ")}${tacklesNote}.`,
    { color: "orange", confidence: "Media-alta", diagnostics: diagnostic }));
  if (moderateSignals.shotsAdvantage) {
    candidates.push(base(`Goles de ${team.name}`, `${team.name} más de 0.5 goles`, side === "home" ? "home_team_goals" : "away_team_goals", teamGoalKey,
      `${team.name} muestra ventaja ofensiva moderada${moderateSignals.passesAdvantage ? " y mejor control reciente" : " con apoyo parcial en control"}, pero la diferencia no es suficiente para pick fuerte.`,
      { color: "orange", confidence: "Media", diagnostics: diagnostic }));
  }

  return candidates.slice(0, 2);
}

export function buildTeamPerformancePicks(match, homeTeamStats, awayTeamStats, {
  odds = [],
  now = new Date().toISOString()
} = {}) {
  const normalizedMatch = {
    id: String(match?.id || match?.fixtureId || match?.matchId || ""),
    home: String(match?.home || homeTeamStats?.nombre || "").trim(),
    away: String(match?.away || awayTeamStats?.nombre || "").trim()
  };
  const home = teamInput(homeTeamStats);
  const away = teamInput(awayTeamStats);
  return {
    home: evaluateSide({ match: normalizedMatch, side: "home", team: home, opponent: away, odds, now }),
    away: evaluateSide({ match: normalizedMatch, side: "away", team: away, opponent: home, odds, now }),
    match: []
  };
}
