export const CLOUD_SESSION_KEY = "football-ai.cloud-session.v1";
export const CLOUD_INITIALIZED_USERS_KEY = "football-ai.cloud-initialized-users.v1";

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

function writeJson(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* El modo local sigue disponible. */ }
}

async function requestJson(path, { method = "GET", token = "", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || "No fue posible completar la sincronizacion.");
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

function mergeById(localRows, remoteRows) {
  const rows = new Map();
  for (const row of Array.isArray(localRows) ? localRows : []) if (row?.id) rows.set(String(row.id), row);
  for (const row of Array.isArray(remoteRows) ? remoteRows : []) if (row?.id) rows.set(String(row.id), row);
  return [...rows.values()];
}

export function mergeCloudState(local = {}, remote = {}) {
  return {
    preferences: { ...(local.preferences || {}), ...(remote.preferences || {}) },
    parlayDraft: mergeById(local.parlayDraft, remote.parlay_draft ?? remote.parlayDraft).slice(0, 12),
    savedPicks: mergeById(local.savedPicks, remote.saved_picks ?? remote.savedPicks),
    savedParlays: mergeById(local.savedParlays, remote.saved_parlays ?? remote.savedParlays),
    evidenceSnapshots: mergeById(local.evidenceSnapshots, remote.evidence_snapshots ?? remote.evidenceSnapshots),
    alerts: mergeById(local.alerts, remote.alerts),
    analysisUsage: { ...(local.analysisUsage || {}), ...(remote.analysis_usage ?? remote.analysisUsage ?? {}) },
    updatedAt: remote.updated_at || remote.updatedAt || null
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
    return (await requestJson("/api/cloud/state", { method: "PUT", token, body: state })).state;
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
