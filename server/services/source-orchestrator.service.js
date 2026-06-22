import { env } from "../config/env.js";
import { getSofaScoreSportsData } from "./sources/sofascore.service.js";
import { getOddspediaMarketData } from "./sources/oddspedia.service.js";

export async function collectExternalSourceData(matchData) {
  const sofaScore = await getSofaScoreSportsData(matchData, { accessMode: env.sofaScoreAccessMode });
  const oddspedia = await getOddspediaMarketData(matchData, {
    accessMode: env.oddspediaAccessMode,
    apiKey: env.openaiApiKey,
    model: env.oddspediaSearchModel || env.openaiModel
  });
  return { sofaScore, oddspedia };
}
