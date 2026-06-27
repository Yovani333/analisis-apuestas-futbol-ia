import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env.js";
import { AppError } from "../errors.js";
import { AnalysisSchema } from "../schemas/analysis.schema.js";
import { ANALYSIS_STATUS } from "../constants/match-research.js";
import { buildOpenAIPromptFromMatchData } from "./match-research.service.js";
import { buildCompactAiMatchData, selectAiModelForMatch } from "./ai-model-selector.service.js";

const MARKET_INSTRUCTIONS = `
Solo puedes sugerir double_chance, over_under_2_5 o btts incluidos en matchData.odds.markets.
Usa marketKey como codigo_mercado, selectionKey como codigo_seleccion, decimalOdds como cuota_decimal, estimatedProbabilityPct como probabilidad_modelo y expectedValuePct como valor_esperado.
No sugieras mercados sin positiveValue=true, con requiresReview=true ni más de tres selecciones.
Si matchData.analysisStatus es needs_review, devuelve mercados_sugeridos vacío y apto_para_parlay No.
El mayor EV no equivale automáticamente al mejor pick.
No uses como pick principal una doble oportunidad contra un favorito fuerte sin al menos dos o tres confirmaciones deportivas.
Usa matchData.favorite como señal de jerarquía, sin tratar su porcentaje como garantía.
Head to head es una señal secundaria. EV, jerarquía, confianza y coherencia deportiva deben evaluarse por separado.`;

function neutralizeVenueLanguage(value, homeTeam, awayTeam) {
  if (Array.isArray(value)) return value.map((item) => neutralizeVenueLanguage(item, homeTeam, awayTeam));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, neutralizeVenueLanguage(item, homeTeam, awayTeam)]));
  if (typeof value !== "string") return value;
  return value
    .replace(/\bequipo local\b/gi, "__HOME_TEAM__")
    .replace(/\bequipo visitante\b/gi, "__AWAY_TEAM__")
    .replace(/\bdel local\b/gi, "de __HOME_TEAM__")
    .replace(/\bdel visitante\b/gi, "de __AWAY_TEAM__")
    .replace(/(?<![\p{L}])local(?![\p{L}])/giu, "__HOME_TEAM__")
    .replace(/(?<![\p{L}])visitante(?![\p{L}])/giu, "__AWAY_TEAM__")
    .replaceAll("__HOME_TEAM__", homeTeam)
    .replaceAll("__AWAY_TEAM__", awayTeam);
}

function enforceEstimatedXgLanguage(value, type = "estimated") {
  if (Array.isArray(value)) return value.map((item) => enforceEstimatedXgLanguage(item, type));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, enforceEstimatedXgLanguage(item, type)]));
  }
  if (typeof value !== "string") return value;
  const historical = type === "historical_estimated";
  const xgLabel = historical ? "xG histórico estimado" : "xG estimado";
  const xgaLabel = historical ? "xGA histórico estimado" : "xGA estimado";
  const dataLabel = historical ? "datos históricos estimados de xG" : "datos estimados de xG";
  let normalized = value
    .replace(/\bxGA\s+oficial\b/gi, xgaLabel)
    .replace(/\bxG\s+oficial\b/gi, xgLabel)
    .replace(/\bdatos? oficiales? de xG\b/gi, dataLabel);
  if (historical) {
    normalized = normalized
      .replace(/\bxG\/xGA\s+del partido actual\b/gi, "xG/xGA histórico estimado")
      .replace(/\bxG\s+del partido actual\b/gi, "xG histórico estimado")
      .replace(/\bxGA\s+del partido actual\b/gi, "xGA histórico estimado");
  }
  return normalized;
}

function xgCanonicalNote(xg = {}) {
  if (xg.status === "not_available" || xg.type === "not_available") {
    return "No hay información suficiente para calcular o reportar xG/xGA responsablemente.";
  }
  if (xg.type === "historical_estimated") {
    const confidence = xg.confidenceLabel === "low"
      ? " La confianza es baja y solo puede usarse como referencia secundaria."
      : xg.confidenceLabel === "medium" ? " La confianza es media y debe interpretarse con cautela." : "";
    const worldCup = String(xg.warning || "").includes("Modo Mundial")
      ? " Modo Mundial: la muestra estadística es limitada." : "";
    return `xG/xGA histórico estimado calculado con partidos anteriores de cada equipo; no requiere H2H y no corresponde al partido actual ni a xG oficial.${confidence}${worldCup}`;
  }
  if (xg.type === "fixture_estimated" || xg.type === "estimated") {
    const confidence = xg.confidenceLabel === "low"
      ? " La confianza es baja y solo puede usarse como referencia secundaria."
      : xg.confidenceLabel === "medium" ? " La confianza es media y debe interpretarse con cautela." : "";
    return `xG/xGA estimado del partido calculado internamente con estadísticas del fixture desde API-Football; no corresponde a xG oficial.${confidence}`;
  }
  if (xg.type === "official") {
    return `xG/xGA oficial atribuido a ${xg.source || "la fuente especializada indicada"}.`;
  }
  return "";
}

function enforceXgAnalysisSummary(parsed, xg) {
  if (!parsed?.analisis_cuantitativo || !xg) return parsed;
  const canonical = xgCanonicalNote(xg);
  if (!canonical) return parsed;
  const current = String(parsed.analisis_cuantitativo.xg_xga || "").trim();
  const replaceModelText = xg.status === "not_available"
    || xg.type === "not_available"
    || (["historical_estimated", "fixture_estimated", "estimated"].includes(xg.type) && xg.confidenceLabel === "low");
  return {
    ...parsed,
    analisis_cuantitativo: {
      ...parsed.analisis_cuantitativo,
      xg_xga: !replaceModelText && current && !current.includes(canonical) ? `${current} ${canonical}` : canonical
    }
  };
}

export function applyResearchGuardrails(parsed, dataset) {
  const quality = dataset.dataQuality;
  const calculations = dataset.marketAnalysis || [];
  const research = dataset.researchData;
  const venueSafe = research?.venue?.neutral
    ? neutralizeVenueLanguage(parsed, research.homeTeam?.name || "equipo 1", research.awayTeam?.name || "equipo 2")
    : parsed;
  const estimatedTypes = new Set(["estimated", "historical_estimated", "fixture_estimated"]);
  const languageSafe = estimatedTypes.has(research?.xgXga?.type)
    ? enforceEstimatedXgLanguage(venueSafe, research.xgXga.type)
    : venueSafe;
  const safeParsed = enforceXgAnalysisSummary(languageSafe, research?.xgXga);
  const researchBlocksMarkets = research?.analysisStatus === ANALYSIS_STATUS.NEEDS_REVIEW;
  const researchIsPartial = research?.analysisStatus === ANALYSIS_STATUS.PARTIAL;
  const pickReview = dataset.pickRecommendation || null;
  const verifiedMarkets = (safeParsed.mercados_sugeridos || []).slice(0, 3).map((market) => {
    const calculation = calculations.find((item) => item.marketKey === market.codigo_mercado && item.selectionKey === market.codigo_seleccion);
    if (!calculation) {
      return { ...market, cuota_decimal: null, probabilidad_modelo: null, valor_esperado: null, requiere_revision: true };
    }
    const reviewedPick = pickReview?.reviewedPicks?.find((item) =>
      item.marketKey === calculation.marketKey && item.selectionKey === calculation.selectionKey
    );
    const requiresLogicalReview = ["value_sospechoso", "high_risk_value", "agresivo_stake_bajo", "evitar", "sin_pick"]
      .includes(reviewedPick?.pickCategory);
    return {
      ...market,
      mercado: calculation.market,
      seleccion: calculation.selection,
      cuota_decimal: calculation.decimalOdds,
      probabilidad_modelo: calculation.estimatedProbabilityPct,
      valor_esperado: calculation.expectedValuePct,
      valueScore: reviewedPick?.valueScore ?? null,
      confidenceScore: reviewedPick?.confidenceScore ?? null,
      pickCategory: reviewedPick?.pickCategory || "sin_pick",
      warning: reviewedPick?.warning || "",
      confirmaciones: reviewedPick?.confirmations || [],
      requiere_revision: market.requiere_revision || calculation.requiresReview || !calculation.positiveValue
        || !quality.canSuggest || researchIsPartial || researchBlocksMarkets || requiresLogicalReview
    };
  });
  const usableMarkets = quality.canSuggest && !researchBlocksMarkets ? verifiedMarkets : [];
  const normalizedMissing = (research?.missingData || []).map((item) => `${item.label}: ${item.message || item.status}`);
  const datosFaltantes = [...new Set([...(safeParsed.datos_faltantes || []), ...normalizedMissing])];
  const researchComplete = research?.analysisStatus === ANALYSIS_STATUS.COMPLETE;
  const recommended = pickReview?.recommendedPick;
  const prudentPrediction = !pickReview ? safeParsed.prediccion_prudente : recommended
    ? {
      seleccion: recommended.selection,
      razonamiento: `Pick lógico validado como ${recommended.pickCategory}. ${recommended.warning || "Coherente con la jerarquía y la cobertura disponibles."}`,
      confianza: recommended.confidenceScore >= 75 ? "Alta" : recommended.confidenceScore >= 60 ? "Media-alta" : "Media"
    }
    : {
      seleccion: "Sin pick principal",
      razonamiento: pickReview?.warning || "No hay valor y coherencia suficientes para recomendar una selección principal.",
      confianza: "Baja"
    };
  return {
    ...safeParsed,
    estado_analisis: researchComplete ? safeParsed.estado_analisis : "Necesita revisión",
    datos_faltantes: datosFaltantes,
    mercados_sugeridos: usableMarkets,
    prediccion_prudente: prudentPrediction,
    pickReview,
    apto_para_parlay: researchComplete && quality.canSuggest && usableMarkets.some((market) => !market.requiere_revision)
      ? safeParsed.apto_para_parlay
      : { respuesta: "No", razonamiento: "La cobertura normalizada, los datos críticos o el valor esperado verificado no alcanzan el umbral para agregar selecciones al parlay." },
    _context: {
      quality, preMatch: dataset.preMatch, marketAnalysis: calculations,
      research: research ? {
        totalConfidenceScore: research.totalConfidenceScore,
        analysisStatus: research.analysisStatus,
        moduleScores: research.moduleScores,
        criticalMissingData: research.criticalMissingData,
        missingData: research.missingData,
        xgXga: research.xgXga ? {
          status: research.xgXga.status,
          type: research.xgXga.type,
          source: research.xgXga.source,
          scope: research.xgXga.scope,
          modelVersion: research.xgXga.modelVersion,
          confidenceScore: research.xgXga.confidenceScore,
          confidenceLabel: research.xgXga.confidenceLabel,
          analysisUse: research.xgXga.analysisUse,
          sampleSize: research.xgXga.sampleSize ?? null,
          missingFields: research.xgXga.missingFields || [],
          warning: research.xgXga.warning || ""
        } : null
      } : null
    }
  };
}

function controlledOpenAiError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === "insufficient_quota") {
    return new AppError("OpenAI no tiene cuota disponible. Revisa la facturación y los límites del proyecto.", 429, "OPENAI_INSUFFICIENT_QUOTA");
  }
  if (error?.status === 401) return new AppError("La clave de OpenAI fue rechazada.", 502, "OPENAI_AUTH_ERROR");
  if (error?.status === 429) return new AppError("OpenAI aplicó un límite temporal de solicitudes.", 429, "OPENAI_RATE_LIMIT");
  if (error?.status === 400) return new AppError("OpenAI rechazó el modelo o el formato configurado.", 422, "OPENAI_REQUEST_ERROR");
  return new AppError("No fue posible completar el análisis con OpenAI.", 502, "OPENAI_PROVIDER_ERROR");
}

async function requestStructuredAnalysis(client, model, prompt) {
  const response = await client.responses.parse({
    model,
    instructions: `${prompt.instructions}\n${MARKET_INSTRUCTIONS}`,
    input: prompt.input,
    text: { format: zodTextFormat(AnalysisSchema, "football_analysis") }
  });
  if (!response.output_parsed) throw new AppError("OpenAI no devolvió un análisis estructurado.", 502, "OPENAI_INVALID_OUTPUT");
  return response.output_parsed;
}

export async function generateAnalysis(dataset, {
  client = null,
  config = env,
  logger = console
} = {}) {
  if (!config.openaiApiKey || !config.openaiModelDefault || !config.openaiModelPremium) {
    throw new AppError("OpenAI no está configurado.", 503, "OPENAI_NOT_CONFIGURED");
  }
  const openai = client || new OpenAI({ apiKey: config.openaiApiKey, timeout: 45000, maxRetries: 1 });
  const selection = selectAiModelForMatch(dataset, {
    defaultModel: config.openaiModelDefault,
    premiumModel: config.openaiModelPremium
  });
  const compactMatchData = buildCompactAiMatchData(dataset);
  const prompt = buildOpenAIPromptFromMatchData(compactMatchData);
  logger.info("[openai-model-selection]", {
    selectedModel: selection.selectedModel,
    modelReason: selection.modelReason,
    costOptimizationApplied: selection.costOptimizationApplied
  });

  let parsed;
  let usedModel = selection.selectedModel;
  let fallbackApplied = false;
  try {
    parsed = await requestStructuredAnalysis(openai, usedModel, prompt);
  } catch (primaryError) {
    const canFallback = usedModel === config.openaiModelDefault
      && config.openaiModelPremium
      && config.openaiModelPremium !== usedModel;
    if (!canFallback) throw controlledOpenAiError(primaryError);
    fallbackApplied = true;
    usedModel = config.openaiModelPremium;
    logger.warn("[openai-model-fallback]", {
      selectedModel: usedModel,
      modelReason: "El modelo económico falló; se aplica un único intento premium.",
      costOptimizationApplied: true
    });
    try {
      parsed = await requestStructuredAnalysis(openai, usedModel, prompt);
    } catch (fallbackError) {
      throw controlledOpenAiError(fallbackError);
    }
  }

  const guarded = applyResearchGuardrails(parsed, dataset);
  return config.aiDebug ? {
    ...guarded,
    _debug: {
      selectedModel: usedModel,
      modelReason: selection.modelReason,
      costOptimizationApplied: true,
      fallbackApplied
    }
  } : guarded;
}
