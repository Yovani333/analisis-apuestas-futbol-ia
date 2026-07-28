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
  assert.equal(metrics.serviceInitiated.services["api-football"].endpoints["/fixtures"].responseBytes, 1500);
});

test("registra bytes de respuestas HTTP por ruta interna", () => {
  resetBandwidthObservability();
  recordHttpResponse({ method: "GET", path: "/api/fixtures/10?refresh=true", statusCode: 200, bytes: 512 });
  const metrics = getBandwidthObservability();
  assert.equal(metrics.httpResponses.count, 1);
  assert.equal(metrics.httpResponses.bytes, 512);
  assert.equal(metrics.httpResponses.routes["GET /api/fixtures/10"].bytes, 512);
  assert.equal(metrics.httpResponses.routes["GET /api/fixtures/10"].lastStatusCode, 200);
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
