const MIN_SAMPLE = 3;

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function average(values) {
  const valid = values.filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function summarizeStyle(records = []) {
  const valid = records.map((record) => ({
    possession: numeric(record?.cornerStats?.possession),
    shots: numeric(record?.cornerStats?.totalShots),
    shotsOnGoal: numeric(record?.cornerStats?.shotsOnGoal)
  })).filter((record) => Object.values(record).every((value) => value !== null));
  if (valid.length < MIN_SAMPLE) return null;
  const possession = average(valid.map((record) => record.possession));
  const shots = average(valid.map((record) => record.shots));
  const shotsOnGoal = average(valid.map((record) => record.shotsOnGoal));
  return {
    sampleSize: valid.length,
    possession: Number(possession.toFixed(2)),
    shots: Number(shots.toFixed(2)),
    shotsOnGoal: Number(shotsOnGoal.toFixed(2)),
    directness: Number(((shots / Math.max(possession, 1)) * 100).toFixed(2))
  };
}

function neutralResult(reason, conditions = [], styles = {}) {
  return {
    favoredSide: null,
    favoredTeam: "",
    label: "Sin ventaja verificable",
    confidence: "not_available",
    reason,
    conditions,
    styles,
    analysisUse: "secondary_context_only"
  };
}

export function evaluateWeatherAdvantage({ fixture = {}, weather = {}, historicalEstimatedXg = {} } = {}) {
  const safeHistoricalEstimatedXg = historicalEstimatedXg || {};
  const rainProbability = numeric(weather.rainProbability);
  const precipitation = numeric(weather.precipitation);
  const windSpeed = numeric(weather.windSpeed);
  const temperature = numeric(weather.temperature);
  const humidity = numeric(weather.humidity);
  const conditions = [];
  if ((rainProbability ?? 0) >= 60 || (precipitation ?? 0) >= 1) conditions.push("lluvia relevante");
  if ((windSpeed ?? 0) >= 25) conditions.push("viento fuerte");
  if ((temperature ?? 0) >= 32) conditions.push("calor intenso");
  if (temperature !== null && temperature <= 5) conditions.push("frío intenso");
  if ((humidity ?? 0) >= 85) conditions.push("humedad alta");

  if (!conditions.length) {
    return neutralResult("El pronóstico no presenta una condición suficientemente adversa para diferenciar a los equipos.");
  }

  const homeStyle = summarizeStyle(safeHistoricalEstimatedXg.homeTeam?.fixturesUsed);
  const awayStyle = summarizeStyle(safeHistoricalEstimatedXg.awayTeam?.fixturesUsed);
  const styles = { home: homeStyle, away: awayStyle };
  if (!homeStyle || !awayStyle) {
    return neutralResult("Faltan al menos tres partidos comparables con posesión y tiros para ambos equipos.", conditions, styles);
  }

  const affectsBallMovement = conditions.includes("lluvia relevante") || conditions.includes("viento fuerte");
  if (!affectsBallMovement) {
    return neutralResult("No hay datos verificables de aclimatación física para atribuir ventaja por temperatura o humedad.", conditions, styles);
  }

  const compare = (candidate, opponent) => (
    candidate.directness >= opponent.directness * 1.12
    && candidate.shots >= opponent.shots - 1
    && candidate.shotsOnGoal >= opponent.shotsOnGoal - 0.25
  );
  const homeAdvantage = compare(homeStyle, awayStyle);
  const awayAdvantage = compare(awayStyle, homeStyle);
  if (homeAdvantage === awayAdvantage) {
    return neutralResult("Los perfiles históricos no muestran una diferencia suficiente de juego directo bajo clima adverso.", conditions, styles);
  }

  const favoredSide = homeAdvantage ? "home" : "away";
  const favoredTeam = favoredSide === "home" ? fixture.home : fixture.away;
  return {
    favoredSide,
    favoredTeam: favoredTeam || "",
    label: favoredTeam ? `Posible ventaja: ${favoredTeam}` : "Sin ventaja verificable",
    confidence: "low",
    reason: `${favoredTeam} muestra mayor producción de tiros por unidad de posesión y conserva tiros a puerta en la muestra reciente. Es una señal táctica secundaria, no una recomendación de apuesta.`,
    conditions,
    styles,
    analysisUse: "secondary_context_only"
  };
}
