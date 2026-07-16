import dotenv from "dotenv";
dotenv.config({ override: true, quiet: true });

export const env = Object.freeze({
  port: Number(process.env.PORT || 3000),
  dataMode: process.env.DATA_MODE === "live" ? "live" : "mock",
  apiFootballKey: process.env.API_FOOTBALL_KEY || "",
  apiFootballBaseUrl: process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io",
  sofaScoreAccessMode: process.env.SOFASCORE_ACCESS_MODE || "disabled",
  oddspediaAccessMode: process.env.ODDSPEDIA_ACCESS_MODE || "disabled",
  fotmobAccessMode: process.env.FOTMOB_ACCESS_MODE || "disabled",
  whoScoredAccessMode: process.env.WHOSCORED_ACCESS_MODE || "disabled",
  fbrefAccessMode: process.env.FBREF_ACCESS_MODE || "disabled",
  weatherAccessMode: process.env.WEATHER_ACCESS_MODE || "open_meteo",
  soccerwayAccessMode: process.env.SOCCERWAY_ACCESS_MODE || "disabled",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || "",
  evidenceAutomationSecret: process.env.EVIDENCE_AUTOMATION_SECRET || "",
  evidenceAutomationIntervalMs: Math.max(60_000, Number(process.env.EVIDENCE_AUTOMATION_INTERVAL_MS || 300_000))
});

export function requireLiveConfiguration() {
  const missing = [];
  if (!env.apiFootballKey) missing.push("API_FOOTBALL_KEY");
  return missing;
}
