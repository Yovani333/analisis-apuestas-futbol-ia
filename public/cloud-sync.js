import { mergeFavoriteTeams } from "./favorite-teams.js";
import { filterValidEvidenceSnapshots, isValidEvidenceSnapshot } from "./evidence-validity.js";

export const CLOUD_SESSION_KEY = "football-ai.cloud-session.v1";
export const CLOUD_INITIALIZED_USERS_KEY = "football-ai.cloud-initialized-users.v1";
export const CLOUD_EVIDENCE_FINGERPRINT_KEY = "football-ai.cloud-evidence-fingerprint.v1";

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
  "apiResponse", "response", "scoreMatrix", "goalMatrix", "matrix",
  "snapshot", "evidence", "evidenceSnapshot", "fixtureAnalysisData", "analysisDetails",
  "calculationDetails", "calculation", "modelDetails", "diagnostics", "diagnostic",
  "explanationLong", "rawOdds", "allOdds", "availableOdds", "markets", "players",
  "statistics", "events", "lineups", "injuries", "weather", "researchData", "modules"
]);
const PICK_SYNC_KEYS = new Set([
  "id", "fixtureId", "matchId", "league", "leagueId", "league_id", "leagueSlug",
  "competition", "season", "home", "away", "homeTeam", "awayTeam", "teamName",
  "opponentName", "teamId", "playerId", "playerName", "date", "fixtureDate",
  "market", "selection", "marketCode", "selectionCode", "decimalOdds", "originalOdds",
  "updatedOdds", "impliedProbability", "modelProbability", "estimatedProbability",
  "expectedValue", "confidence", "effectiveConfidenceScore", "risk", "color",
  "sourceModule", "source", "sourceLabel", "origin", "originLabel", "bookmaker",
  "result", "resultSource", "settlementVerificationVersion", "fixtureStatus", "status",
  "finalScore", "liveScore", "liveMinute", "score", "notes", "addedAt", "savedAt",
  "createdAt", "updatedAt", "lastCheckedAt", "resolvedAt", "trashed", "deletedAt",
  "deletedPermanently", "restoredAt", "removedFromParlayAt", "restoredToParlayAt",
  "purgedAt", "analysisTiming", "oddsMovement", "goalThreatScore"
]);
const PARLAY_SYNC_KEYS = new Set([
  "id", "name", "createdAt", "updatedAt", "result", "notes", "collapsed",
  "lastCheckedAt", "trashed", "deletedAt", "deletedPermanently", "restoredAt"
]);
const AUDIT_SUMMARY_KEYS = new Set([
  "evaluablePicks", "decisivePicks", "discardedPicks", "counterfactualAssessable",
  "counterfactualHits", "counterfactualMisses", "completed", "hits", "misses",
  "voids", "finalScore", "auditSchemaVersion"
]);
const AUDIT_METRIC_KEYS = new Set([
  "total", "decisive", "hits", "misses", "voids", "noBets", "eligible",
  "hitRate", "ROI", "calibrationSample", "brier", "logLoss", "ECE"
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
    row.updatedAt, row.lastCheckedAt, row.deletedAt, row.resolvedAt, row.auditedAt,
    row.savedAt, row.createdAt, row.addedAt, row.capturedAt,
    row.removedFromParlayAt, row.restoredToParlayAt, row.purgedAt
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
  if (Array.isArray(localRow.removedLegs) || Array.isArray(remoteRow.removedLegs)) {
    merged.removedLegs = mergeById(localRow.removedLegs, remoteRow.removedLegs);
    const activeById = new Map(merged.legs?.map((leg) => [String(leg.id), leg]) || []);
    const removedById = new Map(merged.removedLegs.map((leg) => [String(leg.id), leg]));
    for (const [id, removed] of removedById) {
      const active = activeById.get(id);
      const restoredAt = timestamp(active?.restoredToParlayAt);
      const removedAt = Math.max(timestamp(removed.removedFromParlayAt), timestamp(removed.purgedAt));
      if (restoredAt > removedAt) removedById.delete(id);
      else activeById.delete(id);
    }
    merged.legs = [...activeById.values()];
    merged.removedLegs = [...removedById.values()];
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
  merged.removedEvidenceIds = [...new Set([
    ...(Array.isArray(local.removedEvidenceIds) ? local.removedEvidenceIds : []),
    ...(Array.isArray(remote.removedEvidenceIds) ? remote.removedEvidenceIds : [])
  ].map(String))].slice(-500);
  merged.evidenceAudits = mergeById(
    Object.entries(local.evidenceAudits || {}).map(([id, value]) => ({ id, ...value })),
    Object.entries(remote.evidenceAudits || {}).map(([id, value]) => ({ id, ...value }))
  ).reduce((records, { id, ...value }) => merged.removedEvidenceIds.includes(String(id)) ? records : ({ ...records, [id]: value }), {});
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

function compactAuditMetricForSync(metric = {}) {
  if (!metric || typeof metric !== "object") return undefined;
  const result = {};
  for (const key of AUDIT_METRIC_KEYS) {
    if (metric[key] !== undefined) result[key] = metric[key];
  }
  return Object.keys(result).length ? result : undefined;
}

function compactAuditSummaryForSync(summary = {}) {
  if (!summary || typeof summary !== "object") return undefined;
  const result = {};
  for (const key of AUDIT_SUMMARY_KEYS) {
    if (summary[key] !== undefined) result[key] = summary[key];
  }
  const metrics = compactAuditMetricForSync(summary.metrics);
  if (metrics) result.metrics = metrics;
  return Object.keys(result).length ? result : undefined;
}

function compactEvidenceAuditsForSync(audits = {}) {
  const entries = Object.entries(audits || {})
    .filter(([id, value]) => id && value && typeof value === "object")
    .sort(([, a], [, b]) => rowTimestamp(b) - rowTimestamp(a))
    .slice(0, 1_000);
  return Object.fromEntries(entries.map(([id, value]) => {
    const audit = {};
    for (const key of ["auditedAt", "lastCheckedAt", "nextEvaluationAt", "pendingCode"]) {
      if (value[key] !== undefined) audit[key] = value[key];
    }
    const summary = compactAuditSummaryForSync(value.auditSummary);
    if (summary) audit.auditSummary = summary;
    return [id, audit];
  }));
}

function compactPreferencesForSync(preferences = {}) {
  const compact = compactNestedValue(preferences || {}, 0, { maxArray: 120, maxString: 1_000 }) || {};
  compact.favoriteTeams = Array.isArray(preferences.favoriteTeams)
    ? preferences.favoriteTeams.slice(-200).map((team) => compactNestedValue(team, 0, { maxArray: 12, maxString: 500 }))
    : [];
  compact.removedEvidenceIds = Array.isArray(preferences.removedEvidenceIds)
    ? [...new Set(preferences.removedEvidenceIds.map(String))].slice(-500)
    : [];
  compact.evidenceAudits = compactEvidenceAuditsForSync(preferences.evidenceAudits);
  compact.performancePreviousRanks = preferences.performancePreviousRanks && typeof preferences.performancePreviousRanks === "object"
    ? Object.fromEntries(Object.entries(preferences.performancePreviousRanks).slice(-500).map(([key, value]) => [key, Number(value)]))
    : {};
  return compact;
}

function compactAnalysisUsageForSync(usage = {}) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return {};
  return compactNestedValue(usage, 0, { maxArray: 30, maxString: 500 }) || {};
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
  const preferences = mergePreferences(local.preferences, remote.preferences);
  const removedIds = new Set(preferences.removedEvidenceIds || []);
  const mergedEvidence = mergeById(local.evidenceSnapshots, remote.evidence_snapshots ?? remote.evidenceSnapshots);
  const invalidIds = mergedEvidence.filter((row) => row?.id && !isValidEvidenceSnapshot(row)).map((row) => String(row.id));
  preferences.removedEvidenceIds = [...new Set([...removedIds, ...invalidIds])].slice(-500);
  const evidenceSnapshots = filterValidEvidenceSnapshots(mergedEvidence)
    .filter((row) => !preferences.removedEvidenceIds.includes(String(row.id)));
  return {
    preferences,
    parlayDraft: mergeParlayDraft(local, remote).slice(0, 12),
    savedPicks: mergeById(local.savedPicks, remote.saved_picks ?? remote.savedPicks),
    savedParlays: mergeById(local.savedParlays, remote.saved_parlays ?? remote.savedParlays),
    evidenceSnapshots,
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

function compactSyncString(value, maxString = MAX_COMPACT_STRING) {
  if (typeof value !== "string") return value;
  return value.length > maxString ? `${value.slice(0, maxString)}...` : value;
}

function compactPickForSync(row = {}, { aggressive = false } = {}) {
  if (!row || typeof row !== "object") return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (!PICK_SYNC_KEYS.has(key) || HEAVY_SYNC_KEYS.has(key)) continue;
    const compacted = compactNestedValue(value, 0, { maxArray: aggressive ? 12 : 24, maxString: aggressive ? 500 : 1_000 });
    if (compacted !== undefined) result[key] = compacted;
  }
  if (Array.isArray(row.supportingData)) {
    result.supportingData = row.supportingData.slice(0, aggressive ? 4 : 8)
      .map((item) => compactSyncString(String(item || ""), aggressive ? 180 : 300));
  }
  if (Array.isArray(row.contradictingData)) {
    result.contradictingData = row.contradictingData.slice(0, aggressive ? 4 : 8)
      .map((item) => compactSyncString(String(item || ""), aggressive ? 180 : 300));
  }
  result.compactedForCloudState = true;
  return result;
}

function compactParlayForSync(row = {}, { aggressive = false } = {}) {
  if (!row || typeof row !== "object") return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (!PARLAY_SYNC_KEYS.has(key) || HEAVY_SYNC_KEYS.has(key)) continue;
    const compacted = compactNestedValue(value, 0, { maxArray: aggressive ? 12 : 24, maxString: aggressive ? 500 : 1_000 });
    if (compacted !== undefined) result[key] = compacted;
  }
  result.legs = Array.isArray(row.legs) ? row.legs.slice(0, 12).map((leg) => compactPickForSync(leg, { aggressive })) : [];
  if (Array.isArray(row.removedLegs)) {
    result.removedLegs = row.removedLegs.slice(0, aggressive ? 50 : 150).map((leg) => compactPickForSync(leg, { aggressive }));
  }
  result.compactedForCloudState = true;
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

export function prepareEvidenceSyncBatches(rows = [], batchSize = 10) {
  const size = Math.max(1, Math.min(20, Number(batchSize) || 10));
  const unique = new Map();
  for (const row of filterValidEvidenceSnapshots(rows)) {
    if (!row?.id) continue;
    const current = unique.get(String(row.id));
    if (!current || rowTimestamp(row) >= rowTimestamp(current)) unique.set(String(row.id), row);
  }
  const compacted = [...unique.values()]
    .sort((a, b) => rowTimestamp(b) - rowTimestamp(a))
    .map((row) => compactEvidenceSnapshot(row, { maxText: AGGRESSIVE_EVIDENCE_TEXT, maxArray: 40 }));
  return Array.from({ length: Math.ceil(compacted.length / size) }, (_, index) => compacted.slice(index * size, (index + 1) * size));
}

export function compactCloudStateForSync(state = {}, { aggressive = false } = {}) {
  return {
    ...state,
    preferences: compactPreferencesForSync(state.preferences),
    analysisUsage: compactAnalysisUsageForSync(state.analysisUsage),
    parlayDraft: compactNestedValue(state.parlayDraft || [], 0, { maxArray: 12, maxString: MAX_COMPACT_STRING }),
    savedPicks: Array.isArray(state.savedPicks) ? state.savedPicks.slice(0, 500).map((row) => compactPickForSync(row, { aggressive })) : [],
    savedParlays: Array.isArray(state.savedParlays) ? state.savedParlays.slice(0, 200).map((row) => compactParlayForSync(row, { aggressive })) : [],
    alerts: compactNestedValue(state.alerts || [], 0, { maxArray: 500, maxString: aggressive ? 1_500 : MAX_COMPACT_STRING }),
    evidenceSnapshots: []
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

  async loadEvidenceSnapshots({ limit = 200, max = 500 } = {}) {
    const token = await this.accessToken();
    if (!token) return { snapshots: [], count: 0 };
    const rows = [];
    let offset = 0;
    const pageLimit = Math.max(1, Math.min(200, Number(limit) || 200));
    const maxRows = Math.max(1, Math.min(500, Number(max) || 500));
    while (offset !== null && rows.length < maxRows) {
      const page = await requestJson(`/api/cloud/evidence/snapshots?limit=${pageLimit}&offset=${offset}`, { token });
      const snapshots = Array.isArray(page.snapshots) ? page.snapshots : [];
      rows.push(...snapshots);
      offset = page.nextOffset === null || page.nextOffset === undefined ? null : Number(page.nextOffset);
      if (!snapshots.length) break;
    }
    const unique = new Map();
    for (const snapshot of filterValidEvidenceSnapshots(rows)) {
      if (!snapshot?.id) continue;
      const current = unique.get(String(snapshot.id));
      if (!current || rowTimestamp(snapshot) >= rowTimestamp(current)) unique.set(String(snapshot.id), snapshot);
    }
    return {
      snapshots: [...unique.values()].slice(0, maxRows),
      count: unique.size
    };
  }

  async saveState(state) {
    const token = await this.accessToken();
    if (!token) return null;
    try {
      await this.saveEvidenceSnapshots(state.evidenceSnapshots, token);
      this.evidenceSyncError = "";
    } catch (error) {
      // El estado compacto sigue sincronizándose y la copia local nunca se elimina.
      this.evidenceSyncError = error.message || "No fue posible sincronizar el archivo completo de evidencias.";
    }
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

  async saveEvidenceSnapshots(rows, existingToken = "") {
    const token = existingToken || await this.accessToken();
    if (!token) return { received: 0 };
    const batches = prepareEvidenceSyncBatches(rows);
    const fingerprint = batches.flat().map((row) => `${row.id}:${row.capturedAt || row.updatedAt || ""}`).join("|");
    const userId = this.session?.user?.id || this.session?.user?.sub || "default";
    const fingerprintKey = `${CLOUD_EVIDENCE_FINGERPRINT_KEY}:${userId}`;
    const storedFingerprint = readJson(this.storage, fingerprintKey, "");
    if (fingerprint && (fingerprint === this.evidenceFingerprint || fingerprint === storedFingerprint)) return { received: batches.flat().length, unchanged: true };
    let received = 0;
    for (const snapshots of batches) {
      const result = await requestJson("/api/cloud/evidence/sync", { method: "POST", token, body: { snapshots } });
      received += Number(result.received || 0);
    }
    this.evidenceFingerprint = fingerprint;
    if (fingerprint) writeJson(this.storage, fingerprintKey, fingerprint);
    return { received };
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

  async neuralDatasetSummary() {
    const token = await this.accessToken();
    if (!token) throw new Error("Inicia sesión para preparar el dataset neuronal.");
    return requestJson("/api/audit/neural-dataset", { token });
  }

  async backfillNeuralDataset({ limit = 5, dryRun = false } = {}) {
    const token = await this.accessToken();
    if (!token) throw new Error("Inicia sesión para preparar el dataset neuronal.");
    return requestJson("/api/audit/neural-dataset/backfill", {
      method: "POST", token, body: { limit: Math.max(1, Math.min(10, Number(limit) || 5)), dryRun: Boolean(dryRun) }
    });
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
