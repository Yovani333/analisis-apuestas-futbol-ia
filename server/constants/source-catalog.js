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
    defaultStatus: SOURCE_STATUS.AVAILABLE,
    notes: ["Integración activa desde el backend."]
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
    notes: ["Acceso directo rechazado con HTTP 403; adaptador opcional mediante web_search de OpenAI, desactivado por defecto."]
  },
  fotmob: {
    label: "FotMob",
    role: "Bajas, alineaciones probables y métricas",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador opcional mediante web_search de OpenAI, desactivado por defecto."]
  },
  whoScored: {
    label: "WhoScored",
    role: "Bajas y alineaciones probables",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador de respaldo mediante web_search de OpenAI, desactivado por defecto."]
  },
  fbref: {
    label: "FBref",
    role: "xG/xGA y estadísticas avanzadas",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Adaptador opcional mediante web_search de OpenAI, desactivado por defecto y sujeto a cobertura de la competición."]
  },
  weather: {
    label: "Clima",
    role: "Contexto meteorológico y de cancha",
    defaultStatus: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["No hay proveedor meteorológico configurado."]
  }
});

export const MODULE_SOURCE_PLAN = Object.freeze([
  { module: "calendar", label: "Calendario", primary: ["apiFootball"], secondary: ["sofaScore", "oddspedia"] },
  { module: "statsForm", label: "Estadísticas / forma", primary: ["sofaScore"], secondary: ["apiFootball"] },
  { module: "h2h", label: "Head to head", primary: ["apiFootball"], secondary: ["sofaScore", "oddspedia"] },
  { module: "standings", label: "Clasificación", primary: ["apiFootball"], secondary: ["sofaScore"] },
  { module: "odds", label: "Cuotas / momios", primary: ["oddspedia"], secondary: ["apiFootball"] },
  { module: "lineups", label: "Alineaciones", primary: ["sofaScore"], secondary: ["fotmob", "apiFootball"] },
  { module: "injuriesSuspensions", label: "Lesiones / sanciones", primary: ["fotmob", "whoScored"], secondary: ["apiFootball", "sofaScore"] },
  { module: "xgXga", label: "xG / xGA", primary: ["fbref", "fotmob"], secondary: ["sofaScore"] },
  { module: "weatherPitch", label: "Clima / cancha", primary: ["weather"], secondary: [] },
  { module: "contextCalendar", label: "Contexto / calendario", primary: ["apiFootball"], secondary: ["sofaScore"] }
]);
