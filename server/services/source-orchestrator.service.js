import { env } from "../config/env.js";
import { getSofaScoreSportsData } from "./sources/sofascore.service.js";
import { getWeatherContextData } from "./sources/weather.service.js";
import { SOURCE_STATUS } from "../constants/source-catalog.js";
import { createSourceResult } from "./sources/source-adapter.js";

function disabledSource(source, notes = []) {
  return createSourceResult({
    source,
    status: SOURCE_STATUS.NOT_CONFIGURED,
    updatedAt: new Date().toISOString(),
    notes: notes.length ? notes : ["Fuente secundaria desactivada. No se realizaron solicitudes externas."],
    data: null
  });
}

const DEFAULT_ADAPTERS = Object.freeze({
  sofaScore: getSofaScoreSportsData,
  oddspedia: () => disabledSource("oddspedia"),
  fotmob: () => disabledSource("fotmob"),
  whoScored: () => disabledSource("whoScored"),
  fbref: () => disabledSource("fbref"),
  weather: getWeatherContextData,
  soccerway: () => disabledSource("soccerway")
});

async function safeSource(source, operation) {
  try {
    return await operation();
  } catch {
    return createSourceResult({
      source, status: SOURCE_STATUS.FAILED, updatedAt: new Date().toISOString(),
      notes: ["La fuente no pudo procesarse; las demás consultas continuaron."], data: null
    });
  }
}

export async function collectExternalSourceData(matchData, {
  forceRefresh = false, adapters = DEFAULT_ADAPTERS, config = env
} = {}) {
  const [sofaScore, oddspedia, fotmob, weather, soccerway] = await Promise.all([
    safeSource("sofaScore", () => adapters.sofaScore(matchData, { accessMode: config.sofaScoreAccessMode, forceRefresh })),
    safeSource("oddspedia", () => adapters.oddspedia(matchData, { accessMode: "disabled", forceRefresh })),
    safeSource("fotmob", () => adapters.fotmob(matchData, { accessMode: "disabled", forceRefresh })),
    safeSource("weather", () => adapters.weather(matchData, { accessMode: config.weatherAccessMode, forceRefresh })),
    safeSource("soccerway", () => adapters.soccerway(matchData, { accessMode: "disabled", forceRefresh }))
  ]);

  const [whoScored, fbref] = await Promise.all([
    safeSource("whoScored", () => adapters.whoScored(matchData, { accessMode: "disabled", forceRefresh, fotmobResult: fotmob })),
    safeSource("fbref", () => adapters.fbref(matchData, { accessMode: "disabled", forceRefresh, fotmobResult: fotmob }))
  ]);
  return { sofaScore, oddspedia, fotmob, whoScored, fbref, weather, soccerway };
}
