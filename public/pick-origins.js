export const PICK_ORIGINS = Object.freeze({
  data_picks: { label: "Motor de Decisión", module: "Guía de análisis / Motor de Decisión", status: "active" },
  odds: { label: "Cuotas", module: "Datos de mercado / Cuotas", status: "active" },
  odds_rule_engine: { label: "Evaluación predictiva", module: "Dashboard / Evaluación predictiva", status: "active" },
  outcome_1x2: { label: "Selector obligatorio 1X2", module: "Selector obligatorio 1X2", status: "active" },
  h2h: { label: "Head to head", module: "Transparencia de datos / Head to head", status: "active" },
  recent_form: { label: "Estadísticas / forma", module: "Transparencia de datos / Estadísticas / forma", status: "active" },
  xg_btts: { label: "xG / xGA", module: "Transparencia de datos / xG / xGA", status: "active" },
  "xG / xGA": { label: "xG / xGA", module: "Transparencia de datos / xG / xGA", status: "legacy_alias" },
  poisson: { label: "Motor Poisson", module: "Guía de análisis / Motor Poisson", status: "active" },
  corners: { label: "Corners", module: "Modelo de Corners", status: "active" },
  yellow_cards: { label: "Tarjetas amarillas", module: "Dashboard / Tarjetas amarillas", status: "active" },
  goal_half_projection: { label: "Gol por mitad", module: "Dashboard / Gol por mitad", status: "active" },
  team_goal_probability: { label: "Ataque vs Defensa", module: "Guía de análisis / Ataque vs Defensa", status: "active" },
  team_goals: { label: "Ataque vs Defensa", module: "Guía de análisis / Ataque vs Defensa", status: "internal_alias" },
  specific_markets: { label: "Catálogo de mercados", module: "Catálogo de mercados", status: "active" },
  pick_analysis_snapshot: { label: "Picks recomendados", module: "Picks recomendados", status: "active" },
  best_bets_selector: { label: "Mejores apuestas", module: "Dashboard / Mejores apuestas", status: "active" },
  team_average_performance: { label: "Rendimiento promedio por equipo", module: "Rendimiento promedio por equipo", status: "active" },
  player_goal_candidate: { label: "Jugador con posible gol", module: "Jugador con posible gol", status: "active" },
  manual: { label: "Manual", module: "Captura manual", status: "reserved" },
  manual_picks: { label: "Manual", module: "Captura manual", status: "legacy_alias" },
  "Picks basados en datos": { label: "Picks basados en datos", module: "Motor Picks basados en datos", status: "legacy_alias" }
});

const cleanPart = (value) => String(value || "").trim();
const uniqueParts = (values) => values.map(cleanPart).filter((value, index, rows) => value && rows.indexOf(value) === index);

function inferredSnapshotSection(pick = {}) {
  if (pick.originModule && pick.originModule !== "pick_analysis_snapshot") return PICK_ORIGINS[pick.originModule]?.label || cleanPart(pick.originModule);
  if (pick.source && !/^(api-football|sistema|modelo interno)$/i.test(cleanPart(pick.source))) return cleanPart(pick.source);
  const models = Array.isArray(pick.backingModels) ? pick.backingModels.filter(Boolean) : [];
  return models.length ? models.join(" + ") : "";
}

export function pickOriginPath(pickOrOrigin = "odds") {
  if (!pickOrOrigin || typeof pickOrOrigin !== "object") return PICK_ORIGINS[pickOrOrigin]?.label || "Otro módulo";
  const pick = pickOrOrigin;
  const origin = pick.sourceModule || pick.origin || "odds";
  const menu = cleanPart(pick.originMenu);
  const section = cleanPart(pick.originSection);
  const category = cleanPart(pick.originCategory);
  const subcategory = cleanPart(pick.originSubcategory);
  if (menu || section || category || subcategory) return uniqueParts([menu, section, category, subcategory]).join(" → ");
  if (origin === "pick_analysis_snapshot") {
    return uniqueParts(["Picks recomendados", inferredSnapshotSection(pick)]).join(" → ");
  }
  return PICK_ORIGINS[origin]?.label || "Otro módulo";
}

export function pickOriginKey(pickOrOrigin = "odds") {
  if (!pickOrOrigin || typeof pickOrOrigin !== "object") return String(pickOrOrigin || "odds");
  const pick = pickOrOrigin;
  return uniqueParts([
    pick.sourceModule || pick.origin || "odds",
    pick.originMenu,
    pick.originSection,
    pick.originCategory,
    pick.originSubcategory,
    pick.originModule
  ]).join("::");
}

export function pickOriginLabel(origin = "odds") {
  return pickOriginPath(origin);
}

export function pickOriginDefinition(origin = "odds") {
  return PICK_ORIGINS[origin] || { label: "Otro módulo", module: "Origen no reconocido", status: "unknown" };
}
