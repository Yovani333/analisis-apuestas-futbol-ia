import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEvidenceText, runWorldCupEvidenceAudit } from "../server/services/audit/world-cup-evidence-audit.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const evidenceDir = process.argv[2] || "C:/Users/Usuario/Documents/EVIDENCIA PARTIDOS/Mundial";
const outputJson = path.join(rootDir, "docs", "world-cup-evidence-audit-2026-pilot.json");
const outputMd = path.join(rootDir, "docs", "world-cup-evidence-audit-2026-pilot.md");

const PILOT_RESULTS = Object.freeze({
  "1567824": { finished90: true, homeGoals: 0, awayGoals: 3, extraTime: false, penalties: false, advancedTeam: "Morocco", final90Label: "Canada 0-3 Morocco" },
  "1569870": { finished90: true, homeGoals: 0, awayGoals: 1, extraTime: false, penalties: false, advancedTeam: "France", final90Label: "Paraguay 0-1 France" },
  "1568100": { finished90: true, homeGoals: 1, awayGoals: 2, extraTime: false, penalties: false, advancedTeam: "Norway", final90Label: "Brazil 1-2 Norway" },
  "1570714": { finished90: true, homeGoals: 2, awayGoals: 3, extraTime: false, penalties: false, advancedTeam: "England", final90Label: "Mexico 2-3 England" },
  "1576756": { finished90: true, homeGoals: 0, awayGoals: 1, extraTime: false, penalties: false, advancedTeam: "Spain", final90Label: "Portugal 0-1 Spain" },
  "1570715": { finished90: true, homeGoals: 1, awayGoals: 4, extraTime: false, penalties: false, advancedTeam: "Belgium", final90Label: "USA 1-4 Belgium" },
  "1576804": { finished90: true, homeGoals: 3, awayGoals: 2, extraTime: false, penalties: false, advancedTeam: "Argentina", final90Label: "Argentina 3-2 Egypt" },
  "1576805": { finished90: true, homeGoals: 0, awayGoals: 0, extraTime: true, penalties: true, penaltyScore: "Switzerland 4-3 Colombia", advancedTeam: "Switzerland", final90Label: "Switzerland 0-0 Colombia" }
});

function readEvidenceFiles(dir) {
  return fs.readdirSync(dir)
    .filter((file) => /^evidencia_.*\.txt$/i.test(file))
    .sort()
    .map((file) => {
      const fullPath = path.join(dir, file);
      return parseEvidenceText(fs.readFileSync(fullPath, "utf8"), file);
    });
}

function bestMarkets(markets, key) {
  return markets
    .filter((market) => market[key] > 0)
    .sort((a, b) => b[key] - a[key] || a.fallado - b.fallado || b.total - a.total)
    .slice(0, 5);
}

function renderMarkdown(audit) {
  const lines = [
    "# Auditoría de Evidencias - Mundial 2026",
    "",
    `**Etiqueta:** ${audit.label}`,
    "",
    `**Generada:** ${audit.generatedAt}`,
    "",
    "> Esta muestra sirve para validar extracción, comparación contra resultados y detección preliminar de errores. No se usa para recalibrar pesos ni fórmulas.",
    "",
    "## Resumen",
    "",
    `- Evidencias procesadas: ${audit.totals.evidenceCount}`,
    `- Picks extraídos: ${audit.totals.extractedPicks}`,
    `- Picks PRECAUCIÓN/equivalentes evaluados: ${audit.totals.recommendedEvaluated}`,
    `- Acertados: ${audit.totals.hits}`,
    `- Fallados: ${audit.totals.misses}`,
    `- Nulos: ${audit.totals.voids}`,
    `- No evaluables: ${audit.totals.notEvaluable}`,
    `- Descartados EVITAR/NO BET: ${audit.totals.discarded}`,
    "",
    "## Mercados con mejor lectura preliminar",
    "",
    ...bestMarkets(audit.marketDiagnostics, "acertado").map((market) => `- ${market.market}: ${market.acertado} aciertos, ${market.fallado} fallos, ${market.no_evaluable} no evaluables.`),
    "",
    "## Mercados con peor lectura preliminar",
    "",
    ...bestMarkets(audit.marketDiagnostics, "fallado").map((market) => `- ${market.market}: ${market.fallado} fallos, ${market.acertado} aciertos, ${market.no_evaluable} no evaluables.`),
    "",
    "## Evidencias",
    ""
  ];

  for (const report of audit.reports) {
    lines.push(`### ${report.match}`, "");
    lines.push(`- Archivo: ${report.sourceFile}`);
    lines.push(`- Fixture ID: ${report.fixtureId}`);
    lines.push(`- Competición: ${report.competition}`);
    lines.push(`- Fase: ${report.phase}`);
    lines.push(`- Marcador 90': ${report.finalResult?.final90Label || "No disponible"}`);
    lines.push(`- Tiempo extra: ${report.finalResult?.extraTime ? "Sí" : "No"}`);
    lines.push(`- Penales: ${report.finalResult?.penalties ? `Sí (${report.finalResult.penaltyScore || "sin marcador"})` : "No"}`);
    lines.push(`- Avanzó: ${report.finalResult?.advancedTeam || "No disponible"}`);
    lines.push(`- PRECAUCIÓN/equivalentes: ${report.summary.recommended}`);
    lines.push(`- Descartes EVITAR/NO BET: ${report.summary.discarded}`);
    const recommendedRows = report.picks
      .filter((pick) => pick.decisionGroup === "recommended")
      .map((pick) => `  - ${pick.decision}: ${pick.market} - ${pick.selection} => ${pick.evaluation.status}. ${pick.evaluation.reason}`);
    lines.push(...(recommendedRows.length ? recommendedRows : ["  - Sin picks recomendados; solo descartes auditables."]));
    lines.push("");
  }

  lines.push("## Recomendaciones prudentes", "");
  lines.push("- Mantener EVITAR y NO BET como descartes, no como fallos de apuesta.");
  lines.push("- No recalibrar con esta muestra: es menor a 30 resultados por mercado y versión.");
  lines.push("- En torneos cortos, elevar cautela en Over 2.5 y BTTS cuando dependen demasiado de proyecciones ofensivas prepartido.");
  lines.push("- Revisar doble oportunidad cuando la cuota es baja y el margen de EV conservador es pequeño.");
  lines.push("- Seguir acumulando evidencias prepartido con hora de captura y resultado final antes de ajustar pesos.");
  lines.push("");
  lines.push(`**Advertencia:** ${audit.warning}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const evidences = readEvidenceFiles(evidenceDir);
const audit = runWorldCupEvidenceAudit(evidences, PILOT_RESULTS);

fs.writeFileSync(outputJson, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
fs.writeFileSync(outputMd, renderMarkdown(audit), "utf8");

console.log(JSON.stringify({
  evidenceDir,
  outputJson,
  outputMd,
  evidenceCount: audit.totals.evidenceCount,
  extractedPicks: audit.totals.extractedPicks,
  recommendedEvaluated: audit.totals.recommendedEvaluated,
  hits: audit.totals.hits,
  misses: audit.totals.misses,
  discarded: audit.totals.discarded
}, null, 2));
