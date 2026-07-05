import { calculateCornersModel } from "./corners-model.service.js";
import { generateDataPicks } from "./data-picks.service.js";
import { calculatePoissonModel } from "./poisson-model.service.js";
import { calculateTeamGoalProbability } from "./team-goal-probability.service.js";

const number = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const unique = (values) => [...new Set(values.filter(Boolean))];
const text = (pick) => `${pick.marketKey || ""} ${pick.selectionKey || ""} ${pick.market || ""} ${pick.selection || ""}`.toLocaleLowerCase("es-MX");

function normalizeCandidate(pick = {}) {
  return {
    marketKey: pick.marketKey || "",
    selectionKey: pick.selectionKey || "",
    market: pick.market || "Mercado no identificado",
    selection: pick.selection || "Selección no identificada",
    decimalOdds: number(pick.decimalOdds ?? pick.odds),
    impliedProbabilityPct: number(pick.impliedProbabilityPct),
    modelProbabilityPct: number(pick.modelProbabilityPct ?? pick.estimatedProbabilityPct),
    expectedValuePct: number(pick.expectedValuePct),
    confidenceScore: number(pick.confidenceScore ?? pick.finalPickScore) ?? 0,
    highlightColor: pick.highlightColor || "gray",
    decision: pick.decision || pick.level || "NO BET",
    requiresReview: Boolean(pick.requiresReview),
    sourceModule: pick.sourceModule || "data_picks",
    explanation: pick.explanation || "",
    missingData: Array.isArray(pick.missingData) ? pick.missingData : []
  };
}

function actionable(pick) {
  if (pick.sourceModule === "player_goal_candidate") {
    return pick.confidenceScore >= 45 && !["red", "gray"].includes(pick.highlightColor);
  }
  return pick.decimalOdds > 1 && pick.modelProbabilityPct !== null && pick.confidenceScore >= 45
    && !["red", "gray"].includes(pick.highlightColor) && !pick.requiresReview;
}

function group({ key, label, candidates = [], missingData = [], alternativeData = "", warning = "" }) {
  const normalized = candidates.map(normalizeCandidate);
  const picks = normalized.filter(actionable);
  const partialCandidates = normalized.filter((pick) => !picks.includes(pick) && pick.decimalOdds > 1);
  const status = picks.length ? "available" : partialCandidates.length || alternativeData ? "partial" : "not_available";
  return {
    key, label, status, picks,
    observedCandidates: partialCandidates,
    missingData: status === "available" ? [] : unique(missingData),
    alternativeData,
    confidenceScore: picks.length ? Math.max(...picks.map((pick) => pick.confidenceScore)) : 0,
    warning: warning || (status === "available" ? "" : "Datos insuficientes para recomendar este mercado.")
  };
}

export function buildSpecificMarkets(dataset = {}) {
  dataset.poissonModel ||= calculatePoissonModel(dataset);
  dataset.teamGoalProbability ||= calculateTeamGoalProbability(dataset);
  dataset.cornersModel ||= calculateCornersModel(dataset);
  const dataPicks = generateDataPicks(dataset);
  const all = [
    ...(dataset.playerGoalCandidates?.candidates || []),
    ...(dataPicks.picks || []),
    ...(dataset.poissonModel.suggestedMarkets || []),
    ...(dataset.teamGoalProbability.picks || []),
    ...(dataset.cornersModel.picks || []),
    ...(dataset.marketAnalysis || []),
    ...(dataset.researchData?.odds?.markets || [])
  ];
  const matches = (pattern) => all.filter((pick) => pattern.test(text(pick)));
  const quality = number(dataset.researchData?.totalConfidenceScore ?? dataset.dataQuality?.score) ?? 0;
  const playerData = dataset.researchData?.playerPerformance || dataset.supportingData?.playerPerformance;
  const cornerAlternative = dataset.cornersModel.status !== "not_available"
    ? `Modelo de corners disponible: total esperado ${dataset.cornersModel.totalExpectedCorners ?? "no calculado"}; falta una cuota compatible para recomendar.` : "";

  const groups = [
    group({ key: "corners", label: "Corners", candidates: dataset.cornersModel.picks || [], missingData: ["Muestra histórica de corners", "Cuota de corners verificable"], alternativeData: cornerAlternative }),
    group({ key: "asian_handicap", label: "Hándicap asiático", candidates: matches(/asian|asi[aá]tic|handicap|h[aá]ndicap/), missingData: ["Línea de hándicap asiático verificable", "Probabilidad del modelo para esa línea"], alternativeData: quality >= 60 ? "Se conserva la evaluación general del favorito, pero no se convierte en hándicap." : "" }),
    group({ key: "player_goal", label: "Jugador con posible gol", candidates: dataset.playerGoalCandidates?.candidates || matches(/player.*goal|goleador|anotar[aá]|marca.*jugador/), missingData: ["Minutos y tiros recientes del jugador", "Cobertura individual de API-Football"], alternativeData: dataset.playerGoalCandidates?.message || (playerData?.status === "available" ? "Hay rendimiento individual, pero no una cuota y probabilidad prepartido completas." : "") }),
    group({ key: "btts", label: "Ambos equipos anotan", candidates: matches(/btts|ambos.*anotan|both teams.*score/), missingData: ["Probabilidad de gol de ambos equipos", "Cuota BTTS verificable"] }),
    group({ key: "team_scores_over", label: "Equipo marca más de X goles", candidates: matches(/team_goals|goles de .*m[aá]s|over_[01]_5/), missingData: ["Expectativa ofensiva por equipo", "Cuota de goles del equipo"] }),
    group({ key: "team_concedes_under", label: "Equipo recibe menos de X goles", candidates: matches(/recibe.*menos|concede.*under|team.*conced/), missingData: ["Expectativa ofensiva del rival", "Línea de goles recibidos", "Cuota verificable"], alternativeData: dataset.researchData?.xgXga?.status ? "xGA se usa como contexto defensivo, no como pick sin mercado compatible." : "" }),
    group({ key: "result_goals", label: "Resultado + goles", candidates: matches(/result.*goal|resultado.*gol|gan.*y.*(?:over|under|m[aá]s|menos)/), missingData: ["Cuota combinada Resultado + Goles", "Probabilidad conjunta validada"] }),
    group({ key: "double_chance_goals", label: "Doble oportunidad + goles", candidates: matches(/double chance.*goal|doble oportunidad.*gol|1x.*(?:over|under)|x2.*(?:over|under)/), missingData: ["Cuota combinada Doble oportunidad + Goles", "Probabilidad conjunta validada"] }),
    group({ key: "conservative", label: "Mercados conservadores", candidates: all.filter((pick) => ["green", "blue"].includes(pick.highlightColor) && number(pick.decimalOdds) <= 2 && number(pick.expectedValuePct) > 0), missingData: ["Pick con EV positivo, confianza suficiente y sin contradicciones"] }),
    group({ key: "medium_risk", label: "Mercados de riesgo medio", candidates: all.filter((pick) => pick.highlightColor === "orange" || pick.decision === "PRECAUCIÓN"), missingData: ["Pick de riesgo medio con cuota y respaldo suficientes"], warning: "Estos mercados requieren revisión adicional y exposición prudente." }),
    group({ key: "high_value_risk", label: "Alto valor / mayor riesgo", candidates: all.filter((pick) => number(pick.expectedValuePct) >= 10 && !["green", "blue"].includes(pick.highlightColor)), missingData: ["Confirmaciones deportivas adicionales"], warning: "EV alto con riesgo o contradicciones: no usar como pick principal automáticamente." })
  ];

  return {
    status: groups.some((item) => item.status === "available") ? "available" : groups.some((item) => item.status === "partial") ? "partial" : "not_available",
    source: "API-Football + modelos internos",
    fixtureId: String(dataset.fixture?.id || ""),
    dataQualityScore: quality,
    groups,
    warnings: ["Los mercados se muestran solo cuando existe cuota y probabilidad modelada suficientes.", "EV positivo no sustituye la coherencia futbolística ni la confianza."],
    generatedAt: new Date().toISOString()
  };
}
