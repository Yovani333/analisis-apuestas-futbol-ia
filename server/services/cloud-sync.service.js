import { env } from "../config/env.js";
import { AppError } from "../errors.js";

const MAX_SYNC_BYTES = 1_500_000;

function configured() {
  return Boolean(env.supabaseUrl && env.supabasePublishableKey);
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
    throw new AppError(message, response.status, "CLOUD_PROVIDER_ERROR");
  }
  return payload;
}

export function cloudConfiguration() {
  return { enabled: configured(), provider: "supabase", synchronization: "account-scoped" };
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
  const rows = await supabaseRequest("/rest/v1/user_sync_state?select=preferences,parlay_draft,saved_picks,saved_parlays,evidence_snapshots,alerts,analysis_usage,updated_at&limit=1", { token });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function saveCloudState(authorization, input) {
  const token = bearerToken(authorization);
  const state = normalizedState(input);
  const payload = { user_id: userIdFromToken(token), ...state, updated_at: new Date().toISOString() };
  const rows = await supabaseRequest("/rest/v1/user_sync_state?on_conflict=user_id", {
    method: "POST", token, body: payload, prefer: "resolution=merge-duplicates,return=representation"
  });
  return Array.isArray(rows) ? rows[0] || payload : payload;
}

export const cloudSyncInternals = { bearerToken, normalizedState, userIdFromToken, validateCredentials };
