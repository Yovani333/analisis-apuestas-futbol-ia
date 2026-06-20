import dotenv from "dotenv";

dotenv.config({ override: true, quiet: true });

export const env = Object.freeze({
  port: Number(process.env.PORT || 3000),
  dataMode: process.env.DATA_MODE === "live" ? "live" : "mock",
  apiFootballKey: process.env.API_FOOTBALL_KEY || "",
  apiFootballBaseUrl: process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || ""
});

export function requireLiveConfiguration() {
  const missing = [];
  if (!env.apiFootballKey) missing.push("API_FOOTBALL_KEY");
  if (!env.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (!env.openaiModel) missing.push("OPENAI_MODEL");
  return missing;
}
