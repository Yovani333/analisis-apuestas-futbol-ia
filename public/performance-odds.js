function normalizedText(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/,/g, ".").trim();
}

function marketLine(raw) {
  const match = raw.match(/(?:mas(?:\s+de)?|menos(?:\s+de)?|over|under)\s*(\d+(?:\.\d+)?)/);
  return match?.[1] || null;
}

export function performanceMarketKey(item = {}) {
  const market = normalizedText(item.market);
  const selection = normalizedText(item.selection || item.category);
  const selectionKey = normalizedText(item.selectionKey || item.selectionCode);
  const marketKey = normalizedText(item.marketKey || item.marketCode);
  const home = normalizedText(item.home);
  const away = normalizedText(item.away);
  const raw = `${market} ${selection} ${marketKey} ${selectionKey}`
    .replace(/(\d)_(\d)/g, "$1.$2")
    .replace(/[_-]+/g, " ");
  if (/corner/.test(raw)) return null;

  const line = marketLine(raw);
  const directionRaw = `${selection} ${selectionKey}`.replace(/[_-]+/g, " ");
  const direction = /(?:menos|under)/.test(directionRaw) ? "under" : /(?:mas|over)/.test(directionRaw) ? "over" : null;
  const teamGoals = /team.?goals|goles de|home_team_goals|away_team_goals/.test(raw)
    || /^(home|away)_over_/.test(selectionKey);
  if (line && direction && teamGoals) {
    const side = /(^|_)home(_|$)|\blocal\b/.test(`${selectionKey} ${marketKey}`) || (home && selection.includes(home)) ? "home"
      : /(^|_)away(_|$)|\bvisitante\b/.test(`${selectionKey} ${marketKey}`) || (away && selection.includes(away)) ? "away" : "team";
    return `team_goals:${side}:${direction}:${line}`;
  }
  if (line && direction) return `total_goals:${direction}:${line}`;
  if (/both.teams|ambos.*anotan|btts/.test(raw)) return /(?:^|_)(?:no|btts_no)(?:_|$)|\bno\b/.test(`${selectionKey} ${selection}`) ? "btts:no" : "btts:yes";
  if (/double.chance|doble oportunidad|\b1x\b|\bx2\b/.test(raw)) {
    if (/\bx2\b/.test(raw)) return "double_chance:x2";
    if (/\b12\b/.test(raw)) return "double_chance:12";
    return "double_chance:1x";
  }
  if (/draw.no.bet|empate no apuesta|\bdnb\b/.test(raw)) {
    return /(^|_)away(_|$)|\bvisitante\b/.test(`${selectionKey} ${marketKey}`) || (away && selection.includes(away)) ? "dnb:away" : "dnb:home";
  }
  if (/match.winner|resultado 1x2|\bhome win\b|\baway win\b|\bdraw\b|\bgana\b|\bempate\b/.test(raw)) {
    if (/\baway win\b|\bvisitante\b/.test(raw) || (away && selection.includes(away))) return "winner:away";
    if (/\bdraw\b|\bempate\b/.test(raw) && !/gana/.test(raw)) return "winner:draw";
    return "winner:home";
  }
  if (/anytime.goalscorer|player.to.score|jugador.*anota/.test(raw)) return `player_goal:${selection}`;
  return null;
}

function historicalPicksFor(recommendation, performanceRows) {
  const row = performanceRows.find((item) => item.origin === recommendation.origin);
  if (!row) return [];
  return [...(row.wonPicks || []), ...(row.lostPicks || [])]
    .filter((pick) => pick.category === recommendation.category);
}

function colorFor(won, maximumWon) {
  if (won === maximumWon) return "green";
  return won >= Math.max(1, maximumWon * 0.5) ? "orange" : "blue";
}

export function buildPerformanceOddsView(markets = [], performanceRows = [], recommendedEntries = []) {
  const recommendations = recommendedEntries.filter((entry) => !/corner/i.test(`${entry.category} ${entry.market || ""}`));
  const matched = [];

  for (const market of markets) {
    const provider = normalizedText(market.sourceProvider || "api-football");
    const decimalOdds = Number(market.decimalOdds);
    const key = performanceMarketKey(market);
    if (provider !== "api-football" || !key || !Number.isFinite(decimalOdds) || decimalOdds <= 1) continue;

    const matching = recommendations.filter((recommendation) => {
      const historical = historicalPicksFor(recommendation, performanceRows);
      const keys = historical.map(performanceMarketKey).filter(Boolean);
      if (keys.length) return keys.includes(key);
      return performanceMarketKey({ selection: recommendation.category }) === key;
    });
    if (!matching.length) continue;

    const performance = matching.reduce((summary, entry) => ({
      won: summary.won + Number(entry.won || 0),
      lost: summary.lost + Number(entry.lost || 0),
      evaluated: summary.evaluated + Number(entry.evaluated || 0),
      origins: [...new Set([...summary.origins, entry.origin])]
    }), { won: 0, lost: 0, evaluated: 0, origins: [] });
    performance.winRate = performance.evaluated ? Number((performance.won / performance.evaluated * 100).toFixed(1)) : null;
    matched.push({ ...market, decimalOdds, performance, performanceKey: key });
  }

  const deduplicated = new Map();
  for (const market of matched) {
    const identity = market.selectionKey || `${normalizedText(market.market)}:${normalizedText(market.selection)}`;
    const current = deduplicated.get(identity);
    if (!current || market.decimalOdds > current.decimalOdds) deduplicated.set(identity, market);
  }
  const rows = [...deduplicated.values()];
  const maximumWon = Math.max(0, ...rows.map((row) => row.performance.won));
  return rows
    .map((row) => ({ ...row, performanceColor: colorFor(row.performance.won, maximumWon) }))
    .sort((a, b) => b.decimalOdds - a.decimalOdds || b.performance.won - a.performance.won || a.selection.localeCompare(b.selection, "es"));
}
