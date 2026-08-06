import { createHash } from "node:crypto";

const MAX_REPORTS = 20;
const reports = [];

function reportFingerprint(report) {
  const content = {
    configVersion: report.configVersion,
    candidates: (report.candidates || []).map((candidate) => ({
      id: candidate.id, odds: candidate.odds, modelProbabilityPct: candidate.modelProbabilityPct,
      dataQualityScore: candidate.dataQualityScore, classification: candidate.classification
    }))
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 20);
}

export function saveBestBetsReport(report) {
  if (!report?.generatedAt) return null;
  const fingerprint = reportFingerprint(report);
  const existingIndex = reports.findIndex((row) => row.fingerprint === fingerprint);
  const id = existingIndex >= 0 ? reports[existingIndex].id : `${Date.parse(report.generatedAt) || Date.now()}:${report.configVersion || "config"}`;
  const stored = structuredClone({ ...report, id, fingerprint, storage: "runtime-memory" });
  if (existingIndex >= 0) reports.splice(existingIndex, 1);
  reports.unshift(stored);
  reports.splice(MAX_REPORTS);
  return structuredClone(stored);
}

export function latestBestBetsReport() {
  return reports[0] ? structuredClone(reports[0]) : null;
}

export function getBestBetsReport(id) {
  const report = reports.find((row) => row.id === String(id));
  return report ? structuredClone(report) : null;
}

export function clearBestBetsReports() {
  reports.length = 0;
}
