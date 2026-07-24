import { applyAnalysisTiming } from "./analysis-timing.js";

export const PARLAY_DRAFT_KEY = "football-ai.parlay-draft.v1";
export const SAVED_PARLAYS_KEY = "football-ai.saved-parlays.v1";
export const SAVED_PICKS_KEY = "football-ai.saved-picks.v1";
export const LEG_RESULTS = Object.freeze(["pending", "won", "lost", "void"]);
export const SETTLEMENT_VERIFICATION_VERSION = "regulation-score-v3";

const AUTO_SETTLEMENT_CODES = new Set([
  "home_dnb", "away_dnb", "home_win", "draw", "away_win", "1X", "X2", "12",
  "home_over_0_5", "home_over_1_5", "away_over_0_5", "away_over_1_5",
  "over_0_5", "over_1_5", "over_2_5", "over_3_5",
  "under_1_5", "under_2_5", "under_3_5", "btts_yes", "btts_no",
  "home_most_corners", "away_most_corners", "over_corners", "under_corners"
]);

function readArray(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeArray(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // La interfaz sigue funcionando si el navegador bloquea o llena el almacenamiento local.
  }
}

export function loadParlayDraft(storage = globalThis.localStorage) {
  return readArray(storage, PARLAY_DRAFT_KEY);
}

export function saveParlayDraft(legs, storage = globalThis.localStorage) {
  writeArray(storage, PARLAY_DRAFT_KEY, legs);
}

export function loadSavedParlays(storage = globalThis.localStorage) {
  return readArray(storage, SAVED_PARLAYS_KEY);
}

export function saveSavedParlays(parlays, storage = globalThis.localStorage) {
  writeArray(storage, SAVED_PARLAYS_KEY, parlays);
}

export function loadSavedPicks(storage = globalThis.localStorage) {
  return readArray(storage, SAVED_PICKS_KEY);
}

export function saveSavedPicks(picks, storage = globalThis.localStorage) {
  writeArray(storage, SAVED_PICKS_KEY, picks);
}

export function normalizePickLeg(leg, now = new Date()) {
  return applyAnalysisTiming({
    ...leg,
    originalOdds: leg.originalOdds ?? leg.decimalOdds ?? null,
    updatedOdds: leg.updatedOdds ?? null,
    impliedProbability: leg.impliedProbability ?? null,
    modelProbability: leg.modelProbability ?? leg.estimatedProbability ?? null,
    expectedValue: leg.expectedValue ?? null,
    confidence: leg.confidence || "No disponible",
    risk: leg.risk || leg.level || "No disponible",
    sourceModule: leg.sourceModule || "odds",
    supportingData: Array.isArray(leg.supportingData) ? [...leg.supportingData] : [],
    contradictingData: Array.isArray(leg.contradictingData) ? [...leg.contradictingData] : [],
    addedAt: leg.addedAt || now.toISOString()
  }, now);
}

function identityPart(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

export function pickIdentity(pick, { includeSource = false } = {}) {
  const market = pick.marketCode || pick.market;
  const selection = pick.selectionCode || pick.selection;
  const parts = [String(pick.fixtureId || ""), identityPart(market), identityPart(selection)];
  if (includeSource) parts.push(identityPart(pick.sourceModule || "odds"));
  return parts.join("::");
}

export function hasDuplicatePick(picks, candidate, options) {
  const identity = pickIdentity(candidate, options);
  return picks.some((pick) => pickIdentity(pick, options) === identity);
}

export function calculateParlayResult(legs = []) {
  if (!legs.length) return "pending";
  if (legs.some((leg) => leg.result === "lost")) return "lost";
  if (legs.some((leg) => leg.result === "pending")) return "pending";
  const activeLegs = legs.filter((leg) => leg.result !== "void");
  if (!activeLegs.length) return "void";
  return activeLegs.every((leg) => leg.result === "won") ? "won" : "pending";
}

export function settleLegResult(selectionCode, fixtureResult) {
  if (!fixtureResult?.finished) return "pending";
  const rawHome = fixtureResult.goals?.home;
  const rawAway = fixtureResult.goals?.away;
  if (rawHome === null || rawHome === undefined || rawHome === "" || rawAway === null || rawAway === undefined || rawAway === "") return "pending";
  const home = Number(rawHome);
  const away = Number(rawAway);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return "pending";
  const total = home + away;
  if (selectionCode === "home_dnb") return home === away ? "void" : home > away ? "won" : "lost";
  if (selectionCode === "away_dnb") return home === away ? "void" : away > home ? "won" : "lost";
  const outcomes = {
    home_win: home > away,
    draw: home === away,
    away_win: away > home,
    "1X": home >= away,
    X2: away >= home,
    "12": home !== away,
    home_over_0_5: home > 0,
    home_over_1_5: home > 1,
    away_over_0_5: away > 0,
    away_over_1_5: away > 1,
    over_0_5: total > 0.5,
    over_1_5: total > 1.5,
    over_2_5: total > 2.5,
    over_3_5: total > 3.5,
    under_1_5: total < 1.5,
    under_2_5: total < 2.5,
    under_3_5: total < 3.5,
    btts_yes: home > 0 && away > 0,
    btts_no: home === 0 || away === 0
  };
  return selectionCode in outcomes ? (outcomes[selectionCode] ? "won" : "lost") : "pending";
}

function normalizedSelectionText(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

export function resolveSelectionCode(leg = {}) {
  if (leg.selectionCode) return String(leg.selectionCode);
  const selection = normalizedSelectionText(leg.selection);
  const market = normalizedSelectionText(`${leg.marketCode || ""} ${leg.market || ""}`);
  const home = normalizedSelectionText(leg.home);
  const away = normalizedSelectionText(leg.away);
  const belongsTo = (team) => Boolean(team && selection.includes(team));

  if (/\b1x\b|local.*empate|home.*draw/.test(selection)) return "1X";
  if (/\bx2\b|empate.*visitante|draw.*away/.test(selection)) return "X2";
  if (/\b12\b|local.*visitante|home.*away/.test(selection)) return "12";
  if (/dnb|empate no apuesta/.test(`${market} ${selection}`)) return belongsTo(away) ? "away_dnb" : belongsTo(home) ? "home_dnb" : null;
  if (/ambos.*anotan|btts/.test(market)) return /\b(no)\b/.test(selection) ? "btts_no" : /\b(si|yes)\b/.test(selection) ? "btts_yes" : null;
  if (/corners|tiros de esquina/.test(`${market} ${selection}`)) {
    if (/mas corners|most corners/.test(selection)) return belongsTo(away) ? "away_most_corners" : belongsTo(home) ? "home_most_corners" : null;
    if (/mas de|over/.test(selection)) return "over_corners";
    if (/menos de|under/.test(selection)) return "under_corners";
  }
  if (/mas de 0[.,]5/.test(selection)) return belongsTo(away) ? "away_over_0_5" : belongsTo(home) ? "home_over_0_5" : null;
  if (/mas de 1[.,]5/.test(selection) && /goles de|team.*goals/.test(market)) return belongsTo(away) ? "away_over_1_5" : belongsTo(home) ? "home_over_1_5" : null;
  if (/mas de 1[.,]5|over 1[.,]5/.test(selection)) return "over_1_5";
  if (/mas de 2[.,]5|over 2[.,]5/.test(selection)) return "over_2_5";
  if (/mas de 3[.,]5|over 3[.,]5/.test(selection)) return "over_3_5";
  if (/menos de 1[.,]5|under 1[.,]5/.test(selection)) return "under_1_5";
  if (/menos de 2[.,]5|under 2[.,]5/.test(selection)) return "under_2_5";
  if (/menos de 3[.,]5|under 3[.,]5/.test(selection)) return "under_3_5";
  if (/empate|\bdraw\b/.test(selection) && !belongsTo(home) && !belongsTo(away)) return "draw";
  if (/^local gana|home wins?/.test(selection)) return "home_win";
  if (/^visitante gana|away wins?/.test(selection)) return "away_win";
  if (belongsTo(home) && (/gana|winner/.test(`${market} ${selection}`) || selection === home)) return "home_win";
  if (belongsTo(away) && (/gana|winner/.test(`${market} ${selection}`) || selection === away)) return "away_win";
  return null;
}

export function canAutomaticallySettlePick(leg = {}) {
  return AUTO_SETTLEMENT_CODES.has(resolveSelectionCode(leg));
}

export function needsSettlementRefresh(leg = {}, version = SETTLEMENT_VERIFICATION_VERSION) {
  if (!leg.fixtureId || !canAutomaticallySettlePick(leg)) return false;
  if (leg.result !== "pending" && leg.resultSource === "manual") return false;
  return leg.result === "pending" || leg.settlementVerificationVersion !== version;
}

export function settlePickResult(leg, fixtureResult) {
  const selectionCode = resolveSelectionCode(leg);
  if (!selectionCode || !fixtureResult?.finished) return "pending";
  if (!/corners/.test(selectionCode)) {
    const regulation = fixtureResult.regulationGoals || fixtureResult.fulltimeScore || fixtureResult.score?.fulltime;
    const hasRegulationScore = regulation?.home !== null && regulation?.home !== undefined && regulation?.home !== ""
      && regulation?.away !== null && regulation?.away !== undefined && regulation?.away !== ""
      && Number.isFinite(Number(regulation.home)) && Number.isFinite(Number(regulation.away));
    return settleLegResult(selectionCode, hasRegulationScore ? { ...fixtureResult, goals: regulation } : fixtureResult);
  }

  const extraTime = fixtureResult.extraTimeScore || fixtureResult.score?.extratime;
  const penalties = fixtureResult.penaltyScore || fixtureResult.score?.penalty;
  const hasExtendedPlay = [extraTime, penalties].some((score) => score
    && score.home !== null && score.home !== undefined && score.home !== ""
    && score.away !== null && score.away !== undefined && score.away !== "");
  if (hasExtendedPlay) return "pending";

  const rawHomeCorners = fixtureResult.corners?.home;
  const rawAwayCorners = fixtureResult.corners?.away;
  if (rawHomeCorners === null || rawHomeCorners === undefined || rawHomeCorners === ""
    || rawAwayCorners === null || rawAwayCorners === undefined || rawAwayCorners === "") return "pending";
  const homeCorners = Number(rawHomeCorners);
  const awayCorners = Number(rawAwayCorners);
  if (!Number.isFinite(homeCorners) || !Number.isFinite(awayCorners)) return "pending";
  if (selectionCode === "home_most_corners") return homeCorners === awayCorners ? "void" : homeCorners > awayCorners ? "won" : "lost";
  if (selectionCode === "away_most_corners") return homeCorners === awayCorners ? "void" : awayCorners > homeCorners ? "won" : "lost";
  const threshold = Number.parseFloat(normalizedSelectionText(leg.selection).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".") || "");
  if (!Number.isFinite(threshold)) return "pending";
  const total = homeCorners + awayCorners;
  if (Number.isInteger(threshold) && total === threshold) return "void";
  return selectionCode === "over_corners" ? (total > threshold ? "won" : "lost") : total < threshold ? "won" : "lost";
}

export function calculateHistoryMetrics(parlays = []) {
  const settled = parlays.filter((parlay) => ["won", "lost", "void"].includes(calculateParlayResult(parlay.legs)));
  const won = settled.filter((parlay) => calculateParlayResult(parlay.legs) === "won");
  const lost = settled.filter((parlay) => calculateParlayResult(parlay.legs) === "lost");
  const theoreticalUnits = settled.reduce((total, parlay) => {
    const result = calculateParlayResult(parlay.legs);
    if (result === "lost") return total - 1;
    if (result !== "won") return total;
    const odds = parlay.legs.filter((leg) => leg.result !== "void").map((leg) => Number(leg.decimalOdds));
    return odds.every((odd) => odd > 1) ? total + odds.reduce((product, odd) => product * odd, 1) - 1 : total;
  }, 0);
  return {
    total: parlays.length,
    settled: settled.length,
    won: won.length,
    lost: lost.length,
    winRate: won.length + lost.length ? Number((won.length / (won.length + lost.length) * 100).toFixed(1)) : null,
    theoreticalUnits: Number(theoreticalUnits.toFixed(2))
  };
}

export function calculateParlayLegCounts(parlays = []) {
  const legs = parlays.flatMap((parlay) => Array.isArray(parlay?.legs) ? parlay.legs : []);
  return {
    won: legs.filter((leg) => leg?.result === "won").length,
    lost: legs.filter((leg) => leg?.result === "lost").length
  };
}

function fixtureDateValue(item = {}) {
  const storedDate = String(item.date || "").trim();
  const direct = storedDate.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const localized = storedDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (localized) return `${localized[3]}-${localized[2]}-${localized[1]}`;
  const timestamp = Date.parse(item.kickoffAt || item.utcDateTime || "");
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(timestamp));
}

export function filterPicksByFixtureDate(picks = [], date = "") {
  return date ? picks.filter((pick) => fixtureDateValue(pick) === date) : [...picks];
}

export function filterParlaysByFixtureDate(parlays = [], date = "") {
  return date ? parlays.filter((parlay) => (parlay.legs || []).some((leg) => fixtureDateValue(leg) === date)) : [...parlays];
}

export function createSavedParlay(name, legs, now = new Date()) {
  const id = globalThis.crypto?.randomUUID?.() || `parlay-${now.getTime()}`;
  return {
    id,
    name: name.trim() || `Parlay ${now.toLocaleDateString("es-MX")}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    result: "pending",
    notes: "",
    collapsed: true,
    legs: legs.map((leg) => ({
      ...normalizePickLeg(leg, now),
      fixtureStatus: leg.fixtureStatus || "No disponible",
      result: "pending"
    }))
  };
}

export function createSavedPick(leg, now = new Date()) {
  return {
    ...normalizePickLeg(leg, now),
    id: leg.id || globalThis.crypto?.randomUUID?.() || `pick-${now.getTime()}`,
    originalOdds: leg.originalOdds ?? leg.decimalOdds ?? null,
    updatedOdds: leg.updatedOdds ?? null,
    fixtureStatus: leg.fixtureStatus || "No disponible",
    result: leg.result || "pending",
    savedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function calculateOriginPerformance(picks = [], parlays = []) {
  const groups = new Map();
  const parlayLegs = parlays.flatMap((parlay) => Array.isArray(parlay?.legs) ? parlay.legs : []);
  const rows = [...picks.map((pick) => ({ pick, kind: "individual" })), ...parlayLegs.map((pick) => ({ pick, kind: "parlay" }))];
  const leadLabel = (pick) => {
    const kickoff = Date.parse(pick.kickoffAt || pick.utcDateTime || "");
    const added = Date.parse(pick.addedAt || pick.savedAt || pick.createdAt || "");
    if (!Number.isFinite(kickoff) || !Number.isFinite(added) || kickoff <= added) return "Sin dato";
    const minutes = Math.max(1, Math.round((kickoff - added) / 60000));
    if (minutes >= 1440) return `${Math.floor(minutes / 1440)} d`;
    if (minutes >= 60) return `${Math.floor(minutes / 60)} h`;
    return `${minutes} min`;
  };
  const classify = (pick) => {
    const value = String(pick.selection || pick.market || "Pick").trim();
    const total = value.match(/(más|menos)\s+de\s+(\d+(?:[.,]\d+)?)/i);
    if (total) return `${total[1][0].toUpperCase()}${total[1].slice(1).toLowerCase()} de ${total[2].replace(",", ".")}`;
    if (/^empate$/i.test(value) || /resultado.*empate/i.test(`${pick.market} ${value}`)) return "Empate";
    if (/\bgana\b/i.test(value)) return "Gana";
    return value;
  };
  for (const { pick, kind } of rows) {
    if (!['won', 'lost'].includes(pick?.result)) continue;
    const origin = pick.sourceModule || "odds";
    const current = groups.get(origin) || { origin, evaluated: 0, won: 0, lost: 0, individual: 0, parlayLegs: 0, winRate: 0, addedBuckets: {}, wonPicks: [], lostPicks: [], wonCategories: [], lostCategories: [], categoryPerformance: [] };
    current.evaluated += 1;
    current[pick.result] += 1;
    if (kind === "parlay") current.parlayLegs += 1;
    else current.individual += 1;
    const lead = leadLabel(pick);
    current.addedBuckets[lead] = (current.addedBuckets[lead] || 0) + 1;
    const resultPick = {
      id: pick.id || `${origin}:${current.evaluated}`,
      selection: pick.selection || "Pick",
      market: pick.market || "Mercado no disponible",
      match: [pick.home, pick.away].filter(Boolean).join(" vs "),
      league: pick.league || "No disponible",
      addedLead: lead,
      category: classify(pick),
      odds: pick.originalOdds ?? pick.decimalOdds ?? null
    };
    if (pick.result === "won") current.wonPicks.push(resultPick);
    else current.lostPicks.push(resultPick);
    current.winRate = Number((current.won / current.evaluated * 100).toFixed(1));
    groups.set(origin, current);
  }
  for (const current of groups.values()) {
    const wonCategories = new Map();
    const lostCategories = new Map();
    for (const pick of current.wonPicks) wonCategories.set(pick.category, (wonCategories.get(pick.category) || 0) + 1);
    for (const pick of current.lostPicks) lostCategories.set(pick.category, (lostCategories.get(pick.category) || 0) + 1);
    current.wonCategories = [...wonCategories.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    current.lostCategories = [...lostCategories.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    current.categoryPerformance = [...new Set([...wonCategories.keys(), ...lostCategories.keys()])].map((category) => {
      const won = wonCategories.get(category) || 0;
      const lost = lostCategories.get(category) || 0;
      const evaluated = won + lost;
      return { category, won, lost, evaluated, winRate: Number((won / evaluated * 100).toFixed(1)) };
    }).sort((a, b) => b.winRate - a.winRate || b.evaluated - a.evaluated || a.category.localeCompare(b.category));
    current.addedSummary = Object.entries(current.addedBuckets).map(([label, count]) => `${label} (${count})`).join(" · ");
  }
  return [...groups.values()].sort((a, b) => b.winRate - a.winRate || b.evaluated - a.evaluated || a.origin.localeCompare(b.origin));
}

export function calculateCompetitionPerformance(picks = [], parlays = []) {
  const groups = new Map();
  const normalizeCompetition = (value) => String(value || "Competición no disponible").trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(uefa|conmebol|clasificacion|qualification|qualifying)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const allRows = [
    ...picks.map((pick) => ({ pick, kind: "individual", activeEligible: !pick?.trashed })),
    ...parlays.flatMap((parlay) => [
      ...(Array.isArray(parlay?.legs) ? parlay.legs.map((pick) => ({ pick, kind: "parlay", activeEligible: !parlay?.trashed })) : [])
    ])
  ];
  const identityToLeagueId = new Map();
  for (const { pick } of allRows) {
    const leagueId = pick?.leagueId ?? pick?.league_id ?? null;
    if (leagueId !== null && leagueId !== undefined && leagueId !== "") {
      identityToLeagueId.set(normalizeCompetition(pick.league || pick.competition), String(leagueId));
    }
  }
  const isActive = (pick) => {
    if (pick?.result !== "pending") return false;
    const status = String(pick.fixtureStatus || pick.status || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/(final|finished|ft|aet|pen|cancel|postpon|suspend|abandon)/.test(status)) return false;
    if (/(program|scheduled|not started|\bns\b|en vivo|live|\b1h\b|\b2h\b|half)/.test(status)) return true;
    const kickoff = Date.parse(pick.kickoffAt || pick.utcDateTime || pick.date || "");
    return Number.isFinite(kickoff) && kickoff > Date.now();
  };
  for (const { pick, kind, activeEligible } of allRows) {
    const settled = ['won', 'lost'].includes(pick?.result);
    const active = activeEligible && isActive(pick);
    if (!settled && !active) continue;
    const competition = String(pick.league || pick.competition || "Competición no disponible").trim();
    const leagueId = pick.leagueId ?? pick.league_id ?? null;
    const identity = normalizeCompetition(competition);
    const resolvedLeagueId = leagueId ?? identityToLeagueId.get(identity) ?? null;
    const key = resolvedLeagueId === null || resolvedLeagueId === undefined || resolvedLeagueId === ""
      ? `name:${identity}` : `id:${resolvedLeagueId}`;
    const current = groups.get(key) || {
      key, competition, leagueId: resolvedLeagueId, evaluated: 0, won: 0, lost: 0, individual: 0, parlayLegs: 0, active: 0, winRate: null
    };
    if (leagueId !== null && leagueId !== undefined && leagueId !== "") {
      current.leagueId = leagueId;
      current.competition = competition;
    }
    if (active) current.active += 1;
    if (!settled) {
      groups.set(key, current);
      continue;
    }
    current.evaluated += 1;
    current[pick.result] += 1;
    if (kind === "parlay") current.parlayLegs += 1;
    else current.individual += 1;
    current.winRate = current.evaluated ? Number((current.won / current.evaluated * 100).toFixed(1)) : null;
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.evaluated - a.evaluated || a.competition.localeCompare(b.competition));
}

export function classifyParlayPickType(pick = {}) {
  const raw = `${pick.market || ""} ${pick.selection || ""} ${pick.selectionCode || ""}`
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/,/g, ".");
  const home = String(pick.home || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const away = String(pick.away || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/corner/.test(raw)) return "Corners";
  if (/(ambos.*anotan|btts)/.test(raw)) return /\b(no|btts_no)\b/.test(raw) ? "Ambos equipos anotan - No" : "Ambos equipos anotan - Sí";
  if (/(doble oportunidad|double chance|\b1x\b)/.test(raw)) return /\b(x2|away)\b/.test(raw) ? "Doble oportunidad - visitante" : "Doble oportunidad - local";
  if (/(doble oportunidad|double chance|\bx2\b)/.test(raw)) return "Doble oportunidad - visitante";
  if (/(mas|over).*0\.5/.test(raw)) {
    if (/home_over|local/.test(raw) || (home && raw.includes(home))) return "Más de 0.5 - equipo local";
    if (/away_over|visitante/.test(raw) || (away && raw.includes(away))) return "Más de 0.5 - equipo visitante";
    return "Más de 0.5 - total";
  }
  if (/(mas|over).*1\.5/.test(raw)) return "Más de 1.5 - total";
  if (/(menos|under).*1\.5/.test(raw)) return "Menos de 1.5 - total";
  if (/(menos|under).*3\.5/.test(raw)) return "Menos de 3.5 - total";
  return null;
}

export function calculateParlayPickTypePerformance(parlays = []) {
  const groups = new Map();
  for (const parlay of parlays) {
    const legs = Array.isArray(parlay?.legs) ? parlay.legs : [];
    for (const leg of legs) {
      if (!['won', 'lost'].includes(leg?.result)) continue;
      const type = classifyParlayPickType(leg);
      if (!type) continue;
      const current = groups.get(type) || { type, won: 0, lost: 0, total: 0 };
      current[leg.result] += 1;
      current.total += 1;
      groups.set(type, current);
    }
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.type.localeCompare(b.type, "es"));
}

export function removeParlayLeg(parlay, legId, now = new Date()) {
  const leg = parlay?.legs?.find((item) => String(item.id) === String(legId));
  if (!leg) return parlay;
  return {
    ...parlay,
    legs: parlay.legs.filter((item) => String(item.id) !== String(legId)),
    removedLegs: [...(Array.isArray(parlay.removedLegs) ? parlay.removedLegs : []), { ...leg, removedFromParlayAt: now.toISOString() }],
    updatedAt: now.toISOString()
  };
}

export function restoreRemovedParlayLeg(parlay, legId, now = new Date()) {
  const leg = parlay?.removedLegs?.find((item) => String(item.id) === String(legId) && !item.deletedPermanently);
  if (!leg) return parlay;
  const restored = { ...leg, restoredToParlayAt: now.toISOString() };
  delete restored.removedFromParlayAt;
  return {
    ...parlay,
    legs: [...(Array.isArray(parlay.legs) ? parlay.legs : []), restored],
    removedLegs: parlay.removedLegs.filter((item) => String(item.id) !== String(legId)),
    updatedAt: now.toISOString()
  };
}

export function permanentlyDeleteRemovedParlayLeg(parlay, legId, now = new Date()) {
  return {
    ...parlay,
    removedLegs: (Array.isArray(parlay?.removedLegs) ? parlay.removedLegs : []).map((item) => String(item.id) === String(legId)
      ? { ...item, deletedPermanently: true, purgedAt: now.toISOString() }
      : item),
    updatedAt: now.toISOString()
  };
}

export function calculateOriginRecommendations(performanceRows = []) {
  const entries = performanceRows.flatMap((row) => (row.categoryPerformance || []).map((category) => ({
    ...category,
    origin: row.origin
  })));
  const recommended = entries.filter((entry) => entry.evaluated >= 3 && entry.winRate >= 60)
    .sort((a, b) => b.winRate - a.winRate || b.evaluated - a.evaluated || a.category.localeCompare(b.category));
  const notRecommended = entries.filter((entry) => entry.evaluated >= 3 && entry.winRate < 50)
    .sort((a, b) => b.winRate - a.winRate || b.evaluated - a.evaluated || a.category.localeCompare(b.category));
  const observing = entries.filter((entry) => !recommended.includes(entry) && !notRecommended.includes(entry))
    .sort((a, b) => b.winRate - a.winRate || b.evaluated - a.evaluated || a.category.localeCompare(b.category));
  return { recommended, notRecommended, observing };
}

function normalizedHistoricalText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/,/g, ".").trim();
}

function historicalMarketCategory(pick = {}) {
  const classified = classifyParlayPickType(pick);
  if (classified) return classified;
  const raw = normalizedHistoricalText(`${pick.market || ""} ${pick.selection || ""} ${pick.selectionCode || ""}`);
  const total = raw.match(/(mas|menos|over|under)\s*(?:de\s*)?(\d+(?:\.\d+)?)/);
  if (total) return `${["mas", "over"].includes(total[1]) ? "Más" : "Menos"} de ${total[2]} - total`;
  if (/draw no bet|empate no apuesta|\bdnb\b/.test(raw)) return "Draw No Bet";
  if (/resultado 1x2|match winner|gana|ganador/.test(raw)) return "Resultado 1X2";
  return String(pick.market || pick.selection || "Mercado no identificado").trim();
}

function historicalCompetitionKey(pick = {}) {
  const id = pick.leagueId ?? pick.league_id;
  if (id !== null && id !== undefined && id !== "") return `id:${id}`;
  return `name:${normalizedHistoricalText(pick.league || pick.competition || "sin competicion")}`;
}

function historicalSample(values = []) {
  const settled = values.filter((pick) => ["won", "lost"].includes(pick?.result));
  const won = settled.filter((pick) => pick.result === "won").length;
  const lost = settled.length - won;
  return {
    evaluated: settled.length,
    won,
    lost,
    winRate: settled.length ? Number((won / settled.length * 100).toFixed(1)) : null,
    maturity: settled.length >= 10 ? "sufficient" : settled.length >= 5 ? "provisional" : "insufficient"
  };
}

function isPendingActivePick(pick = {}) {
  if (pick.result !== "pending") return false;
  const status = normalizedHistoricalText(pick.fixtureStatus || pick.status);
  return !/(final|finished|\bft\b|aet|pen|cancel|postpon|suspend|abandon)/.test(status);
}

function historicalValidationForPick(pick, settled, context = {}) {
  const origin = pick.sourceModule || pick.origin || "odds";
  const market = historicalMarketCategory(pick);
  const competitionKey = historicalCompetitionKey(pick);
  const dimensions = {
    origin: historicalSample(settled.filter((row) => (row.sourceModule || row.origin || "odds") === origin)),
    market: historicalSample(settled.filter((row) => historicalMarketCategory(row) === market)),
    competition: historicalSample(settled.filter((row) => historicalCompetitionKey(row) === competitionKey)),
    exact: historicalSample(settled.filter((row) => (row.sourceModule || row.origin || "odds") === origin
      && historicalMarketCategory(row) === market && historicalCompetitionKey(row) === competitionKey))
  };
  const comparable = Object.entries(dimensions).filter(([, sample]) => sample.evaluated >= 3);
  const weakest = comparable.sort((a, b) => a[1].winRate - b[1].winRate || b[1].evaluated - a[1].evaluated)[0] || null;
  const warnings = [];
  if (dimensions.exact.evaluated < 5) warnings.push("La combinación exacta de origen, mercado y competición todavía tiene muestra insuficiente.");
  if (weakest && weakest[1].winRate < 50) warnings.push(`El respaldo más débil registra ${weakest[1].winRate}% en ${weakest[1].evaluated} picks.`);
  if (context.parlaySize >= 4) warnings.push(`Los parlays de ${context.parlaySize} selecciones mostraron mayor fragilidad en el historial.`);
  if (context.sameFixtureLegs > 1) warnings.push("Hay selecciones del mismo encuentro; sus resultados pueden estar correlacionados.");

  const robustWeak = Object.values(dimensions).some((sample) => sample.evaluated >= 10 && sample.winRate < 45);
  const exactWeak = dimensions.exact.evaluated >= 5 && dimensions.exact.winRate < 45;
  const favorable = [dimensions.origin, dimensions.market, dimensions.competition]
    .filter((sample) => sample.evaluated >= 10);
  let decision = "review";
  if (robustWeak || exactWeak) decision = "avoid";
  else if (context.parlaySize >= 4 || context.sameFixtureLegs > 1 || (weakest && weakest[1].evaluated >= 5 && weakest[1].winRate < 55)) decision = "individual";
  else if (favorable.length >= 2 && favorable.every((sample) => sample.winRate >= 60)) decision = "favorable";

  return {
    id: pick.id,
    fixtureId: pick.fixtureId,
    selection: pick.selection || "Pick sin selección",
    market,
    competition: pick.league || pick.competition || "Competición no disponible",
    match: [pick.home, pick.away].filter(Boolean).join(" vs "),
    origin,
    kind: context.kind || "individual",
    parlayId: context.parlayId || null,
    parlayName: context.parlayName || null,
    parlaySize: context.parlaySize || 1,
    sameFixtureLegs: context.sameFixtureLegs || 1,
    dimensions,
    weakestDimension: weakest?.[0] || null,
    decision,
    warnings
  };
}

export function buildHistoricalPickValidator(picks = [], parlays = []) {
  const activePicks = picks.filter((pick) => !pick?.trashed && !pick?.deletedPermanently);
  const activeParlays = parlays.filter((parlay) => !parlay?.trashed && !parlay?.deletedPermanently);
  const settled = [
    ...activePicks.filter((pick) => ["won", "lost"].includes(pick?.result)),
    ...activeParlays.flatMap((parlay) => Array.isArray(parlay?.legs) ? parlay.legs : []).filter((pick) => ["won", "lost"].includes(pick?.result))
  ];
  const validations = activePicks.filter(isPendingActivePick).map((pick) => historicalValidationForPick(pick, settled));
  for (const parlay of activeParlays) {
    const pendingLegs = (parlay.legs || []).filter(isPendingActivePick);
    const fixtureCounts = pendingLegs.reduce((counts, leg) => counts.set(String(leg.fixtureId), (counts.get(String(leg.fixtureId)) || 0) + 1), new Map());
    for (const leg of pendingLegs) validations.push(historicalValidationForPick(leg, settled, {
      kind: "parlay",
      parlayId: parlay.id,
      parlayName: parlay.name,
      parlaySize: parlay.legs?.length || 0,
      sameFixtureLegs: fixtureCounts.get(String(leg.fixtureId)) || 1
    }));
  }
  const sizeGroups = new Map();
  for (const parlay of activeParlays.filter((row) => ["won", "lost"].includes(calculateParlayResult(row?.legs || [])))) {
    const size = rowSize(parlay.legs?.length || 0);
    const current = sizeGroups.get(size.key) || { ...size, won: 0, lost: 0, evaluated: 0, winRate: null };
    const result = calculateParlayResult(parlay.legs || []);
    current[result] += 1;
    current.evaluated += 1;
    current.winRate = Number((current.won / current.evaluated * 100).toFixed(1));
    sizeGroups.set(size.key, current);
  }
  return {
    historical: historicalSample(settled),
    activeValidations: validations,
    parlaySizePerformance: [...sizeGroups.values()].sort((a, b) => a.order - b.order)
  };
}

function rowSize(size) {
  return size >= 5 ? { key: "5+", label: "5 o más", order: 5 } : { key: String(size), label: String(size), order: size };
}

export function moveParlayToTrash(parlay, now = new Date()) {
  return { ...parlay, trashed: true, deletedAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function restoreParlayFromTrash(parlay, now = new Date()) {
  const restored = { ...parlay, trashed: false, updatedAt: now.toISOString() };
  delete restored.deletedAt;
  return restored;
}
