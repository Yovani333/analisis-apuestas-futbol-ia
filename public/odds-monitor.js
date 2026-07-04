const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export function findLowestOdds(oddsRows = [], limit = 2) {
  const rows = [];
  for (const response of Array.isArray(oddsRows) ? oddsRows : []) {
    for (const bookmaker of response?.bookmakers || []) {
      for (const bet of bookmaker?.bets || []) {
        for (const value of bet?.values || []) {
          const odd = numeric(value?.odd);
          if (odd === null || odd <= 1) continue;
          rows.push({
            market: bet.name || "Mercado no identificado",
            selection: value.value || "Selección no identificada",
            bookmaker: bookmaker.name || "Fuente no identificada",
            odd
          });
        }
      }
    }
  }
  const unique = new Map();
  rows.sort((a, b) => a.odd - b.odd).forEach((row) => {
    const key = `${row.bookmaker}|${row.market}|${row.selection}`.toLocaleLowerCase("es-MX");
    if (!unique.has(key)) unique.set(key, row);
  });
  return [...unique.values()].slice(0, Math.max(0, limit));
}
