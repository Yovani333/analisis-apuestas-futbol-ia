import test from "node:test";
import assert from "node:assert/strict";
import {
  getApiFootballObservability,
  recordApiFootballCacheHit,
  recordApiFootballCacheMiss,
  recordApiFootballFailure,
  recordApiFootballNegativeCacheHit,
  recordApiFootballPendingHit,
  recordApiFootballResponse,
  resetApiFootballObservability
} from "../server/services/api-football-observability.service.js";

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: (name) => normalized.get(String(name).toLowerCase()) ?? null };
}

test("registra aciertos de caché sin exponer URL ni credenciales", () => {
  resetApiFootballObservability();
  recordApiFootballCacheHit();
  recordApiFootballCacheHit({ endpoint: "/fixtures" });
  recordApiFootballCacheMiss({ endpoint: "/fixtures" });
  recordApiFootballPendingHit({ endpoint: "/fixtures" });
  recordApiFootballNegativeCacheHit({ endpoint: "/fixtures/players" });
  const metrics = getApiFootballObservability();
  assert.equal(metrics.cacheHits, 2);
  assert.equal(metrics.cacheMisses, 1);
  assert.equal(metrics.pendingHits, 1);
  assert.equal(metrics.negativeCacheHits, 1);
  assert.equal(metrics.cacheHitRatePct, 66.7);
  assert.equal(metrics.endpoints["/fixtures"].cacheHits, 1);
  assert.equal(metrics.endpoints["/fixtures"].pendingHits, 1);
  assert.equal(metrics.endpoints["/fixtures/players"].negativeCacheHits, 1);
  assert.doesNotMatch(JSON.stringify(metrics), /api[_-]?key|x-apisports-key/i);
});

test("conserva límites seguros reportados por API-Football", () => {
  resetApiFootballObservability();
  recordApiFootballResponse({
    endpoint: "/fixtures/statistics",
    headers: headers({
      "x-ratelimit-requests-limit": 7500,
      "x-ratelimit-requests-remaining": 7420,
      "x-ratelimit-limit": 300,
      "x-ratelimit-remaining": 288
    })
  });
  const metrics = getApiFootballObservability();
  assert.equal(metrics.networkRequests, 1);
  assert.equal(metrics.lastEndpoint, "/fixtures/statistics");
  assert.equal(metrics.endpoints["/fixtures/statistics"].networkRequests, 1);
  assert.equal(metrics.rateLimit.dailyRemaining, 7420);
  assert.equal(metrics.rateLimit.minuteRemaining, 288);
});

test("registra fallos con código sanitizado", () => {
  resetApiFootballObservability();
  recordApiFootballFailure({
    endpoint: "/fixtures/events",
    code: "API_FOOTBALL_RATE_LIMIT",
    headers: headers({ "x-ratelimit-requests-remaining": 0 })
  });
  const metrics = getApiFootballObservability();
  assert.equal(metrics.failures, 1);
  assert.equal(metrics.endpoints["/fixtures/events"].failures, 1);
  assert.equal(metrics.lastErrorCode, "API_FOOTBALL_RATE_LIMIT");
  assert.equal(metrics.rateLimit.dailyRemaining, 0);
});
