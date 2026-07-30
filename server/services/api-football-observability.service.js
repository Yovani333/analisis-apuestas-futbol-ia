const state = {
  networkRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  pendingHits: 0,
  negativeCacheHits: 0,
  failures: 0,
  endpoints: Object.create(null),
  lastRequestAt: "",
  lastEndpoint: "",
  lastErrorCode: "",
  rateLimit: {
    dailyLimit: null,
    dailyRemaining: null,
    minuteLimit: null,
    minuteRemaining: null
  },
  daily: {
    windowKey: "",
    windowStartLocal: "",
    windowEndLocal: "",
    resetHourPacific: 17,
    networkRequests: 0,
    failures: 0,
    endpoints: Object.create(null)
  }
};

const PACIFIC_TIME_ZONE = "America/Tijuana";
const DAILY_RESET_HOUR_PACIFIC = 17;
const pacificDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function pacificParts(date = new Date()) {
  return Object.fromEntries(pacificDateFormatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function addDaysToIsoDate(isoDate, days) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function resolveApiFootballUsageWindow(now = new Date()) {
  const parts = pacificParts(now);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localHour = Number(parts.hour) % 24;
  const windowKey = localHour >= DAILY_RESET_HOUR_PACIFIC ? localDate : addDaysToIsoDate(localDate, -1);
  const windowEndKey = addDaysToIsoDate(windowKey, 1);
  return {
    windowKey,
    windowStartLocal: `${windowKey} 17:00 PT`,
    windowEndLocal: `${windowEndKey} 17:00 PT`,
    resetHourPacific: DAILY_RESET_HOUR_PACIFIC,
    timezone: PACIFIC_TIME_ZONE
  };
}

function endpointMetrics(endpoint = "") {
  const key = endpoint || "unknown";
  state.endpoints[key] ||= { networkRequests: 0, cacheHits: 0, cacheMisses: 0, pendingHits: 0, negativeCacheHits: 0, failures: 0 };
  return state.endpoints[key];
}

function dailyEndpointMetrics(endpoint = "") {
  const key = endpoint || "unknown";
  state.daily.endpoints[key] ||= { networkRequests: 0, failures: 0 };
  return state.daily.endpoints[key];
}

function ensureDailyWindow(now = new Date()) {
  const window = resolveApiFootballUsageWindow(now);
  if (state.daily.windowKey !== window.windowKey) {
    state.daily.windowKey = window.windowKey;
    state.daily.windowStartLocal = window.windowStartLocal;
    state.daily.windowEndLocal = window.windowEndLocal;
    state.daily.resetHourPacific = window.resetHourPacific;
    state.daily.networkRequests = 0;
    state.daily.failures = 0;
    state.daily.endpoints = Object.create(null);
  }
  return window;
}

function headerNumber(headers, name) {
  const value = headers?.get?.(name);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function updateRateLimit(headers) {
  const values = {
    dailyLimit: headerNumber(headers, "x-ratelimit-requests-limit"),
    dailyRemaining: headerNumber(headers, "x-ratelimit-requests-remaining"),
    minuteLimit: headerNumber(headers, "x-ratelimit-limit"),
    minuteRemaining: headerNumber(headers, "x-ratelimit-remaining")
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) state.rateLimit[key] = value;
  }
}

export function recordApiFootballCacheHit({ endpoint } = {}) {
  state.cacheHits += 1;
  endpointMetrics(endpoint).cacheHits += 1;
}

export function recordApiFootballCacheMiss({ endpoint } = {}) {
  state.cacheMisses += 1;
  endpointMetrics(endpoint).cacheMisses += 1;
}

export function recordApiFootballPendingHit({ endpoint } = {}) {
  state.pendingHits += 1;
  endpointMetrics(endpoint).pendingHits += 1;
}

export function recordApiFootballNegativeCacheHit({ endpoint } = {}) {
  state.negativeCacheHits += 1;
  endpointMetrics(endpoint).negativeCacheHits += 1;
}

export function recordApiFootballResponse({ endpoint, headers }) {
  ensureDailyWindow();
  state.networkRequests += 1;
  endpointMetrics(endpoint).networkRequests += 1;
  state.daily.networkRequests += 1;
  dailyEndpointMetrics(endpoint).networkRequests += 1;
  state.lastRequestAt = new Date().toISOString();
  state.lastEndpoint = endpoint || "";
  state.lastErrorCode = "";
  updateRateLimit(headers);
}

export function recordApiFootballFailure({ endpoint, code, headers }) {
  ensureDailyWindow();
  state.failures += 1;
  endpointMetrics(endpoint).failures += 1;
  state.daily.failures += 1;
  dailyEndpointMetrics(endpoint).failures += 1;
  if (!headers) {
    state.daily.networkRequests += 1;
    dailyEndpointMetrics(endpoint).networkRequests += 1;
  }
  state.lastRequestAt = new Date().toISOString();
  state.lastEndpoint = endpoint || "";
  state.lastErrorCode = code || "API_FOOTBALL_REQUEST_FAILED";
  updateRateLimit(headers);
}

export function getApiFootballObservability() {
  ensureDailyWindow();
  const totalCacheLookups = state.cacheHits + state.cacheMisses;
  return {
    networkRequests: state.networkRequests,
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    pendingHits: state.pendingHits,
    negativeCacheHits: state.negativeCacheHits,
    cacheHitRatePct: totalCacheLookups ? Number(((state.cacheHits / totalCacheLookups) * 100).toFixed(1)) : 0,
    failures: state.failures,
    lastRequestAt: state.lastRequestAt,
    lastEndpoint: state.lastEndpoint,
    lastErrorCode: state.lastErrorCode,
    endpoints: Object.fromEntries(Object.entries(state.endpoints).map(([endpoint, metrics]) => [endpoint, { ...metrics }])),
    daily: {
      windowKey: state.daily.windowKey,
      windowStartLocal: state.daily.windowStartLocal,
      windowEndLocal: state.daily.windowEndLocal,
      resetHourPacific: state.daily.resetHourPacific,
      networkRequests: state.daily.networkRequests,
      failures: state.daily.failures,
      endpoints: Object.fromEntries(Object.entries(state.daily.endpoints).map(([endpoint, metrics]) => [endpoint, { ...metrics }]))
    },
    rateLimit: { ...state.rateLimit }
  };
}

export function resetApiFootballObservability() {
  state.networkRequests = 0;
  state.cacheHits = 0;
  state.cacheMisses = 0;
  state.pendingHits = 0;
  state.negativeCacheHits = 0;
  state.failures = 0;
  state.lastRequestAt = "";
  state.lastEndpoint = "";
  state.lastErrorCode = "";
  state.endpoints = Object.create(null);
  const window = resolveApiFootballUsageWindow();
  Object.assign(state.daily, {
    windowKey: window.windowKey,
    windowStartLocal: window.windowStartLocal,
    windowEndLocal: window.windowEndLocal,
    resetHourPacific: window.resetHourPacific,
    networkRequests: 0,
    failures: 0,
    endpoints: Object.create(null)
  });
  Object.assign(state.rateLimit, {
    dailyLimit: null,
    dailyRemaining: null,
    minuteLimit: null,
    minuteRemaining: null
  });
}
