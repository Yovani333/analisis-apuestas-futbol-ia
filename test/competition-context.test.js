import test from "node:test";
import assert from "node:assert/strict";
import { buildCompetitionContext } from "../server/services/competition-context.service.js";

const fixture = {
  id: "200", leagueId: 2, season: 2026, competitionType: "qualifying", round: "2nd Qualifying Round",
  isQualifyingRound: true, isKnockoutRound: true, homeTeamId: 10, awayTeamId: 20,
  utcDateTime: "2026-07-28T18:00:00Z", score: { home: null, away: null }
};

test("detecta segunda vuelta únicamente con un partido anterior confirmado", () => {
  const previous = [{
    fixture: { id: 100, date: "2026-07-21T18:00:00Z", status: { short: "FT" } },
    league: { id: 2, season: 2026, round: "2nd Qualifying Round" },
    teams: { home: { id: 20 }, away: { id: 10 } }, goals: { home: 1, away: 2 }
  }];
  const context = buildCompetitionContext(fixture, previous);
  assert.equal(context.leg, "second_leg");
  assert.deepEqual(context.previousLegScore, { home: 2, away: 1 });
  assert.equal(context.scope, "regular_time_90_minutes");
});

test("no inventa ida o marcador global cuando no existe partido anterior", () => {
  const context = buildCompetitionContext(fixture, []);
  assert.equal(context.leg, "first_or_single_unconfirmed");
  assert.equal(context.aggregateScore, null);
  assert.ok(context.warnings.some((warning) => /no se confirmó/i.test(warning)));
});

test("liga regular no recibe contexto de eliminatoria", () => {
  const context = buildCompetitionContext({ ...fixture, competitionType: "league", isQualifyingRound: false, isKnockoutRound: false }, []);
  assert.equal(context.type, "regular_league");
  assert.equal(context.leg, "not_applicable");
});
