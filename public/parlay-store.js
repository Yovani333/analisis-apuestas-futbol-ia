export const PARLAY_DRAFT_KEY = "football-ai.parlay-draft.v1";
export const SAVED_PARLAYS_KEY = "football-ai.saved-parlays.v1";
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

export function calculateParlayResult(legs = []) {
  if (!legs.length) return "pending";
  if (legs.some((leg) => leg.result === "lost")) return "lost";
  if (legs.some((leg) => leg.result === "pending")) return "pending";
  const activeLegs = legs.filter((leg) => leg.result !== "void");
  if (!activeLegs.length) return "void";
  return activeLegs.every((leg) => leg.result === "won") ? "won" : "pending";
}

export function createSavedParlay(name, legs, now = new Date()) {
  const id = globalThis.crypto?.randomUUID?.() || `parlay-${now.getTime()}`;
  return {
    id,
    name: name.trim() || `Parlay ${now.toLocaleDateString("es-MX")}`,
    createdAt: now.toISOString(),
    result: "pending",
    notes: "",
    legs: legs.map((leg) => ({ ...leg, result: "pending" }))
  };
}
