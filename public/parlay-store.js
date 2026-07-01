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
  const outcomes = {
    "1X": home >= away,
    X2: away >= home,
    over_2_5: total > 2.5,
    under_2_5: total < 2.5,
    btts_yes: home > 0 && away > 0,
    btts_no: home === 0 || away === 0
  };
  return selectionCode in outcomes ? (outcomes[selectionCode] ? "won" : "lost") : "pending";
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
    savedAt: now.toISOString()
  };
}
