import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEvidenceText } from "../server/services/audit/world-cup-evidence-audit.service.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDirectories = [
  "C:/Users/Usuario/Documents/EVIDENCIA PARTIDOS/Mundial",
  "C:/Users/Usuario/Documents/EVIDENCIA PARTIDOS/Liga china"
];
const directories = process.argv.slice(2).length ? process.argv.slice(2) : defaultDirectories;
const outputPath = path.join(rootDir, "docs", "evidence-library.json");

function evidenceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => /^evidencia_.*\.txt$/i.test(file))
    .map((file) => ({ file, fullPath: path.join(directory, file) }));
}

function newestEvidence(current, candidate) {
  const currentTime = Date.parse(current.capturedAt || "") || 0;
  const candidateTime = Date.parse(candidate.capturedAt || "") || 0;
  return candidateTime >= currentTime ? candidate : current;
}

const evidenceByFixture = new Map();
let validFiles = 0;
for (const directory of directories) {
  for (const { file, fullPath } of evidenceFiles(directory)) {
    const evidence = parseEvidenceText(fs.readFileSync(fullPath, "utf8"), file);
    if (!evidence.fixtureId || !evidence.match || !evidence.competition) continue;
    validFiles += 1;
    const key = String(evidence.fixtureId);
    evidenceByFixture.set(key, evidenceByFixture.has(key) ? newestEvidence(evidenceByFixture.get(key), evidence) : evidence);
  }
}

const reports = [...evidenceByFixture.values()].sort((a, b) =>
  String(a.matchDate || a.capturedAt || "").localeCompare(String(b.matchDate || b.capturedAt || ""))
  || String(a.fixtureId).localeCompare(String(b.fixtureId))
);
const payload = {
  label: "Biblioteca de evidencias prepartido importadas y deduplicadas por fixture.",
  generatedAt: new Date().toISOString(),
  count: reports.length,
  duplicatesIgnored: Math.max(0, validFiles - reports.length),
  competitions: [...new Set(reports.map((row) => row.competition))],
  reports
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, validFiles, imported: reports.length, duplicatesIgnored: payload.duplicatesIgnored, competitions: payload.competitions }, null, 2));
