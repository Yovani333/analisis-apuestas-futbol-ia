import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlayerGoalCandidates, calculateGoalThreatScore, calculateIndividualFormScore, clearPlayerGoalCandidatesCache,
  getPlayerGoalCandidates, normalizeTeamPlayerHistory, selectPlayerHistoryFixtures
} from "../server/services/player-goal-candidates.service.js";

const match = { id: 100, home: "England", away: "Norway", homeTeamId: 1, awayTeamId: 2, utcDateTime: "2026-07-10T20:00:00Z" };
const fixture = (id, date, status = "FT") => ({ fixture: { id, date, status: { short: status } } });
const lineup = (teamId, players = []) => [{ team: { id: teamId }, startXI: players.map((player) => ({ player: { id: player.id, name: player.name, pos: player.pos || "F" } })), substitutes: [] }];
const playerResponse = (teamId, players) => [{ team: { id: teamId }, players: players.map((item) => ({
  player: { id: item.id, name: item.name }, statistics: [{ games: { minutes: item.minutes, position: item.position || "F" }, goals: { total: item.goals || 0, assists: item.assists || 0, expected: item.xg }, shots: { total: item.shots ?? 3, on: item.on ?? 2 }, penalty: { scored: item.penalties || 0, missed: 0 }, cards: { red: item.red || 0 } }]
})) }];
const historyRows = (teamId, playerSets) => playerSets.map((players) => ({ players: playerResponse(teamId, players), lineups: lineup(teamId, players), events: [] }));
const attacker = (id, name, overrides = {}) => ({ id, name, minutes: 80, shots: 4, on: 2, goals: 1, ...overrides });

test("filtra solo los cinco partidos finalizados anteriores", () => {
  const rows = [fixture(1, "2026-07-09T10:00:00Z", "NS"), fixture(2, "2026-07-08T10:00:00Z"), fixture(3, "2026-07-11T10:00:00Z"), ...Array.from({ length: 6 }, (_, index) => fixture(index + 4, `2026-07-0${7 - index}T10:00:00Z`))];
  const selected = selectPlayerHistoryFixtures(rows, match.utcDateTime);
  assert.equal(selected.length, 5);
  assert.ok(selected.every((row) => row.fixture.status.short === "FT"));
});

test("normaliza strings y calcula amenaza sin NaN", () => {
  const players = normalizeTeamPlayerHistory({ teamId: 1, teamName: "England", fixtureRows: historyRows(1, [[attacker(9, "Kane", { minutes: "90", shots: "4", on: "2", xg: "0.42" })]]), teamContext: { lambda: "1.8" } });
  assert.equal(players[0].minutesLast5, 90);
  assert.equal(players[0].matchesEvaluated, 1);
  assert.equal(players[0].xgLast5, 0.42);
  assert.ok(players[0].conservativeGoalProbability > 0);
  assert.ok(Number.isFinite(calculateGoalThreatScore(players[0], { goalProbability: "65%" })));
  assert.ok(Number.isFinite(calculateIndividualFormScore(players[0])));
  assert.ok(players[0].individualFormScore > 0);
});

test("genera máximo tres candidatos ordenados y permite ambos equipos", () => {
  const homeRows = historyRows(1, Array.from({ length: 5 }, () => [attacker(9, "Kane"), attacker(10, "Saka", { shots: 3, on: 1, goals: 0 })]));
  const awayRows = historyRows(2, Array.from({ length: 5 }, () => [attacker(20, "Haaland", { shots: 5, on: 3 }), attacker(21, "Wing", { shots: 2, on: 1, goals: 0 })]));
  const home = normalizeTeamPlayerHistory({ teamId: 1, teamName: "England", fixtureRows: homeRows, teamContext: { lambda: 1.6 } });
  const away = normalizeTeamPlayerHistory({ teamId: 2, teamName: "Norway", fixtureRows: awayRows, teamContext: { lambda: 1.8 } });
  const result = buildPlayerGoalCandidates(match, home, away, { "1": { lambda: 1.6 }, "2": { lambda: 1.8 } });
  assert.equal(result.candidates.length, 3);
  assert.ok(result.candidates.some((row) => row.teamName === "England"));
  assert.ok(result.candidates.some((row) => row.teamName === "Norway"));
  assert.ok(result.candidates.every((row, index, rows) => index === 0 || rows[index - 1].goalThreatScore >= row.goalThreatScore));
});

test("excluye porteros, lesionados y jugadores con pocos minutos", () => {
  const rows = historyRows(1, Array.from({ length: 3 }, () => [attacker(1, "Keeper", { position: "G" }), attacker(2, "Injured"), attacker(3, "Brief", { minutes: 20 })]));
  const players = normalizeTeamPlayerHistory({ teamId: 1, teamName: "England", fixtureRows: rows, injuries: [{ team: { id: 1 }, player: { id: 2, name: "Injured" } }], teamContext: { lambda: 1.8 } });
  const result = buildPlayerGoalCandidates(match, players, [], { "1": { lambda: 1.8 } });
  assert.equal(result.candidates.length, 0);
});

test("alineaciones ausentes no rompen el cálculo si hay minutos y apariciones", () => {
  const rows = historyRows(1, Array.from({ length: 4 }, () => [attacker(9, "Kane")])).map((row) => ({ ...row, lineups: [] }));
  const players = normalizeTeamPlayerHistory({ teamId: 1, teamName: "England", fixtureRows: rows, teamContext: { lambda: 1.8 } });
  assert.equal(buildPlayerGoalCandidates(match, players, [], { "1": { lambda: 1.8 } }).candidates[0].playerName, "Kane");
});

test("una cuota ausente conserva el pick pendiente sin romperlo", () => {
  const rows = historyRows(1, Array.from({ length: 5 }, () => [attacker(9, "Kane")]));
  const players = normalizeTeamPlayerHistory({ teamId: 1, teamName: "England", fixtureRows: rows, teamContext: { lambda: 1.8 }, odds: [] });
  const candidate = buildPlayerGoalCandidates(match, players, [], { "1": { lambda: 1.8 } }).candidates[0];
  assert.equal(candidate.odds, null);
  assert.equal(candidate.canAdd, true);
  assert.equal(candidate.sampleQuality, "Aceptable");
  assert.equal(candidate.stats.matchesEvaluated, 5);
  assert.ok(candidate.conservativeGoalProbability > 0);
});

test("muestra calidad de muestra sin inferir ausencia como lesion", () => {
  const rows = historyRows(1, [
    [attacker(9, "Kane", { minutes: 90 })],
    [attacker(9, "Kane", { minutes: 80 })],
    [attacker(9, "Kane", { minutes: 75 })],
    [attacker(10, "Saka", { minutes: 90 })],
    [attacker(10, "Saka", { minutes: 90 })]
  ]);
  const players = normalizeTeamPlayerHistory({ teamId: 1, teamName: "England", fixtureRows: rows, teamContext: { lambda: 1.8 } });
  const kane = players.find((player) => player.playerName === "Kane");
  assert.equal(kane.appearancesLast5, 3);
  assert.equal(kane.matchesEvaluated, 5);
  assert.equal(kane.isInjuredOrSuspended, false);
  assert.equal(kane.sampleQuality, "Media");
  assert.match(kane.warnings.join(" "), /Muestra media/);
});

test("devuelve estado controlado cuando API-Football no cubre jugadores", async () => {
  clearPlayerGoalCandidatesCache();
  const result = await getPlayerGoalCandidates({ fixture: match, confirmed: {} }, {
    getPreviousFixtures: async (teamId) => [fixture(teamId * 10, "2026-07-01T10:00:00Z")],
    getFixturePlayers: async () => [], getFixtureLineups: async () => [], getFixtureEvents: async () => []
  });
  assert.equal(result.status, "no_player_coverage");
  assert.match(result.message, /cobertura suficiente/);
});
