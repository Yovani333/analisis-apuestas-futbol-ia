import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const OddspediaSearchSchema = z.object({
  match_found: z.boolean(),
  identity_confirmed: z.boolean(),
  matched_home_team: z.string(),
  matched_away_team: z.string(),
  event_url: z.string().nullable(),
  observed_at: z.string().nullable(),
  markets: z.array(z.object({
    market: z.string(), selection: z.string(), decimal_odds: z.number().nullable(), bookmaker: z.string().nullable()
  })).max(30),
  notes: z.array(z.string()).max(10)
});

function isOddspediaUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "oddspedia.com" || hostname.endsWith(".oddspedia.com");
  } catch {
    return false;
  }
}

function webSources(response) {
  return [...new Set((response.output || []).flatMap((item) => {
    if (item.type !== "web_search_call") return [];
    if (item.action?.type === "search") return (item.action.sources || []).map((source) => source.url);
    return item.action?.url ? [item.action.url] : [];
  }).filter(isOddspediaUrl))];
}

export async function getOddspediaMarketData(matchData, {
  accessMode = "disabled", apiKey = "", model = "", client = null, forceRefresh = false
} = {}) {
  if (accessMode !== "openai_web_search") {
    return createSourceResult({
      source: "oddspedia", status: SOURCE_STATUS.BLOCKED,
      notes: ["Acceso directo bloqueado con HTTP 403 y búsqueda web opcional desactivada.", "No se realizaron solicitudes de red."], data: null
    });
  }

  if ((matchData?.marketAnalysis || []).length) {
    return createSourceResult({
      source: "oddspedia", status: SOURCE_STATUS.NOT_AVAILABLE,
      notes: ["No consultada: API-Football ya proporcionó mercados normalizados."], data: null
    });
  }

  if (!apiKey || !model) {
    return createSourceResult({
      source: "oddspedia", status: SOURCE_STATUS.NOT_CONFIGURED,
      notes: ["La búsqueda requiere OPENAI_API_KEY y un modelo con web_search."], data: null
    });
  }

  const fixture = matchData?.fixture || {};
  const cacheKey = `${fixture.id}:${fixture.date}:${fixture.home}:${fixture.away}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;

  try {
    const openai = client || new OpenAI({ apiKey, timeout: 45000, maxRetries: 1 });
    const response = await openai.responses.parse({
      model,
      tools: [{ type: "web_search", filters: { allowed_domains: ["oddspedia.com"] }, search_context_size: "low" }],
      include: ["web_search_call.action.sources"],
      instructions: `Busca únicamente en Oddspedia. Extrae solo datos visibles y atribuibles al partido indicado.
No inventes cuotas, casas, mercados, equipos, fechas ni URL. Si no hay coincidencia exacta, usa match_found=false.
No uses resultados de otros dominios. Devuelve cuotas decimales y null cuando el valor no sea verificable.`,
      input: JSON.stringify({
        task: "Complementar mercados faltantes",
        match: { homeTeam: fixture.home, awayTeam: fixture.away, date: fixture.date, league: fixture.leagueName, country: fixture.country }
      }),
      text: { format: zodTextFormat(OddspediaSearchSchema, "oddspedia_market_data") }
    });
    const parsed = response.output_parsed;
    const sources = webSources(response);
    const eventUrl = parsed?.event_url && isOddspediaUrl(parsed.event_url) ? parsed.event_url : sources[0] || "";
    const markets = (parsed?.markets || []).filter((market) => Number.isFinite(market.decimal_odds) && market.decimal_odds > 1).map((market) => ({
      market: market.market, selection: market.selection, decimalOdds: market.decimal_odds,
      bookmaker: market.bookmaker || "", sourceUrl: eventUrl, requiresReview: true
    }));
    const verified = Boolean(parsed?.match_found && parsed?.identity_confirmed && eventUrl && sources.length && markets.length);
    const value = createSourceResult({
      source: "oddspedia",
      status: verified ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.NOT_AVAILABLE,
      updatedAt: new Date().toISOString(),
      notes: verified
        ? ["Datos recuperados mediante web_search restringido a oddspedia.com.", "Requieren revisión y no sustituyen cuotas directas del operador."]
        : ["Oddspedia no devolvió una coincidencia exacta y verificable con cuotas utilizables."],
      data: verified ? { markets, bestOdds: markets, eventUrl, sources, observedAt: parsed.observed_at || "", retrieval: "openai_web_search" } : null
    });
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return createSourceResult({
      source: "oddspedia", status: SOURCE_STATUS.FAILED,
      updatedAt: new Date().toISOString(),
      notes: ["La búsqueda complementaria de Oddspedia no pudo completarse."], data: null
    });
  }
}
