export const ALLOWED_LEAGUES = Object.freeze([
  { slug: "la-liga", name: "La Liga", country: "España", code: "ESP", apiId: null, defaultSelected: true },
  { slug: "chinese-super-league", name: "Superliga China", country: "China", code: "CHN", apiId: null, defaultSelected: true },
  { slug: "bundesliga", name: "Bundesliga", country: "Alemania", code: "DEU", apiId: null, defaultSelected: true },
  { slug: "primeira-liga", name: "Primeira Liga", country: "Portugal", code: "PRT", apiId: null, defaultSelected: true },
  { slug: "ligue-1", name: "Ligue 1", country: "Francia", code: "FRA", apiId: null, defaultSelected: true },
  { slug: "world-cup", name: "Copa Mundial FIFA", country: "Mundial", code: "FIFA", apiId: null, defaultSelected: false }
]);

export const DATA_CATEGORIES = Object.freeze([
  { key: "standings", label: "Clasificación" },
  { key: "statistics", label: "Estadísticas / forma" },
  { key: "h2h", label: "Head to head" },
  { key: "injuries", label: "Lesiones / sanciones" },
  { key: "lineups", label: "Alineaciones" },
  { key: "odds", label: "Cuotas" },
  { key: "xg", label: "xG / xGA" },
  { key: "context", label: "Contexto / calendario" },
  { key: "weather", label: "Clima / cancha" }
]);

// Escenarios ficticios para probar la interfaz. No describen eventos, clubes ni datos reales.
export const MOCK_FIXTURES = Object.freeze([
  {
    id: "demo-esp-01", leagueSlug: "la-liga", leagueName: "La Liga", home: "Club Azul", away: "Unión Dorada",
    date: "2025-05-08", time: "19:00", status: "scheduled", statusLabel: "Programado", stadium: "Estadio de demostración", country: "España",
    dataAvailability: { standings: "Disponible", statistics: "Disponible", h2h: "Disponible", injuries: "Necesita revisión", lineups: "No disponible", odds: "Disponible", xg: "Necesita revisión", context: "Disponible", weather: "No disponible" }
  },
  {
    id: "demo-chn-01", leagueSlug: "chinese-super-league", leagueName: "Superliga China", home: "Puerto Celeste", away: "Capital Rojo",
    date: "2025-05-11", time: "13:30", status: "scheduled", statusLabel: "Programado", stadium: "Estadio de demostración", country: "China",
    dataAvailability: { standings: "Disponible", statistics: "Necesita revisión", h2h: "No disponible", injuries: "No disponible", lineups: "No disponible", odds: "Necesita revisión", xg: "No disponible", context: "Disponible", weather: "No disponible" }
  },
  {
    id: "demo-deu-01", leagueSlug: "bundesliga", leagueName: "Bundesliga", home: "FC Berg", away: "Rhein Athletic",
    date: "2025-05-14", time: "15:30", status: "scheduled", statusLabel: "Programado", stadium: "Estadio de demostración", country: "Alemania",
    dataAvailability: { standings: "Disponible", statistics: "Disponible", h2h: "Disponible", injuries: "Disponible", lineups: "Necesita revisión", odds: "Disponible", xg: "Disponible", context: "Necesita revisión", weather: "No disponible" }
  },
  {
    id: "demo-prt-01", leagueSlug: "primeira-liga", leagueName: "Primeira Liga", home: "Atlético Navegante", away: "Sporting Serra",
    date: "2025-05-18", time: "18:00", status: "scheduled", statusLabel: "Programado", stadium: "Estadio de demostración", country: "Portugal",
    dataAvailability: { standings: "Disponible", statistics: "Disponible", h2h: "Necesita revisión", injuries: "Disponible", lineups: "Disponible", odds: "Necesita revisión", xg: "No disponible", context: "Disponible", weather: "Necesita revisión" }
  },
  {
    id: "demo-fra-01", leagueSlug: "ligue-1", leagueName: "Ligue 1", home: "Olympique Lumière", away: "Racing Côte",
    date: "2025-05-22", time: "20:45", status: "scheduled", statusLabel: "Programado", stadium: "Estadio de demostración", country: "Francia",
    dataAvailability: { standings: "Disponible", statistics: "Disponible", h2h: "Disponible", injuries: "Necesita revisión", lineups: "Necesita revisión", odds: "Disponible", xg: "Disponible", context: "Disponible", weather: "No disponible" }
  },
  {
    id: "demo-world-01", leagueSlug: "world-cup", leagueName: "Copa Mundial FIFA", home: "Selección Norte", away: "Selección Sur",
    date: "2026-06-21", time: "18:00", status: "scheduled", statusLabel: "Programado", stadium: "Estadio de demostración", country: "Mundial",
    dataAvailability: { standings: "Necesita revisión", statistics: "Disponible", h2h: "No disponible", injuries: "No disponible", lineups: "No disponible", odds: "Necesita revisión", xg: "No disponible", context: "Disponible", weather: "No disponible" }
  }
]);
