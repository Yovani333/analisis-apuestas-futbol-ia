import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

const CACHE_TTL = 30 * 60 * 1000;
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const HOURLY_FIELDS = "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m";
const cache = new Map();

function weatherCondition(code) {
  code = code === null || code === undefined || code === "" ? Number.NaN : Number(code);
  if (code === 0) return "Despejado";
  if ([1, 2].includes(code)) return "Parcialmente nublado";
  if (code === 3) return "Nublado";
  if ([45, 48].includes(code)) return "Niebla";
  if ([51, 53, 55, 56, 57].includes(code)) return "Llovizna";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Lluvia";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Nieve";
  if ([95, 96, 99].includes(code)) return "Tormenta";
  return "No disponible";
}

function estimatedPitch({ precipitation, rainProbability }) {
  const precipitationValue = Number(precipitation);
  const probabilityValue = Number(rainProbability);
  const hasPrecipitation = precipitation !== null && precipitation !== undefined && precipitation !== "" && Number.isFinite(precipitationValue);
  const hasProbability = rainProbability !== null && rainProbability !== undefined && rainProbability !== "" && Number.isFinite(probabilityValue);
  if (!hasPrecipitation && !hasProbability) return "Cancha estimada no disponible.";
  if ((hasPrecipitation && precipitationValue >= 2) || (hasProbability && probabilityValue >= 70)) return "Cancha estimada mojada; no es una inspección oficial.";
  if ((hasPrecipitation && precipitationValue >= 0.2) || (hasProbability && probabilityValue >= 40)) return "Cancha estimada húmeda; no es una inspección oficial.";
  return "Cancha estimada seca; no es una inspección oficial.";
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "football-analysis-dashboard/1.0" } });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.reason || "Open-Meteo error");
  return payload;
}

function finiteCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveCoordinates(fixture, fetchImpl) {
  const latitude = finiteCoordinate(fixture.latitude ?? fixture.coordinates?.latitude);
  const longitude = finiteCoordinate(fixture.longitude ?? fixture.coordinates?.longitude);
  if (latitude !== null && longitude !== null) {
    return { latitude, longitude, name: [fixture.stadium, fixture.city, fixture.country].filter(Boolean).join(", "), source: "api-football" };
  }
  const search = [fixture.city, fixture.country].filter(Boolean).join(", ") || fixture.stadium || "";
  if (!search) return null;
  const params = new URLSearchParams({ name: search, count: "1", language: "es", format: "json" });
  const payload = await requestJson(`${GEOCODING_URL}?${params}`, fetchImpl);
  const result = payload.results?.[0];
  if (!result || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) return null;
  return { latitude: result.latitude, longitude: result.longitude, name: [result.name, result.admin1, result.country].filter(Boolean).join(", "), source: "open-meteo-geocoding" };
}

function nearestHourly(hourly, target) {
  if (!hourly?.time?.length || !target) return null;
  let selected = 0;
  let difference = Number.POSITIVE_INFINITY;
  hourly.time.forEach((value, index) => {
    const current = Math.abs(Date.parse(value.endsWith("Z") ? value : `${value}Z`) - target.getTime());
    if (current < difference) { difference = current; selected = index; }
  });
  if (difference > 2 * 60 * 60 * 1000) return null;
  const value = (key) => hourly[key]?.[selected] ?? null;
  return {
    time: hourly.time[selected], temperature: value("temperature_2m"), humidity: value("relative_humidity_2m"),
    rainProbability: value("precipitation_probability"), precipitation: value("precipitation"),
    windSpeed: value("wind_speed_10m"), weatherCode: value("weather_code")
  };
}

function normalizeWeather(raw, location, retrieval, sourceUrl) {
  const condition = weatherCondition(raw.weatherCode);
  return {
    temperature: raw.temperature ?? null, rainProbability: raw.rainProbability ?? null,
    windSpeed: raw.windSpeed ?? null, humidity: raw.humidity ?? null,
    precipitation: raw.precipitation ?? null, condition, matchedLocation: location.name,
    latitude: location.latitude, longitude: location.longitude, forecastTime: raw.time || "",
    sourceUrl, observedAt: new Date().toISOString(), pitchNotes: estimatedPitch(raw),
    retrieval, locationSource: location.source
  };
}

export async function getWeatherContextData(matchData, {
  accessMode = "open_meteo", fetchImpl = globalThis.fetch, now = new Date(), forceRefresh = false
} = {}) {
  if (accessMode !== "open_meteo" || typeof fetchImpl !== "function") {
    return createSourceResult({ source: "weather", status: SOURCE_STATUS.NOT_CONFIGURED, notes: ["Open-Meteo está desactivado."], data: null });
  }
  const fixture = matchData?.fixture || {};
  if (!fixture.city && !fixture.stadium && finiteCoordinate(fixture.latitude) === null) {
    return createSourceResult({ source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE, notes: ["Clima no disponible: falta ubicación del estadio."], data: null });
  }
  const target = fixture.utcDateTime ? new Date(fixture.utcDateTime) : null;
  if (!target || Number.isNaN(target.getTime())) {
    return createSourceResult({ source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE, notes: ["Clima no disponible: falta fecha y hora verificable del partido."], data: null });
  }
  if (fixture.status === "scheduled" && target.getTime() - now.getTime() > 16 * 24 * 60 * 60 * 1000) {
    return createSourceResult({ source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE, notes: ["Clima no disponible: el partido está fuera del alcance de pronóstico de Open-Meteo."], data: null });
  }
  const cacheKey = `${fixture.id}:${fixture.status}:${target.toISOString()}:${fixture.city}:${fixture.stadium}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;

  try {
    const location = await resolveCoordinates(fixture, fetchImpl);
    if (!location) {
      return createSourceResult({ source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE, notes: ["Clima no disponible: falta ubicación del estadio."], data: null });
    }
    const date = target.toISOString().slice(0, 10);
    const baseParams = { latitude: String(location.latitude), longitude: String(location.longitude), timezone: "UTC", wind_speed_unit: "kmh" };
    let raw;
    let retrieval;
    let sourceUrl;
    if (fixture.status === "live") {
      const params = new URLSearchParams({ ...baseParams, current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m" });
      sourceUrl = `${FORECAST_URL}?${params}`;
      const payload = await requestJson(sourceUrl, fetchImpl);
      raw = {
        time: payload.current?.time || now.toISOString(), temperature: payload.current?.temperature_2m ?? null,
        humidity: payload.current?.relative_humidity_2m ?? null, rainProbability: null,
        precipitation: payload.current?.precipitation ?? null, windSpeed: payload.current?.wind_speed_10m ?? null,
        weatherCode: payload.current?.weather_code ?? null
      };
      retrieval = "open_meteo_current";
    } else {
      const historical = fixture.status === "finished" || target.getTime() < now.getTime();
      const endpoint = historical ? ARCHIVE_URL : FORECAST_URL;
      const hourly = historical ? HOURLY_FIELDS.replace("precipitation_probability,", "") : HOURLY_FIELDS;
      const params = new URLSearchParams({ ...baseParams, start_date: date, end_date: date, hourly });
      sourceUrl = `${endpoint}?${params}`;
      const payload = await requestJson(sourceUrl, fetchImpl);
      raw = nearestHourly(payload.hourly, target);
      retrieval = historical ? "open_meteo_historical" : "open_meteo_forecast";
    }
    if (!raw) {
      return createSourceResult({ source: "weather", status: SOURCE_STATUS.NOT_AVAILABLE, updatedAt: new Date().toISOString(), notes: ["Open-Meteo no devolvió datos para la hora del partido."], data: null });
    }
    const data = normalizeWeather(raw, location, retrieval, sourceUrl);
    const value = createSourceResult({
      source: "weather", status: SOURCE_STATUS.PARTIAL, updatedAt: new Date().toISOString(),
      notes: ["Clima obtenido de Open-Meteo sin API key.", data.pitchNotes], data
    });
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return createSourceResult({ source: "weather", status: SOURCE_STATUS.FAILED, updatedAt: new Date().toISOString(), notes: ["Open-Meteo no respondió; no se inventaron datos meteorológicos."], data: null });
  }
}
