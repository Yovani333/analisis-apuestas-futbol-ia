import { env } from "../config/env.js";
import { calculateCornersModel } from "./corners-model.service.js";
import { generateDataPicks } from "./data-picks.service.js";
import { getFixtureDataset } from "./api-football.service.js";
import {
  evidenceAutomationConfigured,
  listDueEvidenceWatchlist,
  saveAutomaticEvidence,
  updateEvidenceWatchlist
} from "./cloud-sync.service.js";
import { calculatePoissonModel } from "./poisson-model.service.js";
import { calculateTeamGoalProbability } from "./team-goal-probability.service.js";
import { isInvalidEvidenceFixtureStatus, isValidEvidenceSnapshot } from "../../public/evidence-validity.js";

const fallback = (warning) => ({ status: "not_available", warning, picks: [], suggestedMarkets: [] });
let activeCycle = null;

export function createServerEvidenceSnapshot(dataset, now = new Date(), { captureMode = "automatic_one_hour", targetLeadMinutes = 60 } = {}) {
  const fixture = dataset?.fixture;
  if (!fixture?.id) throw new TypeError("La evidencia automatica requiere fixtureId.");
  if (fixture.status !== "scheduled") throw new TypeError("La evidencia automatica solo se captura antes del inicio.");
  let dataPicks, poisson, teamGoals, corners;
  try { dataPicks = generateDataPicks(dataset); } catch { dataPicks = fallback("Picks basados en datos no disponibles al capturar."); }
  try { poisson = dataset.poissonModel || calculatePoissonModel(dataset); } catch { poisson = fallback("Poisson no disponible al capturar."); }
  try { teamGoals = dataset.teamGoalProbability || calculateTeamGoalProbability(dataset); } catch { teamGoals = fallback("Gol por equipo no disponible al capturar."); }
  try { corners = dataset.cornersModel || calculateCornersModel(dataset); } catch { corners = fallback("Corners no disponibles al capturar."); }
  const snapshot = structuredClone({
    version: 2,
    id: `${fixture.id}:${now.getTime()}`,
    capturedAt: now.toISOString(),
    timezone: "America/Tijuana",
    fixture: {
      id: fixture.id,
      date: fixture.date,
      time: fixture.time,
      utcDateTime: fixture.utcDateTime || null,
      status: fixture.status,
      statusLabel: fixture.statusLabel,
      leagueName: fixture.leagueName,
      leagueSlug: fixture.leagueSlug,
      leagueId: fixture.leagueId ?? null,
      season: fixture.season ?? null,
      country: fixture.country || null,
      stadium: fixture.stadium || null,
      city: fixture.city || null,
      venueId: fixture.venueId ?? null,
      stadiumSource: fixture.stadiumSource || "api-football",
      source: fixture.dataSource || dataset.source || "api-football",
      home: fixture.home,
      away: fixture.away,
      homeTeamId: fixture.homeTeamId ?? null,
      awayTeamId: fixture.awayTeamId ?? null,
      favorite: fixture.favorite || null,
      neutralVenue: Boolean(fixture.neutralVenue)
    },
    dataQuality: dataset.dataQuality || fixture.dataQuality || null,
    preMatch: dataset.preMatch || fixture.preMatch || null,
    marketAnalysis: dataset.marketAnalysis || fixture.marketAnalysis || [],
    researchData: dataset.researchData || fixture.researchData || null,
    modules: { dataPicks, poisson, teamGoals, corners },
    auditMetadata: {
      captureMode,
      targetLeadMinutes,
      datasetFetchedAt: dataset.fetchedAt || null,
      dataSource: dataset.source || "api-football",
      dataPicksModelVersion: dataPicks?.modelVersion || null,
      adjustmentsVersion: dataPicks?.adjustmentsVersion || null,
      probabilityScale: "percent_0_100",
      calibrationEligible: true
    },
    currentFixtureStatisticsUsed: false,
    openAiUsed: false
  });
  if (!isValidEvidenceSnapshot(snapshot)) throw new TypeError("La evidencia automatica no es auditable o el fixture ya no es valido.");
  return snapshot;
}

export function createAutomaticEvidenceSnapshot(dataset, now = new Date()) {
  return createServerEvidenceSnapshot(dataset, now, { captureMode: "automatic_one_hour", targetLeadMinutes: 60 });
}

export function evidenceWindowStatus(fixtureDate, now = new Date()) {
  const startsAt = new Date(fixtureDate);
  if (Number.isNaN(startsAt.getTime())) return "invalid";
  if (startsAt <= now) return "started";
  return startsAt.getTime() - now.getTime() <= 60 * 60 * 1000 ? "due" : "waiting";
}

async function processWatchRow(row, now, dependencies) {
  const status = evidenceWindowStatus(row.fixture_date, now);
  if (["invalid", "started"].includes(status)) {
    await dependencies.updateWatch(row, {
      status: "skipped",
      attempts: Number(row.attempts || 0) + 1,
      last_error: status === "started" ? "El partido ya habia iniciado." : "Fecha del fixture invalida.",
      updated_at: now.toISOString()
    });
    return { fixtureId: String(row.fixture_id), status: "skipped" };
  }
  try {
    const dataset = await dependencies.getDataset(row.fixture_id, { forceRefresh: false, includeHistorical: true });
    if (isInvalidEvidenceFixtureStatus(dataset?.fixture?.status)) {
      await dependencies.updateWatch(row, {
        status: "skipped",
        attempts: Number(row.attempts || 0) + 1,
        last_error: "Evidencia descartada: el partido fue pospuesto, cancelado o suspendido.",
        updated_at: now.toISOString()
      });
      return { fixtureId: String(row.fixture_id), status: "skipped", reason: "invalid_fixture_status" };
    }
    if (dataset?.fixture?.status !== "scheduled") throw new TypeError("El fixture ya no esta programado.");
    const snapshot = createAutomaticEvidenceSnapshot(dataset, now);
    await dependencies.saveEvidence(row, snapshot, now);
    return { fixtureId: String(row.fixture_id), status: "captured", snapshot };
  } catch (error) {
    const message = String(error?.message || "No fue posible generar la evidencia.").slice(0, 240);
    const attempts = Number(row.attempts || 0) + 1;
    await dependencies.updateWatch(row, {
      status: attempts >= 3 ? "failed" : "scheduled",
      attempts,
      last_error: message,
      updated_at: now.toISOString()
    });
    return { fixtureId: String(row.fixture_id), status: attempts >= 3 ? "failed" : "retry", error: message };
  }
}

export async function runAutomaticEvidenceCycle(options = {}) {
  if (activeCycle) return activeCycle;
  if (!evidenceAutomationConfigured() && !options.listDue) {
    return { configured: false, checked: 0, captured: 0, failed: 0, retrying: 0, skipped: 0 };
  }
  const now = options.now || new Date();
  const dependencies = {
    listDue: options.listDue || listDueEvidenceWatchlist,
    getDataset: options.getDataset || getFixtureDataset,
    saveEvidence: options.saveEvidence || saveAutomaticEvidence,
    updateWatch: options.updateWatch || updateEvidenceWatchlist
  };
  activeCycle = (async () => {
    // Cada expediente puede requerir varios endpoints. Un lote pequeño evita que
    // la captura automática deje sin capacidad a las consultas interactivas.
    const cycleLimit = Math.max(1, Math.min(2, Number(options.limit) || 2));
    const rows = await dependencies.listDue(now, cycleLimit);
    const datasetByFixture = new Map();
    const getSharedDataset = (fixtureId, datasetOptions = {}) => {
      const key = String(fixtureId);
      if (!datasetByFixture.has(key)) datasetByFixture.set(key, Promise.resolve(dependencies.getDataset(key, datasetOptions)));
      return datasetByFixture.get(key);
    };
    const results = [];
    for (const row of rows) results.push(await processWatchRow(row, now, { ...dependencies, getDataset: getSharedDataset }));
    return {
      configured: true,
      checked: results.length,
      captured: results.filter((item) => item.status === "captured").length,
      failed: results.filter((item) => item.status === "failed").length,
      retrying: results.filter((item) => item.status === "retry").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      results
    };
  })().finally(() => { activeCycle = null; });
  return activeCycle;
}

export function startAutomaticEvidenceScheduler({ logger = console } = {}) {
  if (!evidenceAutomationConfigured()) return () => {};
  const run = () => runAutomaticEvidenceCycle().then((result) => {
    if (result.checked) logger.info(`[automatic-evidence] checked=${result.checked} captured=${result.captured} retrying=${result.retrying} failed=${result.failed} skipped=${result.skipped}`);
  }).catch((error) => logger.error("[automatic-evidence] cycle failed", error?.message || error));
  const initial = setTimeout(run, 10_000);
  const interval = setInterval(run, env.evidenceAutomationIntervalMs);
  initial.unref?.();
  interval.unref?.();
  return () => { clearTimeout(initial); clearInterval(interval); };
}

export const automaticEvidenceInternals = { processWatchRow };
