import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const TeamMetricsSchema = z.object({
  team: z.string(),
  xg_per_match: z.number().nonnegative().nullable(),
  xga_per_match: z.number().nonnegative().nullable(),
  npxg_per_match: z.number().nonnegative().nullable(),
  matches_played: z.number().int().nonnegative().nullable(),
  source_url: z.string().nullable()
});

const FbrefSearchSchema = z.object({
  competition_found: z.boolean(),
  teams_confirmed: z.boolean(),
  season: z.string().nullable(),
  observed_at: z.string().nullable(),
  scope: z.enum(["season_per_match", "not_available"]),
  home: TeamMetricsSchema,
  away: TeamMetricsSchema,
  notes: z.array(z.string()).max(10)
});

function isFbrefUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "fbref.com" || hostname.endsWith(".fbref.com");
  } catch {
    return false;
  }
}

function webSources(response) {
  return [...new Set((response.output || []).flatMap((item) => {
    if (item.type !== "web_search_call") return [];
    if (item.action?.type === "search") return (item.action.sources || []).map((source) => source.url);
    return item.action?.url ? [item.action.url] : [];
  }).filter(isFbrefUrl))];
}

function hasFotMobXg(result) {
  const data = result?.data?.xgXga;
  return Boolean(data
    && ["pre_match_team_aggregate", "season_average"].includes(data.scope)
    && [data.homeXG, data.homeXGA, data.awayXG, data.awayXGA].some(Number.isFinite));
}

function validTeamSource(team, sources) {
  return Boolean(team?.source_url && isFbrefUrl(team.source_url) && sources.includes(team.source_url));
}

export async function getFbrefXgData(matchData, {
  accessMode = "disabled", apiKey = "", model = "", client = null, fotmobResult = null, forceRefresh = false
} = {}) {
  if (accessMode !== "openai_web_search") {
    return createSourceResult({
      source: "fbref", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["Búsqueda web de FBref desactivada; no se realizaron solicitudes."], data: null
    });
  }

  const fixture = matchData?.fixture || {};
  if (fixture.status !== "scheduled") {
    return createSourceResult({
      source: "fbref", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: el partido ya inició o finalizó; se evita fuga de datos posteriores."], data: null
    });
  }

  if (hasFotMobXg(fotmobResult)) {
    return createSourceResult({
      source: "fbref", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: FotMob ya aportó métricas xG/xGA prepartido utilizables."], data: null
    });
  }

  if (!apiKey || !model) {
    return createSourceResult({
      source: "fbref", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["La búsqueda requiere OPENAI_API_KEY y un modelo con web_search."], data: null
    });
  }

  const cacheKey = `${fixture.id}:${fixture.date}:${fixture.home}:${fixture.away}:${fixture.leagueName}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;

  try {
    const openai = client || new OpenAI({ apiKey, timeout: 45000, maxRetries: 1 });
    const response = await openai.responses.parse({
      model,
      tools: [{ type: "web_search", filters: { allowed_domains: ["fbref.com"] }, search_context_size: "low" }],
      include: ["web_search_call.action.sources"],
      instructions: `Busca únicamente en FBref las estadísticas de temporada disponibles antes del inicio del partido.
No inventes xG, xGA, npxG, partidos jugados, equipos, temporadas ni competiciones.
Devuelve solo promedios por partido publicados o calculados directamente desde totales claramente mostrados por FBref.
No uses estadísticas generadas por el mismo fixture ni datos posteriores a su inicio.
Cada equipo debe incluir su URL exacta de FBref. Si no coinciden competición, temporada y equipos, usa scope=not_available y valores null.`,
      input: JSON.stringify({
        task: "Obtener xG, xGA y npxG prepartido por equipo",
        match: {
          homeTeam: fixture.home, awayTeam: fixture.away, date: fixture.date,
          league: fixture.leagueName, country: fixture.country, season: fixture.season || ""
        }
      }),
      text: { format: zodTextFormat(FbrefSearchSchema, "fbref_team_xg") }
    });

    const parsed = response.output_parsed;
    const sources = webSources(response);
    const homeSourceOk = validTeamSource(parsed?.home, sources);
    const awaySourceOk = validTeamSource(parsed?.away, sources);
    const scopeAllowed = parsed?.scope === "season_per_match";
    const teamMetrics = (team, sourceOk) => ({
      xg: sourceOk && scopeAllowed ? team?.xg_per_match : null,
      xga: sourceOk && scopeAllowed ? team?.xga_per_match : null,
      npxg: sourceOk && scopeAllowed ? team?.npxg_per_match : null,
      matchesPlayed: sourceOk && scopeAllowed ? team?.matches_played : null,
      sourceUrl: sourceOk ? team.source_url : ""
    });
    const data = {
      scope: scopeAllowed ? "season_per_match" : "not_available",
      season: parsed?.season || "",
      home: teamMetrics(parsed?.home, homeSourceOk),
      away: teamMetrics(parsed?.away, awaySourceOk),
      sources, observedAt: parsed?.observed_at || "", retrieval: "openai_web_search"
    };
    const hasHome = [data.home.xg, data.home.xga, data.home.npxg].some(Number.isFinite);
    const hasAway = [data.away.xg, data.away.xga, data.away.npxg].some(Number.isFinite);
    const verified = Boolean(parsed?.competition_found && parsed?.teams_confirmed && scopeAllowed && sources.length && (hasHome || hasAway));
    const value = createSourceResult({
      source: "fbref", status: verified ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.NOT_AVAILABLE,
      updatedAt: new Date().toISOString(),
      notes: verified
        ? ["Métricas de temporada recuperadas mediante web_search restringido a fbref.com.", "Los promedios son complementarios, pueden tener cobertura parcial y requieren revisión."]
        : ["FBref no devolvió una coincidencia verificable con métricas prepartido utilizables."],
      data: verified ? data : null
    });
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return createSourceResult({
      source: "fbref", status: SOURCE_STATUS.FAILED, updatedAt: new Date().toISOString(),
      notes: ["La búsqueda complementaria de FBref no pudo completarse."], data: null
    });
  }
}
