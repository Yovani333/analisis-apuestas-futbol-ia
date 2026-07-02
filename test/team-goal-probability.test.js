import test from "node:test";
import assert from "node:assert/strict";
import { calculateTeamGoalProbability } from "../server/services/team-goal-probability.service.js";

function dataset(overrides = {}) {
  return { fixture: { id: 8, home: "A", away: "B", homeTeamId: 1, awayTeamId: 2, status: "scheduled", neutralVenue: true, ...overrides.fixture }, dataQuality: { score: 82 }, researchData: { totalConfidenceScore: 82, xgXga: { homeXG: 1.8, homeXGA: 1, awayXG: 1.2, awayXGA: 1.5, sampleSize: 6, ...overrides.xgXga }, statsForm: { homeGoalsFor: 9, homeGoalsAgainst: 5, awayGoalsFor: 6, awayGoalsAgainst: 8, homeLastMatches: Array(5), awayLastMatches: Array(5), ...overrides.statsForm }, odds: { markets: [] } } };
}

test("calcula gol y no gol por equipo con mercados derivados", () => {
  const result = calculateTeamGoalProbability(dataset());
  assert.equal(result.status, "available");
  assert.equal(result.quality.label, "Alta");
  assert.ok(result.teams.home.over05Pct > result.teams.home.over15Pct);
  assert.ok(Math.abs(result.teams.home.over05Pct + result.teams.home.noGoalPct - 100) < .2);
  assert.equal(result.picks.every((pick) => pick.sourceModule === "team_goal_probability"), true);
});

test("expone apoyo o rechazo a BTTS", () => {
  const result = calculateTeamGoalProbability(dataset());
  assert.ok(["supports_btts_yes", "supports_btts_no", "neutral"].includes(result.btts.support));
});

test("posesión alta sin tiros a puerta contradice confianza live", () => {
  const result = calculateTeamGoalProbability(dataset({ fixture: { status: "live" }, xgXga: { rawStats: { home: { totalShots: 3, shotsOnGoal: 1, ballPossession: "65%" }, away: { totalShots: 5, shotsOnGoal: 2 } } } }));
  assert.match(result.teams.home.contradictingData.join(" "), /posesión con poco peligro/i);
  assert.ok(result.teams.home.confidenceScore < 82);
});

test("no inventa probabilidad cuando faltan todos los insumos", () => {
  const result = calculateTeamGoalProbability({ fixture: { id: 9 }, researchData: { xgXga: {}, statsForm: {} }, dataQuality: { score: 20 } });
  assert.equal(result.status, "not_available");
  assert.equal(result.quality.label, "No disponible");
  assert.deepEqual(result.picks, []);
});
