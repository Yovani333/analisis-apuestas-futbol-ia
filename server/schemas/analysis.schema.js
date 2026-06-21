import { z } from "zod";

const confidence = z.enum(["Baja", "Media-baja", "Media", "Media-alta", "Alta"]);
const quantitative = z.object({
  forma_reciente: z.string(), rendimiento_local_visitante: z.string(), fortaleza_ofensiva: z.string(),
  fortaleza_defensiva: z.string(), xg_xga: z.string(), lesiones_sanciones: z.string(),
  alineaciones_rotacion: z.string(), motivacion_competitiva: z.string(), fatiga_calendario: z.string(),
  matchup_tactico: z.string(), cuotas_valor_esperado: z.string()
});

export const AnalysisSchema = z.object({
  estado_analisis: z.enum(["Completo", "Necesita revisión"]),
  liga: z.string(),
  partido: z.object({ local: z.string(), visitante: z.string(), fecha: z.string(), estadio: z.string(), pais: z.string() }),
  resumen_partido: z.string(),
  datos_confirmados: z.array(z.string()), datos_faltantes: z.array(z.string()), alertas_de_calidad_de_datos: z.array(z.string()),
  analisis_cuantitativo: quantitative,
  probabilidad_estimativa: z.object({ local: z.number().min(0).max(100).nullable(), empate: z.number().min(0).max(100).nullable(), visitante: z.number().min(0).max(100).nullable(), nota: z.string() }),
  mercados_sugeridos: z.array(z.object({
    mercado: z.string(), seleccion: z.string(),
    codigo_mercado: z.enum(["double_chance", "over_under_2_5", "btts", "none"]),
    codigo_seleccion: z.enum(["1X", "X2", "over_2_5", "under_2_5", "btts_yes", "btts_no", "none"]),
    cuota_decimal: z.number().positive().nullable(), probabilidad_modelo: z.number().min(0).max(100).nullable(),
    valor_esperado: z.number().nullable(), razonamiento: z.string(),
    nivel_riesgo: z.enum(["Bajo", "Medio", "Alto"]), confianza: confidence, requiere_revision: z.boolean()
  })),
  mercados_a_evitar: z.array(z.object({ mercado: z.string(), razonamiento: z.string() })),
  prediccion_prudente: z.object({ seleccion: z.string(), razonamiento: z.string(), confianza: confidence }),
  apto_para_parlay: z.object({ respuesta: z.enum(["Sí", "No", "Solo con baja exposición"]), razonamiento: z.string() }),
  riesgos_principales: z.array(z.string()), conclusion: z.string(),
  advertencia: z.literal("Este análisis es únicamente informativo. No garantiza resultados ni ganancias. Apuesta con responsabilidad.")
});
