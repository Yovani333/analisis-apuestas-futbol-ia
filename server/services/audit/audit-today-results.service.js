import { runFixtureBacktest } from "./backtest-engine.service.js";

export async function auditTodayResults({ date, leagues, searchFixtures, getFixtureDataset, getFixtureResult, limit = 10 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new TypeError("La fecha debe usar formato YYYY-MM-DD.");
  const fixtures = await searchFixtures({ leagues, dateFrom: date, dateTo: date, status: "all", season: "auto" });
  const selected = fixtures.slice(0, Math.max(1, Math.min(10, limit)));
  const reports = [];
  const pending = [];
  for (const fixture of selected) {
    if (fixture.status === "live") { pending.push({ fixtureId: String(fixture.id), status: "LIVE_PENDING" }); continue; }
    if (fixture.status !== "finished") continue;
    const result = await getFixtureResult(fixture.id);
    if (!result.finished) { pending.push({ fixtureId: String(fixture.id), status: "LIVE_PENDING" }); continue; }
    const dataset = await getFixtureDataset(fixture.id, { includeHistorical: true });
    reports.push(runFixtureBacktest(dataset, result));
  }
  return { date, fixturesFound: fixtures.length, audited: reports.length, reports, pending, truncated: fixtures.length > selected.length };
}
