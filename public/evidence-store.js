export const EVIDENCE_SNAPSHOTS_KEY = "football-ai.evidence-snapshots.v1";
const MAX_SNAPSHOTS = 50;

function read(storage) {
  try {
    const value = JSON.parse(storage?.getItem(EVIDENCE_SNAPSHOTS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function loadEvidenceSnapshots(storage = globalThis.localStorage) {
  return read(storage);
}

export function latestEvidenceForFixture(snapshots, fixtureId) {
  return snapshots.filter((item) => String(item.fixture?.id) === String(fixtureId))
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] || null;
}

export function createEvidenceSnapshot({ fixture, dataPicks, poisson, teamGoals, corners }, now = new Date()) {
  if (!fixture?.id) throw new TypeError("La evidencia requiere fixtureId.");
  if (fixture.status !== "scheduled") throw new TypeError("Solo se permite guardar evidencia antes del inicio.");
  return structuredClone({
    version: 1,
    id: `${fixture.id}:${now.getTime()}`,
    capturedAt: now.toISOString(),
    timezone: "America/Tijuana",
    fixture: {
      id: fixture.id, date: fixture.date, time: fixture.time, utcDateTime: fixture.utcDateTime || null,
      status: fixture.status, statusLabel: fixture.statusLabel, leagueName: fixture.leagueName,
      leagueSlug: fixture.leagueSlug, home: fixture.home, away: fixture.away,
      homeTeamId: fixture.homeTeamId ?? null, awayTeamId: fixture.awayTeamId ?? null,
      favorite: fixture.favorite || null, neutralVenue: Boolean(fixture.neutralVenue)
    },
    dataQuality: fixture.dataQuality || null,
    preMatch: fixture.preMatch || null,
    marketAnalysis: fixture.marketAnalysis || [],
    researchData: fixture.researchData || null,
    modules: {
      dataPicks: dataPicks || { status: "not_available", picks: [] },
      poisson: poisson || { status: "not_available", suggestedMarkets: [] },
      teamGoals: teamGoals || { status: "not_available", picks: [] },
      corners: corners || { status: "not_available", picks: [] }
    },
    currentFixtureStatisticsUsed: false,
    openAiUsed: false
  });
}

export function saveEvidenceSnapshot(snapshot, storage = globalThis.localStorage) {
  const snapshots = [snapshot, ...read(storage).filter((item) => item.id !== snapshot.id)].slice(0, MAX_SNAPSHOTS);
  storage?.setItem(EVIDENCE_SNAPSHOTS_KEY, JSON.stringify(snapshots));
  return snapshots;
}
