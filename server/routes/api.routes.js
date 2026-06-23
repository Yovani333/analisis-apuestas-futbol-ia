import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env, requireLiveConfiguration } from "../config/env.js";
import { ALLOWED_LEAGUES } from "../config/leagues.js";
import { AppError } from "../errors.js";
import { parseFixtureId, parseFixtureQuery } from "../middleware/validate.js";
import { getFixtureDataset, getFixtureResult, resolveLeague, searchFixtures } from "../services/api-football.service.js";
import { generateAnalysis } from "../services/openai.service.js";

export const apiRouter = Router();
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
    providers: {
      apiFootball: { configured: Boolean(env.apiFootballKey) },
      openai: { configured: Boolean(env.openaiApiKey && env.openaiModel) }
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
    researchData: dataset.researchData
  });
}));

apiRouter.get("/fixtures/:fixtureId/result", requireLiveMode, asyncRoute(async (req, res) => {
  res.json({ source: "api-football", result: await getFixtureResult(parseFixtureId(req.params.fixtureId)) });
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
apiRouter.post("/fixtures/:fixtureId/analysis", requireLiveMode, analysisLimiter, asyncRoute(async (req, res) => {
  const fixtureId = parseFixtureId(req.params.fixtureId);
  const dataset = await getFixtureDataset(fixtureId);
  const analysis = await generateAnalysis(dataset);
  res.json({ source: "openai", generatedAt: new Date().toISOString(), analysis });
}));
