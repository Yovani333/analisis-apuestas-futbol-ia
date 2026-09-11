import { pickOriginLabel } from "./pick-origins.js";

const SETTLED = new Set(["won", "lost"]);

function validProductionRow(row = {}) {
  return !row.isTest && !row.trashed && !row.deletedAt && !row.deletedPermanently && !row.removedFromParlayAt && SETTLED.has(row.result);
}

function fixtureMonth(row = {}) {
  const value = String(row.date || row.fixtureDate || row.kickoffAt || "");
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}

function historicalRows(picks = [], parlays = [], month = "") {
  const keep = (row) => validProductionRow(row) && (!month || fixtureMonth(row) === month);
  return [
    ...picks.filter(keep).map((pick) => ({ ...pick, betType: "individual" })),
    ...parlays.filter((parlay) => !parlay.isTest && !parlay.trashed && !parlay.deletedAt)
      .flatMap((parlay) => (parlay.legs || []).filter(keep).map((leg) => ({ ...leg, betType: "parlay", parlayId: parlay.id })))
  ];
}

export function wilsonLowerBound(won, total, z = 1.96) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const p = Math.max(0, Math.min(total, Number(won) || 0)) / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Number((Math.max(0, (center - margin) / denominator) * 100).toFixed(1));
}

function probabilityRange(probability) {
  const value = Number(probability);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  const lower = Math.min(90, Math.floor(value / 10) * 10);
  return { lower, upper: lower === 90 ? 100 : lower + 9.9, label: lower === 90 ? "90-100%" : `${lower}-${lower + 9.9}%` };
}

export function calculateOutcome1x2Performance(picks = [], parlays = [], { month = "" } = {}) {
  const rows = historicalRows(picks, parlays, month).filter((row) => row.sourceModule === "outcome_1x2");
  const grouped = new Map();
  for (const row of rows) {
    const range = probabilityRange(row.modelProbability);
    if (!range) continue;
    if (!grouped.has(range.label)) grouped.set(range.label, { ...range, won: 0, lost: 0, individual: 0, parlay: 0 });
    const entry = grouped.get(range.label);
    entry[row.result] += 1;
    entry[row.betType] += 1;
  }
  return [...grouped.values()].map((entry) => {
    const evaluated = entry.won + entry.lost;
    return {
      ...entry,
      evaluated,
      hitRate: Number(((entry.won / evaluated) * 100).toFixed(1)),
      conservativeRate: wilsonLowerBound(entry.won, evaluated),
      evidenceLevel: evaluated < 10 ? "Insuficiente" : evaluated < 20 ? "Preliminar" : evaluated < 40 ? "Util" : evaluated < 70 ? "Solida" : "Amplia"
    };
  }).sort((a, b) => b.conservativeRate - a.conservativeRate || b.evaluated - a.evaluated || b.lower - a.lower);
}

function summarizeGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) || "Sin clasificar").trim();
    if (!groups.has(key)) groups.set(key, { label: key, won: 0, lost: 0 });
    groups.get(key)[row.result] += 1;
  }
  return [...groups.values()].map((entry) => {
    const evaluated = entry.won + entry.lost;
    return { ...entry, evaluated, hitRate: Number(((entry.won / evaluated) * 100).toFixed(1)), conservativeRate: wilsonLowerBound(entry.won, evaluated) };
  }).sort((a, b) => b.conservativeRate - a.conservativeRate || b.evaluated - a.evaluated);
}

function parlayPairRows(parlays, month, keyFn) {
  const rows = [];
  for (const parlay of parlays) {
    if (parlay.isTest || parlay.trashed || parlay.deletedAt) continue;
    const legs = (parlay.legs || []).filter((leg) => validProductionRow(leg) && (!month || fixtureMonth(leg) === month));
    const values = [...new Set(legs.map(keyFn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) {
      const related = legs.filter((leg) => [values[i], values[j]].includes(keyFn(leg)));
      rows.push({ label: `${values[i]} + ${values[j]}`, result: related.every((leg) => leg.result === "won") ? "won" : "lost" });
    }
  }
  return summarizeGroups(rows, (row) => row.label);
}

export function buildStatisticalAssistantReport({ picks = [], parlays = [], sections = [], month = "" } = {}) {
  const rows = historicalRows(picks, parlays, month);
  const requested = new Set(sections);
  const output = [];
  const add = (key, title, data) => {
    if (!requested.has(key)) return;
    const qualified = data.filter((row) => row.evaluated >= 3).slice(0, 5);
    output.push({ key, title, rows: qualified, insufficient: data.length - qualified.length });
  };
  add("competitions", "Ligas y competiciones", summarizeGroups(rows, (row) => row.league || row.competition));
  add("markets", "Mercados", summarizeGroups(rows, (row) => row.market));
  add("origins", "Origen de los picks", summarizeGroups(rows, (row) => pickOriginLabel(row)));
  add("market-combinations", "Combinaciones de mercados", parlayPairRows(parlays, month, (row) => row.market));
  add("league-combinations", "Combinaciones de ligas", parlayPairRows(parlays, month, (row) => row.league || row.competition));
  return { month, evaluated: rows.length, sections: output, generatedAt: new Date().toISOString() };
}
