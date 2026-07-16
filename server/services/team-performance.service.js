const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_WINDOW = 5;
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

const resultCache = new Map();
const pendingRequests = new Map();

function numberOrZero(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function hasNumericValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0;
}

function fixtureTimestamp(row) {
  const value = Date.parse(row?.fixture?.date || "");
  return Number.isFinite(value) ? value : 0;
}

export function selectPreviousCompleteFixtures(rows = [], currentMatchDate, limit = 10) {
  const cutoff = Date.parse(currentMatchDate || "");
  return rows
    .filter((row) => FINISHED_STATUSES.has(row?.fixture?.status?.short))
    .filter((row) => !Number.isFinite(cutoff) || fixtureTimestamp(row) < cutoff)
    .sort((a, b) => fixtureTimestamp(b) - fixtureTimestamp(a))
    .slice(0, limit);
}

function findTeamPlayers(response = [], teamId) {
  const team = response.find((row) => String(row?.team?.id) === String(teamId));
  return Array.isArray(team?.players) ? team.players : [];
}

function playerMatchMetrics(playerRow) {
  const stats = playerRow?.statistics?.[0] || {};
  const minutes = numberOrZero(stats.games?.minutes);
  if (minutes < 1) return null;
  return {
    playerId: String(playerRow?.player?.id || playerRow?.player?.name || ""),
    entradas: numberOrZero(stats.tackles?.total),
    tarjetas: numberOrZero(stats.cards?.yellow) + (numberOrZero(stats.cards?.red) * 2),
    tiros: numberOrZero(stats.shots?.total),
    pases_acertados: numberOrZero(stats.passes?.accuracy),
    faltas: numberOrZero(stats.fouls?.committed),
    metricAvailability: {
      entradas: hasNumericValue(stats.tackles?.total),
      tarjetas: hasNumericValue(stats.cards?.yellow) || hasNumericValue(stats.cards?.red),
      tiros: hasNumericValue(stats.shots?.total),
      pases_acertados: hasNumericValue(stats.passes?.accuracy),
      faltas: hasNumericValue(stats.fouls?.committed)
    }
  };
}

export function calculateTeamPerformance({ teamId, teamName, fixturePlayerRows = [], k }) {
  const totalsByPlayer = new Map();
  const observedMetrics = { entradas: 0, tarjetas: 0, tiros: 0, pases_acertados: 0, faltas: 0 };
  for (const response of fixturePlayerRows.slice(0, k)) {
    for (const playerRow of findTeamPlayers(response, teamId)) {
      const metrics = playerMatchMetrics(playerRow);
      if (!metrics?.playerId) continue;
      const current = totalsByPlayer.get(metrics.playerId) || {
        entradas: 0, tarjetas: 0, tiros: 0, pases_acertados: 0, faltas: 0
      };
      for (const key of Object.keys(current)) current[key] += metrics[key];
      for (const key of Object.keys(observedMetrics)) {
        if (metrics.metricAvailability[key]) observedMetrics[key] += 1;
      }
      totalsByPlayer.set(metrics.playerId, current);
    }
  }

  const playerCount = totalsByPlayer.size;
  const metricas = { entradas: 0, tarjetas: 0, tiros: 0, pases_acertados: 0, faltas: 0 };
  if (k > 0 && playerCount > 0) {
    for (const playerTotals of totalsByPlayer.values()) {
      for (const key of Object.keys(metricas)) metricas[key] += playerTotals[key] / k;
    }
    for (const key of Object.keys(metricas)) metricas[key] = Number((metricas[key] / playerCount).toFixed(2));
  }
  return {
    nombre: teamName,
    jugadores: playerCount,
    metricas,
    metricCoverage: Object.fromEntries(Object.entries(observedMetrics).map(([key, count]) => [key, count > 0]))
  };
}

function notAvailable(fixture, reason) {
  return {
    status: "not_available",
    k: 0,
    equipo_local: { nombre: fixture.home, jugadores: 0, metricas: null },
    equipo_visitante: { nombre: fixture.away, jugadores: 0, metricas: null },
    message: reason || "No hay suficientes partidos previos con estadisticas individuales completas.",
    source: "api-football",
    updatedAt: new Date().toISOString()
  };
}

async function loadCompleteWindows(fixture, { getPreviousFixtures, getFixturePlayers }) {
  const [homeRows, awayRows] = await Promise.all([
    getPreviousFixtures(fixture.homeTeamId, 10),
    getPreviousFixtures(fixture.awayTeamId, 10)
  ]);
  const homeFixtures = selectPreviousCompleteFixtures(homeRows, fixture.utcDateTime, 10);
  const awayFixtures = selectPreviousCompleteFixtures(awayRows, fixture.utcDateTime, 10);
  const loadTeamWindow = async (rows, teamId) => {
    const loaded = await Promise.all(rows.map(async (row) => {
      try {
        const players = await getFixturePlayers(row.fixture.id);
        return findTeamPlayers(players, teamId).some((player) => numberOrZero(player?.statistics?.[0]?.games?.minutes) > 0)
          ? { fixture: row, players } : null;
      } catch {
        return null;
      }
    }));
    return loaded.filter(Boolean).slice(0, MAX_WINDOW);
  };
  return Promise.all([
    loadTeamWindow(homeFixtures, fixture.homeTeamId),
    loadTeamWindow(awayFixtures, fixture.awayTeamId)
  ]);
}

export async function getTeamPerformanceForFixture(fixture, dependencies, {
  forceRefresh = false,
  now = Date.now()
} = {}) {
  const cacheKey = String(fixture?.id || "");
  if (!cacheKey || !fixture?.homeTeamId || !fixture?.awayTeamId) {
    return notAvailable(fixture || {}, "No fue posible identificar ambos equipos del encuentro.");
  }
  const cached = resultCache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > now) return { ...cached.value, cached: true };
  if (!forceRefresh && pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);

  const request = (async () => {
    const [homeWindow, awayWindow] = await loadCompleteWindows(fixture, dependencies);
    const k = Math.min(MAX_WINDOW, homeWindow.length, awayWindow.length);
    if (k === 0) return notAvailable(fixture);
    const homeSelected = homeWindow.slice(0, k);
    const awaySelected = awayWindow.slice(0, k);
    const value = {
      status: "available",
      k,
      equipo_local: calculateTeamPerformance({
        teamId: fixture.homeTeamId,
        teamName: fixture.home,
        fixturePlayerRows: homeSelected.map((item) => item.players),
        k
      }),
      equipo_visitante: calculateTeamPerformance({
        teamId: fixture.awayTeamId,
        teamName: fixture.away,
        fixturePlayerRows: awaySelected.map((item) => item.players),
        k
      }),
      fixturesUsedHome: homeSelected.map((item) => String(item.fixture.fixture.id)),
      fixturesUsedAway: awaySelected.map((item) => String(item.fixture.fixture.id)),
      source: "api-football",
      cached: false,
      updatedAt: new Date(now).toISOString()
    };
    resultCache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  })().finally(() => pendingRequests.delete(cacheKey));
  pendingRequests.set(cacheKey, request);
  return request;
}

export function clearTeamPerformanceCache(fixtureId = null) {
  if (fixtureId === null) resultCache.clear();
  else resultCache.delete(String(fixtureId));
}

export function buildTeamPerformancePromptContext(performance) {
  if (!performance || performance.k === 0 || performance.status !== "available") {
    return "CONTEXTO DE RENDIMIENTO PREVIO (ventana de k=0 partidos): No hay suficientes partidos previos con estadísticas individuales completas. No infieras valores faltantes.";
  }
  const home = performance.equipo_local;
  const away = performance.equipo_visitante;
  return `CONTEXTO DE RENDIMIENTO PREVIO (ventana de k=${performance.k} partidos):\n- Equipo Local (${home.nombre}): Entradas=${home.metricas.entradas}, Tarjetas=${home.metricas.tarjetas}, Tiros=${home.metricas.tiros}, Pases Acertados=${home.metricas.pases_acertados}%, Faltas=${home.metricas.faltas}.\n- Equipo Visitante (${away.nombre}): Entradas=${away.metricas.entradas}, Tarjetas=${away.metricas.tarjetas}, Tiros=${away.metricas.tiros}, Pases Acertados=${away.metricas.pases_acertados}%, Faltas=${away.metricas.faltas}.\nInstruccion para el motor de analisis: utiliza estos datos comparativos como indicadores de forma física, intensidad defensiva, disciplina táctica y capacidad de generación de juego para enriquecer tu análisis y predicción del partido actual.`;
}
