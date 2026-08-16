const settledResult = (value) => {
  const result = String(value || "").toLowerCase();
  if (["won", "hit"].includes(result)) return "WON";
  if (["lost", "miss"].includes(result)) return "LOST";
  return null;
};

function compactHistoryRecord(pick = {}) {
  const result = settledResult(pick.result);
  if (!result) return null;
  return {
    fixtureId: pick.fixtureId ?? null,
    leagueId: pick.leagueId ?? pick.league_id ?? null,
    market: pick.market || null,
    marketKey: pick.marketKey || pick.marketCode || null,
    selectionKey: pick.selectionKey || pick.selectionCode || pick.selection || null,
    originModule: pick.originModule || pick.sourceModule || pick.origin || null,
    modelVersion: pick.modelVersion || null,
    result
  };
}

export function buildBestBetsHistoryRecords(savedPicks = [], savedParlays = []) {
  const rows = [
    ...(Array.isArray(savedPicks) ? savedPicks : []),
    ...(Array.isArray(savedParlays) ? savedParlays : []).filter((parlay) => parlay?.isTest !== true)
      .flatMap((parlay) => Array.isArray(parlay?.legs) ? parlay.legs : [])
  ].map(compactHistoryRecord).filter(Boolean);
  const unique = new Map();
  for (const row of rows) {
    const key = [row.fixtureId, row.leagueId, row.marketKey || row.market, row.selectionKey, row.originModule, row.result].join(":");
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].slice(0, 1000);
}

export function filterBestBetCandidates(report = {}, filters = {}) {
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  return candidates.filter((candidate) => {
    if (filters.classification && filters.classification !== "all" && candidate.classification !== filters.classification) return false;
    if (filters.league && filters.league !== "all" && candidate.leagueName !== filters.league) return false;
    if (filters.market && filters.market !== "all" && candidate.marketKey !== filters.market) return false;
    return true;
  });
}

export function bestBetCandidateToLeg(candidate = {}) {
  return {
    id: `best-bet:${candidate.id || `${candidate.fixtureId}:${candidate.marketKey}:${candidate.selectionKey}`}`,
    fixtureId: candidate.fixtureId,
    leagueId: candidate.leagueId ?? null,
    league: candidate.leagueName || "No disponible",
    country: candidate.country || null,
    home: candidate.homeTeam,
    away: candidate.awayTeam,
    date: candidate.kickoffTime ? String(candidate.kickoffTime).slice(0, 10) : "",
    kickoffAt: candidate.kickoffTime || null,
    status: "scheduled",
    market: candidate.market,
    marketCode: candidate.marketKey,
    selection: candidate.selection,
    selectionCode: candidate.selectionKey,
    decimalOdds: candidate.odds ?? null,
    impliedProbability: candidate.normalizedImpliedProbabilityPct ?? candidate.impliedProbabilityPct ?? null,
    modelProbability: candidate.modelProbabilityPct ?? null,
    expectedValue: candidate.expectedValuePct ?? null,
    confidence: candidate.classification || "OBSERVAR",
    confidenceScore: candidate.selectorScore ?? null,
    risk: candidate.riskScore === null || candidate.riskScore === undefined ? "No disponible" : `${candidate.riskScore}/100`,
    explanation: candidate.inclusionReason || candidate.reasons?.[0] || "SelecciÃ³n ordenada por el Selector inteligente de mejores apuestas.",
    sourceModule: "best_bets_selector",
    originModule: candidate.originModule || null,
    sourceLabel: "Mejores apuestas",
    modelVersion: candidate.modelVersion || null,
    configVersion: candidate.configVersion || null,
    generatedAt: candidate.generatedAt || new Date().toISOString(),
    requiresReview: candidate.classification !== "APTO"
  };
}
