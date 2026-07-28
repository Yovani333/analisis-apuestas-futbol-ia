const state = {
  startedAt: new Date().toISOString(),
  httpResponses: {
    count: 0,
    bytes: 0,
    maxBytes: 0,
    routes: Object.create(null)
  },
  serviceInitiated: {
    count: 0,
    responseBytes: 0,
    requestBytes: 0,
    services: Object.create(null)
  }
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function routeMetrics(container, key) {
  const safeKey = String(key || "unknown");
  container[safeKey] ||= {
    count: 0,
    bytes: 0,
    maxBytes: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0
  };
  return container[safeKey];
}

function serviceMetrics(service, endpoint) {
  const safeService = String(service || "unknown");
  const safeEndpoint = String(endpoint || "unknown");
  state.serviceInitiated.services[safeService] ||= {
    count: 0,
    responseBytes: 0,
    requestBytes: 0,
    errors: 0,
    retries: 0,
    endpoints: Object.create(null)
  };
  const serviceRow = state.serviceInitiated.services[safeService];
  serviceRow.endpoints[safeEndpoint] ||= { count: 0, responseBytes: 0, requestBytes: 0, errors: 0, retries: 0 };
  return { serviceRow, endpointRow: serviceRow.endpoints[safeEndpoint] };
}

export function byteLength(value) {
  if (value === null || value === undefined) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === "function") return 0;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (value instanceof Uint8Array) return value.byteLength;
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function recordHttpResponse({ method = "", path = "", statusCode = 0, bytes = 0 } = {}) {
  const amount = number(bytes);
  const status = Number(statusCode) || 0;
  const key = `${String(method || "GET").toUpperCase()} ${String(path || "unknown").split("?")[0]}`;
  state.httpResponses.count += 1;
  state.httpResponses.bytes += amount;
  state.httpResponses.maxBytes = Math.max(state.httpResponses.maxBytes, amount);
  const row = routeMetrics(state.httpResponses.routes, key);
  row.count += 1;
  row.bytes += amount;
  row.maxBytes = Math.max(row.maxBytes, amount);
  if (status >= 200 && status < 300) row.status2xx += 1;
  else if (status >= 400 && status < 500) row.status4xx += 1;
  else if (status >= 500) row.status5xx += 1;
  row.averageBytes = row.count ? Math.round(row.bytes / row.count) : 0;
  row.lastStatusCode = status;
  row.lastSeenAt = new Date().toISOString();
}

export function recordServiceInitiatedTraffic({
  service = "",
  endpoint = "",
  responseBytes = 0,
  requestBytes = 0,
  error = false,
  retry = false
} = {}) {
  const responseAmount = number(responseBytes);
  const requestAmount = number(requestBytes);
  const { serviceRow, endpointRow } = serviceMetrics(service, endpoint);
  state.serviceInitiated.count += 1;
  state.serviceInitiated.responseBytes += responseAmount;
  state.serviceInitiated.requestBytes += requestAmount;
  serviceRow.count += 1;
  serviceRow.responseBytes += responseAmount;
  serviceRow.requestBytes += requestAmount;
  if (error) serviceRow.errors += 1;
  if (retry) serviceRow.retries += 1;
  serviceRow.averageResponseBytes = serviceRow.count ? Math.round(serviceRow.responseBytes / serviceRow.count) : 0;
  serviceRow.lastSeenAt = new Date().toISOString();
  endpointRow.count += 1;
  endpointRow.responseBytes += responseAmount;
  endpointRow.requestBytes += requestAmount;
  if (error) endpointRow.errors += 1;
  if (retry) endpointRow.retries += 1;
  endpointRow.averageResponseBytes = endpointRow.count ? Math.round(endpointRow.responseBytes / endpointRow.count) : 0;
  endpointRow.lastSeenAt = serviceRow.lastSeenAt;
}

function topRows(rows, limit = 12) {
  return Object.fromEntries(Object.entries(rows)
    .sort((a, b) => (b[1].bytes ?? b[1].responseBytes ?? 0) - (a[1].bytes ?? a[1].responseBytes ?? 0))
    .slice(0, limit)
    .map(([key, value]) => [key, { ...value }]));
}

function cloneServices(limit = 12) {
  return Object.fromEntries(Object.entries(state.serviceInitiated.services)
    .sort((a, b) => b[1].responseBytes - a[1].responseBytes)
    .slice(0, limit)
    .map(([service, value]) => [service, {
      count: value.count,
      responseBytes: value.responseBytes,
      requestBytes: value.requestBytes,
      averageResponseBytes: value.averageResponseBytes || (value.count ? Math.round(value.responseBytes / value.count) : 0),
      errors: value.errors || 0,
      retries: value.retries || 0,
      lastSeenAt: value.lastSeenAt,
      endpoints: topRows(value.endpoints, limit)
    }]));
}

export function getBandwidthObservability() {
  return {
    startedAt: state.startedAt,
    httpResponses: {
      count: state.httpResponses.count,
      bytes: state.httpResponses.bytes,
      averageBytes: state.httpResponses.count ? Math.round(state.httpResponses.bytes / state.httpResponses.count) : 0,
      maxBytes: state.httpResponses.maxBytes,
      routes: topRows(state.httpResponses.routes)
    },
    serviceInitiated: {
      count: state.serviceInitiated.count,
      responseBytes: state.serviceInitiated.responseBytes,
      requestBytes: state.serviceInitiated.requestBytes,
      services: cloneServices()
    }
  };
}

export function resetBandwidthObservability(startedAt = new Date().toISOString()) {
  state.startedAt = startedAt;
  state.httpResponses.count = 0;
  state.httpResponses.bytes = 0;
  state.httpResponses.maxBytes = 0;
  state.httpResponses.routes = Object.create(null);
  state.serviceInitiated.count = 0;
  state.serviceInitiated.responseBytes = 0;
  state.serviceInitiated.requestBytes = 0;
  state.serviceInitiated.services = Object.create(null);
}

export function snapshotAndResetBandwidthObservability({ windowEnd = new Date() } = {}) {
  const endedAt = windowEnd instanceof Date ? windowEnd.toISOString() : new Date(windowEnd).toISOString();
  const snapshot = {
    windowStart: state.startedAt,
    windowEnd: endedAt,
    ...getBandwidthObservability()
  };
  resetBandwidthObservability(endedAt);
  return snapshot;
}

export function bandwidthResponseMiddleware(req, res, next) {
  let bytes = 0;
  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function writeWithBandwidth(chunk, encoding, callback) {
    bytes += byteLength(chunk);
    return originalWrite.call(this, chunk, encoding, callback);
  };

  res.end = function endWithBandwidth(chunk, encoding, callback) {
    bytes += byteLength(chunk);
    recordHttpResponse({
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      bytes
    });
    return originalEnd.call(this, chunk, encoding, callback);
  };

  next();
}
