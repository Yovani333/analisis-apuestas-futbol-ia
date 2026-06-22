import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

const CACHE_TTL = 30 * 60 * 1000;
const FORECAST_WINDOW_DAYS = 14;
const ALLOWED_DOMAINS = ["weather.com", "accuweather.com", "meteored.com", "meteored.mx"];
const cache = new Map();

const WeatherSearchSchema = z.object({
  location_confirmed: z.boolean(),
  forecast_time_confirmed: z.boolean(),
  matched_location: z.string().nullable(),
  forecast_time: z.string().nullable(),
  temperature_c: z.number().nullable(),
  rain_probability_pct: z.number().min(0).max(100).nullable(),
  wind_speed_kmh: z.number().nonnegative().nullable(),
  humidity_pct: z.number().min(0).max(100).nullable(),
  condition: z.string().nullable(),
  source_url: z.string().nullable(),
  observed_at: z.string().nullable(),
  notes: z.array(z.string()).max(10)
});

function isAllowedWeatherUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function webSources(response) {
  return [...new Set((response.output || []).flatMap((item) => {
    if (item.type !== "web_search_call") return [];
    if (item.action?.type === "search") return (item.action.sources || []).map((source) => source.url);
    return item.action?.url ? [item.action.url] : [];
  }).filter(isAllowedWeatherUrl))];
}

function fixtureInstant(fixture) {
  const candidate = fixture.utcDateTime;
  const parsed = candidate ? new Date(candidate) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function withinForecastWindow(target, now) {
  if (!target) return false;
  const difference = target.getTime() - now.getTime();
  return difference > 0 && difference <= FORECAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function forecastTimeMatches(value, target) {
  if (!value || !target) return false;
  const forecast = new Date(value);
  if (Number.isNaN(forecast.getTime())) return false;
  return Math.abs(forecast.getTime() - target.getTime()) <= 3 * 60 * 60 * 1000;
}

export async function getWeatherContextData(matchData, {
  accessMode = "disabled", apiKey = "", model = "", client = null, now = new Date(), forceRefresh = false
} = {}) {
  if (accessMode !== "openai_web_search") {
    return createSourceResult({
      source: "weather", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["Búsqueda meteorológica desactivada; no se realizaron solicitudes."], data: null
    });
  }

  const fixture = matchData?.fixture || {};
  if (fixture.status !== "scheduled") {
    return createSourceResult({
      source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: el partido ya inició o finalizó."], data: null
    });
  }

  const target = fixtureInstant(fixture);
  if (!withinForecastWindow(target, now)) {
    return createSourceResult({
      source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: [target
        ? `No consultada: el encuentro está fuera de la ventana meteorológica confiable de ${FORECAST_WINDOW_DAYS} días.`
        : "No consultada: falta la fecha y hora UTC verificable del encuentro."], data: null
    });
  }

  if (!fixture.city && !fixture.stadium) {
    return createSourceResult({
      source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: falta ciudad o estadio para identificar la ubicación."], data: null
    });
  }

  if (!apiKey || !model) {
    return createSourceResult({
      source: "weather", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["La búsqueda requiere OPENAI_API_KEY y un modelo con web_search."], data: null
    });
  }

  const cacheKey = `${fixture.id}:${target.toISOString()}:${fixture.stadium}:${fixture.city}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;

  try {
    const openai = client || new OpenAI({ apiKey, timeout: 45000, maxRetries: 1 });
    const response = await openai.responses.parse({
      model,
      tools: [{ type: "web_search", filters: { allowed_domains: ALLOWED_DOMAINS }, search_context_size: "low" }],
      include: ["web_search_call.action.sources"],
      instructions: `Busca únicamente un pronóstico meteorológico horario en Weather.com, AccuWeather o Meteored.
No inventes temperatura, lluvia, viento, humedad, condición, ubicación ni hora.
La ubicación debe coincidir con la ciudad o estadio y el pronóstico debe corresponder al instante del partido.
Devuelve unidades métricas: grados Celsius, porcentaje y km/h. No conviertas un pronóstico diario en horario.
No afirmes el estado de la cancha o el césped: estas fuentes solo validan clima.
Si no existe pronóstico horario verificable, devuelve valores null y las confirmaciones en false.`,
      input: JSON.stringify({
        task: "Obtener clima horario para un partido de fútbol",
        venue: { stadium: fixture.stadium || "", city: fixture.city || "", country: fixture.country || "" },
        matchUtcDateTime: target.toISOString(),
        teams: { team1: fixture.home || "", team2: fixture.away || "" }
      }),
      text: { format: zodTextFormat(WeatherSearchSchema, "football_match_weather") }
    });

    const parsed = response.output_parsed;
    const sources = webSources(response);
    const sourceUrl = parsed?.source_url && isAllowedWeatherUrl(parsed.source_url) && sources.includes(parsed.source_url)
      ? parsed.source_url : "";
    const hasWeather = [parsed?.temperature_c, parsed?.rain_probability_pct, parsed?.wind_speed_kmh, parsed?.humidity_pct]
      .some(Number.isFinite) || Boolean(parsed?.condition?.trim());
    const verified = Boolean(parsed?.location_confirmed && parsed?.forecast_time_confirmed
      && forecastTimeMatches(parsed?.forecast_time, target) && sourceUrl && hasWeather);
    const data = verified ? {
      temperature: parsed.temperature_c,
      rainProbability: parsed.rain_probability_pct,
      windSpeed: parsed.wind_speed_kmh,
      humidity: parsed.humidity_pct,
      condition: parsed.condition || "",
      matchedLocation: parsed.matched_location || "",
      forecastTime: parsed.forecast_time,
      sourceUrl,
      sources,
      observedAt: parsed.observed_at || "",
      pitchNotes: "Sin reporte reciente de estado de cancha.",
      retrieval: "openai_web_search"
    } : null;
    const value = createSourceResult({
      source: "weather", status: verified ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.NOT_AVAILABLE,
      updatedAt: new Date().toISOString(),
      notes: verified
        ? ["Pronóstico horario recuperado mediante búsqueda web restringida.", "El estado de la cancha no fue confirmado y permanece pendiente de revisión."]
        : ["No se encontró un pronóstico horario verificable para la ubicación y hora del partido."],
      data
    });
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return createSourceResult({
      source: "weather", status: SOURCE_STATUS.FAILED, updatedAt: new Date().toISOString(),
      notes: ["La búsqueda meteorológica complementaria no pudo completarse."], data: null
    });
  }
}
