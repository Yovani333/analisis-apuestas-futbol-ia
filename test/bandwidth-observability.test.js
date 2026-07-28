import test from "node:test";
import assert from "node:assert/strict";
import {
  bandwidthResponseMiddleware,
  byteLength,
  getBandwidthObservability,
  recordHttpResponse,
  recordServiceInitiatedTraffic,
  resetBandwidthObservability
} from "../server/services/bandwidth-observability.service.js";
import {
  buildBandwidthAlerts,
  flushBandwidthObservability,
  bandwidthReportingInternals
} from "../server/services/bandwidth-reporting.service.js";

test("registra trafico saliente por servicio y endpoint sin guardar URLs completas", () => {
  resetBandwidthObservability();
  recordServiceInitiatedTraffic({
    service: "api-football",
    endpoint: "/fixtures",
    responseBytes: 1200,
    requestBytes: 80
  });
  recordServiceInitiatedTraffic({
    service: "api-football",
    endpoint: "/fixtures",
    responseBytes: 300,
    requestBytes: 20
  });
  const metrics = getBandwidthObservability();
  assert.equal(metrics.serviceInitiated.count, 2);
  assert.equal(metrics.serviceInitiated.responseBytes, 1500);
  assert.equal(metrics.serviceInitiated.requestBytes, 100);
  assert.equal(metrics.serviceInitiated.services["api-football"].averageResponseBytes, 750);
  assert.equal(metrics.serviceInitiated.services["api-football"].endpoints["/fixtures"].responseBytes, 1500);
});

test("registra bytes de respuestas HTTP por ruta interna", () => {
  resetBandwidthObservability();
  recordHttpResponse({ method: "GET", path: "/api/fixtures/10?refresh=true", statusCode: 200, bytes: 512 });
  recordHttpResponse({ method: "GET", path: "/api/fixtures/10?refresh=true", statusCode: 500, bytes: 2048 });
  const metrics = getBandwidthObservability();
  assert.equal(metrics.httpResponses.count, 2);
  assert.equal(metrics.httpResponses.bytes, 2560);
  assert.equal(metrics.httpResponses.maxBytes, 2048);
  assert.equal(metrics.httpResponses.routes["GET /api/fixtures/10"].bytes, 2560);
  assert.equal(metrics.httpResponses.routes["GET /api/fixtures/10"].averageBytes, 1280);
  assert.equal(metrics.httpResponses.routes["GET /api/fixtures/10"].status2xx, 1);
  assert.equal(metrics.httpResponses.routes["GET /api/fixtures/10"].status5xx, 1);
  assert.equal(metrics.httpResponses.routes["GET /api/fixtures/10"].lastStatusCode, 500);
});

test("middleware mide chunks escritos por Express", () => {
  resetBandwidthObservability();
  const req = { method: "POST", originalUrl: "/api/test" };
  const chunks = [];
  const res = {
    statusCode: 201,
    write(chunk) { chunks.push(chunk); return true; },
    end(chunk) { if (chunk) chunks.push(chunk); return true; }
  };
  bandwidthResponseMiddleware(req, res, () => {});
  res.write("hola");
  res.end(" mundo");
  const metrics = getBandwidthObservability();
  assert.equal(chunks.join(""), "hola mundo");
  assert.equal(metrics.httpResponses.routes["POST /api/test"].bytes, byteLength("hola mundo"));
});

test("genera alertas para rutas grandes, frecuencia alta y reintentos externos", () => {
  const snapshot = {
    httpResponses: {
      routes: {
        "GET /api/heavy": { count: 12, bytes: 9000, maxBytes: 6000 }
      }
    },
    serviceInitiated: {
      services: {
        "api-football": { count: 4, responseBytes: 2000, requestBytes: 100, retries: 6, errors: 1 }
      }
    }
  };
  const alerts = buildBandwidthAlerts(snapshot, { largeResponseBytes: 5000, highRouteCount: 10 });
  assert.ok(alerts.some((alert) => alert.type === "large_http_response"));
  assert.ok(alerts.some((alert) => alert.type === "high_route_frequency"));
  assert.ok(alerts.some((alert) => alert.type === "excessive_retries"));
});

test("el flush automático compacta la ventana y no requiere Supabase configurado", async () => {
  resetBandwidthObservability("2026-07-28T00:00:00.000Z");
  recordHttpResponse({ method: "GET", path: "/api/example", statusCode: 200, bytes: 1000 });
  const result = await flushBandwidthObservability({ now: new Date("2026-07-28T00:15:00.000Z") });
  assert.equal(result.results[0].saved, false);
  assert.equal(result.results[0].reason, "not_configured");
  assert.equal(result.pending, 0);
  assert.equal(getBandwidthObservability().startedAt, "2026-07-28T00:15:00.000Z");
});

test("el reporte agregado calcula top rutas, proveedores y estimación mensual", () => {
  const windows = [{
    window_start: "2026-07-27T00:00:00.000Z",
    http_summary: {
      bytes: 3000,
      routes: {
        "GET /api/a": { count: 3, bytes: 3000, maxBytes: 1500, status2xx: 3 }
      }
    },
    service_summary: {
      requestBytes: 200,
      responseBytes: 5000,
      services: {
        "api-football": { count: 5, requestBytes: 200, responseBytes: 5000, errors: 0, retries: 0 }
      }
    },
    alerts: []
  }];
  const summary = bandwidthReportingInternals.summarizeWindows(windows, new Date("2026-07-28T00:00:00.000Z"));
  assert.equal(summary.totalBytes, 8200);
  assert.equal(summary.topRoutesByBytes[0].route, "GET /api/a");
  assert.equal(summary.topProviders[0].service, "api-football");
  assert.ok(summary.estimatedMonthlyBytes > 0);
});
