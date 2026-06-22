import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_STATUS } from "../server/constants/source-catalog.js";
import { createSourceResult } from "../server/services/sources/source-adapter.js";
import { getSofaScoreSportsData } from "../server/services/sources/sofascore.service.js";
import { getOddspediaMarketData } from "../server/services/sources/oddspedia.service.js";

test("SofaScore desactivado no realiza solicitudes de red", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("No debe llamarse"); };
  try {
    const result = await getSofaScoreSportsData({ fixture: { id: 100, home: "A", away: "B" } }, { accessMode: "disabled" });
    assert.equal(result.status, SOURCE_STATUS.NOT_CONFIGURED);
    assert.equal(fetchCalls, 0);
    assert.match(result.notes.join(" "), /no se realizaron solicitudes/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SofaScore bloquea modos sin conector aprobado", async () => {
  const result = await getSofaScoreSportsData({ fixture: { id: 100 } }, { accessMode: "unofficial" });
  assert.equal(result.status, SOURCE_STATUS.BLOCKED);
  assert.equal(result.data.matchIdentity.fixtureId, "100");
});

test("el contrato común rechaza estados desconocidos", () => {
  assert.throws(() => createSourceResult({ source: "prueba", status: "inventado" }), /Estado de fuente no válido/);
});

test("Oddspedia desactivado no llama a OpenAI", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getOddspediaMarketData({ fixture: { id: 1 }, marketAnalysis: [] }, { accessMode: "disabled", client });
  assert.equal(result.status, SOURCE_STATUS.BLOCKED);
  assert.equal(calls, 0);
});

test("Oddspedia no se consulta si API-Football ya tiene mercados", async () => {
  let calls = 0;
  const client = { responses: { parse: async () => { calls += 1; } } };
  const result = await getOddspediaMarketData({ fixture: { id: 1 }, marketAnalysis: [{ market: "Cuota existente" }] }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(calls, 0);
});

test("Oddspedia acepta únicamente coincidencia exacta con fuente del dominio", async () => {
  let request;
  const client = { responses: { parse: async (input) => {
    request = input;
    return {
      output_parsed: {
        match_found: true, identity_confirmed: true, matched_home_team: "A", matched_away_team: "B",
        event_url: "https://oddspedia.com/mx/futbol/a-b", observed_at: "2026-06-21T18:00:00Z",
        markets: [{ market: "Ganador", selection: "A", decimal_odds: 1.8, bookmaker: "Casa" }], notes: []
      },
      output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://oddspedia.com/mx/futbol/a-b" }] } }]
    };
  } } };
  const result = await getOddspediaMarketData({ fixture: { id: 2, home: "A", away: "B", date: "2026-06-22", leagueName: "Liga" }, marketAnalysis: [] }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.PARTIAL);
  assert.equal(result.data.markets[0].decimalOdds, 1.8);
  assert.equal(result.data.markets[0].requiresReview, true);
  assert.deepEqual(request.tools[0].filters.allowed_domains, ["oddspedia.com"]);
});

test("Oddspedia descarta cuotas sin una URL verificable del dominio", async () => {
  const client = { responses: { parse: async () => ({
    output_parsed: {
      match_found: true, identity_confirmed: true, matched_home_team: "A", matched_away_team: "B",
      event_url: "https://example.com/a-b", observed_at: null,
      markets: [{ market: "Ganador", selection: "A", decimal_odds: 1.8, bookmaker: null }], notes: []
    },
    output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://example.com/a-b" }] } }]
  }) } };
  const result = await getOddspediaMarketData({ fixture: { id: 3, home: "A", away: "B", date: "2026-06-22" }, marketAnalysis: [] }, {
    accessMode: "openai_web_search", apiKey: "test", model: "test-model", client
  });
  assert.equal(result.status, SOURCE_STATUS.NOT_AVAILABLE);
  assert.equal(result.data, null);
});
