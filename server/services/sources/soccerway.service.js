import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const StandingSchema = z.object({
  team: z.string(), rank: z.number().int().positive().nullable(), points: z.number().int().nullable(),
  played: z.number().int().nonnegative().nullable(), wins: z.number().int().nonnegative().nullable(),
  draws: z.number().int().nonnegative().nullable(), losses: z.number().int().nonnegative().nullable(),
  goals_for: z.number().int().nonnegative().nullable(), goals_against: z.number().int().nonnegative().nullable(),
  goal_difference: z.number().int().nullable(), source_url: z.string().nullable()
});

const H2HSchema = z.object({
  date: z.string(), home_team: z.string(), away_team: z.string(),
  home_goals: z.number().int().nonnegative(), away_goals: z.number().int().nonnegative(),
  source_url: z.string().nullable()
});

const SoccerwaySearchSchema = z.object({
  match_found: z.boolean(), identity_confirmed: z.boolean(), competition_confirmed: z.boolean(),
  competition_url: z.string().nullable(), observed_at: z.string().nullable(),
  home_standing: StandingSchema.nullable(), away_standing: StandingSchema.nullable(),
  h2h_matches: z.array(H2HSchema).max(10), notes: z.array(z.string()).max(10)
});

function isSoccerwayUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "soccerway.com" || hostname.endsWith(".soccerway.com");
  } catch {
    return false;
  }
}

function webSources(response) {
  return [...new Set((response.output || []).flatMap((item) => {
    if (item.type !== "web_search_call") return [];
    if (item.action?.type === "search") return (item.action.sources || []).map((source) => source.url);
    return item.action?.url ? [item.action.url] : [];
  }).filter(isSoccerwayUrl))];
}

function hasApiStandings(matchData) {
  const rows = matchData?.confirmed?.standings;
  return Array.isArray(rows) && rows.length > 0;
}

function hasApiH2h(matchData) {
  return Array.isArray(matchData?.confirmed?.h2h) && matchData.confirmed.h2h.length > 0;
}

function verifiedSource(value, sources) {
  return Boolean(value && isSoccerwayUrl(value) && sources.includes(value));
}

function normalizedName(value) {
  return String(value || "").trim().toLocaleLowerCase("es");
}

function normalizeStanding(value, sources, expectedTeam) {
  if (!value || normalizedName(value.team) !== normalizedName(expectedTeam)
    || !verifiedSource(value.source_url, sources)) return null;
  return {
    team: value.team, rank: value.rank, points: value.points, played: value.played,
    wins: value.wins, draws: value.draws, losses: value.losses,
    goalsFor: value.goals_for, goalsAgainst: value.goals_against,
    goalDifference: value.goal_difference, sourceUrl: value.source_url,
    requiresReview: true
  };
}

function normalizeH2h(items, sources, fixtureDate, homeTeam, awayTeam) {
  const expectedTeams = [normalizedName(homeTeam), normalizedName(awayTeam)].sort().join("|");
  return (items || []).filter((item) => {
    const date = item.date?.slice(0, 10);
    const reportedTeams = [normalizedName(item.home_team), normalizedName(item.away_team)].sort().join("|");
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < fixtureDate
      && reportedTeams === expectedTeams && verifiedSource(item.source_url, sources);
  }).map((item) => ({
    date: item.date.slice(0, 10), homeTeam: item.home_team, awayTeam: item.away_team,
    homeGoals: item.home_goals, awayGoals: item.away_goals,
    sourceUrl: item.source_url, requiresReview: true
  }));
}

export async function getSoccerwayFallbackData(matchData, {
  accessMode = "disabled", apiKey = "", model = "", client = null, forceRefresh = false
} = {}) {
  if (accessMode !== "openai_web_search") {
    return createSourceResult({
      source: "soccerway", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["Búsqueda web de Soccerway desactivada; no se realizaron solicitudes."], data: null
    });
  }

  const fixture = matchData?.fixture || {};
  if (fixture.status !== "scheduled") {
    return createSourceResult({
      source: "soccerway", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: el partido ya inició o finalizó."], data: null
    });
  }

  const needsStandings = !hasApiStandings(matchData);
  const needsH2h = !hasApiH2h(matchData);
  if (!needsStandings && !needsH2h) {
    return createSourceResult({
      source: "soccerway", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: API-Football ya cubrió clasificación y H2H."], data: null
    });
  }

  if (!fixture.date || !fixture.home || !fixture.away) {
    return createSourceResult({
      source: "soccerway", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: faltan fecha o equipos para verificar el encuentro."], data: null
    });
  }

  if (!apiKey || !model) {
    return createSourceResult({
      source: "soccerway", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["La búsqueda requiere OPENAI_API_KEY y un modelo con web_search."], data: null
    });
  }

  const cacheKey = `${fixture.id}:${fixture.date}:${fixture.home}:${fixture.away}:${needsStandings}:${needsH2h}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;

  try {
    const openai = client || new OpenAI({ apiKey, timeout: 45000, maxRetries: 1 });
    const response = await openai.responses.parse({
      model,
      tools: [{ type: "web_search", filters: { allowed_domains: ["soccerway.com"] }, search_context_size: "low" }],
      include: ["web_search_call.action.sources"],
      instructions: `Busca únicamente en Soccerway y usa información publicada antes del inicio del partido.
No inventes clasificación, puntos, resultados, equipos, competición ni fechas.
Devuelve clasificación solo si corresponde exactamente a la competición y temporada indicadas.
Devuelve H2H únicamente para partidos finalizados antes de la fecha del encuentro analizado.
Cada tabla o partido debe incluir su URL exacta de Soccerway. Si la identidad no coincide, devuelve valores vacíos.`,
      input: JSON.stringify({
        task: "Complementar clasificación y H2H faltantes",
        missingModules: { standings: needsStandings, h2h: needsH2h },
        match: {
          team1: fixture.home, team2: fixture.away, date: fixture.date,
          league: fixture.leagueName, country: fixture.country, season: fixture.season || ""
        }
      }),
      text: { format: zodTextFormat(SoccerwaySearchSchema, "soccerway_match_context") }
    });

    const parsed = response.output_parsed;
    const sources = webSources(response);
    const competitionUrl = parsed?.competition_url && verifiedSource(parsed.competition_url, sources)
      ? parsed.competition_url : "";
    const standings = needsStandings && parsed?.competition_confirmed ? {
      home: normalizeStanding(parsed.home_standing, sources, fixture.home),
      away: normalizeStanding(parsed.away_standing, sources, fixture.away)
    } : { home: null, away: null };
    const h2h = needsH2h
      ? normalizeH2h(parsed?.h2h_matches, sources, fixture.date.slice(0, 10), fixture.home, fixture.away)
      : [];
    const hasStandings = Boolean(standings.home || standings.away);
    const verified = Boolean(parsed?.match_found && parsed?.identity_confirmed && sources.length && (hasStandings || h2h.length));
    const data = verified ? {
      standings, h2h, competitionUrl, sources,
      observedAt: parsed?.observed_at || "", retrieval: "openai_web_search"
    } : null;
    const value = createSourceResult({
      source: "soccerway", status: verified ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.NOT_AVAILABLE,
      updatedAt: new Date().toISOString(),
      notes: verified
        ? ["Datos complementarios recuperados mediante web_search restringido a soccerway.com.", "Clasificación y H2H requieren revisión antes del análisis."]
        : ["Soccerway no devolvió una coincidencia verificable con datos utilizables."],
      data
    });
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return createSourceResult({
      source: "soccerway", status: SOURCE_STATUS.FAILED, updatedAt: new Date().toISOString(),
      notes: ["La búsqueda complementaria de Soccerway no pudo completarse."], data: null
    });
  }
}
