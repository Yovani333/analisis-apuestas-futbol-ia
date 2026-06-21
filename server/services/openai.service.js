import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env.js";
import { AppError } from "../errors.js";
import { AnalysisSchema } from "../schemas/analysis.schema.js";

const SYSTEM_INSTRUCTIONS = `Eres un analista cuantitativo prudente de fútbol.
Analiza exclusivamente el JSON proporcionado, procedente de API-Football.
No inventes resultados, lesiones, sanciones, alineaciones, cuotas, estadísticas, noticias, head to head ni jugadores.
Separa datos confirmados, datos faltantes, inferencias razonadas y riesgos.
Si falta cualquier dato importante, usa "Necesita revisión" y probabilidades null cuando no puedan estimarse responsablemente.
No presentes apuestas como seguras, no prometas ganancias y no fuerces mercados sugeridos sin valor esperado verificable.
Head to head es una señal secundaria. Cuotas y valor esperado tienen prioridad.
Solo puedes sugerir double_chance, over_under_2_5 o btts incluidos en verifiedMarketCalculations.
Copia exactamente codigo_mercado, codigo_seleccion, cuota_decimal, estimatedProbabilityPct y expectedValuePct de esos cálculos.
No sugieras mercados sin valor esperado positivo ni más de tres selecciones.
Si dataQuality.canSuggest es false, devuelve mercados_sugeridos vacío y apto_para_parlay No.`;

function finalizeAnalysis(parsed, dataset) {
  const quality = dataset.dataQuality;
  const calculations = dataset.marketAnalysis || [];
  const verifiedMarkets = (parsed.mercados_sugeridos || []).slice(0, 3).map((market) => {
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
      requiere_revision: market.requiere_revision || calculation.requiresReview || !calculation.positiveValue || !quality.canSuggest
    };
  });
  const usableMarkets = quality.canSuggest ? verifiedMarkets : [];
  return {
    ...parsed,
    mercados_sugeridos: usableMarkets,
    apto_para_parlay: quality.canSuggest && usableMarkets.some((market) => !market.requiere_revision)
      ? parsed.apto_para_parlay
      : { respuesta: "No", razonamiento: "La cobertura o el valor esperado verificado no alcanzan el umbral para agregar selecciones al parlay." },
    _context: { quality, preMatch: dataset.preMatch, marketAnalysis: calculations }
  };
}

export async function generateAnalysis(dataset) {
  if (!env.openaiApiKey || !env.openaiModel) throw new AppError("OpenAI no está configurado.", 503, "OPENAI_NOT_CONFIGURED");
  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 45000, maxRetries: 1 });
  try {
    const response = await client.responses.parse({
      model: env.openaiModel,
      instructions: SYSTEM_INSTRUCTIONS,
      input: JSON.stringify(dataset.analysisInput || dataset),
      text: { format: zodTextFormat(AnalysisSchema, "football_analysis") }
    });
    if (!response.output_parsed) throw new AppError("OpenAI no devolvió un análisis estructurado.", 502, "OPENAI_INVALID_OUTPUT");
    return finalizeAnalysis(response.output_parsed, dataset);
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
