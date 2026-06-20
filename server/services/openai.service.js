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
Head to head es una señal secundaria. Cuotas y valor esperado tienen prioridad.`;

export async function generateAnalysis(dataset) {
  if (!env.openaiApiKey || !env.openaiModel) throw new AppError("OpenAI no está configurado.", 503, "OPENAI_NOT_CONFIGURED");
  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 45000, maxRetries: 1 });
  try {
    const response = await client.responses.parse({
      model: env.openaiModel,
      instructions: SYSTEM_INSTRUCTIONS,
      input: JSON.stringify(dataset),
      text: { format: zodTextFormat(AnalysisSchema, "football_analysis") }
    });
    if (!response.output_parsed) throw new AppError("OpenAI no devolvió un análisis estructurado.", 502, "OPENAI_INVALID_OUTPUT");
    return response.output_parsed;
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
