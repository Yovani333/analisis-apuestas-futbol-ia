import { applyAnalysisTiming } from "./analysis-timing.js";

export const PARLAY_DRAFT_KEY = "football-ai.parlay-draft.v1";
export const SAVED_PARLAYS_KEY = "football-ai.saved-parlays.v1";
export const SAVED_PICKS_KEY = "football-ai.saved-picks.v1";
export const LEG_RESULTS = Object.freeze(["pending", "won", "lost", "void"]);

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
  const home = Number(fixtureResult.goals?.home);
  const away = Number(fixtureResult.goals?.away);
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

export function settlePickResult(leg, fixtureResult) {
  const selectionCode = resolveSelectionCode(leg);
  if (!selectionCode || !fixtureResult?.finished) return "pending";
  if (!/corners/.test(selectionCode)) return settleLegResult(selectionCode, fixtureResult);

  const homeCorners = Number(fixtureResult.corners?.home);
  const awayCorners = Number(fixtureResult.corners?.away);
  if (!Number.isFinite(homeCorners) || !Number.isFinite(awayCorners)) return "pending";
  if (selectionCode === "home_most_corners") return homeCorners === awayCorners ? "void" : homeCorners > awayCorners ? "won" : "lost";
  if (selectionCode === "away_most_corners") return homeCorners === awayCorners ? "void" : awayCorners > homeCorners ? "won" : "lost";
  const threshold = Number.parseFloat(normalizedSelectionText(leg.selection).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".") || "");
  if (!Number.isFinite(threshold)) return "pending";
  const total = homeCorners + awayCorners;
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
  const parlayLegs = parlays.filter((parlay) => !parlay?.trashed).flatMap((parlay) => Array.isArray(parlay?.legs) ? parlay.legs : []);
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
    const current = groups.get(origin) || { origin, evaluated: 0, won: 0, lost: 0, individual: 0, parlayLegs: 0, winRate: 0, addedBuckets: {}, wonPicks: [], wonCategories: [] };
    current.evaluated += 1;
    current[pick.result] += 1;
    if (kind === "parlay") current.parlayLegs += 1;
    else current.individual += 1;
    const lead = leadLabel(pick);
    current.addedBuckets[lead] = (current.addedBuckets[lead] || 0) + 1;
    if (pick.result === "won") current.wonPicks.push({
      id: pick.id || `${origin}:${current.wonPicks.length}`,
      selection: pick.selection || "Pick",
      market: pick.market || "Mercado no disponible",
      match: [pick.home, pick.away].filter(Boolean).join(" vs "),
      league: pick.league || "No disponible",
      addedLead: lead,
      category: classify(pick),
      odds: pick.originalOdds ?? pick.decimalOdds ?? null
    });
    current.winRate = Number((current.won / current.evaluated * 100).toFixed(1));
    groups.set(origin, current);
  }
  for (const current of groups.values()) {
    const categories = new Map();
    for (const pick of current.wonPicks) categories.set(pick.category, (categories.get(pick.category) || 0) + 1);
    current.wonCategories = [...categories.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    current.addedSummary = Object.entries(current.addedBuckets).map(([label, count]) => `${label} (${count})`).join(" · ");
  }
  return [...groups.values()].sort((a, b) => b.winRate - a.winRate || b.evaluated - a.evaluated || a.origin.localeCompare(b.origin));
}

export function moveParlayToTrash(parlay, now = new Date()) {
  return { ...parlay, trashed: true, deletedAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function restoreParlayFromTrash(parlay, now = new Date()) {
  const restored = { ...parlay, trashed: false, updatedAt: now.toISOString() };
  delete restored.deletedAt;
  return restored;
}
