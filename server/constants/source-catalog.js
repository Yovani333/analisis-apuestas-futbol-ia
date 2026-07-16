export const SOURCE_STATUS = Object.freeze({
  AVAILABLE: "available",
  PARTIAL: "partial",
  NOT_AVAILABLE: "not_available",
  NOT_CONFIGURED: "not_configured",
  FAILED: "failed",
  BLOCKED: "blocked"
});

export const SOURCE_DEFINITIONS = Object.freeze({
  apiFootball: {
    label: "API-Football",
    role: "Fuente estructurada base",
    defaultStatus: SOURCE_STATUS.NOT_AVAILABLE,
    notes: ["Integración activa desde el backend."]
  },
  apiFootballInternalModel: {
    label: "API-Football + modelo interno",
    role: "xG/xGA histórico estimado y estimado del fixture",
    defaultStatus: SOURCE_STATUS.NOT_AVAILABLE,
    notes: ["Cálculo interno; no corresponde a xG oficial de un proveedor estadístico."]
  },
  sofaScore: {
    label: "SofaScore",
    role: "Respaldo deportivo",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador preparado en modo desactivado; no se realizan consultas ni scraping."]
  },
  oddspedia: {
    label: "Oddspedia",
    role: "Respaldo de mercado y cuotas",
    defaultStatus: SOURCE_STATUS.BLOCKED,
    notes: ["Acceso directo rechazado con HTTP 403; adaptador opcional desactivado; no se realizan solicitudes externas."]
  },
  fotmob: {
    label: "FotMob",
    role: "Bajas, alineaciones probables y métricas",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador opcional desactivado; no se realizan solicitudes externas."]
  },
  whoScored: {
    label: "WhoScored",
    role: "Bajas y alineaciones probables",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador de respaldo desactivado; no se realizan solicitudes externas."]
  },
  fbref: {
    label: "FBref",
    role: "xG/xGA y estadísticas avanzadas",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador opcional desactivado; requiere conector estructurado para activarse."]
  },
  soccerway: {
    label: "Soccerway",
    role: "Respaldo de clasificación y resultados previos",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador condicionado desactivado; no se realizan solicitudes externas."]
  },
  weather: {
    label: "Open-Meteo",
    role: "Proveedor principal gratuito de clima y estimación de cancha",
    defaultStatus: SOURCE_STATUS.AVAILABLE,
    notes: ["Pronóstico, clima actual e histórico sin API key."]
  }
});

export const MODULE_SOURCE_PLAN = Object.freeze([
  { module: "statsForm", label: "Estadísticas / forma", primary: ["apiFootball"], secondary: ["sofaScore"] },
  { module: "h2h", label: "Head to head", primary: ["apiFootball"], secondary: ["soccerway", "sofaScore", "oddspedia"] },
  { module: "standings", label: "Clasificación", primary: ["apiFootball"], secondary: ["soccerway", "sofaScore"] },
  { module: "odds", label: "Cuotas / momios", primary: ["apiFootball"], secondary: ["oddspedia"] },
  { module: "lineups", label: "Alineaciones", primary: ["apiFootball"], secondary: ["sofaScore", "fotmob", "whoScored"] },
  { module: "injuriesSuspensions", label: "Lesiones / sanciones", primary: ["apiFootball"], secondary: ["fotmob", "whoScored", "sofaScore"] },
  { module: "xgXga", label: "xG / xGA", primary: ["apiFootballInternalModel"], secondary: ["fbref", "fotmob", "sofaScore"] },
  { module: "weatherPitch", label: "Clima / cancha", primary: ["weather"], secondary: [] },
  { module: "contextCalendar", label: "Contexto / calendario", primary: ["apiFootball"], secondary: ["sofaScore"] }
]);
