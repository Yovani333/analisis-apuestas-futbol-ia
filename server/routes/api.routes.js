import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env, requireLiveConfiguration } from "../config/env.js";
import { ALLOWED_LEAGUES } from "../config/leagues.js";
import { AppError } from "../errors.js";
import { parseFixtureId, parseFixtureQuery } from "../middleware/validate.js";
import {
  getFixtureDataset, getFixtureEvents, getFixtureLineups, getFixturePlayers, getFixtureResult, getFixtureStatistics, getPlayerGoalFixtureDataset, getPreviousFixturesForTeam, resolveLeague, searchFixtures
} from "../services/api-football.service.js";
import { generateAnalysis } from "../services/openai.service.js";
import { generateRuleBasedAnalysis } from "../services/rule-analysis.service.js";
import { generateDataPicks } from "../services/data-picks.service.js";
import { calculatePoissonModel } from "../services/poisson-model.service.js";
import { calculateTeamGoalProbability } from "../services/team-goal-probability.service.js";
import { calculateCornersModel } from "../services/corners-model.service.js";
import { buildOutcomeScenarios } from "../services/outcome-scenarios.service.js";
import { buildSpecificMarkets } from "../services/specific-markets.service.js";
import { getApiFootballObservability } from "../services/api-football-observability.service.js";
import { runFixtureBacktest, runSavedEvidenceBacktest } from "../services/audit/backtest-engine.service.js";
import { getTeamPerformanceForFixture } from "../services/team-performance.service.js";
import { buildTeamPerformancePicks } from "../services/team-performance-picks.service.js";
import { getPlayerGoalCandidates } from "../services/player-goal-candidates.service.js";
import { compareTeamsWithHistoricalStats } from "../services/simulation-comparator.service.js";

export const apiRouter = Router();
const DEPLOYED_AT = new Date().toISOString();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const requireLiveMode = (req, res, next) => {
  if (env.dataMode !== "live") return next(new AppError("Activa DATA_MODE=live para consultar datos reales.", 409, "LIVE_MODE_DISABLED"));
  next();
};

apiRouter.get("/health", (req, res) => {
  const missing = requireLiveConfiguration();
  res.json({
    status: "ok",
    mode: env.dataMode,
    release: {
      deployedAt: DEPLOYED_AT,
      commit: String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").slice(0, 7)
    },
    providers: {
      apiFootball: {
        configured: Boolean(env.apiFootballKey),
        observability: getApiFootballObservability()
      },
      openai: { configured: Boolean(env.openaiApiKey && env.openaiModelDefault && env.openaiModelPremium) }
    },
    liveReady: missing.length === 0,
    missing
  });
});

apiRouter.get("/leagues", asyncRoute(async (req, res) => {
  if (env.dataMode !== "live") {
    return res.json({ mode: "mock", leagues: ALLOWED_LEAGUES.map(({ apiNames, ...league }) => ({ ...league, apiId: null, verified: false })) });
  }
  const leagues = await Promise.all(ALLOWED_LEAGUES.map(async ({ slug }) => {
    const league = await resolveLeague(slug);
    return { slug: league.slug, name: league.name, country: league.countryLabel, code: league.code, apiId: league.apiId, verified: true };
  }));
  res.json({ mode: "live", leagues });
}));

apiRouter.get("/fixtures", requireLiveMode, asyncRoute(async (req, res) => {
  const filters = parseFixtureQuery(req.query);
  const fixtures = await searchFixtures(filters);
  res.json({ source: "api-football", fixtures });
}));

apiRouter.get("/fixtures/:fixtureId", requireLiveMode, asyncRoute(async (req, res) => {
  const forceRefresh = ["1", "true"].includes(String(req.query.refresh || "").toLowerCase());
  res.json(await getFixtureDataset(parseFixtureId(req.params.fixtureId), { forceRefresh }));
}));

const researchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
apiRouter.get("/fixtures/:fixtureId/research", requireLiveMode, researchLimiter, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const forceRefresh = ["1", "true"].includes(String(req.query.refresh || "").toLowerCase());
  const dataset = await getFixtureDataset(fixtureId, { forceRefresh });
  res.json({
    source: dataset.source,
    fetchedAt: dataset.fetchedAt,
    refreshed: forceRefresh,
    cacheInfo: dataset.cacheInfo || null,
    researchData: dataset.researchData
  });
}));

apiRouter.get("/fixtures/:fixtureId/result", requireLiveMode, asyncRoute(async (req, res) => {
  res.json({ source: "api-football", result: await getFixtureResult(parseFixtureId(req.params.fixtureId)) });
}));

apiRouter.get("/simulation/compare", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = req.query.fixtureId ? parseFixtureId(req.query.fixtureId) : null;
  const windowSize = Number(req.query.window || 5);
  let teamA = { id: req.query.teamAId, name: String(req.query.teamAName || "Equipo A") };
  let teamB = { id: req.query.teamBId, name: String(req.query.teamBName || "Equipo B") };
  let fixtureDate = String(req.query.fixtureDate || "");
  let competition = String(req.query.competition || "");
  if (fixtureId) {
    const dataset = await getFixtureDataset(fixtureId);
    teamA = { id: dataset.fixture.homeTeamId, name: dataset.fixture.home };
    teamB = { id: dataset.fixture.awayTeamId, name: dataset.fixture.away };
    fixtureDate = dataset.fixture.utcDateTime || dataset.fixture.date || fixtureDate;
    competition = dataset.fixture.leagueName || competition;
  }
  const result = await compareTeamsWithHistoricalStats({ teamA, teamB, fixtureDate, windowSize, competition }, {
    getPreviousFixtures: getPreviousFixturesForTeam,
    getFixtureStatistics
  });
  res.json(result);
}));

apiRouter.get("/fixtures/:fixtureId/team-performance", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const forceRefresh = ["1", "true"].includes(String(req.query.refresh || "").toLowerCase());
  const dataset = await getFixtureDataset(fixtureId, { forceRefresh: false });
  const performance = await getTeamPerformanceForFixture(dataset.fixture, {
    getPreviousFixtures: getPreviousFixturesForTeam,
    getFixturePlayers
  }, { forceRefresh });
  const picks = buildTeamPerformancePicks(dataset.fixture, performance.equipo_local, performance.equipo_visitante, {
    odds: dataset.researchData?.odds?.markets || dataset.preMatch?.odds?.selections || []
  });
  res.json({ ...performance, picks });
}));

const playerGoalDependencies = {
  getPreviousFixtures: getPreviousFixturesForTeam,
  getFixturePlayers,
  getFixtureLineups,
  getFixtureEvents
};

apiRouter.get("/fixtures/:fixtureId/player-goal-candidates", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const forceRefresh = ["1", "true"].includes(String(req.query.refresh || "").toLowerCase());
  const dataset = await getPlayerGoalFixtureDataset(fixtureId);
  dataset.poissonModel ||= calculatePoissonModel(dataset);
  dataset.teamGoalProbability ||= calculateTeamGoalProbability(dataset);
  res.json(await getPlayerGoalCandidates(dataset, playerGoalDependencies, { forceRefresh }));
}));

apiRouter.post("/fixtures/:fixtureId/audit", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const result = await getFixtureResult(fixtureId);
  if (!result.finished) return res.status(409).json({ error: { code: "FIXTURE_NOT_FINISHED", message: result.appStatus === "live" ? "El partido sigue en vivo; la auditoría queda LIVE_PENDING." : "Solo se auditan partidos finalizados." } });
  const dataset = await getFixtureDataset(fixtureId, { includeHistorical: true });
  res.json(runFixtureBacktest(dataset, result));
}));

apiRouter.post("/fixtures/:fixtureId/audit/snapshot", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const evidence = req.body?.evidence;
  if (String(evidence?.fixture?.id || "") !== String(fixtureId)) throw new AppError("La evidencia no corresponde al fixture seleccionado.", 400, "EVIDENCE_FIXTURE_MISMATCH");
  const result = await getFixtureResult(fixtureId);
  if (!result.finished) throw new AppError("El partido todavía no ha finalizado.", 409, "FIXTURE_NOT_FINISHED");
  res.json(runSavedEvidenceBacktest(evidence, result));
}));

for (const [route, key] of [["statistics", "statistics"], ["standings", "standings"], ["head-to-head", "h2h"], ["injuries", "injuries"], ["lineups", "lineups"], ["odds", "odds"], ["events", "events"], ["players", "players"], ["team-statistics", "teamStatistics"]]) {
  apiRouter.get(`/fixtures/:fixtureId/${route}`, requireLiveMode, asyncRoute(async (req, res) => {
    const dataset = await getFixtureDataset(parseFixtureId(req.params.fixtureId));
    res.json({ source: dataset.source, fetchedAt: dataset.fetchedAt, data: dataset.confirmed[key] });
  }));
}

apiRouter.get("/fixtures/:fixtureId/sidelined", requireLiveMode, (req, res) => {
  res.status(501).json({ error: { code: "NOT_VERIFIED", message: "Sidelined requiere verificar disponibilidad y cobertura en el plan contratado." } });
});

apiRouter.get("/head-to-head", requireLiveMode, asyncRoute(async (req, res) => {
  const dataset = await getFixtureDataset(parseFixtureId(req.query.fixtureId));
  res.json({ source: dataset.source, fetchedAt: dataset.fetchedAt, data: dataset.confirmed.h2h });
}));

const analysisLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });
apiRouter.post("/fixtures/:fixtureId/analysis/data", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  dataset.poissonModel ||= calculatePoissonModel(dataset);
  dataset.teamGoalProbability ||= calculateTeamGoalProbability(dataset);
  dataset.cornersModel ||= calculateCornersModel(dataset);
  res.json({ source: "rule-engine", generatedAt: new Date().toISOString(), analysis: generateRuleBasedAnalysis(dataset) });
}));

apiRouter.post("/fixtures/:fixtureId/picks/data", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  res.json(generateDataPicks(dataset));
}));

apiRouter.post("/fixtures/:fixtureId/models/poisson", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  res.json(dataset.poissonModel || calculatePoissonModel(dataset));
}));

apiRouter.post("/fixtures/:fixtureId/models/team-goals", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  res.json(dataset.teamGoalProbability || calculateTeamGoalProbability(dataset));
}));

apiRouter.post("/fixtures/:fixtureId/models/corners", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  res.json(dataset.cornersModel || calculateCornersModel(dataset));
}));

apiRouter.post("/fixtures/:fixtureId/models/outcome-1x2", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  dataset.poissonModel ||= calculatePoissonModel(dataset);
  res.json(buildOutcomeScenarios(dataset));
}));

apiRouter.post("/fixtures/:fixtureId/markets/specific", requireLiveMode, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  dataset.poissonModel ||= calculatePoissonModel(dataset);
  dataset.teamGoalProbability ||= calculateTeamGoalProbability(dataset);
  dataset.playerGoalCandidates = await getPlayerGoalCandidates(dataset, playerGoalDependencies);
  res.json(buildSpecificMarkets(dataset));
}));

apiRouter.post("/fixtures/:fixtureId/analysis", requireLiveMode, analysisLimiter, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  dataset.teamPerformance = await getTeamPerformanceForFixture(dataset.fixture, {
    getPreviousFixtures: getPreviousFixturesForTeam,
    getFixturePlayers
  });
  const analysis = await generateAnalysis(dataset);
  res.json({ source: "openai", generatedAt: new Date().toISOString(), analysis });
}));
