import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const AbsenceSchema = z.object({ player: z.string(), type: z.enum(["injury", "suspension", "doubt"]), reason: z.string() });
const PlayerSchema = z.object({ name: z.string(), position: z.string().nullable() });
const FotMobSearchSchema = z.object({
  match_found: z.boolean(), identity_confirmed: z.boolean(), event_url: z.string().nullable(), observed_at: z.string().nullable(),
  home_absences: z.array(AbsenceSchema).max(30), away_absences: z.array(AbsenceSchema).max(30),
  lineups_confirmed: z.boolean(), home_starting_xi: z.array(PlayerSchema).max(11), away_starting_xi: z.array(PlayerSchema).max(11),
  home_probable_xi: z.array(PlayerSchema).max(11), away_probable_xi: z.array(PlayerSchema).max(11),
  home_formation: z.string().nullable(), away_formation: z.string().nullable(),
  xg_scope: z.enum(["pre_match_team_aggregate", "season_average", "not_available"]),
  home_xg: z.number().nullable(), home_xga: z.number().nullable(), away_xg: z.number().nullable(), away_xga: z.number().nullable(),
  notes: z.array(z.string()).max(10)
});

function isFotMobUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "fotmob.com" || hostname.endsWith(".fotmob.com");
  } catch {
    return false;
  }
}

function webSources(response) {
  return [...new Set((response.output || []).flatMap((item) => {
    if (item.type !== "web_search_call") return [];
    if (item.action?.type === "search") return (item.action.sources || []).map((source) => source.url);
    return item.action?.url ? [item.action.url] : [];
  }).filter(isFotMobUrl))];
}

function normalizeAbsences(items = []) {
  const result = { injuries: [], suspensions: [], doubts: [] };
  items.forEach((item) => {
    const key = item.type === "suspension" ? "suspensions" : item.type === "doubt" ? "doubts" : "injuries";
    result[key].push({ name: item.player, type: item.type, reason: item.reason, requiresReview: true });
  });
  return result;
}

function normalizePlayers(items = []) {
  return items.map((player) => ({ name: player.name, position: player.position || "", requiresReview: true }));
}

export async function getFotMobContextData(matchData, {
  accessMode = "disabled", apiKey = "", model = "", client = null, forceRefresh = false
} = {}) {
  if (accessMode !== "openai_web_search") {
    return createSourceResult({
      source: "fotmob", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["Búsqueda web de FotMob desactivada; no se realizaron solicitudes."], data: null
    });
  }

  const fixture = matchData?.fixture || {};
  if (fixture.status !== "scheduled") {
    return createSourceResult({
      source: "fotmob", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: el partido ya inició o finalizó; se evita incorporar datos posteriores al comienzo."], data: null
    });
  }

  const needsInjuries = !(matchData?.confirmed?.injuries || []).length;
  const needsLineups = !(matchData?.confirmed?.lineups || []).length;
  const needsXg = true;
  if (!needsInjuries && !needsLineups && !needsXg) {
    return createSourceResult({ source: "fotmob", status: SOURCE_STATUS.NOT_AVAILABLE, notes: ["No hay módulos faltantes que requieran FotMob."], data: null });
  }

  if (!apiKey || !model) {
    return createSourceResult({
      source: "fotmob", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["La búsqueda requiere OPENAI_API_KEY y un modelo con web_search."], data: null
    });
  }

  const cacheKey = `${fixture.id}:${fixture.date}:${fixture.home}:${fixture.away}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;

  try {
    const openai = client || new OpenAI({ apiKey, timeout: 45000, maxRetries: 1 });
    const response = await openai.responses.parse({
      model,
      tools: [{ type: "web_search", filters: { allowed_domains: ["fotmob.com"] }, search_context_size: "low" }],
      include: ["web_search_call.action.sources"],
      instructions: `Busca únicamente en FotMob y usa solo información previa al inicio del partido.
No inventes lesiones, sanciones, dudas, alineaciones, formaciones, xG ni xGA.
No uses estadísticas generadas durante o después del mismo fixture.
Acepta xG/xGA solo si son agregados prepartido o promedios de temporada claramente identificados.
Si el partido o el dato no coincide exactamente, marca match_found=false o usa valores vacíos/null.`,
      input: JSON.stringify({
        task: "Complementar faltantes prepartido",
        missingModules: { injuriesSuspensions: needsInjuries, lineups: needsLineups, xgXga: needsXg },
        match: { homeTeam: fixture.home, awayTeam: fixture.away, date: fixture.date, time: fixture.time, league: fixture.leagueName, country: fixture.country }
      }),
      text: { format: zodTextFormat(FotMobSearchSchema, "fotmob_match_context") }
    });
    const parsed = response.output_parsed;
    const sources = webSources(response);
    const eventUrl = parsed?.event_url && isFotMobUrl(parsed.event_url) ? parsed.event_url : sources[0] || "";
    const xgAllowed = ["pre_match_team_aggregate", "season_average"].includes(parsed?.xg_scope);
    const data = {
      injuriesSuspensions: {
        home: normalizeAbsences(parsed?.home_absences), away: normalizeAbsences(parsed?.away_absences)
      },
      lineups: {
        reportedConfirmed: Boolean(parsed?.lineups_confirmed),
        homeStartingXI: normalizePlayers(parsed?.home_starting_xi), awayStartingXI: normalizePlayers(parsed?.away_starting_xi),
        probableHomeXI: normalizePlayers(parsed?.home_probable_xi), probableAwayXI: normalizePlayers(parsed?.away_probable_xi),
        homeFormation: parsed?.home_formation || "", awayFormation: parsed?.away_formation || ""
      },
      xgXga: {
        scope: xgAllowed ? parsed.xg_scope : "not_available",
        homeXG: xgAllowed ? parsed.home_xg : null, homeXGA: xgAllowed ? parsed.home_xga : null,
        awayXG: xgAllowed ? parsed.away_xg : null, awayXGA: xgAllowed ? parsed.away_xga : null
      },
      eventUrl, sources, observedAt: parsed?.observed_at || "", retrieval: "openai_web_search"
    };
    const hasAbsences = [...Object.values(data.injuriesSuspensions.home), ...Object.values(data.injuriesSuspensions.away)].some((items) => items.length);
    const hasLineups = data.lineups.homeStartingXI.length || data.lineups.awayStartingXI.length || data.lineups.probableHomeXI.length || data.lineups.probableAwayXI.length;
    const hasXg = Object.entries(data.xgXga).some(([key, value]) => key !== "scope" && Number.isFinite(value));
    const verified = Boolean(parsed?.match_found && parsed?.identity_confirmed && eventUrl && sources.length && (hasAbsences || hasLineups || hasXg));
    const value = createSourceResult({
      source: "fotmob", status: verified ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.NOT_AVAILABLE,
      updatedAt: new Date().toISOString(),
      notes: verified
        ? ["Datos prepartido recuperados mediante web_search restringido a fotmob.com.", "Todos los elementos requieren revisión antes del análisis."]
        : ["FotMob no devolvió una coincidencia exacta con datos prepartido utilizables."],
      data: verified ? data : null
    });
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return createSourceResult({
      source: "fotmob", status: SOURCE_STATUS.FAILED, updatedAt: new Date().toISOString(),
      notes: ["La búsqueda complementaria de FotMob no pudo completarse."], data: null
    });
  }
}
