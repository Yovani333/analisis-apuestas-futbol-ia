const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const asDecimal = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 1 ? number : null;
};

function teamScore(row, teamId) {
  const isHome = row.teams?.home?.id === teamId;
  return {
    isHome,
    goalsFor: Number(isHome ? row.goals?.home : row.goals?.away) || 0,
    goalsAgainst: Number(isHome ? row.goals?.away : row.goals?.home) || 0,
    opponent: isHome ? row.teams?.away?.name : row.teams?.home?.name
  };
}

export function summarizeRecentFixtures(rows = [], teamId, fixtureDate) {
  const fixtureTime = Date.parse(fixtureDate);
  const matches = rows
    .filter((row) => FINISHED_STATUSES.has(row.fixture?.status?.short) && Date.parse(row.fixture?.date) < fixtureTime)
    .sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date))
    .slice(0, 5)
    .map((row) => {
      const score = teamScore(row, teamId);
      const result = score.goalsFor > score.goalsAgainst ? "W" : score.goalsFor < score.goalsAgainst ? "L" : "D";
      return {
        fixtureId: row.fixture.id,
        date: row.fixture.date.slice(0, 10),
        opponent: score.opponent || "No disponible",
        venue: score.isHome ? "Local" : "Visitante",
        goalsFor: score.goalsFor,
        goalsAgainst: score.goalsAgainst,
        result,
        over25: score.goalsFor + score.goalsAgainst > 2.5,
        btts: score.goalsFor > 0 && score.goalsAgainst > 0
      };
    });

  const played = matches.length;
  const sum = (key) => matches.reduce((total, match) => total + Number(match[key] || 0), 0);
  const wins = matches.filter((match) => match.result === "W").length;
  const draws = matches.filter((match) => match.result === "D").length;
  const losses = matches.filter((match) => match.result === "L").length;
  const lastMatchTime = matches[0] ? Date.parse(`${matches[0].date}T00:00:00Z`) : null;
  const restDays = lastMatchTime ? Math.max(0, Math.floor((fixtureTime - lastMatchTime) / 86400000)) : null;
  const homeMatches = matches.filter((match) => match.venue === "Local");
  const awayMatches = matches.filter((match) => match.venue === "Visitante");
  const venueRate = (venueMatches, predicate) => venueMatches.length ? round(venueMatches.filter(predicate).length / venueMatches.length * 100, 1) : null;

  return {
    played, wins, draws, losses,
    form: matches.map((match) => match.result).join(""),
    goalsFor: sum("goalsFor"),
    goalsAgainst: sum("goalsAgainst"),
    avgGoalsFor: played ? round(sum("goalsFor") / played) : null,
    avgGoalsAgainst: played ? round(sum("goalsAgainst") / played) : null,
    over25Rate: played ? round(matches.filter((match) => match.over25).length / played * 100, 1) : null,
    bttsRate: played ? round(matches.filter((match) => match.btts).length / played * 100, 1) : null,
    nonLossRate: played ? round((wins + draws) / played * 100, 1) : null,
    winRate: played ? round(wins / played * 100, 1) : null,
    homePlayed: homeMatches.length,
    homeWinRate: venueRate(homeMatches, (match) => match.result === "W"),
    homeNonLossRate: venueRate(homeMatches, (match) => match.result !== "L"),
    awayPlayed: awayMatches.length,
    awayWinRate: venueRate(awayMatches, (match) => match.result === "W"),
    awayNonLossRate: venueRate(awayMatches, (match) => match.result !== "L"),
    restDays,
    matches
  };
}

function normalizedName(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findBet(bookmaker, pattern) {
  return bookmaker?.bets?.find((bet) => pattern.test(normalizedName(bet.name)));
}

function findOdd(bet, patterns) {
  const value = bet?.values?.find((item) => patterns.some((pattern) => pattern.test(normalizedName(item.value))));
  return asDecimal(value?.odd);
}

function escapedPattern(value = "") {
  const normalized = normalizedName(value);
  return normalized ? new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) : null;
}

export function normalizeOdds(rows = [], teams = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const bookmakers = safeRows.flatMap((row) => {
    if (Array.isArray(row?.bookmakers)) return row.bookmakers;
    if (!Array.isArray(row?.odds)) return [];
    return [{
      id: null,
      name: "API-Football Live",
      bets: row.odds.map((odd) => ({ id: odd.id, name: odd.name, values: odd.values || [] }))
    }];
  });
  const preference = (item) => /caliente/.test(normalizedName(item?.name)) ? 0 : /playdoit/.test(normalizedName(item?.name)) ? 1 : 2;
  const orderedBookmakers = [...bookmakers].sort((a, b) => preference(a) - preference(b));
  if (!orderedBookmakers.length) return { bookmaker: null, updatedAt: rows[0]?.update || null, selections: [] };
  const homeLabel = teams.homeName ? `${teams.homeName} o empate (1X)` : "Equipo 1 o empate (1X)";
  const awayLabel = teams.awayName ? `Empate o ${teams.awayName} (X2)` : "Empate o equipo 2 (X2)";
  const homeNamePattern = escapedPattern(teams.homeName);
  const awayNamePattern = escapedPattern(teams.awayName);
  const definitions = [
    ["match_winner", "home_win", "Resultado 1X2", teams.homeName || "Equipo 1 gana", /^(match winner|1x2)$/, [/^home$/, /^1$/, homeNamePattern].filter(Boolean)],
    ["match_winner", "draw", "Resultado 1X2", "Empate", /^(match winner|1x2)$/, [/^draw$/, /^x$/]],
    ["match_winner", "away_win", "Resultado 1X2", teams.awayName || "Equipo 2 gana", /^(match winner|1x2)$/, [/^away$/, /^2$/, awayNamePattern].filter(Boolean)],
    ["draw_no_bet", "home_dnb", "Empate no apuesta (DNB)", `${teams.homeName || "Equipo 1"} DNB`, /^(draw no bet|dnb)$/, [/^home$/, /^1$/, homeNamePattern].filter(Boolean)],
    ["draw_no_bet", "away_dnb", "Empate no apuesta (DNB)", `${teams.awayName || "Equipo 2"} DNB`, /^(draw no bet|dnb)$/, [/^away$/, /^2$/, awayNamePattern].filter(Boolean)],
    ["double_chance", "1X", "Doble oportunidad", homeLabel, /^double chance$/, [/home draw/, /^1x$/, /local empate/]],
    ["double_chance", "X2", "Doble oportunidad", awayLabel, /^double chance$/, [/draw away/, /^x2$/, /empate visitante/]],
    ["double_chance", "12", "Doble oportunidad", `${teams.homeName || "Equipo 1"} o ${teams.awayName || "Equipo 2"} (12)`, /^double chance$/, [/home away/, /^12$/, /local visitante/]],
    ["over_under_1_5", "over_1_5", "Total de goles 1.5", "Más de 1.5 goles", /^(goals over under|over under|total goals)$/, [/^over 1 5$/, /^mas de 1 5$/]],
    ["over_under_2_5", "over_2_5", "Total de goles 2.5", "Más de 2.5 goles", /^(goals over under|over under|total goals)$/, [/^over 2 5$/, /^mas de 2 5$/]],
    ["over_under_2_5", "under_2_5", "Total de goles 2.5", "Menos de 2.5 goles", /^(goals over under|over under|total goals)$/, [/^under 2 5$/, /^menos de 2 5$/]],
    ["over_under_3_5", "under_3_5", "Total de goles 3.5", "Menos de 3.5 goles", /^(goals over under|over under|total goals)$/, [/^under 3 5$/, /^menos de 3 5$/]],
    ["btts", "btts_yes", "Ambos equipos anotan", "Sí", /^(both teams.*score|both teams to score)$/, [/^yes$/, /^si$/]],
    ["btts", "btts_no", "Ambos equipos anotan", "No", /^(both teams.*score|both teams to score)$/, [/^no$/]],
    ["home_team_goals", "home_over_0_5", `Goles de ${teams.homeName || "Equipo 1"}`, `${teams.homeName || "Equipo 1"} más de 0.5`, /^(home team total goals|home goals over under|team total.*home)$/, [/^over 0 5$/]],
    ["home_team_goals", "home_over_1_5", `Goles de ${teams.homeName || "Equipo 1"}`, `${teams.homeName || "Equipo 1"} más de 1.5`, /^(home team total goals|home goals over under|team total.*home)$/, [/^over 1 5$/]],
    ["away_team_goals", "away_over_0_5", `Goles de ${teams.awayName || "Equipo 2"}`, `${teams.awayName || "Equipo 2"} más de 0.5`, /^(away team total goals|away goals over under|team total.*away)$/, [/^over 0 5$/]],
    ["away_team_goals", "away_over_1_5", `Goles de ${teams.awayName || "Equipo 2"}`, `${teams.awayName || "Equipo 2"} más de 1.5`, /^(away team total goals|away goals over under|team total.*away)$/, [/^over 1 5$/]]
  ];
  const selections = definitions.flatMap(([marketKey, selectionKey, market, selection, betPattern, valuePatterns]) => {
    for (const bookmaker of orderedBookmakers) {
      const decimalOdds = findOdd(findBet(bookmaker, betPattern), valuePatterns);
      if (!decimalOdds) continue;
      const preferred = preference(bookmaker) < 2;
      return [{ marketKey, selectionKey, market, selection, decimalOdds,
        bookmaker: bookmaker.name || "No disponible", bookmakerId: bookmaker.id ?? null,
        sourceProvider: "api-football", status: preferred ? "available" : "fallback", isPreferredBookmaker: preferred,
        oddsFreshnessStatus: safeRows[0]?.update ? "available" : "unknown", updatedAt: safeRows[0]?.update || null }];
    }
    return [];
  });
  const usedBookmakers = [...new Set(selections.map((item) => item.bookmaker))];
  const preferred = selections.some((item) => item.isPreferredBookmaker);
  return { bookmaker: usedBookmakers.length === 1 ? usedBookmakers[0] : usedBookmakers.length ? "Múltiples casas" : null, bookmakerId: null, preferred,
    warning: selections.length && !preferred ? "Las casas preferidas no están disponibles en el proveedor actual. Se usaron cuotas alternativas verificadas por mercado." : "",
    updatedAt: safeRows[0]?.update || null, selections };
}

function smoothedRate(successes, trials) {
  // Prior conservador equivalente a seis partidos al 50% para reducir extremos en muestras pequeñas.
  return (successes + 3) / (trials + 6);
}

export function calculateMarketAnalysis(homeForm, awayForm, oddsSummary) {
  const combinedPlayed = homeForm.played + awayForm.played;
  if (!combinedPlayed) return [];
  const homeAllMatches = homeForm.matches || [];
  const awayAllMatches = awayForm.matches || [];
  const homeMatches = homeAllMatches.filter((match) => match.venue === "Local");
  const awayMatches = awayAllMatches.filter((match) => match.venue === "Visitante");
  const homeRelevant = homeMatches.length >= 2 ? homeMatches : homeAllMatches;
  const awayRelevant = awayMatches.length >= 2 ? awayMatches : awayAllMatches;
  const allMatches = [...homeAllMatches, ...awayAllMatches];
  const overProbability = smoothedRate(allMatches.filter((match) => match.over25).length, allMatches.length);
  const bttsProbability = smoothedRate(allMatches.filter((match) => match.btts).length, allMatches.length);
  const venueTrials = homeRelevant.length + awayRelevant.length;
  const homeNonLoss = smoothedRate(homeRelevant.filter((match) => match.result !== "L").length + awayRelevant.filter((match) => match.result !== "W").length, venueTrials);
  const awayNonLoss = smoothedRate(awayRelevant.filter((match) => match.result !== "L").length + homeRelevant.filter((match) => match.result !== "W").length, venueTrials);
  const probabilities = {
    "1X": homeNonLoss, X2: awayNonLoss,
    over_2_5: overProbability, under_2_5: 1 - overProbability,
    btts_yes: bttsProbability, btts_no: 1 - bttsProbability
  };

  const marginByMarket = Object.fromEntries(["over_under_2_5", "btts"].map((marketKey) => {
    const selections = oddsSummary.selections.filter((item) => item.marketKey === marketKey);
    const sum = selections.reduce((total, item) => total + 1 / item.decimalOdds, 0);
    const sameBookmaker = selections.length === 2 && selections.every((item) => item.bookmaker === selections[0].bookmaker);
    return [marketKey, sameBookmaker ? sum : null];
  }));

  return oddsSummary.selections.map((selection) => {
    const probability = probabilities[selection.selectionKey];
    const implied = 1 / selection.decimalOdds;
    if (!Number.isFinite(probability)) return {
      ...selection,
      estimatedProbabilityPct: null,
      impliedProbabilityPct: round(implied * 100, 1),
      noVigImpliedProbabilityPct: null,
      bookmakerMarginPct: null,
      fairOdds: null,
      expectedValuePct: null,
      sampleSize: combinedPlayed,
      method: "Cuota normalizada desde API-Football; la probabilidad y el EV corresponden al módulo específico que la consuma.",
      positiveValue: false
    };
    const expectedValue = probability * selection.decimalOdds - 1;
    const impliedSum = marginByMarket[selection.marketKey];
    return {
      ...selection,
      estimatedProbabilityPct: round(probability * 100, 1),
      impliedProbabilityPct: round(implied * 100, 1),
      noVigImpliedProbabilityPct: impliedSum ? round(implied / impliedSum * 100, 1) : null,
      bookmakerMarginPct: impliedSum ? round((impliedSum - 1) * 100, 1) : null,
      fairOdds: round(1 / probability),
      expectedValuePct: round(expectedValue * 100, 1),
      sampleSize: combinedPlayed,
      method: "Frecuencia reciente combinada con prior conservador al 50%; muestra máxima de 5 partidos por equipo.",
      positiveValue: expectedValue >= 0.05
    };
  });
}

export function calculateDataQuality({ homeForm, awayForm, odds, standings, injuries, lineups, h2h }) {
  const components = [
    { key: "odds", label: "Cuotas principales", weight: 25, available: odds.selections.length >= 4 },
    { key: "form", label: "Forma reciente de ambos equipos", weight: 25, available: homeForm.played >= 3 && awayForm.played >= 3 },
    { key: "standings", label: "Clasificación", weight: 15, available: standings.length > 0 },
    { key: "injuries", label: "Lesiones y sanciones", weight: 10, available: injuries.length > 0 },
    { key: "lineups", label: "Alineaciones", weight: 10, available: lineups.length > 0 },
    { key: "rest", label: "Días de descanso", weight: 10, available: homeForm.restDays !== null && awayForm.restDays !== null },
    { key: "h2h", label: "Head to head", weight: 5, available: h2h.length > 0 }
  ];
  const score = components.filter((item) => item.available).reduce((total, item) => total + item.weight, 0);
  const level = score >= 75 ? "Alta" : score >= 50 ? "Media" : "Baja";
  return {
    score, level,
    canSuggest: score >= 50 && odds.selections.length > 0 && homeForm.played >= 3 && awayForm.played >= 3,
    components,
    missing: components.filter((item) => !item.available).map((item) => item.label)
  };
}

function relevantStandings(rows, teamIds) {
  return (Array.isArray(rows) ? rows : []).flatMap((entry) => entry.league?.standings || []).flat()
    .filter((row) => teamIds.includes(row.team?.id))
    .map((row) => ({ rank: row.rank, team: row.team?.name, points: row.points, group: row.group, form: row.form, played: row.all?.played, goalsFor: row.all?.goals?.for, goalsAgainst: row.all?.goals?.against }));
}

export function buildAnalysisInput(dataset) {
  const { fixture, preMatch, marketAnalysis, dataQuality, confirmed, unavailable, qualityAlerts, fetchedAt } = dataset;
  return {
    source: dataset.source,
    fetchedAt,
    fixture,
    dataQuality,
    preMatch,
    verifiedMarketCalculations: marketAnalysis,
    confirmed: {
      standings: relevantStandings(confirmed.standings, [fixture.homeTeamId, fixture.awayTeamId]),
      injuries: confirmed.injuries.slice(0, 30).map((item) => ({ team: item.team?.name, player: item.player?.name, type: item.player?.type, reason: item.player?.reason })),
      lineups: confirmed.lineups.map((item) => ({ team: item.team?.name, formation: item.formation, coach: item.coach?.name, starters: (item.startXI || []).map((entry) => entry.player?.name) })),
      h2h: confirmed.h2h.slice(0, 5).map((item) => ({ date: item.fixture?.date?.slice(0, 10), home: item.teams?.home?.name, away: item.teams?.away?.name, goalsHome: item.goals?.home, goalsAway: item.goals?.away }))
    },
    unavailable,
    qualityAlerts,
    rules: {
      allowedMarkets: ["double_chance", "over_under_2_5", "btts"],
      calculationsAreAuthoritative: true,
      doNotCreateProbabilitiesOrOdds: true,
      lowQualityBlocksParlay: true,
      dataQualityMeasuresCoverageNotPredictiveConfidence: true
    }
  };
}
