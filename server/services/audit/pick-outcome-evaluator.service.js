const number = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export const AUDIT_OUTCOMES = Object.freeze(["HIT", "MISS", "VOID", "NO_BET", "DATA_INSUFFICIENT", "LIVE_PENDING"]);

export function evaluatePickOutcome(pick = {}, result = {}) {
  if (result.finished !== true) return result.appStatus === "live" || result.status === "LIVE" ? "LIVE_PENDING" : "DATA_INSUFFICIENT";
  if (pick.noBet || pick.highlightColor === "red") return "NO_BET";
  const home = number(result.goals?.home);
  const away = number(result.goals?.away);
  if (home === null || away === null) return "DATA_INSUFFICIENT";
  const total = home + away;
  const key = pick.selectionKey || pick.selectionCode;
  if (["home_dnb", "away_dnb"].includes(key) && home === away) return "VOID";
  const won = {
    home_win: home > away, away_win: away > home, draw: home === away,
    "1X": home >= away, X2: away >= home,
    home_dnb: home > away, away_dnb: away > home,
    over_1_5: total > 1.5, over_2_5: total > 2.5, under_2_5: total < 2.5,
    btts_yes: home > 0 && away > 0, btts_no: home === 0 || away === 0,
    home_over_0_5: home > 0, home_over_1_5: home > 1,
    away_over_0_5: away > 0, away_over_1_5: away > 1
  }[key];
  if (typeof won !== "boolean") return "DATA_INSUFFICIENT";
  return won ? "HIT" : "MISS";
}
