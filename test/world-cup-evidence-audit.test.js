import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidencePick, parseEvidenceText, runWorldCupEvidenceAudit, WORLD_CUP_PILOT_AUDIT_LABEL } from "../server/services/audit/world-cup-evidence-audit.service.js";

const sampleEvidence = `EVIDENCIA PREPARTIDO AUDITABLE
Partido: Mexico vs England
Liga: Copa Mundial FIFA (ID 1)
País: Mundial
Temporada: 2026
Fecha del partido: 2026-07-05T17:00:00.000Z
Generada: 2026-07-05T16:00:00.000Z
Fixture ID: 1570714
Home team ID: 16
Away team ID: 10

PICKS CLASIFICADOS
Motor de picks: picks-data-engine-v3

1. Total de goles 2.5 - Más de 2.5 goles
Decisión: PRECAUCIÓN
Cuota: 2.35 | Bookmaker: 10Bet | Fuente: api-football
Modelo: 70.6% | Implícita: 42.6% | EV: 65.9% | EV conservador: 12.1%
Confianza: 63/100 | Estadística: 63/100 | Futbolística: 62/100 | Riesgo: 45/100
Soporte Poisson: 100 | Soporte Gol por Equipo: 0 | Contradicción: low
Origen: Picks basados en datos | Motivo: Señal ofensiva positiva. | Timestamp: 2026-07-05T16:00:00.000Z

2. Doble oportunidad - England o empate (X2)
Decisión: PRECAUCIÓN
Cuota: 1.42 | Bookmaker: 10Bet | Fuente: api-football
Modelo: 71.4% | Implícita: 70.4% | EV: 1.4% | EV conservador: -3%
Confianza: 65/100 | Estadística: 65/100 | Futbolística: 65/100 | Riesgo: 35/100
Soporte Poisson: 100 | Soporte Gol por Equipo: 0 | Contradicción: low
Origen: Picks basados en datos | Motivo: Pick conservador. | Timestamp: 2026-07-05T16:00:00.000Z

3. Resultado 1X2 - Mexico gana
Decisión: EVITAR
Cuota: 2.75 | Bookmaker: 10Bet | Fuente: api-football
Modelo: 28.6% | Implícita: 36.4% | EV: -21.3% | EV conservador: -30%
Confianza: 45/100 | Estadística: 45/100 | Futbolística: 45/100 | Riesgo: 70/100
Soporte Poisson: 20 | Soporte Gol por Equipo: 0 | Contradicción: medium
Origen: Picks basados en datos | Motivo: La probabilidad implícita supera al modelo. | Timestamp: 2026-07-05T16:00:00.000Z
`;

test("extrae picks de evidencia y separa recomendados de descartes", () => {
  const evidence = parseEvidenceText(sampleEvidence, "mexico.txt");
  assert.equal(evidence.fixtureId, "1570714");
  assert.equal(evidence.picks.length, 3);
  assert.equal(evidence.picks[0].decisionGroup, "recommended");
  assert.equal(evidence.picks[2].decisionGroup, "discarded");
  assert.equal(evidence.picks[0].selectionKey, "over_2_5");
  assert.equal(evidence.picks[1].selectionKey, "X2");
});

test("evalúa PRECAUCIÓN contra 90 minutos y no cuenta EVITAR como fallo", () => {
  const evidence = parseEvidenceText(sampleEvidence, "mexico.txt");
  const result = { finished90: true, homeGoals: 2, awayGoals: 3, extraTime: false, penalties: false, advancedTeam: "England" };
  assert.equal(evaluateEvidencePick(evidence.picks[0], evidence, result).status, "acertado");
  assert.equal(evaluateEvidencePick(evidence.picks[1], evidence, result).status, "acertado");
  assert.equal(evaluateEvidencePick(evidence.picks[2], evidence, result).status, "descartado");
});

test("usa penales solo para mercados de clasificación", () => {
  const evidence = parseEvidenceText(sampleEvidence.replace("Mexico vs England", "Switzerland vs Colombia"), "swiss.txt");
  const advancePick = { market: "Clasifica", selection: "Switzerland avanza", decision: "PRECAUCIÓN", decisionGroup: "recommended", selectionKey: "advance" };
  const result = { finished90: true, homeGoals: 0, awayGoals: 0, extraTime: true, penalties: true, advancedTeam: "Switzerland" };
  assert.equal(evaluateEvidencePick(evidence.picks[1], evidence, result).status, "acertado");
  assert.equal(evaluateEvidencePick(advancePick, evidence, result).status, "acertado");
});

test("resume la auditoría piloto sin recalibrar pesos", () => {
  const evidence = parseEvidenceText(sampleEvidence, "mexico.txt");
  const audit = runWorldCupEvidenceAudit([evidence], {
    "1570714": { finished90: true, homeGoals: 2, awayGoals: 3, advancedTeam: "England" }
  });
  assert.equal(audit.label, WORLD_CUP_PILOT_AUDIT_LABEL);
  assert.equal(audit.totals.evidenceCount, 1);
  assert.equal(audit.totals.recommendedEvaluated, 2);
  assert.equal(audit.totals.hits, 2);
  assert.equal(audit.totals.discarded, 1);
  assert.match(audit.warning, /no recalibrar/i);
});
