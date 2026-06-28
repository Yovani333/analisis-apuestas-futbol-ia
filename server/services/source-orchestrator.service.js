import { env } from "../config/env.js";
import { getSofaScoreSportsData } from "./sources/sofascore.service.js";
import { getOddspediaMarketData } from "./sources/oddspedia.service.js";
import { getFotMobContextData } from "./sources/fotmob.service.js";
import { getWhoScoredAbsenceData } from "./sources/whoscored.service.js";
import { getFbrefXgData } from "./sources/fbref.service.js";
import { getWeatherContextData } from "./sources/weather.service.js";
import { getSoccerwayFallbackData } from "./sources/soccerway.service.js";
import { SOURCE_STATUS } from "../constants/source-catalog.js";
import { createSourceResult } from "./sources/source-adapter.js";

const DEFAULT_ADAPTERS = Object.freeze({
  sofaScore: getSofaScoreSportsData,
  oddspedia: getOddspediaMarketData,
  fotmob: getFotMobContextData,
  whoScored: getWhoScoredAbsenceData,
  fbref: getFbrefXgData,
  weather: getWeatherContextData,
  soccerway: getSoccerwayFallbackData
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
  const common = { apiKey: config.openaiApiKey, forceRefresh };
  const economicalModel = config.openaiModelDefault || config.openaiModel;
  const [sofaScore, oddspedia, fotmob, weather, soccerway] = await Promise.all([
    safeSource("sofaScore", () => adapters.sofaScore(matchData, { accessMode: config.sofaScoreAccessMode, forceRefresh })),
    safeSource("oddspedia", () => adapters.oddspedia(matchData, {
      ...common, accessMode: config.oddspediaAccessMode, model: config.oddspediaSearchModel || economicalModel
    })),
    safeSource("fotmob", () => adapters.fotmob(matchData, {
      ...common, accessMode: config.fotmobAccessMode, model: config.fotmobSearchModel || economicalModel
    })),
    safeSource("weather", () => adapters.weather(matchData, { accessMode: config.weatherAccessMode, forceRefresh })),
    safeSource("soccerway", () => adapters.soccerway(matchData, {
      ...common, accessMode: config.soccerwayAccessMode, model: config.soccerwaySearchModel || economicalModel
    }))
  ]);

  const [whoScored, fbref] = await Promise.all([
    safeSource("whoScored", () => adapters.whoScored(matchData, {
      ...common, accessMode: config.whoScoredAccessMode,
      model: config.whoScoredSearchModel || economicalModel, fotmobResult: fotmob
    })),
    safeSource("fbref", () => adapters.fbref(matchData, {
      ...common, accessMode: config.fbrefAccessMode,
      model: config.fbrefSearchModel || economicalModel, fotmobResult: fotmob
    }))
  ]);
  return { sofaScore, oddspedia, fotmob, whoScored, fbref, weather, soccerway };
}
