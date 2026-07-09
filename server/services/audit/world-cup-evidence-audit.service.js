export const WORLD_CUP_PILOT_AUDIT_LABEL = "Prueba piloto inicial: 9 evidencias del Mundial. Útil para validar auditoría y detectar errores preliminares, pero insuficiente para calibración estadística.";

const ACTIONABLE_DECISIONS = new Set(["PRECAUCION", "VALOR", "RECOMENDADO", "PICK FUERTE", "PICK LOGICO"]);
const DISCARD_DECISIONS = new Set(["EVITAR", "NO BET", "SIN PICK"]);

const stripAccents = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (value) => stripAccents(value).toLowerCase().replace(/\s+/g, " ").trim();

function firstMatch(text, regex, fallback = "") {
  return text.match(regex)?.[1]?.trim() || fallback;
}

function fieldLine(block, label) {
  const target = norm(label);
  return block.split(/\r?\n/).find((line) => norm(line).startsWith(`${target}:`)) || "";
}

function fieldValue(block, label) {
  const line = fieldLine(block, label);
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

function partValue(line, label) {
  const target = norm(label);
  const part = String(line || "").split("|").find((item) => norm(item).startsWith(`${target}:`));
  return part ? part.slice(part.indexOf(":") + 1).trim() : "";
}

function numeric(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace("%", "").replace(",", ".").trim();
  if (!cleaned || /no disponible/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function confidencePart(value) {
  const match = String(value || "").match(/-?\d+(?:[.,]\d+)?/);
  return match ? numeric(match[0]) : null;
}

function decisionGroup(decision) {
  const normalized = norm(decision).toUpperCase();
  if (ACTIONABLE_DECISIONS.has(normalized)) return "recommended";
  if (DISCARD_DECISIONS.has(normalized)) return "discarded";
  return "other";
}

function inferSelectionKey(market, selection) {
  const combined = norm(`${market} ${selection}`);
  const pick = norm(selection);
  if (combined.includes("doble oportunidad")) {
    if (combined.includes("(1x)") || pick.endsWith(" 1x")) return "1X";
    if (combined.includes("(x2)") || pick.endsWith(" x2")) return "X2";
    if (combined.includes("(12)") || pick.endsWith(" 12")) return "12";
  }
  if (combined.includes("resultado 1x2")) {
    if (pick.includes("empate")) return "draw";
    if (pick.includes("gana")) return pick;
  }
  if (combined.includes("ambos anotan")) return pick === "si" ? "btts_yes" : pick === "no" ? "btts_no" : null;
  if (combined.includes("total de goles")) {
    const threshold = combined.match(/(\d+(?:[.,]\d+)?)/)?.[1]?.replace(",", ".");
    if (combined.includes("mas de") && threshold) return `over_${threshold.replace(".", "_")}`;
    if (combined.includes("menos de") && threshold) return `under_${threshold.replace(".", "_")}`;
  }
  if (combined.includes("goles de")) {
    const threshold = combined.match(/(\d+(?:[.,]\d+)?)/)?.[1]?.replace(",", ".");
    if (combined.includes("mas de") && threshold) return `team_over_${threshold.replace(".", "_")}`;
  }
  if (combined.includes("clasifica") || combined.includes("avanza")) return "advance";
  return null;
}

export function parseEvidenceText(text, sourceFile = "") {
  const picks = [...String(text || "").matchAll(/\n(\d+)\.\s+([^\n-]+)\s+-\s+([\s\S]*?)(?=\n\d+\.\s+|\nResultado final del partido:|$)/g)]
    .map((match) => {
      const block = match[3].trim();
      const oddsLine = fieldLine(block, "Cuota");
      const modelLine = fieldLine(block, "Modelo");
      const confidenceLine = fieldLine(block, "Confianza");
      const supportLine = fieldLine(block, "Soporte Poisson");
      const originLine = fieldLine(block, "Origen");
      const selection = block.split(/\r?\n/)[0]?.trim() || "";
      const market = match[2].trim();
      const decision = fieldValue(block, "Decisión");
      return {
        index: Number(match[1]),
        market,
        selection,
        decision,
        decisionGroup: decisionGroup(decision),
        decimalOdds: numeric(partValue(oddsLine, "Cuota")),
        bookmaker: partValue(oddsLine, "Bookmaker") || null,
        source: partValue(oddsLine, "Fuente") || null,
        modelProbabilityPct: numeric(partValue(modelLine, "Modelo")),
        impliedProbabilityPct: numeric(partValue(modelLine, "Implícita")),
        expectedValuePct: numeric(partValue(modelLine, "EV")),
        conservativeExpectedValuePct: numeric(partValue(modelLine, "EV conservador")),
        confidenceScore: confidencePart(partValue(confidenceLine, "Confianza")),
        statisticalConfidenceScore: confidencePart(partValue(confidenceLine, "Estadística")),
        footballConfidenceScore: confidencePart(partValue(confidenceLine, "Futbolística")),
        riskScore: confidencePart(partValue(confidenceLine, "Riesgo")),
        poissonSupport: numeric(partValue(supportLine, "Soporte Poisson")),
        teamGoalSupport: numeric(partValue(supportLine, "Soporte Gol por Equipo")),
        contradiction: partValue(supportLine, "Contradicción") || null,
        origin: partValue(originLine, "Origen") || null,
        reason: partValue(originLine, "Motivo") || null,
        timestamp: partValue(originLine, "Timestamp") || null,
        selectionKey: inferSelectionKey(market, selection)
      };
    });

  return {
    sourceFile,
    match: firstMatch(text, /^Partido:\s*(.+)$/m),
    fixtureId: firstMatch(text, /^Fixture ID:\s*(.+)$/m),
    competition: firstMatch(text, /^Liga:\s*(.+)$/m),
    country: firstMatch(text, /^País:\s*(.+)$/m),
    season: firstMatch(text, /^Temporada:\s*(.+)$/m),
    matchDate: firstMatch(text, /^Fecha del partido:\s*(.+)$/m),
    capturedAt: firstMatch(text, /^Generada:\s*(.+)$/m),
    homeTeamId: firstMatch(text, /^Home team ID:\s*(.+)$/m),
    awayTeamId: firstMatch(text, /^Away team ID:\s*(.+)$/m),
    phase: firstMatch(text, /^Fase(?: del Mundial)?:\s*(.+)$/m, "No especificada"),
    picks
  };
}

function resultSides(evidence, result) {
  const [homeName = "Local", awayName = "Visitante"] = String(evidence.match || "").split(/\s+vs\s+/i).map((item) => item.trim());
  return { homeName, awayName, homeGoals: Number(result.homeGoals), awayGoals: Number(result.awayGoals) };
}

function evaluateMatchWinner(pick, sides) {
  const selection = norm(pick.selection);
  if (selection.includes("empate")) return sides.homeGoals === sides.awayGoals;
  if (selection.includes(norm(sides.homeName))) return sides.homeGoals > sides.awayGoals;
  if (selection.includes(norm(sides.awayName))) return sides.awayGoals > sides.homeGoals;
  return null;
}

function evaluateTeamGoals(pick, sides) {
  const selection = norm(pick.selection);
  const threshold = Number((pick.selectionKey || "").match(/team_over_(\d+)_?(\d+)?/)?.slice(1).filter(Boolean).join("."));
  if (!Number.isFinite(threshold)) return null;
  if (selection.includes(norm(sides.homeName))) return sides.homeGoals > threshold;
  if (selection.includes(norm(sides.awayName))) return sides.awayGoals > threshold;
  return null;
}

export function evaluateEvidencePick(pick, evidence, result) {
  if (pick.decisionGroup === "discarded") return { status: "descartado", reason: `El sistema lo marcó como ${pick.decision}; no se cuenta como apuesta fallada.` };
  if (pick.decisionGroup !== "recommended") return { status: "no_evaluable", reason: `Decisión no accionable o no reconocida: ${pick.decision || "sin decisión"}.` };
  if (!result || result.finished90 !== true) return { status: "no_evaluable", reason: "Falta marcador final de 90 minutos + añadido." };

  const sides = resultSides(evidence, result);
  const totalGoals = sides.homeGoals + sides.awayGoals;
  let won = null;
  let reason = "";
  const key = pick.selectionKey;

  if (key === "1X") {
    won = sides.homeGoals >= sides.awayGoals;
    reason = `Doble oportunidad 1X evaluada con 90': ${sides.homeGoals}-${sides.awayGoals}.`;
  }
  else if (key === "X2") {
    won = sides.awayGoals >= sides.homeGoals;
    reason = `Doble oportunidad X2 evaluada con 90': ${sides.homeGoals}-${sides.awayGoals}.`;
  }
  else if (key === "12") {
    won = sides.homeGoals !== sides.awayGoals;
    reason = `Doble oportunidad 12 gana si no hay empate en 90': ${sides.homeGoals}-${sides.awayGoals}.`;
  }
  else if (key === "draw" || norm(pick.market).includes("resultado 1x2")) {
    won = evaluateMatchWinner(pick, sides);
    reason = `Resultado 1X2 evaluado solo con 90': ${sides.homeGoals}-${sides.awayGoals}.`;
  }
  else if (key?.startsWith("over_")) {
    const threshold = Number(key.replace("over_", "").replace("_", "."));
    won = totalGoals > threshold;
    reason = `Total ${totalGoals} goles en 90' contra línea ${threshold}.`;
  }
  else if (key?.startsWith("under_")) {
    const threshold = Number(key.replace("under_", "").replace("_", "."));
    won = totalGoals < threshold;
    reason = `Total ${totalGoals} goles en 90' contra línea ${threshold}.`;
  }
  else if (key === "btts_yes") {
    won = sides.homeGoals > 0 && sides.awayGoals > 0;
    reason = `Ambos anotan evaluado con 90': ${sides.homeGoals}-${sides.awayGoals}.`;
  }
  else if (key === "btts_no") {
    won = sides.homeGoals === 0 || sides.awayGoals === 0;
    reason = `BTTS No evaluado con 90': ${sides.homeGoals}-${sides.awayGoals}.`;
  }
  else if (key?.startsWith("team_over_")) {
    won = evaluateTeamGoals(pick, sides);
    reason = `Goles de equipo evaluados con marcador 90': ${sides.homeGoals}-${sides.awayGoals}.`;
  }
  else if (key === "advance") {
    const advanced = norm(result.advancedTeam);
    won = advanced ? norm(pick.selection).includes(advanced) : null;
    reason = result.penalties ? "Mercado de clasificación evaluado incluyendo penales." : "Mercado de clasificación evaluado con el equipo que avanzó.";
  }

  if (typeof won !== "boolean") return { status: "no_evaluable", reason: "Mercado sin regla evaluable en esta auditoría piloto." };
  return { status: won ? "acertado" : "fallado", reason };
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "No disponible";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function marketDiagnostics(evaluatedPicks) {
  const recommended = evaluatedPicks.filter((pick) => pick.evaluation.status !== "descartado");
  const byMarket = {};
  for (const pick of recommended) {
    const market = pick.market || "No disponible";
    byMarket[market] ||= { market, acertado: 0, fallado: 0, nulo: 0, no_evaluable: 0, total: 0 };
    byMarket[market].total += 1;
    if (pick.evaluation.status in byMarket[market]) byMarket[market][pick.evaluation.status] += 1;
  }
  return Object.values(byMarket).sort((a, b) => b.acertado - a.acertado || a.fallado - b.fallado || b.total - a.total);
}

export function auditEvidence(evidence, result) {
  const evaluatedPicks = evidence.picks.map((pick) => ({ ...pick, evaluation: evaluateEvidencePick(pick, evidence, result) }));
  const recommended = evaluatedPicks.filter((pick) => pick.decisionGroup === "recommended");
  const discarded = evaluatedPicks.filter((pick) => pick.evaluation.status === "descartado");
  return {
    ...evidence,
    finalResult: result,
    picks: evaluatedPicks,
    summary: {
      totalPicks: evaluatedPicks.length,
      recommended: recommended.length,
      discarded: discarded.length,
      byDecision: countBy(evaluatedPicks, "decision"),
      outcomes: countBy(recommended.map((pick) => pick.evaluation), "status")
    }
  };
}

export function runWorldCupEvidenceAudit(evidences, resultsByFixtureId, options = {}) {
  const reports = evidences.map((evidence) => auditEvidence(evidence, resultsByFixtureId[String(evidence.fixtureId)]));
  const recommended = reports.flatMap((report) => report.picks.filter((pick) => pick.decisionGroup === "recommended"));
  const discarded = reports.flatMap((report) => report.picks.filter((pick) => pick.evaluation.status === "descartado"));
  return {
    label: options.label || WORLD_CUP_PILOT_AUDIT_LABEL,
    competitionScope: "Mundial",
    generatedAt: new Date().toISOString(),
    evidenceCount: reports.length,
    reports,
    totals: {
      evidenceCount: reports.length,
      extractedPicks: reports.reduce((sum, report) => sum + report.summary.totalPicks, 0),
      recommendedEvaluated: recommended.length,
      hits: recommended.filter((pick) => pick.evaluation.status === "acertado").length,
      misses: recommended.filter((pick) => pick.evaluation.status === "fallado").length,
      voids: recommended.filter((pick) => pick.evaluation.status === "nulo").length,
      notEvaluable: recommended.filter((pick) => pick.evaluation.status === "no_evaluable").length,
      discarded: discarded.length,
      discardedByDecision: countBy(discarded, "decision")
    },
    marketDiagnostics: marketDiagnostics(recommended),
    warning: "Muestra piloto insuficiente: no recalibrar pesos, fórmulas ni rentabilidad por mercado con estos datos."
  };
}
