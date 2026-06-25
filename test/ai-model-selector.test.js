import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompactAiMatchData,
  selectAiModelForMatch
} from "../server/services/ai-model-selector.service.js";
import { generateAnalysis } from "../server/services/openai.service.js";

function dataset(overrides = {}) {
  return {
    fixture: {
      id: "100", home: "Equipo Local", away: "Equipo Visitante",
      leagueName: "Liga de prueba", country: "Prueba", status: "scheduled",
      neutralVenue: false, stadium: "Estadio", favorite: { team: "Equipo Local", percent: 55 }
    },
    researchData: {
      totalConfidenceScore: 82, analysisStatus: "complete", criticalMissingData: [], missingData: [],
      league: { name: "Liga de prueba", country: "Prueba" },
      homeTeam: { name: "Equipo Local" }, awayTeam: { name: "Equipo Visitante" },
      odds: { markets: [] },
      xgXga: { status: "available", type: "historical_estimated", homeXG: 1.4, homeXGA: 1.1, awayXG: 1.2, awayXGA: 1.3 }
    },
    dataQuality: { score: 82, canSuggest: true },
    preMatch: {
      home: { team: "Equipo Local", played: 5, goalsFor: 8, goalsAgainst: 4, matches: [] },
      away: { team: "Equipo Visitante", played: 5, goalsFor: 6, goalsAgainst: 5, matches: [] }
    },
    marketAnalysis: [],
    pickRecommendation: {
      confidenceScore: 78, favoriteStrength: "medium", qualityGap: "medium",
      pickCategory: "pick_logico", highestEvPick: null,
      recommendedPick: { pickCategory: "pick_logico", confidenceScore: 78, valueScore: 62, contradictsFavorite: false }
    },
    qualityAlerts: [],
    ...overrides
  };
}

test("usa el modelo económico en un análisis normal y suficientemente completo", () => {
  const result = selectAiModelForMatch(dataset(), {
    defaultModel: "mini-test", premiumModel: "premium-test"
  });
  assert.equal(result.selectedModel, "mini-test");
  assert.match(result.modelReason, /análisis normal/i);
  assert.equal(result.costOptimizationApplied, true);
});

test("usa premium con confianza baja cuando no faltan datos críticos", () => {
  const input = dataset();
  input.pickRecommendation.confidenceScore = 54;
  const result = selectAiModelForMatch(input, {
    defaultModel: "mini-test", premiumModel: "premium-test"
  });
  assert.equal(result.selectedModel, "premium-test");
  assert.match(result.modelReason, /inferior a 60/i);
});

test("con datos críticos faltantes y sin modo premium conserva el modelo económico", () => {
  const input = dataset();
  input.researchData.criticalMissingData = [{ label: "Alineaciones" }];
  input.pickRecommendation.confidenceScore = 35;
  const result = selectAiModelForMatch(input, {
    defaultModel: "mini-test", premiumModel: "premium-test"
  });
  assert.equal(result.selectedModel, "mini-test");
  assert.match(result.modelReason, /marcarse para revisión/i);
});

test("reserva premium para Mundial, parlays importantes y value sospechoso", () => {
  const worldCup = dataset();
  worldCup.fixture.leagueName = "Copa Mundial FIFA";
  assert.equal(selectAiModelForMatch(worldCup).selectedModel, "gpt-5.4");

  const parlay = dataset({ analysisOptions: { isParlay: true, parlaySelections: [{}, {}, {}] } });
  assert.equal(selectAiModelForMatch(parlay).selectedModel, "gpt-5.4");

  const suspicious = dataset();
  suspicious.pickRecommendation.favoriteStrength = "strong";
  suspicious.pickRecommendation.highestEvPick = {
    valueScore: 92, contradictsFavorite: true, pickCategory: "value_sospechoso"
  };
  assert.equal(selectAiModelForMatch(suspicious).selectedModel, "gpt-5.4");
});

test("el payload compacto excluye respuestas crudas y conserva métricas necesarias", () => {
  const input = dataset({
    confirmed: { statistics: [{ huge: "raw-provider-payload" }] },
    unavailable: ["weather"]
  });
  const compact = buildCompactAiMatchData(input);
  const serialized = JSON.stringify(compact);
  assert.equal(compact.partido.home, "Equipo Local");
  assert.equal(compact.teams.home.averages.goalsFor, 1.6);
  assert.equal(compact.xgXga.homeXG, 1.4);
  assert.doesNotMatch(serialized, /raw-provider-payload/);
  assert.doesNotMatch(serialized, /"confirmed"/);
});

test("si falla el modelo económico realiza un único fallback premium", async () => {
  const models = [];
  const client = {
    responses: {
      parse: async ({ model }) => {
        models.push(model);
        if (model === "mini-test") throw new Error("fallo simulado");
        return {
          output_parsed: {
            estado_analisis: "Completo",
            datos_faltantes: [],
            analisis_cuantitativo: { xg_xga: "" },
            mercados_sugeridos: [],
            prediccion_prudente: { seleccion: "Sin pick", razonamiento: "", confianza: "Baja" },
            apto_para_parlay: { respuesta: "No", razonamiento: "" }
          }
        };
      }
    }
  };
  const logs = [];
  const result = await generateAnalysis(dataset(), {
    client,
    config: {
      openaiApiKey: "test",
      openaiModelDefault: "mini-test",
      openaiModelPremium: "premium-test",
      aiDebug: true
    },
    logger: {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args)
    }
  });
  assert.deepEqual(models, ["mini-test", "premium-test"]);
  assert.equal(result._debug.selectedModel, "premium-test");
  assert.equal(result._debug.fallbackApplied, true);
  assert.equal(logs.length, 2);
});
