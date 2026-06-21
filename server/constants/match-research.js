export const DATA_STATUS = Object.freeze({
  AVAILABLE: "available",
  PARTIAL: "partial",
  NOT_AVAILABLE: "not_available",
  FAILED: "failed",
  NEEDS_REVIEW: "needs_review"
});

export const ANALYSIS_STATUS = Object.freeze({
  COMPLETE: "complete",
  PARTIAL: "partial",
  NEEDS_REVIEW: "needs_review"
});

export const MODULE_WEIGHTS = Object.freeze({
  injuriesSuspensions: 18,
  lineups: 18,
  statsForm: 17,
  xgXga: 17,
  contextCalendar: 10,
  standings: 8,
  odds: 7,
  h2h: 3,
  weatherPitch: 2
});

export const CRITICAL_MODULES = Object.freeze([
  "injuriesSuspensions",
  "lineups",
  "statsForm",
  "xgXga"
]);

export const MODULE_LABELS = Object.freeze({
  injuriesSuspensions: "Lesiones / sanciones",
  lineups: "Alineaciones",
  statsForm: "Estadísticas / forma",
  xgXga: "xG / xGA",
  contextCalendar: "Contexto / calendario",
  standings: "Clasificación",
  odds: "Cuotas",
  h2h: "Head to head",
  weatherPitch: "Clima / cancha"
});
