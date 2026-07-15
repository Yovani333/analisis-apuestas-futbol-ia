import { readFileSync } from "node:fs";
import { ALLOWED_LEAGUES } from "../../config/leagues.js";

const LIBRARY_PATH = new URL("../../../docs/evidence-library.json", import.meta.url);

function technicalOrigin(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("poisson")) return "poisson_picks";
  if (value.includes("corner")) return "corners_picks";
  if (value.includes("gol por equipo")) return "goal_probability_picks";
  return "data_picks";
}

function reportSnapshot(report) {
  const [home = "Local", away = "Visitante"] = String(report.match || "").split(/\s+vs\s+/i);
  const leagueId = Number(String(report.competition || "").match(/ID\s+(\d+)/i)?.[1]) || null;
  const leagueName = String(report.competition || "").replace(/\s*\(ID\s+\d+\)\s*$/i, "").trim() || "No disponible";
  const leagueSlug = ALLOWED_LEAGUES.find((league) => Number(league.apiId) === leagueId)?.slug || "";
  return {
    version: 2,
    id: `library:${report.fixtureId}:${Date.parse(report.capturedAt || "") || 0}`,
    capturedAt: report.capturedAt,
    timezone: "America/Tijuana",
    fixture: {
      id: String(report.fixtureId), date: String(report.matchDate || "").slice(0, 10), time: "",
      utcDateTime: report.matchDate || null, status: "scheduled", statusLabel: "Programado",
      leagueName, leagueId, leagueSlug, season: Number(report.season) || report.season || null,
      country: report.country || "Mundial", home: home.trim(), away: away.trim(),
      homeTeamId: Number(report.homeTeamId) || report.homeTeamId || null,
      awayTeamId: Number(report.awayTeamId) || report.awayTeamId || null
    },
    dataQuality: {
      score: report.dataQualityScore ?? null,
      level: report.dataQualityLevel || "No disponible",
      missing: []
    },
    preMatch: null,
    marketAnalysis: [],
    researchData: null,
    modules: {
      dataPicks: {
        status: report.picks?.length ? "available" : "not_available",
        modelVersion: "evidence-library-import-v1",
        finalDecision: "Auditoría histórica",
        picks: (report.picks || []).map((pick) => ({
          market: pick.market, selection: pick.selection, decision: pick.decision,
          decimalOdds: pick.decimalOdds, bookmaker: pick.bookmaker, sourceProvider: pick.source,
          modelProbabilityPct: pick.modelProbabilityPct, impliedProbabilityPct: pick.impliedProbabilityPct,
          expectedValuePct: pick.expectedValuePct, conservativeExpectedValuePct: pick.conservativeExpectedValuePct,
          confidenceScore: pick.confidenceScore, statisticalConfidenceScore: pick.statisticalConfidenceScore,
          footballConfidenceScore: pick.footballConfidenceScore, riskScore: pick.riskScore,
          poissonSupportScore: pick.poissonSupport, teamGoalSupportScore: pick.teamGoalSupport,
          contradictionLevel: pick.contradiction, sourceModule: technicalOrigin(pick.origin),
          explanation: pick.reason, generatedAt: pick.timestamp, selectionKey: pick.selectionKey
        }))
      },
      poisson: { status: "not_available", suggestedMarkets: [] },
      teamGoals: { status: "not_available", picks: [] },
      corners: { status: "not_available", picks: [] }
    },
    auditMetadata: {
      captureMode: "imported_user_evidence",
      sourceFile: report.sourceFile,
      dataPicksModelVersion: "evidence-library-import-v1",
      probabilityScale: "percent_0_100",
      calibrationEligible: true
    },
    currentFixtureStatisticsUsed: false,
    openAiUsed: false
  };
}

export function loadEvidenceLibrary() {
  const payload = JSON.parse(readFileSync(LIBRARY_PATH, "utf8"));
  return {
    label: payload.label,
    generatedAt: payload.generatedAt,
    competitions: payload.competitions || [],
    duplicatesIgnored: payload.duplicatesIgnored || 0,
    count: payload.reports?.length || 0,
    snapshots: (payload.reports || []).map(reportSnapshot)
  };
}
