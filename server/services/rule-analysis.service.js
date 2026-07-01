import { ANALYSIS_STATUS, MODULE_LABELS } from "../constants/match-research.js";
import { applyResearchGuardrails } from "./openai.service.js";

const RESPONSIBLE_WARNING = "Este análisis es únicamente informativo. No garantiza resultados ni beneficios. Las apuestas implican riesgo y deben hacerse con responsabilidad.";

function value(value, fallback = "No disponible") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function confidenceLabel(score) {
  if (score >= 80) return "Alta";
  if (score >= 65) return "Media-alta";
  if (score >= 45) return "Media";
  if (score > 0) return "Media-baja";
  return "Baja";
}

function riskLabel(pick) {
  if (pick.highlightColor === "green") return "Bajo";
  if (pick.highlightColor === "orange") return "Medio";
  return "Alto";
}

function concreteMarketReason(pick, research) {
  const xg = research?.xgXga;
  const xgText = xg && xg.homeXG !== null && xg.awayXG !== null
    ? `xG estimado ${value(xg.homeXG)}-${value(xg.awayXG)}` : "xG no disponible";
  const stats = research?.statsForm;
  const goalsText = stats
    ? `goles recientes ${value(stats.homeGoalsFor)}-${value(stats.awayGoalsFor)}` : "forma no disponible";
  const evText = pick.expectedValuePct === null || pick.expectedValuePct === undefined
    ? "sin cuota suficiente para EV" : `EV ${pick.expectedValuePct}%`;
  return `${pick.explanation || "Evaluación del motor de reglas."} Base: ${xgText}, ${goalsText}, probabilidad modelo ${value(pick.estimatedProbabilityPct)}% y ${evText}.`;
}

function marketFromPick(pick, research) {
  return {
    mercado: pick.market || "",
    seleccion: pick.selection || "",
    codigo_mercado: pick.marketKey || "none",
    codigo_seleccion: pick.selectionKey || "none",
    cuota_decimal: pick.decimalOdds ?? null,
    probabilidad_modelo: pick.estimatedProbabilityPct ?? null,
    valor_esperado: pick.expectedValuePct ?? null,
    razonamiento: concreteMarketReason(pick, research),
    nivel_riesgo: riskLabel(pick),
    confianza: confidenceLabel(pick.finalPickScore ?? pick.confidenceScore ?? 0),
    sourceModule: "odds_rule_engine",
    requiere_revision: pick.highlightColor !== "green"
  };
}

function quantitativeSummary(dataset) {
  const research = dataset.researchData || {};
  const form = research.statsForm || {};
  const xg = research.xgXga || {};
  const odds = research.odds || {};
  const poisson = dataset.poissonModel || {};
  const teamGoals = dataset.teamGoalProbability || {};
  return {
    forma_reciente: `${research.homeTeam?.name || dataset.fixture.home}: ${value(form.homeWinRate)}% victorias; ${research.awayTeam?.name || dataset.fixture.away}: ${value(form.awayWinRate)}%.`,
    rendimiento_local_visitante: dataset.fixture.neutralVenue ? "Sede neutral confirmada; no se aplica ventaja automática de localía." : "La localía se conserva como contexto, no como garantía.",
    fortaleza_ofensiva: `Goles recientes acumulados: ${value(form.homeGoalsFor)} y ${value(form.awayGoalsFor)}.${["available", "partial"].includes(teamGoals.status) ? ` Probabilidad de marcar 0.5+: ${value(teamGoals.teams?.home?.over05Pct)}% y ${value(teamGoals.teams?.away?.over05Pct)}%; señal BTTS ${value(teamGoals.btts?.support)}.` : " Probabilidad de gol por equipo no disponible."}`,
    fortaleza_defensiva: `Goles recibidos recientes: ${value(form.homeGoalsAgainst)} y ${value(form.awayGoalsAgainst)}; porterías a cero: ${value(form.homeCleanSheets)} y ${value(form.awayCleanSheets)}.`,
    xg_xga: xg.status === "available" || xg.status === "partial"
      ? `${xg.type === "historical_estimated" ? "xG/xGA histórico estimado" : "xG/xGA estimado del fixture"}: ${value(xg.homeXG)}/${value(xg.homeXGA)} y ${value(xg.awayXG)}/${value(xg.awayXGA)}. Confianza ${value(xg.confidenceLabel)}.`
      : "xG/xGA no disponible; no se inventaron valores.",
    lesiones_sanciones: research.injuriesSuspensions?.status === "available" ? "Bajas consultadas en API-Football." : "Bajas incompletas o no confirmadas.",
    alineaciones_rotacion: research.lineups?.confirmed ? "Alineaciones confirmadas." : "Alineaciones no confirmadas; reduce la confianza.",
    motivacion_competitiva: "No se asigna motivación si no existe un dato estructurado verificable.",
    fatiga_calendario: `Descanso: ${value(research.contextCalendar?.homeRestDays)} y ${value(research.contextCalendar?.awayRestDays)} días.`,
    matchup_tactico: `Perfil calculado: ${value(dataset.pickRecommendation?.matchProfile)}.`,
    cuotas_valor_esperado: `${odds.markets?.length || 0} mercados normalizados; el EV se calcula en código con cuota y probabilidad modelo.${["available", "partial"].includes(poisson.status) ? ` Poisson interno: λ ${value(poisson.lambdaHome)}-${value(poisson.lambdaAway)}, usado solo como señal secundaria.` : " Poisson no disponible como señal secundaria."}`
  };
}

export function generateRuleBasedAnalysis(dataset = {}) {
  const fixture = dataset.fixture || {};
  const research = dataset.researchData || {};
  const review = dataset.pickRecommendation || {};
  const reviewed = review.reviewedPicks || [];
  const suggested = reviewed.filter((pick) => pick.highlightColor !== "red").slice(0, 3);
  const avoided = reviewed.filter((pick) => pick.highlightColor === "red").slice(0, 5);
  const probabilities = fixture.favorite?.probabilities || {};
  const confirmed = Object.entries(research.moduleScores || {})
    .filter(([, module]) => module.status === "available")
    .map(([key]) => `${MODULE_LABELS[key] || key}: disponible.`);
  const missing = (research.missingData || []).map((item) => `${item.label}: ${item.message || item.status}.`);
  const base = {
    estado_analisis: research.analysisStatus === ANALYSIS_STATUS.COMPLETE ? "Completo" : "Necesita revisión",
    liga: fixture.leagueName || "",
    partido: { local: fixture.home || "", visitante: fixture.away || "", fecha: fixture.date || "", estadio: fixture.stadium || "", pais: fixture.country || "" },
    resumen_partido: `Análisis generado por el Motor de Reglas con ${research.totalConfidenceScore || 0}/100 de cobertura. No se utilizó OpenAI para calcular picks.`,
    datos_confirmados: confirmed,
    datos_faltantes: missing,
    alertas_de_calidad_de_datos: [...(dataset.qualityAlerts || []), ...(research.criticalMissingData || []).map((item) => `${item.label}: dato crítico faltante.`)],
    analisis_cuantitativo: quantitativeSummary(dataset),
    probabilidad_estimativa: {
      local: probabilities.home ?? null, empate: probabilities.draw ?? null, visitante: probabilities.away ?? null,
      nota: probabilities.home !== null && probabilities.home !== undefined ? "Probabilidades 1X2 de API-Football; no son una garantía." : "API-Football no proporcionó probabilidades 1X2 completas."
    },
    mercados_sugeridos: suggested.map((pick) => marketFromPick(pick, research)),
    mercados_a_evitar: avoided.map((pick) => ({ mercado: `${pick.market}: ${pick.selection}`, razonamiento: concreteMarketReason(pick, research) })),
    prediccion_prudente: review.recommendedPick ? {
      seleccion: review.recommendedPick.selection,
      razonamiento: concreteMarketReason(review.recommendedPick, research),
      confianza: confidenceLabel(review.recommendedPick.finalPickScore ?? review.recommendedPick.confidenceScore ?? 0)
    } : { seleccion: "Sin pick principal", razonamiento: review.warning || "No hay respaldo suficiente.", confianza: "Baja" },
    apto_para_parlay: suggested.some((pick) => pick.highlightColor === "green")
      ? { respuesta: "Solo con baja exposición", razonamiento: "Existen picks verdes del motor, pero deben actualizarse antes del inicio." }
      : { respuesta: "No", razonamiento: "No hay picks con respaldo suficiente para parlay." },
    riesgos_principales: [...new Set(reviewed.flatMap((pick) => pick.riskFlags || []))].slice(0, 8),
    conclusion: review.recommendedPick
      ? `El motor prioriza ${review.recommendedPick.selection} con score final ${review.recommendedPick.finalPickScore || 0}/100.`
      : "El motor no identifica un pick principal responsable con los datos disponibles.",
    advertencia: RESPONSIBLE_WARNING
  };
  return { ...applyResearchGuardrails(base, dataset), analysisMode: "rule_engine", generatedBy: "internal-rule-engine" };
}
