export const PICK_ORIGINS = Object.freeze({
  data_picks: { label: "Picks basados en datos", module: "Motor Picks basados en datos", status: "active" },
  odds: { label: "Cuotas", module: "Datos de mercado / Cuotas", status: "active" },
  odds_rule_engine: { label: "Análisis con datos", module: "Motor de Reglas", status: "active" },
  poisson: { label: "Modelo Poisson", module: "Modelo Poisson", status: "active" },
  corners: { label: "Corners", module: "Modelo de Corners", status: "active" },
  team_goal_probability: { label: "Probabilidad de gol", module: "Probabilidad de Gol por Equipo", status: "active" },
  manual: { label: "Manual", module: "Captura manual", status: "reserved" },
  manual_picks: { label: "Manual", module: "Captura manual", status: "legacy_alias" },
  "Picks basados en datos": { label: "Picks basados en datos", module: "Motor Picks basados en datos", status: "legacy_alias" }
});

export function pickOriginLabel(origin = "odds") {
  return PICK_ORIGINS[origin]?.label || "Otro módulo";
}

export function pickOriginDefinition(origin = "odds") {
  return PICK_ORIGINS[origin] || { label: "Otro módulo", module: "Origen no reconocido", status: "unknown" };
}
