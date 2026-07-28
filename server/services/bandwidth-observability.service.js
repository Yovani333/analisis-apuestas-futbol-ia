const state = {
  startedAt: new Date().toISOString(),
  httpResponses: {
    count: 0,
    bytes: 0,
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
  container[safeKey] ||= { count: 0, bytes: 0 };
  return container[safeKey];
}

function serviceMetrics(service, endpoint) {
  const safeService = String(service || "unknown");
  const safeEndpoint = String(endpoint || "unknown");
  state.serviceInitiated.services[safeService] ||= {
    count: 0,
    responseBytes: 0,
    requestBytes: 0,
    endpoints: Object.create(null)
  };
  const serviceRow = state.serviceInitiated.services[safeService];
  serviceRow.endpoints[safeEndpoint] ||= { count: 0, responseBytes: 0, requestBytes: 0 };
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
  const key = `${String(method || "GET").toUpperCase()} ${String(path || "unknown").split("?")[0]}`;
  state.httpResponses.count += 1;
  state.httpResponses.bytes += amount;
  const row = routeMetrics(state.httpResponses.routes, key);
  row.count += 1;
  row.bytes += amount;
  row.lastStatusCode = Number(statusCode) || 0;
  row.lastSeenAt = new Date().toISOString();
}

export function recordServiceInitiatedTraffic({
  service = "",
  endpoint = "",
  responseBytes = 0,
  requestBytes = 0
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
  serviceRow.lastSeenAt = new Date().toISOString();
  endpointRow.count += 1;
  endpointRow.responseBytes += responseAmount;
  endpointRow.requestBytes += requestAmount;
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

export function resetBandwidthObservability() {
  state.startedAt = new Date().toISOString();
  state.httpResponses.count = 0;
  state.httpResponses.bytes = 0;
  state.httpResponses.routes = Object.create(null);
  state.serviceInitiated.count = 0;
  state.serviceInitiated.responseBytes = 0;
  state.serviceInitiated.requestBytes = 0;
  state.serviceInitiated.services = Object.create(null);
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
