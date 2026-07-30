import { env } from "../config/env.js";
import { AppError } from "../errors.js";
import { filterValidEvidenceSnapshots } from "../../public/evidence-validity.js";
import { byteLength, recordServiceInitiatedTraffic } from "./bandwidth-observability.service.js";

const MAX_SYNC_BYTES = 1_500_000;
const MAX_WATCHLIST_FIXTURES = 100;
const MAX_AUTOMATIC_EVIDENCE_METADATA_ON_STATE = 100;
const MAX_EVIDENCE_LIBRARY_PAGE = 200;
const MAX_EVIDENCE_LIBRARY_TOTAL = 500;
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

function configured() {
  return Boolean(env.supabaseUrl && env.supabasePublishableKey);
}

export function evidenceAutomationConfigured() {
  return Boolean(configured() && env.supabaseSecretKey && env.dataMode === "live");
}

function baseUrl() {
  return String(env.supabaseUrl || "").replace(/\/+$/, "");
}

function bearerToken(header = "") {
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AppError("Inicia sesion para sincronizar tus datos.", 401, "CLOUD_AUTH_REQUIRED");
  return match[1];
}

function userIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!/^[0-9a-f-]{36}$/i.test(String(payload.sub || ""))) throw new Error("subject invalido");
    return payload.sub;
  } catch {
    throw new AppError("La sesion de sincronizacion no es valida.", 401, "CLOUD_SESSION_INVALID");
  }
}

function validateCredentials({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new AppError("Escribe un correo valido.", 400, "INVALID_EMAIL");
  if (String(password || "").length < 8) throw new AppError("La contrasena debe tener al menos 8 caracteres.", 400, "WEAK_PASSWORD");
  return { email: normalizedEmail, password: String(password) };
}

function providerMessage(error) {
  return String(error?.message || error?.details || error?.hint || error?.payload?.message || error?.payload?.error || "");
}

function isMissingCloudSchema(error) {
  return /user_sync_state|schema cache|could not find|does not exist|42P01|PGRST205/i.test(providerMessage(error));
}

function isMissingEvidenceSchema(error) {
  return /evidence_watchlist|automatic_evidence_snapshots|schema cache|could not find|does not exist|42P01|PGRST205/i.test(providerMessage(error));
}

function isMissingRpc(error, functionName) {
  const message = providerMessage(error);
  return new RegExp(`${functionName}|schema cache|could not find the function|PGRST202`, "i").test(message);
}

function isRpcExecutionFailure(error) {
  return /invalid input syntax for type timestamp|merge_user_sync_state|22P02|PGRST/i.test(providerMessage(error));
}

function normalizedState(value = {}) {
  const arrays = {
    parlay_draft: [value.parlayDraft, 12],
    saved_picks: [value.savedPicks, 500],
    saved_parlays: [value.savedParlays, 200],
    evidence_snapshots: [value.evidenceSnapshots, 50],
    alerts: [value.alerts, 500]
  };
  const state = {
    preferences: compactPreferencesForCloudState(value.preferences),
    analysis_usage: compactAnalysisUsageForCloudState(value.analysisUsage)
  };
  for (const [key, [rows, limit]] of Object.entries(arrays)) {
    const values = key === "evidence_snapshots" ? filterValidEvidenceSnapshots(rows) : rows;
    state[key] = Array.isArray(values) ? values.slice(0, limit) : [];
  }
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_SYNC_BYTES) {
    throw new AppError("Los datos locales exceden el limite de sincronizacion. Descarga evidencias antiguas antes de continuar.", 413, "CLOUD_STATE_TOO_LARGE");
  }
  return state;
}

function mergeRowsById(existingRows, incomingRows, limit) {
  const rows = new Map();
  for (const row of Array.isArray(existingRows) ? existingRows : []) if (row?.id) rows.set(String(row.id), row);
  for (const row of Array.isArray(incomingRows) ? incomingRows : []) if (row?.id) rows.set(String(row.id), row);
  return [...rows.values()].slice(0, limit);
}

function syncTimestamp(value) {
  return Date.parse(value || "") || 0;
}

function mergeNormalizedState(existing = {}, incoming = {}) {
  const existingDraftUpdatedAt = syncTimestamp(existing.preferences?.parlayDraftUpdatedAt);
  const incomingDraftUpdatedAt = syncTimestamp(incoming.preferences?.parlayDraftUpdatedAt);
  const merged = {
    preferences: { ...(existing.preferences || {}), ...(incoming.preferences || {}) },
    parlay_draft: incomingDraftUpdatedAt >= existingDraftUpdatedAt && incomingDraftUpdatedAt
      ? incoming.parlay_draft
      : existingDraftUpdatedAt ? existing.parlay_draft : mergeRowsById(existing.parlay_draft, incoming.parlay_draft, 12),
    saved_picks: mergeRowsById(existing.saved_picks, incoming.saved_picks, 500),
    saved_parlays: mergeRowsById(existing.saved_parlays, incoming.saved_parlays, 200),
    evidence_snapshots: mergeRowsById(existing.evidence_snapshots, incoming.evidence_snapshots, 50),
    alerts: mergeRowsById(existing.alerts, incoming.alerts, 500),
    analysis_usage: { ...(existing.analysis_usage || {}), ...(incoming.analysis_usage || {}) }
  };
  const compacted = compactStateRows(merged);
  if (Buffer.byteLength(JSON.stringify(compacted), "utf8") > MAX_SYNC_BYTES) {
    throw new AppError("Los datos combinados exceden el limite de sincronizacion.", 413, "CLOUD_STATE_TOO_LARGE");
  }
  return compacted;
}

function compactSyncValue(value, depth = 0, { maxArray = 80, maxString = 1_000 } = {}) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString)}...` : value;
  if (depth >= 5) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, maxArray)
      .map((item) => compactSyncValue(item, depth + 1, { maxArray, maxString }))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (HEAVY_SYNC_KEYS.has(key)) continue;
    const compacted = compactSyncValue(item, depth + 1, { maxArray, maxString });
    if (compacted !== undefined) result[key] = compacted;
  }
  return result;
}

function compactPickForCloudState(row = {}) {
  if (!row || typeof row !== "object") return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (!PICK_SYNC_KEYS.has(key) || HEAVY_SYNC_KEYS.has(key)) continue;
    const compacted = compactSyncValue(value, 0, { maxArray: 24, maxString: 1_000 });
    if (compacted !== undefined) result[key] = compacted;
  }
  if (Array.isArray(row.supportingData)) {
    result.supportingData = row.supportingData.slice(0, 8).map((item) => String(item || "").slice(0, 300));
  }
  if (Array.isArray(row.contradictingData)) {
    result.contradictingData = row.contradictingData.slice(0, 8).map((item) => String(item || "").slice(0, 300));
  }
  result.compactedForCloudState = true;
  return result;
}

function compactParlayForCloudState(row = {}) {
  if (!row || typeof row !== "object") return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (!PARLAY_SYNC_KEYS.has(key) || HEAVY_SYNC_KEYS.has(key)) continue;
    const compacted = compactSyncValue(value, 0, { maxArray: 24, maxString: 1_000 });
    if (compacted !== undefined) result[key] = compacted;
  }
  result.legs = Array.isArray(row.legs) ? row.legs.slice(0, 12).map(compactPickForCloudState) : [];
  if (Array.isArray(row.removedLegs)) result.removedLegs = row.removedLegs.slice(0, 150).map(compactPickForCloudState);
  result.compactedForCloudState = true;
  return result;
}

function compactAuditMetricForCloudState(metric = {}) {
  if (!metric || typeof metric !== "object") return undefined;
  const result = {};
  for (const key of AUDIT_METRIC_KEYS) {
    if (metric[key] !== undefined) result[key] = metric[key];
  }
  return Object.keys(result).length ? result : undefined;
}

function compactAuditSummaryForCloudState(summary = {}) {
  if (!summary || typeof summary !== "object") return undefined;
  const result = {};
  for (const key of AUDIT_SUMMARY_KEYS) {
    if (summary[key] !== undefined) result[key] = summary[key];
  }
  const metrics = compactAuditMetricForCloudState(summary.metrics);
  if (metrics) result.metrics = metrics;
  return Object.keys(result).length ? result : undefined;
}

function compactEvidenceAuditsForCloudState(audits = {}) {
  return Object.fromEntries(Object.entries(audits || {})
    .filter(([id, value]) => id && value && typeof value === "object")
    .sort(([, a], [, b]) => syncTimestamp(b?.auditedAt || b?.lastCheckedAt || b?.nextEvaluationAt) - syncTimestamp(a?.auditedAt || a?.lastCheckedAt || a?.nextEvaluationAt))
    .slice(0, 1_000)
    .map(([id, value]) => {
      const audit = {};
      for (const key of ["auditedAt", "lastCheckedAt", "nextEvaluationAt", "pendingCode"]) {
        if (value[key] !== undefined) audit[key] = value[key];
      }
      const summary = compactAuditSummaryForCloudState(value.auditSummary);
      if (summary) audit.auditSummary = summary;
      return [id, audit];
    }));
}

function compactPreferencesForCloudState(preferences = {}) {
  const compact = compactSyncValue(preferences || {}, 0, { maxArray: 120, maxString: 1_000 }) || {};
  compact.favoriteTeams = Array.isArray(preferences?.favoriteTeams)
    ? preferences.favoriteTeams.slice(-200).map((team) => compactSyncValue(team, 0, { maxArray: 12, maxString: 500 }))
    : [];
  compact.removedEvidenceIds = Array.isArray(preferences?.removedEvidenceIds)
    ? [...new Set(preferences.removedEvidenceIds.map(String))].slice(-500)
    : [];
  compact.evidenceAudits = compactEvidenceAuditsForCloudState(preferences?.evidenceAudits);
  compact.performancePreviousRanks = preferences?.performancePreviousRanks && typeof preferences.performancePreviousRanks === "object"
    ? Object.fromEntries(Object.entries(preferences.performancePreviousRanks).slice(-500).map(([key, value]) => [key, Number(value)]))
    : {};
  return compact;
}

function compactAnalysisUsageForCloudState(usage = {}) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return {};
  return compactSyncValue(usage, 0, { maxArray: 30, maxString: 500 }) || {};
}

function compactStateRows(state = {}) {
  return {
    ...(state || {}),
    preferences: compactPreferencesForCloudState(state?.preferences),
    analysis_usage: compactAnalysisUsageForCloudState(state?.analysis_usage),
    parlay_draft: Array.isArray(state?.parlay_draft) ? state.parlay_draft.slice(0, 12).map(compactPickForCloudState) : [],
    saved_picks: Array.isArray(state?.saved_picks) ? state.saved_picks.slice(0, 500).map(compactPickForCloudState) : [],
    saved_parlays: Array.isArray(state?.saved_parlays) ? state.saved_parlays.slice(0, 200).map(compactParlayForCloudState) : [],
    alerts: Array.isArray(state?.alerts) ? state.alerts.slice(0, 500).map((row) => compactSyncValue(row, 0, { maxArray: 24, maxString: 1_000 })) : []
  };
}

async function supabaseRequest(path, { method = "GET", token = "", body, prefer = "" } = {}) {
  if (!configured()) throw new AppError("La sincronizacion en linea no esta configurada.", 503, "CLOUD_NOT_CONFIGURED");
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        apikey: env.supabasePublishableKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(prefer ? { Prefer: prefer } : {})
      },
      ...(bodyText === undefined ? {} : { body: bodyText })
    });
  } catch {
    throw new AppError("No fue posible conectar con la base en linea.", 503, "CLOUD_UNREACHABLE");
  }
  const responseText = response.status === 204 ? "" : await response.text().catch(() => "");
  recordServiceInitiatedTraffic({
    service: "supabase",
    endpoint: path.split("?")[0],
    requestBytes: byteLength(bodyText),
    responseBytes: byteLength(responseText),
    error: !response.ok
  });
  const payload = responseText ? (() => { try { return JSON.parse(responseText); } catch { return null; } })() : null;
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || "Supabase rechazo la solicitud.";
    throw new AppError(message, response.status, "CLOUD_PROVIDER_ERROR", payload || undefined);
  }
  return payload;
}

async function supabaseAdminRequest(path, { method = "GET", body, prefer = "" } = {}) {
  if (!evidenceAutomationConfigured()) {
    throw new AppError("La captura automatica requiere SUPABASE_SECRET_KEY en el backend.", 503, "EVIDENCE_AUTOMATION_NOT_CONFIGURED");
  }
  const secret = env.supabaseSecretKey;
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        apikey: secret,
        "Content-Type": "application/json",
        ...(secret.startsWith("eyJ") ? { Authorization: `Bearer ${secret}` } : {}),
        ...(prefer ? { Prefer: prefer } : {})
      },
      ...(bodyText === undefined ? {} : { body: bodyText })
    });
  } catch {
    throw new AppError("No fue posible conectar con Supabase para automatizar evidencias.", 503, "EVIDENCE_AUTOMATION_UNREACHABLE");
  }
  const responseText = response.status === 204 ? "" : await response.text().catch(() => "");
  recordServiceInitiatedTraffic({
    service: "supabase-admin",
    endpoint: path.split("?")[0],
    requestBytes: byteLength(bodyText),
    responseBytes: byteLength(responseText),
    error: !response.ok
  });
  const payload = responseText ? (() => { try { return JSON.parse(responseText); } catch { return null; } })() : null;
  if (!response.ok) {
    throw new AppError(payload?.message || payload?.error || "Supabase rechazo la automatizacion.", response.status, "EVIDENCE_AUTOMATION_PROVIDER_ERROR");
  }
  return payload;
}

async function supabaseCountRequest(path, { token = "" } = {}) {
  if (!configured()) throw new AppError("La sincronizacion en linea no esta configurada.", 503, "CLOUD_NOT_CONFIGURED");
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: "HEAD",
      headers: {
        apikey: env.supabasePublishableKey,
        "Content-Type": "application/json",
        Prefer: "count=exact",
        Range: "0-0",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  } catch {
    throw new AppError("No fue posible conectar con la base en linea.", 503, "CLOUD_UNREACHABLE");
  }
  recordServiceInitiatedTraffic({
    service: "supabase",
    endpoint: path.split("?")[0],
    requestBytes: 0,
    responseBytes: 0,
    error: !response.ok
  });
  if (!response.ok) throw new AppError("Supabase rechazo el conteo de evidencias.", response.status, "CLOUD_PROVIDER_ERROR");
  const range = response.headers.get("content-range") || "";
  const total = Number(range.split("/").pop());
  return Number.isFinite(total) ? total : 0;
}

function mergeEvidenceSnapshots(manualRows, automaticRows) {
  const rows = new Map();
  for (const row of Array.isArray(manualRows) ? manualRows : []) if (row?.id) rows.set(String(row.id), row);
  for (const row of Array.isArray(automaticRows) ? automaticRows : []) if (row?.snapshot?.id) rows.set(String(row.snapshot.id), row.snapshot);
  return filterValidEvidenceSnapshots([...rows.values()])
    .sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0)).slice(0, 500);
}

function compactCloudStateResponse(state = {}, evidenceSummary = {}) {
  const compactState = compactStateRows(state || {});
  return {
    ...compactState,
    evidence_snapshots: [],
    evidence_sync_summary: {
      compacted: true,
      included: 0,
      automaticAvailable: Number(evidenceSummary.automaticAvailable || 0),
      latestAutomaticCapturedAt: evidenceSummary.latestAutomaticCapturedAt || null,
      note: "El estado de cuenta no descarga evidencias completas para reducir ancho de banda. Las evidencias completas permanecen guardadas en la biblioteca automatica."
    }
  };
}

async function getCloudEvidenceSummary(token) {
  let automaticMetadataRows = [];
  let automaticEvidenceCount = 0;
  try {
    automaticEvidenceCount = await supabaseCountRequest("/rest/v1/automatic_evidence_snapshots?select=fixture_id", { token });
    const payload = await supabaseRequest("/rest/v1/automatic_evidence_snapshots?select=fixture_id,captured_at&order=captured_at.desc&limit=1", { token });
    automaticMetadataRows = Array.isArray(payload) ? payload : [];
  } catch (error) {
    if (!/automatic_evidence_snapshots|schema cache|could not find|does not exist|PGRST205/i.test(providerMessage(error))) throw error;
  }
  return {
    automaticAvailable: automaticEvidenceCount || automaticMetadataRows.length,
    latestAutomaticCapturedAt: automaticMetadataRows[0]?.captured_at || null
  };
}

export async function saveCloudEvidenceSnapshots(authorization, input = {}) {
  const token = bearerToken(authorization);
  const userId = userIdFromToken(token);
  const snapshots = filterValidEvidenceSnapshots(Array.isArray(input.snapshots) ? input.snapshots : []).slice(0, 20)
    .filter((snapshot) => snapshot?.id && typeof snapshot === "object");
  if (!snapshots.length) return { received: 0 };
  const payload = snapshots.map((snapshot) => ({
    user_id: userId,
    fixture_id: String(snapshot.id).slice(0, 240),
    captured_at: Number.isNaN(Date.parse(snapshot.capturedAt || snapshot.updatedAt || ""))
      ? new Date().toISOString()
      : new Date(snapshot.capturedAt || snapshot.updatedAt).toISOString(),
    snapshot
  }));
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 700_000) {
    throw new AppError("El lote de evidencias es demasiado grande para sincronizar.", 413, "CLOUD_EVIDENCE_BATCH_TOO_LARGE");
  }
  await supabaseAdminRequest("/rest/v1/automatic_evidence_snapshots?on_conflict=user_id,fixture_id", {
    method: "POST",
    body: payload,
    prefer: "resolution=ignore-duplicates,return=minimal"
  });
  return { received: payload.length };
}

export async function listCloudEvidenceSnapshots(authorization, input = {}) {
  const token = bearerToken(authorization);
  const limit = Math.max(1, Math.min(MAX_EVIDENCE_LIBRARY_PAGE, Number(input.limit) || MAX_EVIDENCE_LIBRARY_PAGE));
  const offset = Math.max(0, Number(input.offset) || 0);
  if (offset >= MAX_EVIDENCE_LIBRARY_TOTAL) return { snapshots: [], count: 0, offset, limit, nextOffset: null };
  const safeLimit = Math.min(limit, MAX_EVIDENCE_LIBRARY_TOTAL - offset);
  let rows = [];
  try {
    const payload = await supabaseRequest(
      `/rest/v1/automatic_evidence_snapshots?select=fixture_id,captured_at,snapshot&order=captured_at.desc&limit=${safeLimit}&offset=${offset}`,
      { token }
    );
    rows = Array.isArray(payload) ? payload : [];
  } catch (error) {
    if (isMissingEvidenceSchema(error)) {
      return { snapshots: [], count: 0, offset, limit: safeLimit, nextOffset: null, disabledReason: "Ejecuta la migracion 002_automatic_evidence.sql para activar evidencias automaticas." };
    }
    throw error;
  }
  const snapshots = mergeEvidenceSnapshots([], rows);
  const nextOffset = rows.length >= safeLimit && offset + safeLimit < MAX_EVIDENCE_LIBRARY_TOTAL ? offset + safeLimit : null;
  return {
    snapshots,
    count: snapshots.length,
    offset,
    limit: safeLimit,
    nextOffset,
    latestCapturedAt: rows[0]?.captured_at || null
  };
}

function normalizeWatchedFixture(fixture, userId, now = new Date()) {
  const fixtureId = String(fixture?.id || "");
  const fixtureDate = new Date(fixture?.utcDateTime || "");
  if (!/^\d+$/.test(fixtureId) || Number.isNaN(fixtureDate.getTime()) || fixtureDate <= now || fixture?.status !== "scheduled") return null;
  return {
    user_id: userId,
    fixture_id: fixtureId,
    fixture_date: fixtureDate.toISOString(),
    capture_due_at: new Date(fixtureDate.getTime() - 60 * 60 * 1000).toISOString(),
    fixture: {
      id: fixtureId,
      utcDateTime: fixtureDate.toISOString(),
      date: fixture.date || null,
      time: fixture.time || null,
      status: "scheduled",
      statusLabel: fixture.statusLabel || "Programado",
      leagueName: fixture.leagueName || null,
      leagueSlug: fixture.leagueSlug || null,
      leagueId: fixture.leagueId ?? null,
      season: fixture.season ?? null,
      country: fixture.country || null,
      home: fixture.home || null,
      away: fixture.away || null,
      homeTeamId: fixture.homeTeamId ?? null,
      awayTeamId: fixture.awayTeamId ?? null
    },
    status: "scheduled",
    updated_at: now.toISOString()
  };
}

export function cloudConfiguration() {
  return {
    enabled: configured(),
    provider: "supabase",
    synchronization: "account-scoped",
    automaticEvidence: evidenceAutomationConfigured(),
    automaticEvidenceLeadMinutes: 60
  };
}

export async function signUpCloudUser(input) {
  return supabaseRequest("/auth/v1/signup", { method: "POST", body: validateCredentials(input) });
}

export async function signInCloudUser(input) {
  return supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: validateCredentials(input) });
}

export async function refreshCloudSession(refreshToken) {
  if (!refreshToken) throw new AppError("No existe una sesion para renovar.", 401, "CLOUD_REFRESH_REQUIRED");
  return supabaseRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });
}

export async function signOutCloudUser(authorization) {
  const token = bearerToken(authorization);
  await supabaseRequest("/auth/v1/logout", { method: "POST", token });
  return { signedOut: true };
}

export async function getCloudState(authorization) {
  const token = bearerToken(authorization);
  let rows;
  try {
    rows = await supabaseRequest("/rest/v1/user_sync_state?select=preferences,parlay_draft,saved_picks,saved_parlays,alerts,analysis_usage,updated_at&limit=1", { token });
  } catch (error) {
    if (isMissingCloudSchema(error)) {
      throw new AppError("La tabla de sincronizacion no esta disponible en Supabase. Ejecuta las migraciones cloud y recarga el schema cache.", 503, "CLOUD_SCHEMA_MISSING");
    }
    throw error;
  }
  const state = Array.isArray(rows) ? rows[0] || null : null;
  const evidenceSummary = await getCloudEvidenceSummary(token);
  if (!state && !evidenceSummary.automaticAvailable) return null;
  return compactCloudStateResponse(state, evidenceSummary);
}

export async function saveCloudState(authorization, input) {
  const token = bearerToken(authorization);
  const state = normalizedState(input);
  const userId = userIdFromToken(token);
  let existingRows;
  try {
    existingRows = await supabaseRequest("/rest/v1/user_sync_state?select=preferences,parlay_draft,saved_picks,saved_parlays,alerts,analysis_usage&limit=1", { token });
  } catch (error) {
    if (isMissingCloudSchema(error)) {
      throw new AppError("La tabla de sincronizacion no esta disponible en Supabase. Ejecuta las migraciones cloud y recarga el schema cache.", 503, "CLOUD_SCHEMA_MISSING");
    }
    throw error;
  }
  const existing = Array.isArray(existingRows) ? existingRows[0] || {} : {};
  const merged = mergeNormalizedState(existing, state);
  const { evidence_snapshots: _evidenceSnapshots, ...mergedWithoutEvidence } = merged;
  const payload = { user_id: userId, ...compactStateRows(mergedWithoutEvidence), updated_at: new Date().toISOString() };
  try {
    await supabaseRequest("/rest/v1/user_sync_state?on_conflict=user_id", {
      method: "POST", token, body: payload, prefer: "resolution=merge-duplicates,return=minimal"
    });
  } catch (error) {
    if (isMissingCloudSchema(error)) {
      throw new AppError("La tabla de sincronizacion no esta disponible en Supabase. Ejecuta las migraciones cloud y recarga el schema cache.", 503, "CLOUD_SCHEMA_MISSING");
    }
    throw error;
  }
  return compactCloudStateResponse(payload);
}

export async function registerEvidenceWatchlist(authorization, input = {}) {
  const token = bearerToken(authorization);
  const userId = userIdFromToken(token);
  const now = new Date();
  const requestedFixtures = (Array.isArray(input.fixtures) ? input.fixtures : [])
    .slice(0, MAX_WATCHLIST_FIXTURES)
    .map((fixture) => normalizeWatchedFixture(fixture, userId, now))
    .filter(Boolean);
  const future = encodeURIComponent(now.toISOString());
  let activeRows;
  try {
    activeRows = await supabaseRequest(`/rest/v1/evidence_watchlist?select=fixture_id,fixture_date,capture_due_at&status=eq.scheduled&fixture_date=gt.${future}&limit=${MAX_WATCHLIST_FIXTURES}`, { token });
  } catch (error) {
    if (isMissingEvidenceSchema(error)) {
      return {
        configured: evidenceAutomationConfigured(),
        leadMinutes: 60,
        watched: 0,
        scheduled: 0,
        captured: 0,
        failed: 0,
        registered: 0,
        ignoredByLimit: 0,
        disabledReason: "Ejecuta la migracion 002_automatic_evidence.sql para activar evidencias automaticas."
      };
    }
    throw error;
  }
  const activeById = new Map((Array.isArray(activeRows) ? activeRows : []).map((row) => [String(row.fixture_id), row]));
  const activeIds = new Set(activeById.keys());
  let availableSlots = Math.max(0, MAX_WATCHLIST_FIXTURES - activeIds.size);
  const fixtures = requestedFixtures.filter((fixture) => {
    if (activeIds.has(fixture.fixture_id)) return true;
    if (availableSlots <= 0) return false;
    availableSlots -= 1;
    return true;
  });
  if (fixtures.length) {
    try {
      await supabaseRequest("/rest/v1/evidence_watchlist?on_conflict=user_id,fixture_id", {
        method: "POST",
        token,
        body: fixtures,
        prefer: "resolution=ignore-duplicates,return=minimal"
      });
    } catch (error) {
      if (!isMissingEvidenceSchema(error)) throw error;
      return {
        configured: evidenceAutomationConfigured(),
        leadMinutes: 60,
        watched: activeIds.size,
        scheduled: activeIds.size,
        captured: 0,
        failed: 0,
        registered: 0,
        ignoredByLimit: 0,
        disabledReason: "Ejecuta la migracion 002_automatic_evidence.sql para activar evidencias automaticas."
      };
    }
  }
  const changedScheduledFixtures = fixtures.filter((fixture) => {
    const current = activeById.get(String(fixture.fixture_id));
    return current && (current.fixture_date !== fixture.fixture_date || current.capture_due_at !== fixture.capture_due_at);
  });
  for (const fixture of changedScheduledFixtures.slice(0, 10)) {
    await supabaseRequest(`/rest/v1/evidence_watchlist?fixture_id=eq.${encodeURIComponent(fixture.fixture_id)}&status=eq.scheduled`, {
      method: "PATCH",
      token,
      body: {
        fixture_date: fixture.fixture_date,
        capture_due_at: fixture.capture_due_at,
        fixture: fixture.fixture,
        updated_at: now.toISOString()
      },
      prefer: "return=minimal"
    });
  }
  return getEvidenceAutomationStatus(authorization, {
    registered: fixtures.length,
    refreshed: changedScheduledFixtures.length,
    ignoredByLimit: Math.max(0, requestedFixtures.length - fixtures.length)
  });
}

export async function getEvidenceAutomationStatus(authorization, extra = {}) {
  const token = bearerToken(authorization);
  let rows;
  try {
    rows = await supabaseRequest("/rest/v1/evidence_watchlist?select=fixture_id,fixture_date,status,captured_at,last_error&order=fixture_date.asc&limit=100", { token });
  } catch (error) {
    if (isMissingEvidenceSchema(error)) {
      return {
        configured: evidenceAutomationConfigured(),
        leadMinutes: 60,
        watched: 0,
        scheduled: 0,
        captured: 0,
        failed: 0,
        disabledReason: "Ejecuta la migracion 002_automatic_evidence.sql para activar evidencias automaticas.",
        ...extra
      };
    }
    throw error;
  }
  const watched = Array.isArray(rows) ? rows : [];
  const counts = watched.reduce((result, row) => ({ ...result, [row.status]: (result[row.status] || 0) + 1 }), {});
  const evidenceSummary = await getCloudEvidenceSummary(token);
  return {
    configured: evidenceAutomationConfigured(),
    leadMinutes: 60,
    watched: watched.length,
    scheduled: counts.scheduled || 0,
    captured: counts.captured || 0,
    failed: counts.failed || 0,
    automaticAvailable: evidenceSummary.automaticAvailable,
    latestAutomaticCapturedAt: evidenceSummary.latestAutomaticCapturedAt,
    ...extra
  };
}

export async function listDueEvidenceWatchlist(now = new Date(), limit = 10) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
  const timestamp = encodeURIComponent(now.toISOString());
  const rows = await supabaseAdminRequest(`/rest/v1/evidence_watchlist?select=*&status=eq.scheduled&capture_due_at=lte.${timestamp}&order=capture_due_at.asc&limit=${safeLimit}`);
  return Array.isArray(rows) ? rows : [];
}

export async function saveAutomaticEvidence(row, snapshot, now = new Date()) {
  const capturedAt = snapshot.capturedAt || now.toISOString();
  await supabaseAdminRequest("/rest/v1/automatic_evidence_snapshots?on_conflict=user_id,fixture_id", {
    method: "POST",
    body: { user_id: row.user_id, fixture_id: String(row.fixture_id), captured_at: capturedAt, snapshot },
    prefer: "resolution=merge-duplicates,return=minimal"
  });
  return updateEvidenceWatchlist(row, {
    status: "captured",
    captured_at: capturedAt,
    last_error: null,
    attempts: Number(row.attempts || 0) + 1,
    updated_at: now.toISOString()
  });
}

export async function updateEvidenceWatchlist(row, changes) {
  const userId = encodeURIComponent(String(row.user_id));
  const fixtureId = encodeURIComponent(String(row.fixture_id));
  await supabaseAdminRequest(`/rest/v1/evidence_watchlist?user_id=eq.${userId}&fixture_id=eq.${fixtureId}`, {
    method: "PATCH",
    body: changes,
    prefer: "return=minimal"
  });
}

export const cloudSyncInternals = { bearerToken, compactCloudStateResponse, isMissingCloudSchema, isMissingEvidenceSchema, isMissingRpc, isRpcExecutionFailure, mergeEvidenceSnapshots, mergeNormalizedState, normalizedState, normalizeWatchedFixture, providerMessage, userIdFromToken, validateCredentials };
