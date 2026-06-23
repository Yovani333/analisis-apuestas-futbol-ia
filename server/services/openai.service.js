import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env.js";
import { AppError } from "../errors.js";
import { AnalysisSchema } from "../schemas/analysis.schema.js";
import { ANALYSIS_STATUS } from "../constants/match-research.js";
import { buildOpenAIPromptFromMatchData } from "./match-research.service.js";

const MARKET_INSTRUCTIONS = `
Solo puedes sugerir double_chance, over_under_2_5 o btts incluidos en matchData.odds.markets.
Usa marketKey como codigo_mercado, selectionKey como codigo_seleccion, decimalOdds como cuota_decimal, estimatedProbabilityPct como probabilidad_modelo y expectedValuePct como valor_esperado.
No sugieras mercados sin positiveValue=true, con requiresReview=true ni más de tres selecciones.
Si matchData.analysisStatus es needs_review, devuelve mercados_sugeridos vacío y apto_para_parlay No.
Head to head es una señal secundaria. Cuotas y valor esperado tienen prioridad.`;

function neutralizeVenueLanguage(value, homeTeam, awayTeam) {
  if (Array.isArray(value)) return value.map((item) => neutralizeVenueLanguage(item, homeTeam, awayTeam));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, neutralizeVenueLanguage(item, homeTeam, awayTeam)]));
  if (typeof value !== "string") return value;
  return value
    .replace(/\bequipo local\b/gi, "__HOME_TEAM__")
    .replace(/\bequipo visitante\b/gi, "__AWAY_TEAM__")
    .replace(/\bdel local\b/gi, "de __HOME_TEAM__")
    .replace(/\bdel visitante\b/gi, "de __AWAY_TEAM__")
    .replace(/\blocal\b/gi, "__HOME_TEAM__")
    .replace(/\bvisitante\b/gi, "__AWAY_TEAM__")
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
  return value
    .replace(/\bxGA\s+oficial\b/gi, xgaLabel)
    .replace(/\bxG\s+oficial\b/gi, xgLabel)
    .replace(/\bdatos? oficiales? de xG\b/gi, dataLabel);
}

export function applyResearchGuardrails(parsed, dataset) {
  const quality = dataset.dataQuality;
  const calculations = dataset.marketAnalysis || [];
  const research = dataset.researchData;
  const venueSafe = research?.venue?.neutral
    ? neutralizeVenueLanguage(parsed, research.homeTeam?.name || "equipo 1", research.awayTeam?.name || "equipo 2")
    : parsed;
  const estimatedTypes = new Set(["estimated", "historical_estimated", "fixture_estimated"]);
  const safeParsed = estimatedTypes.has(research?.xgXga?.type)
    ? enforceEstimatedXgLanguage(venueSafe, research.xgXga.type)
    : venueSafe;
  const researchBlocksMarkets = research?.analysisStatus === ANALYSIS_STATUS.NEEDS_REVIEW;
  const researchIsPartial = research?.analysisStatus === ANALYSIS_STATUS.PARTIAL;
  const verifiedMarkets = (safeParsed.mercados_sugeridos || []).slice(0, 3).map((market) => {
    const calculation = calculations.find((item) => item.marketKey === market.codigo_mercado && item.selectionKey === market.codigo_seleccion);
    if (!calculation) {
      return { ...market, cuota_decimal: null, probabilidad_modelo: null, valor_esperado: null, requiere_revision: true };
    }
    return {
      ...market,
      mercado: calculation.market,
      seleccion: calculation.selection,
      cuota_decimal: calculation.decimalOdds,
      probabilidad_modelo: calculation.estimatedProbabilityPct,
      valor_esperado: calculation.expectedValuePct,
      requiere_revision: market.requiere_revision || calculation.requiresReview || !calculation.positiveValue || !quality.canSuggest || researchIsPartial || researchBlocksMarkets
    };
  });
  const usableMarkets = quality.canSuggest && !researchBlocksMarkets ? verifiedMarkets : [];
  const normalizedMissing = (research?.missingData || []).map((item) => `${item.label}: ${item.message || item.status}`);
  const datosFaltantes = [...new Set([...(safeParsed.datos_faltantes || []), ...normalizedMissing])];
  const researchComplete = research?.analysisStatus === ANALYSIS_STATUS.COMPLETE;
  return {
    ...safeParsed,
    estado_analisis: researchComplete ? safeParsed.estado_analisis : "Necesita revisión",
    datos_faltantes: datosFaltantes,
    mercados_sugeridos: usableMarkets,
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
          type: research.xgXga.type,
          modelVersion: research.xgXga.modelVersion,
          confidenceScore: research.xgXga.confidenceScore,
          confidenceLabel: research.xgXga.confidenceLabel,
          analysisUse: research.xgXga.analysisUse
        } : null
      } : null
    }
  };
}

export async function generateAnalysis(dataset) {
  if (!env.openaiApiKey || !env.openaiModel) throw new AppError("OpenAI no está configurado.", 503, "OPENAI_NOT_CONFIGURED");
  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 45000, maxRetries: 1 });
  try {
    const prompt = buildOpenAIPromptFromMatchData(dataset.researchData);
    const response = await client.responses.parse({
      model: env.openaiModel,
      instructions: `${prompt.instructions}\n${MARKET_INSTRUCTIONS}`,
      input: prompt.input,
      text: { format: zodTextFormat(AnalysisSchema, "football_analysis") }
    });
    if (!response.output_parsed) throw new AppError("OpenAI no devolvió un análisis estructurado.", 502, "OPENAI_INVALID_OUTPUT");
    return applyResearchGuardrails(response.output_parsed, dataset);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.code === "insufficient_quota") {
      throw new AppError("OpenAI no tiene cuota disponible. Revisa la facturación y los límites del proyecto.", 429, "OPENAI_INSUFFICIENT_QUOTA");
    }
    if (error?.status === 401) throw new AppError("La clave de OpenAI fue rechazada.", 502, "OPENAI_AUTH_ERROR");
    if (error?.status === 429) throw new AppError("OpenAI aplicó un límite temporal de solicitudes.", 429, "OPENAI_RATE_LIMIT");
    if (error?.status === 400) throw new AppError("OpenAI rechazó el modelo o el formato configurado.", 422, "OPENAI_REQUEST_ERROR");
    throw new AppError("No fue posible completar el análisis con OpenAI.", 502, "OPENAI_PROVIDER_ERROR");
  }
}
