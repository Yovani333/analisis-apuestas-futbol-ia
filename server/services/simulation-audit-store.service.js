const MAX_RECORDS = 200;
const records = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "simulation";
}

export function apiDelta(before = {}, after = {}) {
  return {
    networkRequests: Math.max(0, Number(after.networkRequests || 0) - Number(before.networkRequests || 0)),
    cacheHits: Math.max(0, Number(after.cacheHits || 0) - Number(before.cacheHits || 0)),
    cacheMisses: Math.max(0, Number(after.cacheMisses || 0) - Number(before.cacheMisses || 0)),
    pendingHits: Math.max(0, Number(after.pendingHits || 0) - Number(before.pendingHits || 0)),
    failures: Math.max(0, Number(after.failures || 0) - Number(before.failures || 0)),
    lastEndpoint: after.lastEndpoint || "",
    rateLimit: clone(after.rateLimit || {})
  };
}

export function createSimulationAuditRecord(result = {}, input = {}, observability = {}) {
  const createdAt = new Date().toISOString();
  const home = result.comparison?.teamA?.name || input.teamA?.name || "Equipo A";
  const away = result.comparison?.teamB?.name || input.teamB?.name || "Equipo B";
  const record = {
    id: `${Date.now()}-${slug(home)}-vs-${slug(away)}`,
    fixtureId: String(input.fixtureId || result.audit?.fixtureId || ""),
    teams: { home, away },
    competition: result.comparison?.competition || input.competition || "",
    fixtureDate: input.fixtureDate || "",
    calculatedAt: createdAt,
    modelVersions: clone(result.audit?.versions || {}),
    parameters: {
      windowSize: result.comparison?.windowSize || input.windowSize || 5,
      mode: result.context?.mode || "rule_based"
    },
    dataUsed: {
      source: result.source || "",
      comparisonSource: result.comparison?.source || "",
      matchesUsedHome: result.comparison?.teamA?.matchesWithStatistics || 0,
      matchesUsedAway: result.comparison?.teamB?.matchesWithStatistics || 0,
      fixturesUsedHome: clone(result.comparison?.teamA?.fixturesUsed || []),
      fixturesUsedAway: clone(result.comparison?.teamB?.fixturesUsed || [])
    },
    dataMissing: clone(result.audit?.dataMissing || result.context?.variablesMissing || []),
    intermediateProbabilities: {
      elo: clone(result.elo?.probabilities || {}),
      dixonColes: clone(result.dixonColes?.probabilities || {}),
      contextBefore: clone(result.context?.probabilityBefore || {}),
      contextAfter: clone(result.context?.probabilityAfter || {})
    },
    finalProbabilities: clone(result.finalProbabilities || {}),
    marketComparison: clone(result.marketComparison || []),
    decision: clone(result.summary || {}),
    warnings: clone(result.warnings || []),
    validation: clone(result.validation || {}),
    apiConsumption: apiDelta(observability.before, observability.after),
    cacheInfo: clone(result.cacheInfo || null),
    status: result.status || "not_available"
  };
  return record;
}

export function saveSimulationAuditRecord(record) {
  if (!record?.id) return null;
  records.unshift(clone(record));
  if (records.length > MAX_RECORDS) records.splice(MAX_RECORDS);
  return records[0];
}

export function listSimulationAuditRecords({ fixtureId = "", limit = 50 } = {}) {
  const rows = fixtureId ? records.filter((record) => String(record.fixtureId) === String(fixtureId)) : records;
  return clone(rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, MAX_RECORDS))));
}

export function getSimulationAuditRecord(id) {
  return clone(records.find((record) => String(record.id) === String(id)) || null);
}

export function resetSimulationAuditStore() {
  records.splice(0);
}
