import { env } from "../config/env.js";

const TABLE = "bandwidth_observability_windows";

function configured() {
  return Boolean(env.dataMode === "live" && env.supabaseUrl && env.supabaseSecretKey);
}

function baseUrl() {
  return String(env.supabaseUrl || "").replace(/\/+$/, "");
}

function providerMessage(error) {
  return String(error?.message || error?.msg || error?.error || "");
}

function isMissingSchema(error) {
  return /bandwidth_observability_windows|schema cache|could not find|does not exist|42P01/i.test(providerMessage(error));
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function supabaseAdminRequest(path, { method = "GET", body, prefer = "" } = {}) {
  if (!configured()) return null;
  const secret = env.supabaseSecretKey;
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      apikey: secret,
      "Content-Type": "application/json",
      ...(secret.startsWith("eyJ") ? { Authorization: `Bearer ${secret}` } : {}),
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(bodyText === undefined ? {} : { body: bodyText })
  });
  const responseText = response.status === 204 ? "" : await response.text().catch(() => "");
  const payload = parseJson(responseText);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || "Supabase rechazo la solicitud de observabilidad.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function buildBandwidthWindowKey(windowStart, windowEnd) {
  const start = new Date(windowStart).toISOString();
  const end = new Date(windowEnd).toISOString();
  return `${start}_${end}`;
}

function totalBytes(snapshot = {}) {
  return Number(snapshot.httpResponses?.bytes || 0)
    + Number(snapshot.serviceInitiated?.requestBytes || 0)
    + Number(snapshot.serviceInitiated?.responseBytes || 0);
}

export async function saveBandwidthWindow(snapshot, { now = new Date() } = {}) {
  if (!configured()) return { saved: false, reason: "not_configured" };
  if (!snapshot?.windowStart || !snapshot?.windowEnd) return { saved: false, reason: "invalid_window" };
  if (totalBytes(snapshot) <= 0) return { saved: false, reason: "empty_window" };
  const payload = {
    window_key: buildBandwidthWindowKey(snapshot.windowStart, snapshot.windowEnd),
    window_start: snapshot.windowStart,
    window_end: snapshot.windowEnd,
    http_summary: snapshot.httpResponses || {},
    service_summary: snapshot.serviceInitiated || {},
    alerts: snapshot.alerts || [],
    daily_rollup_key: String(snapshot.windowStart).slice(0, 10),
    updated_at: now.toISOString()
  };
  try {
    await supabaseAdminRequest(`/rest/v1/${TABLE}?on_conflict=window_key`, {
      method: "POST",
      body: payload,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
    return { saved: true, reason: "saved", windowKey: payload.window_key, bytes: totalBytes(snapshot) };
  } catch (error) {
    if (isMissingSchema(error)) return { saved: false, reason: "schema_missing" };
    console.warn("[bandwidth] save failed", { message: error.message });
    return { saved: false, reason: "save_failed" };
  }
}

export async function loadBandwidthWindows({ since, limit = 700 } = {}) {
  if (!configured()) return [];
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 700));
  const query = [
    "select=window_key,window_start,window_end,http_summary,service_summary,alerts,daily_rollup_key,updated_at",
    "order=window_start.desc",
    `limit=${safeLimit}`
  ];
  if (since) query.push(`window_start=gte.${encodeURIComponent(new Date(since).toISOString())}`);
  try {
    const rows = await supabaseAdminRequest(`/rest/v1/${TABLE}?${query.join("&")}`);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingSchema(error)) return [];
    console.warn("[bandwidth] load failed", { message: error.message });
    return [];
  }
}

export async function pruneBandwidthWindows({ olderThan, now = new Date() } = {}) {
  if (!configured() || !olderThan) return { pruned: false, reason: "not_configured" };
  try {
    await supabaseAdminRequest(`/rest/v1/${TABLE}?window_end=lt.${encodeURIComponent(new Date(olderThan).toISOString())}`, {
      method: "DELETE",
      prefer: "return=minimal"
    });
    return { pruned: true, at: now.toISOString() };
  } catch (error) {
    if (isMissingSchema(error)) return { pruned: false, reason: "schema_missing" };
    console.warn("[bandwidth] prune failed", { message: error.message });
    return { pruned: false, reason: "prune_failed" };
  }
}

export const bandwidthReportStoreInternals = { configured, isMissingSchema, totalBytes };
