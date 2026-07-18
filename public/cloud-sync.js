import { mergeFavoriteTeams } from "./favorite-teams.js";

export const CLOUD_SESSION_KEY = "football-ai.cloud-session.v1";
export const CLOUD_INITIALIZED_USERS_KEY = "football-ai.cloud-initialized-users.v1";

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

function writeJson(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* El modo local sigue disponible. */ }
}

const MAX_SYNC_EVIDENCE = 25;
const MAX_SYNC_EVIDENCE_TEXT = 16_000;
const MAX_COMPACT_STRING = 4_000;
const AGGRESSIVE_SYNC_EVIDENCE = 10;
const AGGRESSIVE_EVIDENCE_TEXT = 4_000;
const HEAVY_SYNC_KEYS = new Set([
  "raw", "rawData", "dataset", "matchData", "fullDataset", "debug", "logs",
  "apiResponse", "response", "scoreMatrix", "goalMatrix", "matrix"
]);

async function requestJson(path, { method = "GET", token = "", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload.error?.code || payload.code || "";
    const message = payload.error?.message || payload.message || "No fue posible completar la sincronizacion.";
    const error = new Error(code ? `${message} (${code})` : message);
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function sessionExpiry(session) {
  if (Number(session?.expires_at)) return Number(session.expires_at);
  return Math.floor(Date.now() / 1000) + Number(session?.expires_in || 3600);
}

function normalizeSession(payload) {
  const session = payload?.session || payload;
  if (!session?.access_token || !session?.refresh_token) return null;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: sessionExpiry(session),
    user: payload?.user || session.user || null
  };
}

function rowTimestamp(row = {}) {
  return Math.max(0, ...[
    row.updatedAt, row.lastCheckedAt, row.deletedAt, row.resolvedAt,
    row.savedAt, row.createdAt, row.addedAt, row.capturedAt
  ].map((value) => Date.parse(value || "") || 0));
}

function mergeRow(localRow, remoteRow) {
  if (!localRow) return remoteRow;
  if (!remoteRow) return localRow;
  const localTime = rowTimestamp(localRow);
  const remoteTime = rowTimestamp(remoteRow);
  const keepLocalFullEvidence = localTime === remoteTime && remoteRow.compactedForCloud && !localRow.compactedForCloud;
  const localIsNewer = localTime > remoteTime || keepLocalFullEvidence;
  const older = localIsNewer ? remoteRow : localRow;
  const newer = localIsNewer ? localRow : remoteRow;
  const merged = { ...older, ...newer };
  if (Array.isArray(localRow.legs) || Array.isArray(remoteRow.legs)) {
    merged.legs = mergeById(localRow.legs, remoteRow.legs);
  }
  return merged;
}

function mergeById(localRows, remoteRows) {
  const rows = new Map();
  for (const row of Array.isArray(localRows) ? localRows : []) if (row?.id) rows.set(String(row.id), row);
  for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
    if (row?.id) rows.set(String(row.id), mergeRow(rows.get(String(row.id)), row));
  }
  return [...rows.values()];
}

function timestamp(value) {
  return Date.parse(value || "") || 0;
}

function mergePreferences(local = {}, remote = {}) {
  const merged = { ...local, ...remote };
  merged.favoriteTeams = mergeFavoriteTeams(local.favoriteTeams, remote.favoriteTeams);
  const localThemeUpdatedAt = timestamp(local.themeUpdatedAt);
  const remoteThemeUpdatedAt = timestamp(remote.themeUpdatedAt);
  if (local.theme && (localThemeUpdatedAt > remoteThemeUpdatedAt || (localThemeUpdatedAt > 0 && localThemeUpdatedAt === remoteThemeUpdatedAt))) {
    merged.theme = local.theme;
    merged.themeUpdatedAt = local.themeUpdatedAt || remote.themeUpdatedAt || null;
  }
  if (timestamp(local.parlayDraftUpdatedAt) >= timestamp(remote.parlayDraftUpdatedAt) && local.parlayDraftUpdatedAt) {
    merged.parlayDraftUpdatedAt = local.parlayDraftUpdatedAt;
  }
  return merged;
}

function mergeParlayDraft(local = {}, remote = {}) {
  const localUpdatedAt = timestamp(local.preferences?.parlayDraftUpdatedAt);
  const remoteUpdatedAt = timestamp(remote.preferences?.parlayDraftUpdatedAt);
  const remoteDraft = remote.parlay_draft ?? remote.parlayDraft;
  if (localUpdatedAt || remoteUpdatedAt) {
    return localUpdatedAt >= remoteUpdatedAt
      ? (Array.isArray(local.parlayDraft) ? local.parlayDraft : [])
      : (Array.isArray(remoteDraft) ? remoteDraft : []);
  }
  return mergeById(local.parlayDraft, remoteDraft).slice(0, 12);
}

export function mergeCloudState(local = {}, remote = {}) {
  return {
    preferences: mergePreferences(local.preferences, remote.preferences),
    parlayDraft: mergeParlayDraft(local, remote).slice(0, 12),
    savedPicks: mergeById(local.savedPicks, remote.saved_picks ?? remote.savedPicks),
    savedParlays: mergeById(local.savedParlays, remote.saved_parlays ?? remote.savedParlays),
    evidenceSnapshots: mergeById(local.evidenceSnapshots, remote.evidence_snapshots ?? remote.evidenceSnapshots),
    alerts: mergeById(local.alerts, remote.alerts),
    analysisUsage: { ...(local.analysisUsage || {}), ...(remote.analysis_usage ?? remote.analysisUsage ?? {}) },
    updatedAt: remote.updated_at || remote.updatedAt || null
  };
}

function compactNestedValue(value, depth = 0, { maxArray = 80, maxString = MAX_COMPACT_STRING } = {}) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString)}...` : value;
  if (depth >= 6) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, maxArray)
      .map((item) => compactNestedValue(item, depth + 1, { maxArray, maxString }))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (HEAVY_SYNC_KEYS.has(key)) continue;
    const compacted = compactNestedValue(item, depth + 1, { maxArray, maxString });
    if (compacted !== undefined) result[key] = compacted;
  }
  return result;
}

function compactResearchData(researchData) {
  if (!researchData || typeof researchData !== "object") return null;
  return {
    updatedAt: researchData.updatedAt || null,
    sourceCoverage: Array.isArray(researchData.sourceCoverage)
      ? researchData.sourceCoverage.slice(0, 40).map((row) => ({
        module: row?.module || row?.label || row?.moduleKey || null,
        moduleKey: row?.moduleKey || null,
        status: row?.status || null,
        activeSource: row?.activeSource || row?.source || null
      }))
      : []
  };
}

function compactEvidenceSnapshot(row = {}, { maxText = MAX_SYNC_EVIDENCE_TEXT, maxArray = 80 } = {}) {
  const compact = { ...row };
  for (const key of HEAVY_SYNC_KEYS) delete compact[key];
  delete compact.preMatch;
  delete compact.marketAnalysis;
  compact.researchData = compactResearchData(compact.researchData);
  compact.modules = compactNestedValue(compact.modules, 0, { maxArray, maxString: MAX_COMPACT_STRING });
  for (const key of ["text", "content", "summary", "evidenceText"]) {
    if (typeof compact[key] === "string" && compact[key].length > maxText) {
      compact[key] = `${compact[key].slice(0, maxText)}\n\n[Contenido recortado para sincronizacion en linea. La copia local conserva la evidencia completa.]`;
      compact.compactedForCloud = true;
    }
  }
  if (Array.isArray(compact.picks)) compact.picks = compact.picks.slice(0, maxArray);
  if (Array.isArray(compact.recommendedPicks)) compact.recommendedPicks = compact.recommendedPicks.slice(0, Math.min(40, maxArray));
  if (Array.isArray(compact.discardedPicks)) compact.discardedPicks = compact.discardedPicks.slice(0, maxArray);
  compact.compactedForCloud = true;
  return compact;
}

export function compactCloudStateForSync(state = {}, { aggressive = false } = {}) {
  const evidenceLimit = aggressive ? AGGRESSIVE_SYNC_EVIDENCE : MAX_SYNC_EVIDENCE;
  const evidenceTextLimit = aggressive ? AGGRESSIVE_EVIDENCE_TEXT : MAX_SYNC_EVIDENCE_TEXT;
  const maxArray = aggressive ? 30 : 80;
  const evidenceSnapshots = Array.isArray(state.evidenceSnapshots)
    ? [...state.evidenceSnapshots]
      .sort((a, b) => rowTimestamp(b) - rowTimestamp(a))
      .slice(0, evidenceLimit)
      .map((row) => compactEvidenceSnapshot(row, { maxText: evidenceTextLimit, maxArray }))
    : [];
  return {
    ...state,
    parlayDraft: compactNestedValue(state.parlayDraft || [], 0, { maxArray: 12, maxString: MAX_COMPACT_STRING }),
    savedPicks: compactNestedValue(state.savedPicks || [], 0, { maxArray: 500, maxString: aggressive ? 1_500 : MAX_COMPACT_STRING }),
    savedParlays: compactNestedValue(state.savedParlays || [], 0, { maxArray: 200, maxString: aggressive ? 1_500 : MAX_COMPACT_STRING }),
    alerts: compactNestedValue(state.alerts || [], 0, { maxArray: 500, maxString: aggressive ? 1_500 : MAX_COMPACT_STRING }),
    evidenceSnapshots
  };
}

export class CloudSyncClient {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.session = readJson(storage, CLOUD_SESSION_KEY, null);
  }

  async configuration() { return requestJson("/api/cloud/config"); }

  saveSession(payload) {
    this.session = normalizeSession(payload);
    if (this.session) writeJson(this.storage, CLOUD_SESSION_KEY, this.session);
    return this.session;
  }

  clearSession() {
    this.session = null;
    try { this.storage?.removeItem(CLOUD_SESSION_KEY); } catch { /* Sin almacenamiento persistente. */ }
  }

  async signUp(email, password) {
    const payload = await requestJson("/api/cloud/auth/sign-up", { method: "POST", body: { email, password } });
    return { payload, session: this.saveSession(payload) };
  }

  async signIn(email, password) {
    const payload = await requestJson("/api/cloud/auth/sign-in", { method: "POST", body: { email, password } });
    const session = this.saveSession(payload);
    if (!session) throw new Error("Supabase no devolvio una sesion valida.");
    return session;
  }

  async accessToken() {
    if (!this.session?.accessToken) return "";
    if (Number(this.session.expiresAt || 0) > Math.floor(Date.now() / 1000) + 60) return this.session.accessToken;
    try {
      const payload = await requestJson("/api/cloud/auth/refresh", { method: "POST", body: { refreshToken: this.session.refreshToken } });
      return this.saveSession(payload)?.accessToken || "";
    } catch (error) {
      this.clearSession();
      throw error;
    }
  }

  async loadState() {
    const token = await this.accessToken();
    if (!token) return null;
    return (await requestJson("/api/cloud/state", { token })).state;
  }

  async saveState(state) {
    const token = await this.accessToken();
    if (!token) return null;
    try {
      return (await requestJson("/api/cloud/state", { method: "PUT", token, body: compactCloudStateForSync(state) })).state;
    } catch (error) {
      if (error?.status !== 413 && error?.code !== "CLOUD_REQUEST_TOO_LARGE" && error?.code !== "CLOUD_STATE_TOO_LARGE") throw error;
      return (await requestJson("/api/cloud/state", {
        method: "PUT",
        token,
        body: compactCloudStateForSync(state, { aggressive: true })
      })).state;
    }
  }

  async watchEvidence(fixtures) {
    const token = await this.accessToken();
    if (!token) return null;
    return requestJson("/api/cloud/evidence/watch", { method: "POST", token, body: { fixtures } });
  }

  async evidenceAutomationStatus() {
    const token = await this.accessToken();
    if (!token) return null;
    return requestJson("/api/cloud/evidence/status", { token });
  }

  async signOut() {
    const token = await this.accessToken().catch(() => "");
    if (token) await requestJson("/api/cloud/auth/sign-out", { method: "POST", token }).catch(() => null);
    this.clearSession();
  }

  isInitialized(userId) {
    return readJson(this.storage, CLOUD_INITIALIZED_USERS_KEY, []).includes(String(userId || ""));
  }

  markInitialized(userId) {
    const users = new Set(readJson(this.storage, CLOUD_INITIALIZED_USERS_KEY, []));
    users.add(String(userId));
    writeJson(this.storage, CLOUD_INITIALIZED_USERS_KEY, [...users]);
  }
}

export const cloudSyncClient = new CloudSyncClient();
