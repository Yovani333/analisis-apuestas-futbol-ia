import test from "node:test";
import assert from "node:assert/strict";
import { collectExternalSourceData } from "../server/services/source-orchestrator.service.js";

const config = {
  openaiApiKey: "test", openaiModel: "test-model",
  sofaScoreAccessMode: "enabled", oddspediaAccessMode: "enabled", fotmobAccessMode: "enabled",
  whoScoredAccessMode: "enabled", fbrefAccessMode: "enabled", weatherAccessMode: "enabled", soccerwayAccessMode: "enabled"
};

function result(source, marker = source) {
  return { source, status: "partial", updatedAt: "2026-06-22T12:00:00Z", notes: [], data: { marker } };
}

test("el orquestador respeta dependencias de FotMob y propaga actualización forzada", async () => {
  let fotmobFinished = false;
  const received = {};
  const adapter = (source) => async (_matchData, options) => {
    received[source] = options;
    return result(source);
  };
  const adapters = {
    sofaScore: adapter("sofaScore"), oddspedia: adapter("oddspedia"),
    fotmob: async (_matchData, options) => {
      received.fotmob = options;
      await new Promise((resolve) => setTimeout(resolve, 15));
      fotmobFinished = true;
      return result("fotmob", "fotmob-ready");
    },
    weather: adapter("weather"), soccerway: adapter("soccerway"),
    whoScored: async (_matchData, options) => {
      assert.equal(fotmobFinished, true);
      assert.equal(options.fotmobResult.data.marker, "fotmob-ready");
      received.whoScored = options;
      return result("whoScored");
    },
    fbref: async (_matchData, options) => {
      assert.equal(fotmobFinished, true);
      assert.equal(options.fotmobResult.data.marker, "fotmob-ready");
      received.fbref = options;
      return result("fbref");
    }
  };
  const output = await collectExternalSourceData({ fixture: { id: 1 } }, { forceRefresh: true, adapters, config });
  assert.equal(output.fotmob.data.marker, "fotmob-ready");
  assert.ok(Object.values(received).every((options) => options.forceRefresh === true));
});

test("el orquestador aísla una fuente fallida y conserva las demás", async () => {
  const adapter = (source) => async () => result(source);
  const adapters = {
    sofaScore: adapter("sofaScore"), oddspedia: async () => { throw new Error("fallo simulado"); },
    fotmob: adapter("fotmob"), whoScored: adapter("whoScored"), fbref: adapter("fbref"),
    weather: adapter("weather"), soccerway: adapter("soccerway")
  };
  const output = await collectExternalSourceData({ fixture: { id: 2 } }, { adapters, config });
  assert.equal(output.oddspedia.status, "failed");
  assert.equal(output.weather.status, "partial");
  assert.equal(output.soccerway.status, "partial");
});
