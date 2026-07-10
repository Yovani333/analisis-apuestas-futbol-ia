const state = {
  networkRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  pendingHits: 0,
  failures: 0,
  lastRequestAt: "",
  lastEndpoint: "",
  lastErrorCode: "",
  rateLimit: {
    dailyLimit: null,
    dailyRemaining: null,
    minuteLimit: null,
    minuteRemaining: null
  }
};

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

export function recordApiFootballCacheHit() {
  state.cacheHits += 1;
}

export function recordApiFootballCacheMiss() {
  state.cacheMisses += 1;
}

export function recordApiFootballPendingHit() {
  state.pendingHits += 1;
}

export function recordApiFootballResponse({ endpoint, headers }) {
  state.networkRequests += 1;
  state.lastRequestAt = new Date().toISOString();
  state.lastEndpoint = endpoint || "";
  state.lastErrorCode = "";
  updateRateLimit(headers);
}

export function recordApiFootballFailure({ endpoint, code, headers }) {
  state.failures += 1;
  state.lastRequestAt = new Date().toISOString();
  state.lastEndpoint = endpoint || "";
  state.lastErrorCode = code || "API_FOOTBALL_REQUEST_FAILED";
  updateRateLimit(headers);
}

export function getApiFootballObservability() {
  const totalCacheLookups = state.cacheHits + state.cacheMisses;
  return {
    networkRequests: state.networkRequests,
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    pendingHits: state.pendingHits,
    cacheHitRatePct: totalCacheLookups ? Number(((state.cacheHits / totalCacheLookups) * 100).toFixed(1)) : 0,
    failures: state.failures,
    lastRequestAt: state.lastRequestAt,
    lastEndpoint: state.lastEndpoint,
    lastErrorCode: state.lastErrorCode,
    rateLimit: { ...state.rateLimit }
  };
}

export function resetApiFootballObservability() {
  state.networkRequests = 0;
  state.cacheHits = 0;
  state.cacheMisses = 0;
  state.pendingHits = 0;
  state.failures = 0;
  state.lastRequestAt = "";
  state.lastEndpoint = "";
  state.lastErrorCode = "";
  Object.assign(state.rateLimit, {
    dailyLimit: null,
    dailyRemaining: null,
    minuteLimit: null,
    minuteRemaining: null
  });
}
