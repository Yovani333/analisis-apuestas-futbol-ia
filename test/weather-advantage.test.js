import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWeatherAdvantage } from "../server/services/weather-advantage.service.js";

const records = (possession, shots, shotsOnGoal) => Array.from({ length: 3 }, () => ({
  cornerStats: { possession, totalShots: shots, shotsOnGoal }
}));

test("no atribuye ventaja con clima normal", () => {
  const result = evaluateWeatherAdvantage({
    fixture: { home: "Local", away: "Visitante" },
    weather: { rainProbability: 10, precipitation: 0, windSpeed: 12, temperature: 22, humidity: 55 },
    historicalEstimatedXg: {
      homeTeam: { fixturesUsed: records(48, 12, 4) },
      awayTeam: { fixturesUsed: records(52, 11, 4) }
    }
  });
  assert.equal(result.favoredSide, null);
  assert.equal(result.label, "Sin ventaja verificable");
});

test("detecta posible ventaja de juego directo bajo lluvia o viento", () => {
  const result = evaluateWeatherAdvantage({
    fixture: { home: "Equipo Directo", away: "Equipo de Posesión" },
    weather: { rainProbability: 75, precipitation: 1.5, windSpeed: 27, temperature: 18, humidity: 88 },
    historicalEstimatedXg: {
      homeTeam: { fixturesUsed: records(42, 14, 5) },
      awayTeam: { fixturesUsed: records(60, 12, 4) }
    }
  });
  assert.equal(result.favoredSide, "home");
  assert.equal(result.favoredTeam, "Equipo Directo");
  assert.equal(result.confidence, "low");
  assert.match(result.reason, /señal táctica secundaria/i);
});

test("no inventa ventaja con muestra insuficiente o solo calor", () => {
  const insufficient = evaluateWeatherAdvantage({
    fixture: { home: "A", away: "B" },
    weather: { rainProbability: 80, precipitation: 2 },
    historicalEstimatedXg: {
      homeTeam: { fixturesUsed: records(45, 13, 4).slice(0, 2) },
      awayTeam: { fixturesUsed: records(55, 10, 3) }
    }
  });
  assert.equal(insufficient.favoredSide, null);

  const heat = evaluateWeatherAdvantage({
    fixture: { home: "A", away: "B" },
    weather: { temperature: 36, humidity: 40 },
    historicalEstimatedXg: {
      homeTeam: { fixturesUsed: records(45, 13, 4) },
      awayTeam: { fixturesUsed: records(55, 10, 3) }
    }
  });
  assert.equal(heat.favoredSide, null);
  assert.match(heat.reason, /aclimatación/i);
});

