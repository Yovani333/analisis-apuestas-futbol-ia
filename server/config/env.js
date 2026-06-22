import dotenv from "dotenv";

dotenv.config({ override: true, quiet: true });

export const env = Object.freeze({
  port: Number(process.env.PORT || 3000),
  dataMode: process.env.DATA_MODE === "live" ? "live" : "mock",
  apiFootballKey: process.env.API_FOOTBALL_KEY || "",
  apiFootballBaseUrl: process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "",
  sofaScoreAccessMode: process.env.SOFASCORE_ACCESS_MODE || "disabled",
  oddspediaAccessMode: process.env.ODDSPEDIA_ACCESS_MODE || "disabled",
  oddspediaSearchModel: process.env.ODDSPEDIA_SEARCH_MODEL || "",
  fotmobAccessMode: process.env.FOTMOB_ACCESS_MODE || "disabled",
  fotmobSearchModel: process.env.FOTMOB_SEARCH_MODEL || "",
  whoScoredAccessMode: process.env.WHOSCORED_ACCESS_MODE || "disabled",
  whoScoredSearchModel: process.env.WHOSCORED_SEARCH_MODEL || "",
  fbrefAccessMode: process.env.FBREF_ACCESS_MODE || "disabled",
  fbrefSearchModel: process.env.FBREF_SEARCH_MODEL || "",
  weatherAccessMode: process.env.WEATHER_ACCESS_MODE || "disabled",
  weatherSearchModel: process.env.WEATHER_SEARCH_MODEL || "",
  soccerwayAccessMode: process.env.SOCCERWAY_ACCESS_MODE || "disabled",
  soccerwaySearchModel: process.env.SOCCERWAY_SEARCH_MODEL || ""
});

export function requireLiveConfiguration() {
  const missing = [];
  if (!env.apiFootballKey) missing.push("API_FOOTBALL_KEY");
  if (!env.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (!env.openaiModel) missing.push("OPENAI_MODEL");
  return missing;
}
