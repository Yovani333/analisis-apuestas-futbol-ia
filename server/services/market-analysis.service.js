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

export function normalizeOdds(rows = []) {
  const bookmakers = rows.flatMap((row) => row.bookmakers || []);
  const bookmaker = bookmakers.find((item) => {
    const names = (item.bets || []).map((bet) => normalizedName(bet.name)).join("|");
    return /double chance|goals over under|both teams.*score/.test(names);
  }) || bookmakers[0];
  if (!bookmaker) return { bookmaker: null, updatedAt: rows[0]?.update || null, selections: [] };

  const doubleChance = findBet(bookmaker, /double chance/);
  const totals = findBet(bookmaker, /goals over under|over under/);
  const btts = findBet(bookmaker, /both teams.*score|both teams to score/);
  const selections = [
    { marketKey: "double_chance", selectionKey: "1X", market: "Doble oportunidad", selection: "Local o empate (1X)", decimalOdds: findOdd(doubleChance, [/home draw/, /^1x$/, /local empate/]) },
    { marketKey: "double_chance", selectionKey: "X2", market: "Doble oportunidad", selection: "Empate o visitante (X2)", decimalOdds: findOdd(doubleChance, [/draw away/, /^x2$/, /empate visitante/]) },
    { marketKey: "over_under_2_5", selectionKey: "over_2_5", market: "Total de goles 2.5", selection: "Más de 2.5 goles", decimalOdds: findOdd(totals, [/over 2 5/, /mas de 2 5/]) },
    { marketKey: "over_under_2_5", selectionKey: "under_2_5", market: "Total de goles 2.5", selection: "Menos de 2.5 goles", decimalOdds: findOdd(totals, [/under 2 5/, /menos de 2 5/]) },
    { marketKey: "btts", selectionKey: "btts_yes", market: "Ambos equipos anotan", selection: "Sí", decimalOdds: findOdd(btts, [/^yes$/, /^si$/]) },
    { marketKey: "btts", selectionKey: "btts_no", market: "Ambos equipos anotan", selection: "No", decimalOdds: findOdd(btts, [/^no$/]) }
  ].filter((item) => item.decimalOdds);

  return { bookmaker: bookmaker.name || "No disponible", updatedAt: rows[0]?.update || null, selections };
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
    return [marketKey, selections.length === 2 ? sum : null];
  }));

  return oddsSummary.selections.map((selection) => {
    const probability = probabilities[selection.selectionKey];
    const implied = 1 / selection.decimalOdds;
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
  return rows.flatMap((entry) => entry.league?.standings || []).flat()
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
