import { buildShortTournamentContext } from "./short-tournament-context.service.js";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_MATCHES = 5;
const resultCache = new Map();
const pendingRequests = new Map();

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const safeNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const normalizedText = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fixtureTime = (row) => Date.parse(row?.fixture?.date || "") || 0;
const ratioPct = (part, total) => total > 0 ? round((part / total) * 100, 1) : 0;
const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number.parseFloat(String(value).replace("%", "")));

export function selectPlayerHistoryFixtures(rows = [], currentMatchDate, limit = MAX_MATCHES) {
  const cutoff = Date.parse(currentMatchDate || "");
  return rows.filter((row) => FINISHED_STATUSES.has(row?.fixture?.status?.short))
    .filter((row) => !Number.isFinite(cutoff) || fixtureTime(row) < cutoff)
    .sort((a, b) => fixtureTime(b) - fixtureTime(a)).slice(0, limit);
}

function positionPriority(position = "") {
  const value = normalizedText(position);
  if (/^(g|goalkeeper|portero)$/.test(value)) return { level: 0, goalkeeper: true };
  if (/(st|cf|centre forward|center forward|delantero centro)/.test(value)) return { level: 5 };
  if (/^(f|attacker|forward)$/.test(value) || /(lw|rw|winger|extremo|second striker)/.test(value)) return { level: 4 };
  if (/(am|cam|attacking midfielder|mediapunta|interior ofensivo)/.test(value)) return { level: 3 };
  if (/(cm|midfielder|lateral|left back|right back)/.test(value)) return { level: 2 };
  if (/^(d|defender)$/.test(value) || /(centre back|center back|defensa central)/.test(value)) return { level: 1, defender: true };
  return { level: 1 };
}

function lineupsForTeam(response = [], teamId) {
  return response.find((row) => String(row?.team?.id) === String(teamId));
}

function playersForTeam(response = [], teamId) {
  return response.find((row) => String(row?.team?.id) === String(teamId))?.players || [];
}

function eventTotals(events = [], teamId, playerId) {
  const rows = events.filter((event) => String(event?.team?.id) === String(teamId) && String(event?.player?.id) === String(playerId));
  const goals = rows.filter((event) => event.type === "Goal" && !/missed/i.test(event.detail || "")).length;
  const penaltiesScored = rows.filter((event) => event.type === "Goal" && /penalty/i.test(event.detail || "") && !/missed/i.test(event.detail || "")).length;
  const penaltiesMissed = rows.filter((event) => /missed penalty|penalty missed/i.test(`${event.type || ""} ${event.detail || ""}`)).length;
  return { goals, penaltiesScored, penaltiesMissed };
}

function absenceNames(injuries = [], teamId) {
  const ids = new Set();
  const names = new Set();
  for (const row of injuries) {
    if (teamId && row?.team?.id && String(row.team.id) !== String(teamId)) continue;
    if (row?.player?.id) ids.add(String(row.player.id));
    const name = normalizedText(row?.player?.name || row?.name);
    if (name) names.add(name);
  }
  return { ids, names };
}

function findPlayerOdd(rawOdds = [], playerName) {
  const target = normalizedText(playerName);
  for (const bookmaker of rawOdds.flatMap((row) => row?.bookmakers || [])) {
    for (const bet of bookmaker?.bets || []) {
      if (!/(anytime goalscorer|player to score|goalscorer|jugador.*anota)/.test(normalizedText(bet?.name))) continue;
      const value = bet.values?.find((item) => normalizedText(item?.value).includes(target));
      const odds = safeNumber(value?.odd);
      if (odds > 1) return { odds, bookmaker: bookmaker.name || "API-Football" };
    }
  }
  return { odds: null, bookmaker: "" };
}

function offensiveExpectation(teamContext = {}) {
  const lambda = safeNumber(teamContext.lambda);
  const goalProbability = safeNumber(teamContext.goalProbability);
  const opponentXga = safeNumber(teamContext.opponentXga);
  const signals = [];
  if (lambda > 0) signals.push(Math.min(100, lambda / 2 * 100));
  if (goalProbability > 0) signals.push(Math.min(100, goalProbability));
  if (opponentXga > 0) signals.push(Math.min(100, opponentXga / 2 * 100));
  if (signals.length) return signals.reduce((sum, value) => sum + value, 0) / signals.length;
  return 40;
}

function extractPlayerXg(stats = {}) {
  const value = stats.goals?.expected ?? stats.goals?.xg ?? stats.shots?.xg ?? stats.xg ?? stats.expectedGoals;
  return hasValue(value) ? safeNumber(value) : null;
}

function sampleQualityLabel(appearances, matchesEvaluated) {
  const ratio = matchesEvaluated ? appearances / matchesEvaluated : 0;
  if (appearances >= 4 || ratio >= 0.8) return "Aceptable";
  if (appearances >= 3 || ratio >= 0.6) return "Media";
  return "Debil";
}

function conservativeGoalProbability(player, teamContext = {}) {
  const teamAttack = offensiveExpectation(teamContext);
  const shotSignal = Math.min(45, player.shotsOnTargetPer90 * 15 + player.shotsPer90 * 4);
  const minutesSignal = Math.min(20, player.avgMinutes / 90 * 20);
  const scoringSignal = Math.min(20, player.goalsLast5 * 5 + player.penaltiesScoredLast5 * 4);
  const teamSignal = Math.min(15, teamAttack * 0.15);
  return round(Math.max(3, Math.min(65, shotSignal + minutesSignal + scoringSignal + teamSignal)), 1);
}

function playerWarnings(player) {
  const warnings = [];
  if (player.sampleQuality !== "Aceptable") warnings.push(`Muestra ${player.sampleQuality.toLowerCase()}: jugo ${player.appearancesLast5}/${player.matchesEvaluated} partidos.`);
  if (!player.shotsOnTargetLast5) warnings.push("Sin tiros a puerta registrados en la muestra.");
  if (!player.xgLast5) warnings.push("xG individual no disponible en API-Football.");
  if (player.avgMinutes < 60) warnings.push("Promedio de minutos menor a 60.");
  if (player.isDefender) warnings.push("Posicion defensiva: requiere cautela.");
  return warnings;
}

export function calculateGoalThreatScore(player, teamContext = {}) {
  const sample = Math.max(1, player.matchesEvaluated || 5);
  const availability = Math.min(100, ((player.appearancesLast5 / sample) * 45) + (Math.min(player.avgMinutes, 90) / 90 * 35) + ((player.startsLast5 / sample) * 20));
  const shots = Math.min(100, player.shotsPer90 / 4 * 100);
  const shotsOnTarget = Math.min(100, player.shotsOnTargetPer90 / 2 * 100);
  const goals = Math.min(100, player.goalsLast5 / Math.max(1, Math.min(3, sample)) * 100);
  const xg = player.metricCoverage?.xg ? Math.min(100, safeNumber(player.xgLast5) / Math.max(1, sample) / .6 * 100) : null;
  const finishing = xg === null ? goals : (goals * .55) + (xg * .45);
  const involvement = Math.min(100, ((player.goalsLast5 + player.assistsLast5) / Math.max(90, player.minutesLast5) * 90) / .8 * 100);
  const penalties = player.penaltiesScoredLast5 > 0 ? 100 : player.penaltiesMissedLast5 > 0 ? 55 : 0;
  const teamAttack = offensiveExpectation(teamContext);
  const position = Math.min(100, safeNumber(player.positionPriority) / 5 * 100);
  const coverageRatio = [player.metricCoverage?.shots, player.metricCoverage?.shotsOnTarget, player.metricCoverage?.goals, player.metricCoverage?.minutes]
    .filter(Boolean).length / 4;
  const raw = (availability * .20) + (shots * .20) + (shotsOnTarget * .20) + (finishing * .15)
    + (involvement * .10) + (penalties * .05) + (position * .05) + (teamAttack * .05);
  return round(raw * (.8 + coverageRatio * .2), 0);
}

export function calculateIndividualFormScore(player = {}) {
  const sample = Math.max(1, player.matchesEvaluated || 1);
  const participation = Math.min(100, (player.appearancesLast5 / sample * 60) + (Math.min(90, player.avgMinutes) / 90 * 40));
  const production = Math.min(100, ((safeNumber(player.goalsLast5) + safeNumber(player.assistsLast5)) / Math.max(90, safeNumber(player.minutesLast5)) * 90) / .8 * 100);
  const shooting = Math.min(100, (safeNumber(player.shotsPer90) / 4 * 55) + (safeNumber(player.shotsOnTargetPer90) / 2 * 45));
  const regularity = Math.min(100, player.startsLast5 / sample * 100);
  const sampleQuality = player.appearancesLast5 >= 4 ? 100 : player.appearancesLast5 >= 3 ? 70 : player.appearancesLast5 >= 2 ? 40 : 20;
  return round(participation * .25 + production * .25 + shooting * .25 + regularity * .15 + sampleQuality * .10, 0);
}

function confidenceFor(player, teamContext) {
  const goodTeamAttack = offensiveExpectation(teamContext) >= 55;
  if (player.matchesEvaluated === 5 && player.startsLast5 === 5 && player.appearancesLast5 === 5
    && player.goalThreatScore >= 85 && player.shotsLast5 > 0 && player.shotsOnTargetLast5 > 0 && goodTeamAttack) {
    return { confidence: "Alta", color: "green" };
  }
  return { confidence: "Baja", color: "red" };
}

export function normalizeTeamPlayerHistory({ teamId, teamName, fixtureRows = [], injuries = [], teamContext = {}, odds = [] }) {
  const records = new Map();
  const evaluatedRows = fixtureRows.slice(0, MAX_MATCHES);
  const matchesEvaluated = evaluatedRows.length;
  for (const row of evaluatedRows) {
    const lineup = lineupsForTeam(row.lineups, teamId);
    const starters = new Set((lineup?.startXI || []).map((item) => String(item?.player?.id || "")));
    const lineupPositions = new Map([...(lineup?.startXI || []), ...(lineup?.substitutes || [])].map((item) => [String(item?.player?.id || ""), item?.player?.pos || ""]));
    for (const playerRow of playersForTeam(row.players, teamId)) {
      const playerId = String(playerRow?.player?.id || "");
      if (!playerId) continue;
      const stats = playerRow?.statistics?.[0] || {};
      const minutes = safeNumber(stats.games?.minutes);
      if (minutes < 1) continue;
      const current = records.get(playerId) || {
        playerId, playerName: playerRow?.player?.name || "Jugador", teamId: String(teamId), teamName,
        position: stats.games?.position || lineupPositions.get(playerId) || "", appearancesLast5: 0, startsLast5: 0,
        minutesLast5: 0, goalsLast5: 0, assistsLast5: 0, shotsLast5: 0, shotsOnTargetLast5: 0,
        xgLast5: 0, penaltiesScoredLast5: 0, penaltiesMissedLast5: 0, redCardsLast5: 0, fixturesPlayed: [],
        matchHistory: [], metricCoverage: { minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0 }
      };
      const eventStats = eventTotals(row.events, teamId, playerId);
      const xgValue = extractPlayerXg(stats);
      current.appearancesLast5 += 1;
      current.startsLast5 += starters.has(playerId) ? 1 : 0;
      current.minutesLast5 += minutes;
      current.goalsLast5 += Math.max(safeNumber(stats.goals?.total), eventStats.goals);
      current.assistsLast5 += safeNumber(stats.goals?.assists);
      current.shotsLast5 += safeNumber(stats.shots?.total);
      current.shotsOnTargetLast5 += safeNumber(stats.shots?.on);
      current.xgLast5 += xgValue || 0;
      current.penaltiesScoredLast5 += Math.max(safeNumber(stats.penalty?.scored), eventStats.penaltiesScored);
      current.penaltiesMissedLast5 += Math.max(safeNumber(stats.penalty?.missed), eventStats.penaltiesMissed);
      current.redCardsLast5 += safeNumber(stats.cards?.red);
      current.position ||= lineupPositions.get(playerId) || "";
      current.metricCoverage.minutes += hasValue(stats.games?.minutes) ? 1 : 0;
      current.metricCoverage.goals += hasValue(stats.goals?.total) || eventStats.goals > 0 ? 1 : 0;
      current.metricCoverage.assists += hasValue(stats.goals?.assists) ? 1 : 0;
      current.metricCoverage.shots += hasValue(stats.shots?.total) ? 1 : 0;
      current.metricCoverage.shotsOnTarget += hasValue(stats.shots?.on) ? 1 : 0;
      current.metricCoverage.xg += xgValue !== null ? 1 : 0;
      current.matchHistory.push({
        fixtureId: String(row.fixture?.id || ""), date: row.fixture?.date || "", minutes,
        goals: Math.max(safeNumber(stats.goals?.total), eventStats.goals), assists: safeNumber(stats.goals?.assists),
        shots: safeNumber(stats.shots?.total), shotsOnTarget: safeNumber(stats.shots?.on), xg: xgValue
      });
      current.fixturesPlayed.push({
        fixtureId: String(row.fixture?.id || ""),
        date: row.fixture?.date || "",
        minutes,
        started: starters.has(playerId)
      });
      records.set(playerId, current);
    }
  }

  const absences = absenceNames(injuries, teamId);
  return [...records.values()].map((player) => {
    const position = positionPriority(player.position);
    const totalMinutes = player.minutesLast5;
    const normalized = {
      ...player,
      avgMinutes: player.appearancesLast5 ? round(totalMinutes / player.appearancesLast5) : 0,
      shotsPer90: totalMinutes ? round(player.shotsLast5 / totalMinutes * 90) : 0,
      shotsOnTargetPer90: totalMinutes ? round(player.shotsOnTargetLast5 / totalMinutes * 90) : 0,
      avgShots: matchesEvaluated ? round(player.shotsLast5 / matchesEvaluated) : 0,
      avgShotsOnTarget: matchesEvaluated ? round(player.shotsOnTargetLast5 / matchesEvaluated) : 0,
      avgXg: matchesEvaluated ? round(player.xgLast5 / matchesEvaluated) : null,
      matchesEvaluated,
      participationFrequencyPct: ratioPct(player.appearancesLast5, matchesEvaluated),
      goalFrequencyPct: ratioPct(player.goalsLast5, Math.max(1, player.appearancesLast5)),
      isInjuredOrSuspended: absences.ids.has(player.playerId) || absences.names.has(normalizedText(player.playerName)),
      positionPriority: position.level, isGoalkeeper: Boolean(position.goalkeeper), isDefender: Boolean(position.defender),
      teamExpectedGoals: safeNumber(teamContext.lambda) || null,
      teamGoalProbability: safeNumber(teamContext.goalProbability) || null
    };
    normalized.goalThreatScore = calculateGoalThreatScore(normalized, teamContext);
    normalized.individualFormScore = calculateIndividualFormScore(normalized);
    Object.assign(normalized, confidenceFor(normalized, teamContext));
    normalized.sampleQuality = sampleQualityLabel(normalized.appearancesLast5, matchesEvaluated);
    normalized.conservativeGoalProbability = conservativeGoalProbability(normalized, teamContext);
    normalized.warnings = playerWarnings(normalized);
    const odd = findPlayerOdd(odds, normalized.playerName);
    normalized.odds = odd.odds;
    normalized.bookmaker = odd.bookmaker;
    const opponentContext = safeNumber(teamContext.opponentXga) > 0 ? ` La defensa rival registra xGA ${round(teamContext.opponentXga)}.` : " La dificultad defensiva rival no está disponible.";
    normalized.explanation = `${normalized.playerName} suma ${normalized.minutesLast5} minutos, ${normalized.shotsLast5} tiros y ${normalized.shotsOnTargetLast5} a puerta en ${normalized.appearancesLast5}/${normalized.matchesEvaluated} partidos utiles.${normalized.penaltiesScoredLast5 ? " Registra participacion reciente en penales." : ""}${opponentContext}`;
    return normalized;
  });
}

function isEligible(player) {
  const regular = player.matchesEvaluated === 5 && player.appearancesLast5 === 5 && player.startsLast5 === 5;
  const shooting = player.shotsLast5 > 0 || player.penaltiesScoredLast5 > 0;
  const defenderException = !player.isDefender || player.goalsLast5 > 0 || player.shotsLast5 >= 3;
  return regular && player.goalThreatScore >= 85 && shooting && defenderException && !player.isGoalkeeper && !player.isInjuredOrSuspended;
}

export function buildPlayerGoalCandidates(match, homeTeamData = [], awayTeamData = [], teamContext = {}) {
  const eligible = [...homeTeamData, ...awayTeamData].filter(isEligible).filter((player) => player.color !== "red");
  eligible.sort((a, b) => b.goalThreatScore - a.goalThreatScore || b.positionPriority - a.positionPriority || b.appearancesLast5 - a.appearancesLast5 || b.shotsOnTargetPer90 - a.shotsOnTargetPer90 || b.shotsPer90 - a.shotsPer90 || b.goalsLast5 - a.goalsLast5 || offensiveExpectation(teamContext[b.teamId]) - offensiveExpectation(teamContext[a.teamId]));
  const lowAttackCount = new Map();
  const candidates = [];
  for (const player of eligible) {
    const context = teamContext[player.teamId] || {};
    if (offensiveExpectation(context) < 40 && (lowAttackCount.get(player.teamId) || 0) >= 1) continue;
    lowAttackCount.set(player.teamId, (lowAttackCount.get(player.teamId) || 0) + 1);
    candidates.push({
      fixtureId: String(match?.id || ""), matchId: String(match?.id || ""), homeTeam: match?.home || "", awayTeam: match?.away || "",
      teamId: player.teamId, teamName: player.teamName, playerId: player.playerId, playerName: player.playerName,
      market: "Jugador anota en cualquier momento", marketKey: "anytime_goalscorer", selectionKey: `player_goal_${player.playerId}`,
      selection: `${player.playerName} anota`, confidence: player.confidence, confidenceScore: player.goalThreatScore,
      color: player.color, highlightColor: player.color, goalThreatScore: player.goalThreatScore, explanation: player.explanation,
      conservativeGoalProbability: player.conservativeGoalProbability, sampleQuality: player.sampleQuality, warnings: player.warnings || [],
      origin: "player_goal_candidate", sourceModule: "player_goal_candidate", sourceLabel: "Jugador con posible gol",
      odds: player.odds, decimalOdds: player.odds, bookmaker: player.bookmaker, canAdd: true, requiresReview: player.color !== "green" || !player.odds,
      stats: player, createdAt: new Date().toISOString()
    });
    if (candidates.length === 3) break;
  }
  return { candidates };
}

function teamContextFromDataset(dataset, teamId, side) {
  const poisson = dataset.poissonModel || {};
  const teamGoals = dataset.teamGoalProbability || {};
  const xg = dataset.researchData?.xgXga || {};
  const tournament = buildShortTournamentContext(dataset);
  return {
    lambda: side === "home" ? poisson.lambdaHome ?? poisson.homeLambda : poisson.lambdaAway ?? poisson.awayLambda,
    goalProbability: teamGoals.teams?.[side]?.scoreOver05ProbabilityPct ?? teamGoals.teams?.[side]?.over05ProbabilityPct,
    opponentXga: side === "home" ? xg.awayXGA : xg.homeXGA,
    tournament,
    teamId
  };
}

function unavailable(dataset, status, message, coverage = {}) {
  return { status, fixtureId: String(dataset?.fixture?.id || ""), candidates: [], coverage, message, source: "api-football", generatedAt: new Date().toISOString() };
}

export async function getPlayerGoalCandidates(dataset, dependencies, { forceRefresh = false, now = Date.now() } = {}) {
  const fixture = dataset?.fixture || {};
  const key = String(fixture.id || "");
  if (!key || !fixture.homeTeamId || !fixture.awayTeamId) return unavailable(dataset, "not_available", "No fue posible identificar ambos equipos del encuentro.");
  const cached = resultCache.get(key);
  if (!forceRefresh && cached?.expiresAt > now) return { ...cached.value, cached: true };
  if (!forceRefresh && pendingRequests.has(key)) return pendingRequests.get(key);
  const request = (async () => {
    const [homeRows, awayRows] = await Promise.all([
      dependencies.getPreviousFixtures(fixture.homeTeamId, 10), dependencies.getPreviousFixtures(fixture.awayTeamId, 10)
    ]);
    const homeFixtures = selectPlayerHistoryFixtures(homeRows, fixture.utcDateTime);
    const awayFixtures = selectPlayerHistoryFixtures(awayRows, fixture.utcDateTime);
    const uniqueFixtureIds = [...new Set([...homeFixtures, ...awayFixtures].map((row) => String(row.fixture.id)))];
    const loaded = new Map(await mapWithConcurrency(uniqueFixtureIds, 3, async (fixtureId) => {
      const [players, lineups, events] = await Promise.all([
        dependencies.getFixturePlayers(fixtureId).catch(() => []), dependencies.getFixtureLineups(fixtureId).catch(() => []), dependencies.getFixtureEvents(fixtureId).catch(() => [])
      ]);
      return [fixtureId, { players, lineups, events }];
    }));
    const rowsFor = (fixtures) => fixtures.map((row) => ({ ...(loaded.get(String(row.fixture.id)) || {}), fixture: row.fixture })).filter((row) => row?.players?.length);
    const homeLoaded = rowsFor(homeFixtures);
    const awayLoaded = rowsFor(awayFixtures);
    const coverage = { homeFixtures: homeFixtures.length, awayFixtures: awayFixtures.length, homePlayerFixtures: homeLoaded.length, awayPlayerFixtures: awayLoaded.length, lineupsAvailable: [...loaded.values()].filter((row) => row.lineups.length).length, eventsAvailable: [...loaded.values()].filter((row) => row.events.length).length };
    if (!homeLoaded.length && !awayLoaded.length) return unavailable(dataset, "no_player_coverage", "La API no tiene cobertura suficiente de estadisticas de jugadores para este partido.", coverage);
    const contexts = {
      [String(fixture.homeTeamId)]: teamContextFromDataset(dataset, fixture.homeTeamId, "home"),
      [String(fixture.awayTeamId)]: teamContextFromDataset(dataset, fixture.awayTeamId, "away")
    };
    const injuries = dataset.confirmed?.injuries || [];
    const rawOdds = dataset.confirmed?.odds || [];
    const homePlayers = normalizeTeamPlayerHistory({ teamId: fixture.homeTeamId, teamName: fixture.home, fixtureRows: homeLoaded, injuries, teamContext: contexts[String(fixture.homeTeamId)], odds: rawOdds });
    const awayPlayers = normalizeTeamPlayerHistory({ teamId: fixture.awayTeamId, teamName: fixture.away, fixtureRows: awayLoaded, injuries, teamContext: contexts[String(fixture.awayTeamId)], odds: rawOdds });
    const currentLineups = dataset.confirmed?.lineups || [];
    const currentStarters = new Set(currentLineups.flatMap((row) => (row.startXI || []).map((item) => String(item?.player?.id || ""))).filter(Boolean));
    const lineupAvailable = currentStarters.size > 0;
    for (const player of [...homePlayers, ...awayPlayers]) player.isProbableStarter = lineupAvailable ? currentStarters.has(player.playerId) : null;
    const built = buildPlayerGoalCandidates(fixture, homePlayers, awayPlayers, contexts);
    const tournamentContext = buildShortTournamentContext(dataset);
    const individualForm = [...homePlayers, ...awayPlayers]
      .filter((player) => !player.isGoalkeeper && player.minutesLast5 >= 90)
      .sort((a, b) => b.individualFormScore - a.individualFormScore || b.goalThreatScore - a.goalThreatScore)
      .slice(0, 10)
      .map((player) => ({
        playerId: player.playerId, playerName: player.playerName, teamId: player.teamId, teamName: player.teamName,
        score: player.individualFormScore, threatScore: player.goalThreatScore, confidence: player.sampleQuality,
        trend: player.matchHistory.length >= 3 && player.matchHistory[0].shots + player.matchHistory[1].shots > player.shotsLast5 / player.appearancesLast5 * 2 ? "positiva" : "estable",
        appearances: player.appearancesLast5, matchesEvaluated: player.matchesEvaluated, minutes: player.minutesLast5,
        goals: player.goalsLast5, assists: player.assistsLast5, shots: player.shotsLast5, shotsOnTarget: player.shotsOnTargetLast5,
        xg: player.metricCoverage.xg ? round(player.xgLast5) : null, isProbableStarter: player.isProbableStarter,
        warnings: player.warnings
      }));
    const value = {
      status: built.candidates.length ? "available" : "insufficient_data", fixtureId: key, candidates: built.candidates,
      coverage, message: built.candidates.length ? "" : "Datos insuficientes para sugerir jugador con posible gol.",
      playersEvaluated: homePlayers.length + awayPlayers.length, individualForm, tournamentContext, source: "api-football + modelo interno",
      updateReason: "historical_snapshot_calculated_from_api_football",
      cached: false, generatedAt: new Date(now).toISOString()
    };
    resultCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  })().finally(() => pendingRequests.delete(key));
  pendingRequests.set(key, request);
  return request;
}

export function clearPlayerGoalCandidatesCache(fixtureId = null) {
  if (fixtureId === null) resultCache.clear(); else resultCache.delete(String(fixtureId));
}
