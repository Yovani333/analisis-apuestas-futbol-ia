import { env } from "../config/env.js";

const TABLE = "fixture_analysis_cache";
const MAX_DATASET_BYTES = 1_800_000;

function configured() {
  return Boolean(env.dataMode === "live" && env.supabaseUrl && env.supabaseSecretKey);
}

function baseUrl() {
  return String(env.supabaseUrl || "").replace(/\/+$/, "");
}

function providerMessage(error) {
  return String(error?.message || error?.msg || error?.error || "");
}

function isMissingSchema(error) {
  return /fixture_analysis_cache|schema cache|could not find|does not exist|42P01/i.test(providerMessage(error));
}

async function supabaseAdminRequest(path, { method = "GET", body, prefer = "" } = {}) {
  if (!configured()) return null;
  const secret = env.supabaseSecretKey;
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      apikey: secret,
      "Content-Type": "application/json",
      ...(secret.startsWith("eyJ") ? { Authorization: `Bearer ${secret}` } : {}),
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || "Supabase rechazo la solicitud de cache de fixture.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactDataset(dataset = {}) {
  return {
    source: dataset.source || "api-football",
    fetchedAt: dataset.fetchedAt || null,
    fixture: dataset.fixture || null,
    confirmed: {
      statistics: dataset.confirmed?.statistics || [],
      standings: dataset.confirmed?.standings || [],
      h2h: dataset.confirmed?.h2h || [],
      injuries: dataset.confirmed?.injuries || [],
      lineups: dataset.confirmed?.lineups || [],
      odds: dataset.confirmed?.odds || [],
      events: dataset.confirmed?.events || [],
      teamStatistics: dataset.confirmed?.teamStatistics || null
    },
    preMatch: dataset.preMatch || null,
    marketAnalysis: dataset.marketAnalysis || [],
    dataQuality: dataset.dataQuality || null,
    competitionContext: dataset.competitionContext || null,
    estimatedXg: dataset.estimatedXg || null,
    historicalEstimatedXg: dataset.historicalEstimatedXg || null,
    externalSources: dataset.externalSources || {},
    researchData: dataset.researchData || null,
    poissonModel: dataset.poissonModel || null,
    teamGoalProbability: dataset.teamGoalProbability || null,
    cornersModel: dataset.cornersModel || null,
    pickRecommendation: dataset.pickRecommendation || null,
    unavailable: dataset.unavailable || [],
    qualityAlerts: dataset.qualityAlerts || []
  };
}

function datasetBytes(dataset) {
  return Buffer.byteLength(JSON.stringify(dataset), "utf8");
}

function rowToDataset(row) {
  const dataset = row?.dataset;
  if (!dataset || typeof dataset !== "object") return null;
  return {
    ...dataset,
    persistentCache: {
      source: "supabase-fixture-cache",
      updatedAt: row.updated_at || null,
      qualityScore: row.quality_score ?? null
    }
  };
}

export async function loadPersistedFixtureDataset(fixtureId, now = new Date()) {
  if (!configured() || !fixtureId) return null;
  const id = encodeURIComponent(String(fixtureId));
  try {
    const rows = await supabaseAdminRequest(`/rest/v1/${TABLE}?fixture_id=eq.${id}&select=dataset,quality_score,status,expires_at,updated_at&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : null;
    if (expiresAt && expiresAt <= now.getTime()) return null;
    return rowToDataset(row);
  } catch (error) {
    if (isMissingSchema(error)) return null;
    console.warn("[fixture-cache] load failed", { fixtureId: String(fixtureId), message: error.message });
    return null;
  }
}

export async function savePersistedFixtureDataset(dataset, ttlMs = 0, now = new Date()) {
  if (!configured() || !dataset?.fixture?.id) return { saved: false, reason: "not_configured" };
  const compact = compactDataset(dataset);
  const bytes = datasetBytes(compact);
  if (bytes > MAX_DATASET_BYTES) return { saved: false, reason: "dataset_too_large", bytes };
  const fixtureId = String(dataset.fixture.id);
  const incomingScore = numberOrNull(dataset.dataQuality?.score ?? dataset.researchData?.totalConfidenceScore) ?? 0;
  try {
    const existing = await loadPersistedFixtureDataset(fixtureId, now);
    const existingScore = numberOrNull(existing?.dataQuality?.score ?? existing?.researchData?.totalConfidenceScore) ?? 0;
    if (dataset.fixture.status === "finished" && existingScore > incomingScore) {
      return { saved: false, reason: "kept_higher_quality_finished_snapshot", existingScore, incomingScore };
    }
    const expiresAt = dataset.fixture.status === "finished" ? null : new Date(now.getTime() + Math.max(60_000, ttlMs || 30 * 60_000)).toISOString();
    const payload = {
      fixture_id: fixtureId,
      league_id: dataset.fixture.leagueId ?? null,
      season: dataset.fixture.season ?? null,
      status: dataset.fixture.status || null,
      quality_score: incomingScore,
      quality_level: dataset.dataQuality?.level || null,
      fetched_at: dataset.fetchedAt || now.toISOString(),
      expires_at: expiresAt,
      dataset: compact,
      updated_at: now.toISOString()
    };
    await supabaseAdminRequest(`/rest/v1/${TABLE}?on_conflict=fixture_id`, {
      method: "POST",
      body: payload,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
    return { saved: true, reason: "saved", bytes, qualityScore: incomingScore };
  } catch (error) {
    if (isMissingSchema(error)) return { saved: false, reason: "schema_missing" };
    console.warn("[fixture-cache] save failed", { fixtureId, message: error.message });
    return { saved: false, reason: "save_failed" };
  }
}

export const fixtureDatasetPersistenceInternals = { compactDataset, configured, datasetBytes, isMissingSchema };
