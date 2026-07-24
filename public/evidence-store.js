import { pickOriginLabel } from "./pick-origins.js";
import { filterValidEvidenceSnapshots, isValidEvidenceSnapshot } from "./evidence-validity.js";

export const EVIDENCE_SNAPSHOTS_KEY = "football-ai.evidence-snapshots.v1";
const MAX_SNAPSHOTS = 50;

function read(storage) {
  try {
    const value = JSON.parse(storage?.getItem(EVIDENCE_SNAPSHOTS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function loadEvidenceSnapshots(storage = globalThis.localStorage) {
  const stored = read(storage);
  const snapshots = filterValidEvidenceSnapshots(stored);
  if (snapshots.length !== stored.length) storage?.setItem(EVIDENCE_SNAPSHOTS_KEY, JSON.stringify(snapshots));
  return snapshots;
}

export function latestEvidenceForFixture(snapshots, fixtureId) {
  return filterValidEvidenceSnapshots(snapshots).filter((item) => String(item.fixture?.id) === String(fixtureId))
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] || null;
}

export function createEvidenceSnapshot({ fixture, dataPicks, poisson, teamGoals, corners }, now = new Date()) {
  if (!fixture?.id) throw new TypeError("La evidencia requiere fixtureId.");
  if (fixture.status !== "scheduled") throw new TypeError("Solo se permite guardar evidencia antes del inicio.");
  const modules = {
    dataPicks: dataPicks || { status: "not_available", picks: [] },
    poisson: poisson || { status: "not_available", suggestedMarkets: [] },
    teamGoals: teamGoals || { status: "not_available", picks: [] },
    corners: corners || { status: "not_available", picks: [] }
  };
  const quality = fixture.dataQuality || {};
  const snapshot = structuredClone({
    version: 3,
    id: `${fixture.id}:${now.getTime()}`,
    capturedAt: now.toISOString(),
    timezone: "America/Tijuana",
    fixture: {
      id: fixture.id, date: fixture.date, time: fixture.time, utcDateTime: fixture.utcDateTime || null,
      status: fixture.status, statusLabel: fixture.statusLabel, leagueName: fixture.leagueName,
      leagueSlug: fixture.leagueSlug, leagueId: fixture.leagueId ?? null, season: fixture.season ?? null,
      country: fixture.country || fixture.countryLabel || null, source: fixture.dataSource || "api-football",
      stadium: fixture.stadium || null, city: fixture.city || null, venueId: fixture.venueId ?? null,
      stadiumSource: fixture.stadiumSource || "not_available",
      home: fixture.home, away: fixture.away,
      homeTeamId: fixture.homeTeamId ?? null, awayTeamId: fixture.awayTeamId ?? null,
      favorite: fixture.favorite || null, neutralVenue: Boolean(fixture.neutralVenue)
    },
    dataQuality: fixture.dataQuality || null,
    preMatch: fixture.preMatch || null,
    marketAnalysis: fixture.marketAnalysis || [],
    researchData: fixture.researchData || null,
    modules,
    captureManifest: {
      schemaVersion: "pre-match-evidence-v3",
      qualityScore: Number.isFinite(Number(quality.score)) ? Number(quality.score) : null,
      qualityLevel: quality.level || null,
      missingFields: Array.isArray(quality.missing) ? [...quality.missing] : [],
      modules: Object.fromEntries(Object.entries(modules).map(([key, value]) => [key, {
        status: value?.status || "not_available",
        itemCount: [value?.picks, value?.suggestedMarkets, value?.likelyScores].find(Array.isArray)?.length || 0
      }])),
      sources: [],
      datasetFetchedAt: fixture.fetchedAt || null
    },
    auditMetadata: {
      captureMode: "manual_local_legacy",
      datasetFetchedAt: fixture.fetchedAt || null,
      dataPicksModelVersion: dataPicks?.modelVersion || null,
      adjustmentsVersion: dataPicks?.adjustmentsVersion || null,
      probabilityScale: "percent_0_100",
      calibrationEligible: true
    },
    currentFixtureStatisticsUsed: false,
    openAiUsed: false
  });
  if (!isValidEvidenceSnapshot(snapshot)) throw new TypeError("La evidencia no es auditable: verifica la hora de inicio y que el partido siga programado.");
  return snapshot;
}

export function saveEvidenceSnapshot(snapshot, storage = globalThis.localStorage) {
  if (!isValidEvidenceSnapshot(snapshot)) throw new TypeError("No se puede guardar una evidencia invalida o posterior al inicio.");
  const snapshots = filterValidEvidenceSnapshots([snapshot, ...read(storage).filter((item) => item.id !== snapshot.id)]).slice(0, MAX_SNAPSHOTS);
  storage?.setItem(EVIDENCE_SNAPSHOTS_KEY, JSON.stringify(snapshots));
  return snapshots;
}

const textValue = (value) => value === null || value === undefined || value === "" ? "No disponible" : String(value);
export function evidenceSnapshotToText(snapshot, { includeRejected = true } = {}) {
  const fixture = snapshot.fixture || {};
  const modules = snapshot.modules || {};
  const poisson = modules.poisson || {};
  const goals = modules.teamGoals || {};
  const allPicks = modules.dataPicks?.picks || [];
  const picks = includeRejected ? allPicks : allPicks.filter((pick) => ["VALOR", "PRECAUCIÓN"].includes(pick.decision));
  const lines = [
    "EVIDENCIA PREPARTIDO AUDITABLE", "=".repeat(34),
    `Partido: ${textValue(fixture.home)} vs ${textValue(fixture.away)}`,
    `Liga: ${textValue(fixture.leagueName)} (ID ${textValue(fixture.leagueId)})`, `País: ${textValue(fixture.country)}`, `Temporada: ${textValue(fixture.season)}`,
    `Fecha del partido: ${textValue(fixture.utcDateTime || `${fixture.date || ""} ${fixture.time || ""}`)}`,
    `Generada: ${textValue(snapshot.capturedAt)}`, `Fixture ID: ${textValue(fixture.id)}`,
    `Home team ID: ${textValue(fixture.homeTeamId)}`, `Away team ID: ${textValue(fixture.awayTeamId)}`,
    `Estado: ${textValue(fixture.statusLabel || fixture.status)}`, "Fuente principal: API-Football + modelos internos", "",
    `Modo de captura: ${textValue(snapshot.auditMetadata?.captureMode)}`,
    `Versión de evidencia: ${textValue(snapshot.captureManifest?.schemaVersion || `legacy-v${snapshot.version || 1}`)}`,
    `Dataset obtenido: ${textValue(snapshot.auditMetadata?.datasetFetchedAt || snapshot.capturedAt)}`,
    `Estadio: ${textValue(fixture.stadium)} | Ciudad: ${textValue(fixture.city)}`,
    "COBERTURA Y FUENTES", `Fuente declarada: ${textValue(fixture.source)}`,
    `Módulos consultados: ${textValue(snapshot.researchData?.sourceCoverage?.map((row) => row.module || row.label || row.moduleKey).filter(Boolean).join(", "))}`,
    `Calidad: ${textValue(snapshot.dataQuality?.score)}/100 (${textValue(snapshot.dataQuality?.level)})`,
    `Calidad congelada en captura: ${textValue(snapshot.captureManifest?.qualityScore)}/100 (${textValue(snapshot.captureManifest?.qualityLevel)})`,
    `Cobertura por módulo: ${textValue(Object.entries(snapshot.captureManifest?.modules || {}).map(([key, value]) => `${key}=${value.status}:${value.itemCount}`).join(", "))}`,
    `Datos faltantes: ${textValue(snapshot.dataQuality?.missing?.join(", "))}`, `Última actualización: ${textValue(snapshot.researchData?.updatedAt || snapshot.capturedAt)}`, "",
    "PROBABILIDAD DE GOL POR EQUIPO",
    `Local anota: ${textValue(goals.homeGoalProbability)}%`, `Visitante anota: ${textValue(goals.awayGoalProbability)}%`,
    `BTTS Sí: ${textValue(goals.btts?.yesProbabilityPct)}%`, `BTTS No: ${textValue(goals.btts?.noProbabilityPct)}%`,
    `Riesgo local sin anotar: ${textValue(goals.homeFailedToScoreRisk)}%`, `Riesgo visitante sin anotar: ${textValue(goals.awayFailedToScoreRisk)}%`,
    `Calidad del módulo: ${textValue(goals.teamGoalDataQuality)}/100`, "",
    "MODELO POISSON", `Lambda local: ${textValue(poisson.lambdaHome)}`, `Lambda visitante: ${textValue(poisson.lambdaAway)}`,
    `Total esperado: ${poisson.lambdaHome != null && poisson.lambdaAway != null ? Number(poisson.lambdaHome + poisson.lambdaAway).toFixed(2) : "No disponible"}`,
    ...Object.entries(poisson.probabilities || {}).map(([key, value]) => `${key}: ${textValue(value)}%`),
    `Marcadores probables: ${textValue(poisson.likelyScores?.map((row) => `${row.score} (${row.probabilityPct}%)`).join(", "))}`, "",
    "PICKS CLASIFICADOS"
  ];
  lines.push(`Motor de picks: ${textValue(snapshot.auditMetadata?.dataPicksModelVersion || modules.dataPicks?.modelVersion)}`,
    `Ajustes predictivos: ${textValue(snapshot.auditMetadata?.adjustmentsVersion || modules.dataPicks?.adjustmentsVersion)}`, "");
  picks.forEach((pick, index) => lines.push("", `${index + 1}. ${textValue(pick.market)} - ${textValue(pick.selection)}`,
    `Decisión: ${textValue(pick.decision)}`, `Cuota: ${textValue(pick.decimalOdds)} | Bookmaker: ${textValue(pick.bookmaker)} | Fuente: ${textValue(pick.sourceProvider)}`,
    `Modelo: ${textValue(pick.modelProbabilityPct)}% | Implícita: ${textValue(pick.impliedProbabilityPct)}% | EV: ${textValue(pick.expectedValuePct)}% | EV conservador: ${textValue(pick.conservativeExpectedValuePct)}%`,
    `Confianza: ${textValue(pick.confidenceScore)}/100 | Estadística: ${textValue(pick.statisticalConfidenceScore)}/100 | Futbolística: ${textValue(pick.footballConfidenceScore)}/100 | Riesgo: ${textValue(pick.riskScore)}/100`,
    `Soporte Poisson: ${textValue(pick.poissonSupportScore)} | Soporte Gol por Equipo: ${textValue(pick.teamGoalSupportScore)} | Contradicción: ${textValue(pick.contradictionLevel)}`,
    `Origen: ${textValue(pickOriginLabel(pick.sourceModule))} | Motivo: ${textValue(pick.explanation)} | Timestamp: ${textValue(pick.generatedAt)}`));
  lines.push("", "RESUMEN FINAL", `Recomendación: ${textValue(modules.dataPicks?.finalDecision || "NO BET")}`, "",
    "Resultado final del partido: Pendiente", "Comparación posterior: Pendiente", "Aciertos: Pendiente", "Errores detectados: Pendiente", "Notas de auditoría: Pendiente");
  return lines.join("\r\n");
}
