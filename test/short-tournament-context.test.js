import test from "node:test";
import assert from "node:assert/strict";
import { buildShortTournamentContext } from "../server/services/short-tournament-context.service.js";

test("identifica Mundial, fase eliminatoria y limita confianza con muestra corta", () => {
  const context = buildShortTournamentContext({
    fixture: { leagueSlug: "world-cup", leagueName: "Copa Mundial FIFA", phase: "Semi-final", neutralVenue: true },
    researchData: { xgXga: { homeSampleSize: 2, awaySampleSize: 4 } }
  });
  assert.equal(context.isWorldCup, true);
  assert.equal(context.isKnockout, true);
  assert.equal(context.sampleSize, 2);
  assert.equal(context.confidenceCap, 45);
  assert.equal(context.scope, "regular_time_90_minutes");
  assert.ok(context.warnings.some((warning) => /tiempo extra y penales/i.test(warning)));
});

test("liga regular no recibe penalización de torneo corto", () => {
  const context = buildShortTournamentContext({ fixture: { leagueSlug: "liga-mx", leagueName: "Liga MX" } });
  assert.equal(context.isShortTournament, false);
  assert.equal(context.confidenceCap, 100);
  assert.equal(context.riskAdjustment, 0);
});
