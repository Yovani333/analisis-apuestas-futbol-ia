import { env } from "../config/env.js";
import { getSofaScoreSportsData } from "./sources/sofascore.service.js";
import { getOddspediaMarketData } from "./sources/oddspedia.service.js";
import { getFotMobContextData } from "./sources/fotmob.service.js";
import { getWhoScoredAbsenceData } from "./sources/whoscored.service.js";
import { getFbrefXgData } from "./sources/fbref.service.js";

export async function collectExternalSourceData(matchData) {
  const sofaScore = await getSofaScoreSportsData(matchData, { accessMode: env.sofaScoreAccessMode });
  const oddspedia = await getOddspediaMarketData(matchData, {
    accessMode: env.oddspediaAccessMode,
    apiKey: env.openaiApiKey,
    model: env.oddspediaSearchModel || env.openaiModel
  });
  const fotmob = await getFotMobContextData(matchData, {
    accessMode: env.fotmobAccessMode,
    apiKey: env.openaiApiKey,
    model: env.fotmobSearchModel || env.openaiModel
  });
  const whoScored = await getWhoScoredAbsenceData(matchData, {
    accessMode: env.whoScoredAccessMode,
    apiKey: env.openaiApiKey,
    model: env.whoScoredSearchModel || env.openaiModel,
    fotmobResult: fotmob
  });
  const fbref = await getFbrefXgData(matchData, {
    accessMode: env.fbrefAccessMode,
    apiKey: env.openaiApiKey,
    model: env.fbrefSearchModel || env.openaiModel,
    fotmobResult: fotmob
  });
  return { sofaScore, oddspedia, fotmob, whoScored, fbref };
}
