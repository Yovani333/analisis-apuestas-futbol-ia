import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const AbsenceSchema = z.object({ player: z.string(), type: z.enum(["injury", "suspension", "doubt"]), reason: z.string() });
const PlayerSchema = z.object({ name: z.string(), position: z.string().nullable() });
const WhoScoredSearchSchema = z.object({
  match_found: z.boolean(), identity_confirmed: z.boolean(), event_url: z.string().nullable(), observed_at: z.string().nullable(),
  home_absences: z.array(AbsenceSchema).max(30), away_absences: z.array(AbsenceSchema).max(30),
  home_probable_xi: z.array(PlayerSchema).max(11), away_probable_xi: z.array(PlayerSchema).max(11),
  home_formation: z.string().nullable(), away_formation: z.string().nullable(),
  tactical_notes: z.array(z.string()).max(10), notes: z.array(z.string()).max(10)
});

function isWhoScoredUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "whoscored.com" || hostname.endsWith(".whoscored.com");
  } catch {
    return false;
  }
}

function webSources(response) {
  return [...new Set((response.output || []).flatMap((item) => {
    if (item.type !== "web_search_call") return [];
    if (item.action?.type === "search") return (item.action.sources || []).map((source) => source.url);
    return item.action?.url ? [item.action.url] : [];
  }).filter(isWhoScoredUrl))];
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

function hasFotMobAbsences(result) {
  const sides = result?.data?.injuriesSuspensions;
  return sides && [...Object.values(sides.home || {}), ...Object.values(sides.away || {})].some((items) => items?.length);
}

function hasFotMobLineups(result) {
  const lineups = result?.data?.lineups;
  return Boolean(lineups && (lineups.homeStartingXI?.length || lineups.awayStartingXI?.length || lineups.probableHomeXI?.length || lineups.probableAwayXI?.length));
}

export async function getWhoScoredAbsenceData(matchData, {
  accessMode = "disabled", apiKey = "", model = "", client = null, fotmobResult = null
} = {}) {
  if (accessMode !== "openai_web_search") {
    return createSourceResult({
      source: "whoScored", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["Búsqueda web de WhoScored desactivada; no se realizaron solicitudes."], data: null
    });
  }

  const fixture = matchData?.fixture || {};
  if (fixture.status !== "scheduled") {
    return createSourceResult({
      source: "whoScored", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: el partido ya inició o finalizó."], data: null
    });
  }

  const needsInjuries = !(matchData?.confirmed?.injuries || []).length && !hasFotMobAbsences(fotmobResult);
  const needsLineups = !(matchData?.confirmed?.lineups || []).length && !hasFotMobLineups(fotmobResult);
  if (!needsInjuries && !needsLineups) {
    return createSourceResult({
      source: "whoScored", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: API-Football o FotMob ya cubrieron bajas y alineaciones."], data: null
    });
  }

  if (!apiKey || !model) {
    return createSourceResult({
      source: "whoScored", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["La búsqueda requiere OPENAI_API_KEY y un modelo con web_search."], data: null
    });
  }

  const cacheKey = `${fixture.id}:${fixture.date}:${fixture.home}:${fixture.away}:${needsInjuries}:${needsLineups}`;
  const cached = cache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.value;

  try {
    const openai = client || new OpenAI({ apiKey, timeout: 45000, maxRetries: 1 });
    const response = await openai.responses.parse({
      model,
      tools: [{ type: "web_search", filters: { allowed_domains: ["whoscored.com"] }, search_context_size: "low" }],
      include: ["web_search_call.action.sources"],
      instructions: `Busca únicamente en WhoScored y usa solo información publicada antes del inicio del partido.
No inventes lesiones, sanciones, jugadores en duda, alineaciones, formaciones ni notas tácticas.
No conviertas una alineación probable en confirmada y no uses datos del mismo fixture generados después del inicio.
Si el partido o los equipos no coinciden exactamente, marca match_found=false y devuelve arreglos vacíos.`,
      input: JSON.stringify({
        task: "Completar bajas y alineaciones probables faltantes",
        missingModules: { injuriesSuspensions: needsInjuries, lineups: needsLineups },
        match: { homeTeam: fixture.home, awayTeam: fixture.away, date: fixture.date, time: fixture.time, league: fixture.leagueName, country: fixture.country }
      }),
      text: { format: zodTextFormat(WhoScoredSearchSchema, "whoscored_match_context") }
    });
    const parsed = response.output_parsed;
    const sources = webSources(response);
    const eventUrl = parsed?.event_url && isWhoScoredUrl(parsed.event_url) ? parsed.event_url : sources[0] || "";
    const data = {
      injuriesSuspensions: { home: normalizeAbsences(parsed?.home_absences), away: normalizeAbsences(parsed?.away_absences) },
      lineups: {
        probableHomeXI: normalizePlayers(parsed?.home_probable_xi), probableAwayXI: normalizePlayers(parsed?.away_probable_xi),
        homeFormation: parsed?.home_formation || "", awayFormation: parsed?.away_formation || ""
      },
      tacticalNotes: (parsed?.tactical_notes || []).map((note) => ({ text: note, requiresReview: true })),
      eventUrl, sources, observedAt: parsed?.observed_at || "", retrieval: "openai_web_search"
    };
    const hasAbsences = [...Object.values(data.injuriesSuspensions.home), ...Object.values(data.injuriesSuspensions.away)].some((items) => items.length);
    const hasLineups = data.lineups.probableHomeXI.length || data.lineups.probableAwayXI.length;
    const verified = Boolean(parsed?.match_found && parsed?.identity_confirmed && eventUrl && sources.length && (hasAbsences || hasLineups));
    const value = createSourceResult({
      source: "whoScored", status: verified ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.NOT_AVAILABLE,
      updatedAt: new Date().toISOString(),
      notes: verified
        ? ["Datos prepartido recuperados mediante web_search restringido a whoscored.com.", "Bajas y alineaciones permanecen probables y requieren revisión."]
        : ["WhoScored no devolvió una coincidencia exacta con datos prepartido utilizables."],
      data: verified ? data : null
    });
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return createSourceResult({
      source: "whoScored", status: SOURCE_STATUS.FAILED, updatedAt: new Date().toISOString(),
      notes: ["La búsqueda complementaria de WhoScored no pudo completarse."], data: null
    });
  }
}
