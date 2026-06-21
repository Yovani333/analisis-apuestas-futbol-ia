import { ALLOWED_LEAGUES, DATA_CATEGORIES, MOCK_FIXTURES } from "./mock-data.js?v=20260620-efficient-analysis";

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function buildMockAnalysis(fixture) {
  const confirmed = DATA_CATEGORIES.filter(({ key }) => fixture.dataAvailability[key] === "Disponible").map(({ label }) => `${label}: disponible en el escenario sintético.`);
  const missing = DATA_CATEGORIES.filter(({ key }) => fixture.dataAvailability[key] !== "Disponible").map(({ key, label }) => `${label}: ${fixture.dataAvailability[key].toLowerCase()}.`);
  const needsReview = missing.length > 0;

  return {
    estado_analisis: needsReview ? "Necesita revisión" : "Completo",
    liga: fixture.leagueName,
    partido: { local: fixture.home, visitante: fixture.away, fecha: fixture.date, estadio: fixture.stadium, pais: fixture.country },
    resumen_partido: needsReview
      ? "La cobertura sintética es insuficiente para una estimación responsable. Deben verificarse los datos faltantes antes de evaluar mercados."
      : "La cobertura sintética está completa; aun así, esta demostración no produce una recomendación de apuesta real.",
    datos_confirmados: confirmed,
    datos_faltantes: missing,
    alertas_de_calidad_de_datos: ["Escenario completamente sintético; no corresponde a un partido real."],
    analisis_cuantitativo: {
      forma_reciente: "Sin métricas numéricas reales.", rendimiento_local_visitante: "Sin métricas numéricas reales.",
      fortaleza_ofensiva: "No estimada.", fortaleza_defensiva: "No estimada.", xg_xga: "No estimado.",
      lesiones_sanciones: fixture.dataAvailability.injuries, alineaciones_rotacion: fixture.dataAvailability.lineups,
      motivacion_competitiva: "No disponible.", fatiga_calendario: fixture.dataAvailability.context,
      matchup_tactico: "No disponible.", cuotas_valor_esperado: "No calculado sin cuotas verificadas."
    },
    probabilidad_estimativa: { local: null, empate: null, visitante: null, nota: "No hay datos suficientes para estimar con responsabilidad." },
    mercados_sugeridos: [{
      mercado: "Sin mercado", seleccion: "Esperar datos verificados", razonamiento: "No existe base real para calcular probabilidad implícita ni valor esperado.",
      nivel_riesgo: "Alto", confianza: "Baja", requiere_revision: true
    }],
    mercados_a_evitar: [{ mercado: "Todos", razonamiento: "Los datos son sintéticos y están incompletos." }],
    prediccion_prudente: { seleccion: "Sin predicción", razonamiento: "No se inventan probabilidades ni resultados cuando faltan datos reales.", confianza: "Baja" },
    apto_para_parlay: { respuesta: "No", razonamiento: "No hay una ventaja cuantificable y verificada." },
    riesgos_principales: ["Datos sintéticos.", ...missing.slice(0, 3)],
    conclusion: "Necesita validación con fuentes reales antes de cualquier decisión.",
    advertencia: "Este análisis es únicamente informativo. No garantiza resultados ni ganancias. Apuesta con responsabilidad."
  };
}

// Capa mock reemplazable. El navegador nunca debe llamar directamente a API-Football u OpenAI.
export const footballDataService = {
  getAllowedLeagues() {
    return ALLOWED_LEAGUES;
  },

  async searchMockFixtures({ leagues, dateFrom, dateTo, status }) {
    await wait(450);
    return MOCK_FIXTURES.filter((fixture) =>
      leagues.includes(fixture.leagueSlug) &&
      (!dateFrom || fixture.date >= dateFrom) &&
      (!dateTo || fixture.date <= dateTo) &&
      (status === "all" || fixture.status === status)
    );
  },

  async generateMockAnalysis(fixture) {
    await wait(900);
    return { ...buildMockAnalysis(fixture), _source: "mock" };
  },

  async getRuntime() {
    try {
      return await requestJson("/api/health");
    } catch {
      return { mode: "mock", liveReady: false };
    }
  },

  async searchFixtures(filters) {
    const runtime = await this.getRuntime();
    if (runtime.mode !== "live") return this.searchMockFixtures(filters);
    const payload = await requestJson(`/api/fixtures?${new URLSearchParams({
      leagues: filters.leagues.join(","), season: filters.season || "auto",
      dateFrom: filters.dateFrom, dateTo: filters.dateTo, status: filters.status
    })}`);
    return payload.fixtures.map((fixture) => ({ ...fixture, dataSource: "api-football" }));
  },

  async getFixtureData(fixture) {
    const runtime = await this.getRuntime();
    if (runtime.mode !== "live") return fixture;
    const payload = await requestJson(`/api/fixtures/${encodeURIComponent(fixture.id)}`);
    return {
      ...fixture,
      ...payload.fixture,
      confirmedData: payload.confirmed || {},
      preMatch: payload.preMatch || null,
      marketAnalysis: payload.marketAnalysis || [],
      dataQuality: payload.dataQuality || null,
      unavailableData: payload.unavailable || [],
      qualityAlerts: payload.qualityAlerts || [],
      fetchedAt: payload.fetchedAt,
      dataSource: "api-football"
    };
  },

  async generateAnalysis(fixture) {
    const runtime = await this.getRuntime();
    if (runtime.mode !== "live") return this.generateMockAnalysis(fixture);
    const payload = await requestJson(`/api/fixtures/${encodeURIComponent(fixture.id)}/analysis`, { method: "POST" });
    return { ...payload.analysis, _source: "openai" };
  },

  async getFixtureResult(fixtureId) {
    const payload = await requestJson(`/api/fixtures/${encodeURIComponent(fixtureId)}/result`);
    return payload.result;
  }
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible completar la solicitud.");
  return payload;
}

// Contrato previsto para la siguiente fase. Estas rutas pertenecen a un backend propio.
export const backendApi = {
  health: () => fetch("/api/health"),
  allowedLeagues: () => fetch("/api/leagues"),
  fixtures: (query) => fetch(`/api/fixtures?${new URLSearchParams(query)}`),
  fixture: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}`),
  fixtureResult: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/result`),
  standings: (query) => fetch(`/api/standings?${new URLSearchParams(query)}`),
  statistics: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/statistics`),
  headToHead: (query) => fetch(`/api/head-to-head?${new URLSearchParams(query)}`),
  injuries: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/injuries`),
  sidelined: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/sidelined`),
  lineups: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/lineups`),
  odds: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/odds`),
  analysis: (fixtureId) => fetch(`/api/fixtures/${encodeURIComponent(fixtureId)}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" } })
};
