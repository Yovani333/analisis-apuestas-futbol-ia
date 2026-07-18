import { env } from "../config/env.js";
import { AppError } from "../errors.js";

const MAX_SYNC_BYTES = 1_500_000;
const MAX_WATCHLIST_FIXTURES = 100;

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
    preferences: value.preferences && typeof value.preferences === "object" && !Array.isArray(value.preferences) ? value.preferences : {},
    analysis_usage: value.analysisUsage && typeof value.analysisUsage === "object" && !Array.isArray(value.analysisUsage) ? value.analysisUsage : {}
  };
  for (const [key, [rows, limit]] of Object.entries(arrays)) state[key] = Array.isArray(rows) ? rows.slice(0, limit) : [];
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
  if (Buffer.byteLength(JSON.stringify(merged), "utf8") > MAX_SYNC_BYTES) {
    throw new AppError("Los datos combinados exceden el limite de sincronizacion.", 413, "CLOUD_STATE_TOO_LARGE");
  }
  return merged;
}

async function supabaseRequest(path, { method = "GET", token = "", body, prefer = "" } = {}) {
  if (!configured()) throw new AppError("La sincronizacion en linea no esta configurada.", 503, "CLOUD_NOT_CONFIGURED");
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new AppError("No fue posible conectar con la base en linea.", 503, "CLOUD_UNREACHABLE");
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new AppError("No fue posible conectar con Supabase para automatizar evidencias.", 503, "EVIDENCE_AUTOMATION_UNREACHABLE");
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new AppError(payload?.message || payload?.error || "Supabase rechazo la automatizacion.", response.status, "EVIDENCE_AUTOMATION_PROVIDER_ERROR");
  }
  return payload;
}

function mergeEvidenceSnapshots(manualRows, automaticRows) {
  const rows = new Map();
  for (const row of Array.isArray(manualRows) ? manualRows : []) if (row?.id) rows.set(String(row.id), row);
  for (const row of Array.isArray(automaticRows) ? automaticRows : []) if (row?.snapshot?.id) rows.set(String(row.snapshot.id), row.snapshot);
  return [...rows.values()].sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0)).slice(0, 50);
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
    rows = await supabaseRequest("/rest/v1/user_sync_state?select=preferences,parlay_draft,saved_picks,saved_parlays,evidence_snapshots,alerts,analysis_usage,updated_at&limit=1", { token });
  } catch (error) {
    if (isMissingCloudSchema(error)) {
      throw new AppError("La tabla de sincronizacion no esta disponible en Supabase. Ejecuta las migraciones cloud y recarga el schema cache.", 503, "CLOUD_SCHEMA_MISSING");
    }
    throw error;
  }
  const state = Array.isArray(rows) ? rows[0] || null : null;
  let automaticRows = [];
  try {
    const payload = await supabaseRequest("/rest/v1/automatic_evidence_snapshots?select=snapshot,captured_at&order=captured_at.desc&limit=50", { token });
    automaticRows = Array.isArray(payload) ? payload : [];
  } catch (error) {
    if (!/automatic_evidence_snapshots|schema cache|could not find|does not exist|PGRST205/i.test(providerMessage(error))) throw error;
  }
  if (!state && !automaticRows.length) return null;
  return {
    ...(state || { preferences: {}, parlay_draft: [], saved_picks: [], saved_parlays: [], alerts: [], analysis_usage: {} }),
    evidence_snapshots: mergeEvidenceSnapshots(state?.evidence_snapshots, automaticRows)
  };
}

export async function saveCloudState(authorization, input) {
  const token = bearerToken(authorization);
  const state = normalizedState(input);
  const userId = userIdFromToken(token);
  try {
    const rows = await supabaseRequest("/rest/v1/rpc/merge_user_sync_state_v2", {
      method: "POST",
      token,
      body: {
        p_preferences: state.preferences,
        p_parlay_draft: state.parlay_draft,
        p_saved_picks: state.saved_picks,
        p_saved_parlays: state.saved_parlays,
        p_evidence_snapshots: state.evidence_snapshots,
        p_alerts: state.alerts,
        p_analysis_usage: state.analysis_usage
      }
    });
    return Array.isArray(rows) ? rows[0] || state : rows;
  } catch (error) {
    if (!isMissingRpc(error, "merge_user_sync_state_v2") && !isRpcExecutionFailure(error)) throw error;
  }
  try {
    const rows = await supabaseRequest("/rest/v1/rpc/merge_user_sync_state", {
      method: "POST",
      token,
      body: {
        p_preferences: state.preferences,
        p_parlay_draft: state.parlay_draft,
        p_saved_picks: state.saved_picks,
        p_saved_parlays: state.saved_parlays,
        p_evidence_snapshots: state.evidence_snapshots,
        p_alerts: state.alerts,
        p_analysis_usage: state.analysis_usage
      }
    });
    return Array.isArray(rows) ? rows[0] || state : rows;
  } catch (error) {
    if (!isMissingRpc(error, "merge_user_sync_state") && !isRpcExecutionFailure(error)) throw error;
  }
  let existingRows;
  try {
    existingRows = await supabaseRequest("/rest/v1/user_sync_state?select=preferences,parlay_draft,saved_picks,saved_parlays,evidence_snapshots,alerts,analysis_usage&limit=1", { token });
  } catch (error) {
    if (isMissingCloudSchema(error)) {
      throw new AppError("La tabla de sincronizacion no esta disponible en Supabase. Ejecuta las migraciones cloud y recarga el schema cache.", 503, "CLOUD_SCHEMA_MISSING");
    }
    throw error;
  }
  const existing = Array.isArray(existingRows) ? existingRows[0] || {} : {};
  const merged = mergeNormalizedState(existing, state);
  const payload = { user_id: userId, ...merged, updated_at: new Date().toISOString() };
  let rows;
  try {
    rows = await supabaseRequest("/rest/v1/user_sync_state?on_conflict=user_id", {
      method: "POST", token, body: payload, prefer: "resolution=merge-duplicates,return=representation"
    });
  } catch (error) {
    if (isMissingCloudSchema(error)) {
      throw new AppError("La tabla de sincronizacion no esta disponible en Supabase. Ejecuta las migraciones cloud y recarga el schema cache.", 503, "CLOUD_SCHEMA_MISSING");
    }
    throw error;
  }
  return Array.isArray(rows) ? rows[0] || payload : payload;
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
    activeRows = await supabaseRequest(`/rest/v1/evidence_watchlist?select=fixture_id&status=eq.scheduled&fixture_date=gt.${future}&limit=${MAX_WATCHLIST_FIXTURES}`, { token });
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
  const activeIds = new Set((Array.isArray(activeRows) ? activeRows : []).map((row) => String(row.fixture_id)));
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
  return getEvidenceAutomationStatus(authorization, {
    registered: fixtures.length,
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
  return {
    configured: evidenceAutomationConfigured(),
    leadMinutes: 60,
    watched: watched.length,
    scheduled: counts.scheduled || 0,
    captured: counts.captured || 0,
    failed: counts.failed || 0,
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

export const cloudSyncInternals = { bearerToken, isMissingCloudSchema, isMissingEvidenceSchema, isMissingRpc, isRpcExecutionFailure, mergeEvidenceSnapshots, mergeNormalizedState, normalizedState, normalizeWatchedFixture, providerMessage, userIdFromToken, validateCredentials };
