import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_LEAGUES as BACKEND_LEAGUES } from "../server/config/leagues.js";
import { ALLOWED_LEAGUES as FRONTEND_LEAGUES } from "../public/mock-data.js";
import { searchFixtures } from "../server/services/api-football.service.js";
import { buildPickAnalysisCollection } from "../server/services/pick-analysis-collection.service.js";

const expected = new Map([
  ["mls", 253], ["brasileirao-serie-a", 71], ["liga-profesional-argentina", 128], ["liga-mx-femenil", 673],
  ["liga-expansion-mx", 263], ["eredivisie", 88], ["allsvenskan", 113], ["eliteserien", 103],
  ["conmebol-libertadores", 13], ["conmebol-sudamericana", 11], ["uefa-champions-qualifying", 2],
  ["uefa-europa-qualifying", 3], ["uefa-conference-qualifying", 848]
]);

test("registra los trece IDs oficiales sin duplicar slugs", () => {
  assert.equal(new Set(BACKEND_LEAGUES.map((league) => league.slug)).size, BACKEND_LEAGUES.length);
  for (const [slug, apiId] of expected) {
    const league = BACKEND_LEAGUES.find((item) => item.slug === slug);
    assert.equal(league?.apiId, apiId, slug);
    assert.ok(league?.region);
    assert.ok(league?.confederation);
    assert.ok(["league", "cup", "qualifying"].includes(league?.competitionType));
  }
});

test("frontend y backend comparten los mismos slugs nuevos", () => {
  const frontend = new Set(FRONTEND_LEAGUES.map((league) => league.slug));
  for (const slug of expected.keys()) assert.equal(frontend.has(slug), true, slug);
});

test("clasificatorias UEFA comparten ID oficial pero exigen filtro de ronda", () => {
  for (const slug of ["uefa-champions-qualifying", "uefa-europa-qualifying", "uefa-conference-qualifying"]) {
    const league = BACKEND_LEAGUES.find((item) => item.slug === slug);
    assert.equal(league.competitionType, "qualifying");
    assert.deepEqual(league.roundIncludes, ["Qualifying Round"]);
  }
});

test("cada competición nueva entra al buscador y a la recopilación genérica", async (context) => {
  for (const [slug, apiId] of expected) {
    await context.test(slug, async () => {
      const config = BACKEND_LEAGUES.find((item) => item.slug === slug);
      const round = config.competitionType === "qualifying" ? "1st Qualifying Round" : config.competitionType === "cup" ? "Round of 16" : "Regular Season - 1";
      const calls = [];
      const fixtures = await searchFixtures({ leagues: [slug], season: 2026, dateFrom: "2026-07-12", dateTo: "2026-07-12", status: "all" }, {
        leagueResolver: async () => ({ ...config, seasons: [] }),
        request: async (path, params) => {
          calls.push({ path, params });
          return [{
            fixture: { id: apiId * 100, date: "2026-07-12T20:00:00Z", status: { short: "NS", elapsed: null }, venue: {} },
            league: { id: apiId, season: 2026, round },
            teams: { home: { id: 1, name: "Local" }, away: { id: 2, name: "Visitante" } },
            goals: { home: null, away: null }, score: { penalty: { home: null, away: null } }
          }];
        }
      });
      assert.equal(calls[0].params.league, apiId);
      assert.equal(fixtures[0].leagueSlug, slug);
      const snapshot = buildPickAnalysisCollection({ fixture: fixtures[0], dataQuality: { score: 0 }, marketAnalysis: [] }, {
        dataPicks: { picks: [] }, outcome: {}, poisson: {}, teamGoals: {}, corners: {},
        teamPerformance: { picks: { home: [], away: [] } }, playerGoals: { candidates: [] }, specificMarkets: { groups: [] }
      });
      assert.equal(snapshot.fixtureId, fixtures[0].id);
      assert.ok(Array.isArray(snapshot.missingData));
    });
  }
});
