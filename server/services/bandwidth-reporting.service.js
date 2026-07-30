import { env } from "../config/env.js";
import { getBandwidthObservability, snapshotAndResetBandwidthObservability } from "./bandwidth-observability.service.js";
import { loadBandwidthWindows, pruneBandwidthWindows, saveBandwidthWindow } from "./bandwidth-report-store.service.js";
import { resolveApiFootballUsageWindow } from "./api-football-observability.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const pendingWindows = [];
let lastFlush = null;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function entries(object = {}) {
  return Object.entries(object || {});
}

function totalWindowBytes(row = {}) {
  const http = row.http_summary || row.httpResponses || {};
  const service = row.service_summary || row.serviceInitiated || {};
  return number(http.bytes) + number(service.requestBytes) + number(service.responseBytes);
}

function sortByBytes(rows, limit = 10) {
  return rows.sort((a, b) => number(b.bytes) - number(a.bytes)).slice(0, limit);
}

function sortByCount(rows, limit = 10) {
  return rows.sort((a, b) => number(b.count) - number(a.count)).slice(0, limit);
}

export function buildBandwidthAlerts(snapshot = {}, options = {}) {
  const largeResponseBytes = number(options.largeResponseBytes ?? env.bandwidthLargeResponseBytes);
  const highRouteCount = number(options.highRouteCount ?? env.bandwidthHighRouteCount);
  const alerts = [];
  for (const [route, row] of entries(snapshot.httpResponses?.routes)) {
    if (number(row.maxBytes) >= largeResponseBytes) {
      alerts.push({
        type: "large_http_response",
        severity: "warning",
        route,
        maxBytes: number(row.maxBytes),
        message: "Respuesta interna grande detectada; revisar paginacion o compactacion."
      });
    }
    if (number(row.count) >= highRouteCount) {
      alerts.push({
        type: "high_route_frequency",
        severity: "warning",
        route,
        count: number(row.count),
        message: "Ruta llamada muchas veces durante la ventana; revisar polling, renders o bots."
      });
    }
  }
  for (const [service, row] of entries(snapshot.serviceInitiated?.services)) {
    if (number(row.retries) >= 5) {
      alerts.push({
        type: "excessive_retries",
        severity: "warning",
        service,
        retries: number(row.retries),
        message: "Proveedor con reintentos acumulados durante la ventana."
      });
    }
    if (number(row.errors) >= 5) {
      alerts.push({
        type: "external_errors",
        severity: "warning",
        service,
        errors: number(row.errors),
        message: "Proveedor externo con errores repetidos durante la ventana."
      });
    }
  }
  return alerts;
}

function compactSnapshotForStorage(snapshot = {}) {
  const alerts = buildBandwidthAlerts(snapshot);
  return {
    ...snapshot,
    alerts
  };
}

export async function flushBandwidthObservability({ now = new Date(), force = false } = {}) {
  const snapshot = compactSnapshotForStorage(snapshotAndResetBandwidthObservability({ windowEnd: now }));
  const currentBytes = totalWindowBytes({ http_summary: snapshot.httpResponses, service_summary: snapshot.serviceInitiated });
  if (currentBytes > 0 || force) pendingWindows.push(snapshot);
  const results = [];
  while (pendingWindows.length) {
    const current = pendingWindows[0];
    const result = await saveBandwidthWindow(current, { now });
    results.push(result);
    if (!result.saved && !["empty_window", "not_configured"].includes(result.reason)) break;
    pendingWindows.shift();
  }
  const retentionCutoff = new Date(now.getTime() - env.bandwidthRetentionDays * DAY_MS);
  const prune = await pruneBandwidthWindows({ olderThan: retentionCutoff, now });
  lastFlush = { at: now.toISOString(), results, prune, pending: pendingWindows.length };
  return lastFlush;
}

function flattenHttpRoutes(windows = []) {
  const map = new Map();
  for (const row of windows) {
    for (const [route, metrics] of entries(row.http_summary?.routes)) {
      const current = map.get(route) || { route, count: 0, bytes: 0, maxBytes: 0, status2xx: 0, status4xx: 0, status5xx: 0 };
      current.count += number(metrics.count);
      current.bytes += number(metrics.bytes);
      current.maxBytes = Math.max(current.maxBytes, number(metrics.maxBytes));
      current.status2xx += number(metrics.status2xx);
      current.status4xx += number(metrics.status4xx);
      current.status5xx += number(metrics.status5xx);
      current.lastSeenAt = metrics.lastSeenAt || current.lastSeenAt;
      map.set(route, current);
    }
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    averageBytes: row.count ? Math.round(row.bytes / row.count) : 0
  }));
}

function flattenServices(windows = []) {
  const map = new Map();
  for (const row of windows) {
    for (const [service, metrics] of entries(row.service_summary?.services)) {
      const current = map.get(service) || { service, count: 0, requestBytes: 0, responseBytes: 0, errors: 0, retries: 0 };
      current.count += number(metrics.count);
      current.requestBytes += number(metrics.requestBytes);
      current.responseBytes += number(metrics.responseBytes);
      current.errors += number(metrics.errors);
      current.retries += number(metrics.retries);
      current.lastSeenAt = metrics.lastSeenAt || current.lastSeenAt;
      map.set(service, current);
    }
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    bytes: row.requestBytes + row.responseBytes,
    averageResponseBytes: row.count ? Math.round(row.responseBytes / row.count) : 0
  }));
}

function summarizeWindows(windows = [], now = new Date()) {
  const httpRoutes = flattenHttpRoutes(windows);
  const services = flattenServices(windows);
  const totalHttpBytes = windows.reduce((sum, row) => sum + number(row.http_summary?.bytes), 0);
  const totalExternalRequestBytes = windows.reduce((sum, row) => sum + number(row.service_summary?.requestBytes), 0);
  const totalExternalResponseBytes = windows.reduce((sum, row) => sum + number(row.service_summary?.responseBytes), 0);
  const totalBytes = totalHttpBytes + totalExternalRequestBytes + totalExternalResponseBytes;
  const oldest = windows.at(-1)?.window_start ? new Date(windows.at(-1).window_start) : now;
  const hours = Math.max(1, (now.getTime() - oldest.getTime()) / (60 * 60 * 1000));
  const dailyEstimate = totalBytes / hours * 24;
  return {
    windows: windows.length,
    totalBytes,
    totalHttpBytes,
    totalExternalRequestBytes,
    totalExternalResponseBytes,
    estimatedMonthlyBytes: Math.round(dailyEstimate * 30),
    topRoutesByBytes: sortByBytes(httpRoutes.map((row) => ({ ...row }))),
    topRoutesByCount: sortByCount(httpRoutes.map((row) => ({ ...row }))),
    topProviders: sortByBytes(services.map((row) => ({ ...row }))),
    alerts: windows.flatMap((row) => Array.isArray(row.alerts) ? row.alerts : [])
  };
}

function mergeApiFootballUsage(target, service = {}) {
  const count = number(service.count);
  const errors = number(service.errors);
  target.networkRequests += count;
  target.failures += errors;
  for (const [endpoint, metrics] of entries(service.endpoints)) {
    const key = endpoint || "unknown";
    target.endpoints[key] ||= { networkRequests: 0, failures: 0 };
    target.endpoints[key].networkRequests += number(metrics.count);
    target.endpoints[key].failures += number(metrics.errors);
  }
}

export function summarizeApiFootballDailyUsage(windows = [], { now = new Date(), currentBandwidth = null } = {}) {
  const usageWindow = resolveApiFootballUsageWindow(now);
  const summary = {
    ...usageWindow,
    networkRequests: 0,
    failures: 0,
    endpoints: Object.create(null),
    source: "bandwidth_persisted_daily_window"
  };
  for (const row of windows || []) {
    const windowStart = row?.window_start || row?.windowStart;
    if (!windowStart || resolveApiFootballUsageWindow(new Date(windowStart)).windowKey !== usageWindow.windowKey) continue;
    mergeApiFootballUsage(summary, row.service_summary?.services?.["api-football"]);
  }
  mergeApiFootballUsage(summary, currentBandwidth?.serviceInitiated?.services?.["api-football"]);
  summary.endpoints = Object.fromEntries(Object.entries(summary.endpoints)
    .sort(([, left], [, right]) => number(right.networkRequests) - number(left.networkRequests)));
  return summary;
}

export async function buildApiFootballDailyUsageFromBandwidth({ now = new Date(), currentBandwidth = null } = {}) {
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const rows = await loadBandwidthWindows({ since, limit: 200 });
  return summarizeApiFootballDailyUsage(rows, { now, currentBandwidth });
}

function recommendationsFromSummary(summary = {}) {
  const recommendations = [];
  const largestRoute = summary.topRoutesByBytes?.[0];
  if (largestRoute?.bytes) recommendations.push(`Revisar ${largestRoute.route}: es la ruta interna con mayor salida acumulada.`);
  const mostCalled = summary.topRoutesByCount?.[0];
  if (mostCalled?.count >= env.bandwidthHighRouteCount) recommendations.push(`Auditar frecuencia de ${mostCalled.route}: puede existir polling, render repetido o bot.`);
  const topProvider = summary.topProviders?.[0];
  if (topProvider?.bytes) recommendations.push(`Priorizar cache y deduplicacion en ${topProvider.service}: es el proveedor externo con mayor tráfico.`);
  if (!recommendations.length) recommendations.push("No se detectan consumidores dominantes con la muestra actual.");
  return recommendations;
}

export async function buildBandwidthReport({ now = new Date() } = {}) {
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const rows = await loadBandwidthWindows({ since: since7d, limit: 700 });
  const todayKey = now.toISOString().slice(0, 10);
  const since24h = new Date(now.getTime() - DAY_MS);
  const todayRows = rows.filter((row) => String(row.daily_rollup_key || row.window_start).slice(0, 10) === todayKey);
  const last24hRows = rows.filter((row) => new Date(row.window_start).getTime() >= since24h.getTime());
  const today = summarizeWindows(todayRows, now);
  const last24h = summarizeWindows(last24hRows, now);
  const last7d = summarizeWindows(rows, now);
  const activeAlerts = [
    ...today.alerts,
    ...(today.totalBytes >= env.bandwidthDailyAlertBytes ? [{
      type: "daily_threshold_exceeded",
      severity: "critical",
      bytes: today.totalBytes,
      thresholdBytes: env.bandwidthDailyAlertBytes,
      message: "El consumo estimado del dia supero el umbral configurado."
    }] : [])
  ];
  return {
    generatedAt: now.toISOString(),
    retentionDays: env.bandwidthRetentionDays,
    flushIntervalMs: env.bandwidthFlushIntervalMs,
    inMemory: getBandwidthObservability(),
    lastFlush,
    today,
    last24h,
    last7d,
    monthlyEstimateBytes: last24h.estimatedMonthlyBytes,
    activeAlerts,
    recommendations: recommendationsFromSummary(last24h)
  };
}

export function startBandwidthReportingScheduler() {
  const interval = setInterval(() => {
    flushBandwidthObservability().catch((error) => console.warn("[bandwidth] scheduled flush failed", { message: error.message }));
  }, env.bandwidthFlushIntervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}

export const bandwidthReportingInternals = {
  flattenHttpRoutes,
  flattenServices,
  pendingWindows,
  recommendationsFromSummary,
  summarizeApiFootballDailyUsage,
  summarizeWindows,
  totalWindowBytes
};
