const number = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export const AUDIT_OUTCOMES = Object.freeze(["HIT", "MISS", "VOID", "NO_BET", "DATA_INSUFFICIENT", "LIVE_PENDING"]);

function normalizedText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function regulationGoals(result = {}) {
  for (const candidate of [result.regulationGoals, result.score90, result.fulltimeGoals, result.goals]) {
    const home = number(candidate?.home);
    const away = number(candidate?.away);
    if (home !== null && away !== null) return { home, away };
  }
  return null;
}

function numericLine(key, prefix, selection = "") {
  const keyMatch = String(key || "").match(new RegExp(`^${prefix}_(\\d+(?:_\\d+)?)`));
  if (keyMatch) return number(keyMatch[1].replace("_", "."));
  const selectionMatch = String(selection || "").replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return number(selectionMatch?.[1]);
}

function settleTotal(total, line, direction) {
  if (line === null) return null;
  const fraction = Number((line % 1).toFixed(2));
  if ([0.25, 0.75].includes(fraction)) {
    const split = fraction === 0.25
      ? [Math.floor(line), Math.floor(line) + 0.5]
      : [Math.floor(line) + 0.5, Math.ceil(line)];
    const outcomes = split.map((part) => total === part
      ? "VOID"
      : direction === "over" ? (total > part ? "HIT" : "MISS") : (total < part ? "HIT" : "MISS"));
    return outcomes[0] === outcomes[1] ? outcomes[0] : null;
  }
  if (total === line) return "VOID";
  return direction === "over" ? (total > line ? "HIT" : "MISS") : (total < line ? "HIT" : "MISS");
}

function selectedSide(pick = {}, result = {}) {
  if (["home", "away"].includes(pick.side)) return pick.side;
  const selection = normalizedText(pick.selection);
  const home = normalizedText(result.home);
  const away = normalizedText(result.away);
  if (home && selection.includes(home)) return "home";
  if (away && selection.includes(away)) return "away";
  return null;
}

function officialTotal(result = {}, key) {
  const direct = number(result[key]?.total ?? result[key]);
  if (direct !== null) return direct;
  const home = number(result[key]?.home);
  const away = number(result[key]?.away);
  return home !== null && away !== null ? home + away : null;
}

export function evaluatePickOutcome(pick = {}, result = {}) {
  if (result.finished !== true) return result.appStatus === "live" || result.status === "LIVE" ? "LIVE_PENDING" : "DATA_INSUFFICIENT";
  if (pick.noBet) return "NO_BET";
  const score = regulationGoals(result);
  if (!score) return "DATA_INSUFFICIENT";
  const { home, away } = score;
  const total = home + away;
  const key = pick.selectionKey || pick.selectionCode;
  if (["home_dnb", "away_dnb"].includes(key) && home === away) return "VOID";

  const simpleResult = {
    home_win: home > away, away_win: away > home, draw: home === away,
    "1X": home >= away, X2: away >= home, "12": home !== away,
    home_dnb: home > away, away_dnb: away > home,
    btts_yes: home > 0 && away > 0, btts_no: home === 0 || away === 0,
    home_over_0_5: home > 0, home_over_1_5: home > 1,
    away_over_0_5: away > 0, away_over_1_5: away > 1
  }[key];
  if (typeof simpleResult === "boolean") return simpleResult ? "HIT" : "MISS";

  if (/^(over|under)_\d/.test(String(key || "")) && !String(key).includes("corners") && !String(key).includes("cards")) {
    const direction = String(key).startsWith("over_") ? "over" : "under";
    return settleTotal(total, numericLine(key, direction, pick.selection), direction) || "DATA_INSUFFICIENT";
  }

  if (String(key || "").startsWith("team_over_")) {
    const side = selectedSide(pick, result);
    const line = numericLine(key, "team_over", pick.selection);
    if (!side || line === null) return "DATA_INSUFFICIENT";
    return settleTotal(side === "home" ? home : away, line, "over") || "DATA_INSUFFICIENT";
  }

  if (String(key || "").endsWith("_win") || normalizedText(pick.selection).includes("gana")) {
    const side = selectedSide(pick, result);
    if (!side) return "DATA_INSUFFICIENT";
    return (side === "home" ? home > away : away > home) ? "HIT" : "MISS";
  }

  if (String(key || "").includes("corners")) {
    if (key === "home_most_corners" || key === "away_most_corners") {
      const homeCorners = number(result.corners?.home);
      const awayCorners = number(result.corners?.away);
      if (homeCorners === null || awayCorners === null) return "DATA_INSUFFICIENT";
      if (homeCorners === awayCorners) return "VOID";
      return (key === "home_most_corners" ? homeCorners > awayCorners : awayCorners > homeCorners) ? "HIT" : "MISS";
    }
    const corners = officialTotal(result, "corners");
    const direction = String(key).startsWith("under_") ? "under" : "over";
    if (corners === null) return "DATA_INSUFFICIENT";
    return settleTotal(corners, numericLine(key, direction, pick.selection), direction) || "DATA_INSUFFICIENT";
  }

  if (String(key || "").includes("cards")) {
    const cards = officialTotal(result, "cards");
    const direction = String(key).startsWith("under_") ? "under" : "over";
    if (cards === null) return "DATA_INSUFFICIENT";
    return settleTotal(cards, numericLine(key, direction, pick.selection), direction) || "DATA_INSUFFICIENT";
  }

  return "DATA_INSUFFICIENT";
}

export function evaluateDiscardedPickCounterfactual(pick = {}, result = {}) {
  return evaluatePickOutcome({ ...pick, noBet: false }, result);
}
