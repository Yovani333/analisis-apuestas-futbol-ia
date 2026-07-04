export const TOOLTIP_DEFINITIONS = Object.freeze({
  xg: {
    title: "xG",
    meaning: "Goles esperados: estima la calidad de las ocasiones creadas.",
    use: "Ayuda a comparar producción ofensiva más allá del marcador.",
    interpretation: "Un valor mayor sugiere ocasiones de mejor calidad.",
    warning: "En esta app puede ser una estimación interna, no xG oficial."
  },
  xga: {
    title: "xGA",
    meaning: "Goles esperados en contra: estima la calidad de las ocasiones concedidas.",
    use: "Sirve para evaluar la resistencia defensiva.",
    interpretation: "Un valor menor suele indicar mejor control defensivo.",
    warning: "Debe revisarse junto con muestra, rival y contexto."
  },
  ev: {
    title: "EV",
    meaning: "Valor esperado: diferencia entre la probabilidad estimada y lo exigido por la cuota.",
    use: "Permite detectar si una cuota podría ofrecer valor matemático.",
    interpretation: "EV positivo no garantiza que el pick sea acertado.",
    warning: "Nunca debe decidir por sí solo la apuesta."
  },
  implied_probability: {
    title: "Probabilidad implícita",
    meaning: "Probabilidad aproximada que representa una cuota decimal.",
    use: "Permite comparar el precio de la casa con el modelo.",
    interpretation: "Cuota más baja equivale a mayor probabilidad implícita.",
    warning: "Puede incluir margen de la casa."
  },
  model_probability: {
    title: "Probabilidad del modelo",
    meaning: "Estimación calculada con los datos disponibles del partido.",
    use: "Se compara contra la probabilidad implícita para calcular EV.",
    interpretation: "Debe leerse junto con confianza y datos faltantes.",
    warning: "Es una estimación, no una certeza."
  },
  poisson: {
    title: "Poisson",
    meaning: "Modelo estadístico que estima probabilidades de goles y marcadores.",
    use: "Apoya mercados de goles, BTTS y resultados probables.",
    interpretation: "Su calidad depende de las tasas de gol usadas como entrada.",
    warning: "No captura por sí solo tácticas, lesiones o cambios de alineación."
  },
  asian_handicap: {
    title: "Hándicap asiático",
    meaning: "Mercado que aplica una ventaja o desventaja virtual al marcador.",
    use: "Reduce o modifica el riesgo frente al mercado 1X2.",
    interpretation: "Líneas enteras, medias y cuartos se liquidan de forma distinta.",
    warning: "Verifica siempre la línea y reglas del operador."
  },
  over_under: {
    title: "Over / Under",
    meaning: "Apuesta a que un total termine por encima o debajo de una línea.",
    use: "Se aplica a goles, corners y otras estadísticas.",
    interpretation: "La línea 2.5 evita empate: 3+ es Over y 0-2 es Under.",
    warning: "Requiere contexto y datos suficientes."
  },
  btts: {
    title: "BTTS",
    meaning: "Both Teams To Score: ambos equipos anotan.",
    use: "Evalúa la posibilidad de que cada equipo marque al menos un gol.",
    interpretation: "Cruza ataque de ambos equipos con sus defensas.",
    warning: "No debe depender únicamente de promedios goleadores."
  },
  double_chance: {
    title: "Doble oportunidad",
    meaning: "Cubre dos resultados del 1X2: 1X, X2 o 12.",
    use: "Reduce riesgo a cambio de una cuota normalmente menor.",
    interpretation: "1X cubre local o empate; X2 cubre empate o visitante.",
    warning: "Una cuota baja no implica valor positivo."
  },
  corners: {
    title: "Corners",
    meaning: "Mercados relacionados con tiros de esquina.",
    use: "Se analizan con volumen ofensivo, tiros, posesión y muestra histórica.",
    interpretation: "Puede evaluarse total o rendimiento por equipo.",
    warning: "Es sensible al estado del partido y al estilo del rival."
  },
  confidence: {
    title: "Confianza",
    meaning: "Puntaje que resume calidad, muestra, coherencia y datos disponibles.",
    use: "Indica cuánto respaldo tiene una estimación o pick.",
    interpretation: "Mayor confianza significa mejor soporte, no garantía de acierto.",
    warning: "Revisa siempre los datos faltantes."
  },
  risk: {
    title: "Nivel de riesgo",
    meaning: "Clasificación de incertidumbre y posibles contradicciones del pick.",
    use: "Ayuda a separar opciones conservadoras de selecciones agresivas.",
    interpretation: "Riesgo alto exige cautela aunque el EV sea positivo.",
    warning: "No sustituye una gestión responsable."
  },
  odds: {
    title: "Cuotas",
    meaning: "Precio ofrecido por la casa para una selección.",
    use: "Determina el pago potencial y la probabilidad implícita.",
    interpretation: "Cuota baja suele implicar menor pago y mayor favoritismo del mercado.",
    warning: "No indica automáticamente una buena apuesta."
  },
  picks: {
    title: "Picks",
    meaning: "Selecciones candidatas evaluadas por los módulos del sistema.",
    use: "Organizan mercado, cuota, confianza, EV y riesgos.",
    interpretation: "Solo los picks respaldados deben considerarse accionables.",
    warning: "Son información analítica, no resultados garantizados."
  },
  parlays: {
    title: "Parlays",
    meaning: "Combinación de varias selecciones en una sola apuesta.",
    use: "Multiplica cuotas, pero exige acertar todas las selecciones activas.",
    interpretation: "Más selecciones normalmente aumentan el riesgo total.",
    warning: "Evita confundir pago potencial alto con probabilidad alta."
  },
  pick_origin: {
    title: "Origen del pick",
    meaning: "Módulo que generó o guardó la selección.",
    use: "Permite distinguir Cuotas, Poisson, Corners y otros motores.",
    interpretation: "El origen ayuda a saber qué método respalda el pick.",
    warning: "Dos módulos derivados no siempre son confirmaciones independientes."
  }
});

export const TOOLTIP_LABEL_KEYS = Object.freeze({
  "xg": "xg", "xg estimado": "xg", "xg / xga": "xg", "xga": "xga", "xga estimado": "xga", "ev": "ev",
  "implícita": "implied_probability", "prob. implícita": "implied_probability", "probabilidad implícita": "implied_probability",
  "modelo": "model_probability", "prob. modelo": "model_probability", "probabilidad del modelo": "model_probability",
  "poisson": "poisson", "modelo poisson": "poisson", "hándicap asiático": "asian_handicap",
  "over / under": "over_under", "total de goles 2.5": "over_under", "btts": "btts", "ambos anotan": "btts",
  "doble oportunidad": "double_chance", "corners": "corners", "confianza": "confidence",
  "nivel de riesgo": "risk", "riesgo": "risk", "cuota": "odds", "cuotas": "odds",
  "picks": "picks", "picks basados en datos": "picks", "parlays": "parlays", "origen": "pick_origin"
});

export function tooltipKeyForLabel(label = "") {
  return TOOLTIP_LABEL_KEYS[String(label).trim().toLocaleLowerCase("es-MX")] || null;
}
