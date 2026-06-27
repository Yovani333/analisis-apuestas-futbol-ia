const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const numeric = (value) => value === null || value === undefined || value === ""
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;

const STRENGTH_RANK = Object.freeze({ none: 0, slight: 1, medium: 2, strong: 3 });
const COLOR_MEANING = Object.freeze({ green: "Confiable", orange: "Riesgo", red: "Evitar" });

function strengthFromPercent(percent) {
  if (!Number.isFinite(percent)) return "none";
  if (percent >= 60) return "strong";
  if (percent >= 50) return "medium";
  if (percent >= 42) return "slight";
  return "none";
}

function strengthFromDoubleChance(odd) {
  if (!Number.isFinite(odd)) return "none";
  if (odd <= 1.10) return "strong";
  if (odd <= 1.25) return "medium";
  if (odd <= 1.45) return "slight";
  return "none";
}

function strongerStrength(first, second) {
  return STRENGTH_RANK[first] >= STRENGTH_RANK[second] ? first : second;
}

function sideForSelection(selectionKey) {
  if (selectionKey === "1X") return "home";
  if (selectionKey === "X2") return "away";
  return null;
}

function selectionFor(dataset, key) {
  return (dataset.marketAnalysis || []).find((item) => item.selectionKey === key) || null;
}

function standingGap(research) {
  const homeRank = numeric(research?.standings?.home?.rank);
  const awayRank = numeric(research?.standings?.away?.rank);
  return homeRank !== null && awayRank !== null ? Math.abs(homeRank - awayRank) : null;
}

function qualityGap(strength, rankGap = null) {
  if (strength === "strong" && Number.isFinite(rankGap) && rankGap >= 12) return "very_high";
  if (strength === "strong") return "high";
  if (strength === "medium") return Number.isFinite(rankGap) && rankGap >= 8 ? "high" : "medium";
  return strength === "slight" ? "low" : "low";
}

export function detectFavorite(dataset = {}) {
  const fixture = dataset.fixture || {};
  const providerFavorite = fixture.favorite || null;
  let side = providerFavorite?.teamId === fixture.homeTeamId ? "home"
    : providerFavorite?.teamId === fixture.awayTeamId ? "away" : null;
  let strength = strengthFromPercent(numeric(providerFavorite?.percent));

  const homeDc = selectionFor(dataset, "1X");
  const awayDc = selectionFor(dataset, "X2");
  const homeOdd = numeric(homeDc?.decimalOdds);
  const awayOdd = numeric(awayDc?.decimalOdds);
  const dcSide = homeOdd !== null && awayOdd !== null && Math.abs(homeOdd - awayOdd) >= 0.08
    ? (homeOdd < awayOdd ? "home" : "away")
    : homeOdd !== null && homeOdd <= 1.45 ? "home"
      : awayOdd !== null && awayOdd <= 1.45 ? "away" : null;
  const dcOdd = dcSide === "home" ? homeOdd : dcSide === "away" ? awayOdd : null;

  if (!side && dcSide) side = dcSide;
  if (side && dcSide === side) strength = strongerStrength(strength, strengthFromDoubleChance(dcOdd));
  const team = side === "home" ? fixture.home || providerFavorite?.team
    : side === "away" ? fixture.away || providerFavorite?.team : providerFavorite?.team || "No identificado";
  const teamId = side === "home" ? fixture.homeTeamId : side === "away" ? fixture.awayTeamId : providerFavorite?.teamId || null;
  return { team, teamId, side, strength, source: providerFavorite ? "api-football-predictions" : dcSide ? "double-chance-odds" : "not_identified" };
}

function absenceCount(side = {}) {
  return ["injuries", "suspensions"].reduce((total, key) => total + (side[key]?.length || 0), 0);
}

function formScore(team = {}) {
  if (!team.played) return null;
  return (Number(team.winRate) || 0) + (Number(team.nonLossRate) || 0) * 0.35;
}

function offensiveSignal(dataset, side) {
  const preMatch = dataset.preMatch?.[side] || {};
  const xg = dataset.researchData?.xgXga;
  const xgValue = side === "home" ? numeric(xg?.homeXG) : numeric(xg?.awayXG);
  const avgGoals = numeric(preMatch.avgGoalsFor);
  const bttsRate = numeric(preMatch.bttsRate);
  const score = (xgValue !== null ? Math.min(xgValue / 1.6 * 45, 45) : 0)
    + (avgGoals !== null ? Math.min(avgGoals / 1.6 * 35, 35) : 0)
    + (bttsRate !== null ? Math.min(bttsRate / 55 * 20, 20) : 0);
  return clamp(Math.round(score));
}

function marketProbability(dataset, key) {
  return numeric(selectionFor(dataset, key)?.estimatedProbabilityPct);
}

export function classifyMatchProfile(dataset = {}, favorite = detectFavorite(dataset)) {
  const over = marketProbability(dataset, "over_2_5");
  const under = marketProbability(dataset, "under_2_5");
  const bttsYes = marketProbability(dataset, "btts_yes");
  const bttsNo = marketProbability(dataset, "btts_no");
  const homeAttack = offensiveSignal(dataset, "home");
  const awayAttack = offensiveSignal(dataset, "away");
  const favoriteAttack = favorite.side === "away" ? awayAttack : homeAttack;
  const underdogAttack = favorite.side === "away" ? homeAttack : awayAttack;
  const highEvUnderdog = (dataset.marketAnalysis || []).some((pick) => {
    const side = sideForSelection(pick.selectionKey);
    return side && favorite.side && side !== favorite.side && numeric(pick.expectedValuePct) > 15;
  });

  if (["strong", "medium"].includes(favorite.strength) && highEvUnderdog && underdogAttack < 55) return "false_value_risk";
  if (["strong", "medium"].includes(favorite.strength)) {
    if (underdogAttack < 45 && (bttsNo === null || bttsYes === null || bttsNo >= bttsYes)) return "favorite_defensive";
    if (favoriteAttack >= 60 || over >= 55 || bttsYes >= 55) return "favorite_open";
    return underdogAttack < 50 ? "favorite_defensive" : "favorite_open";
  }
  if ((under !== null && over !== null && under > over) && (bttsNo === null || bttsYes === null || bttsNo >= bttsYes)) return "closed_balanced";
  if ((homeAttack >= 50 && awayAttack >= 50) && (over >= 55 || bttsYes >= 55)) return "competitive_open";
  return over !== null && over >= 52 ? "competitive_open" : "closed_balanced";
}

function underdogConfirmations(dataset, favorite, underdog) {
  const research = dataset.researchData || {};
  const confirmations = [];
  const favoriteAbsences = absenceCount(research.injuriesSuspensions?.[favorite]);
  const underdogAbsences = absenceCount(research.injuriesSuspensions?.[underdog]);
  if (favoriteAbsences >= 2 && favoriteAbsences > underdogAbsences) confirmations.push("bajas_importantes_favorito");
  const favoriteForm = formScore(dataset.preMatch?.[favorite]);
  const underdogForm = formScore(dataset.preMatch?.[underdog]);
  if (Number.isFinite(favoriteForm) && Number.isFinite(underdogForm) && underdogForm >= favoriteForm + 12) confirmations.push("mejor_forma_underdog");
  const xg = research.xgXga;
  const favoriteXg = favorite === "home" ? xg?.homeXG : xg?.awayXG;
  const underdogXg = underdog === "home" ? xg?.homeXG : xg?.awayXG;
  const favoriteXga = favorite === "home" ? xg?.homeXGA : xg?.awayXGA;
  const underdogXga = underdog === "home" ? xg?.homeXGA : xg?.awayXGA;
  if ([favoriteXg, underdogXg, favoriteXga, underdogXga].every(Number.isFinite)
    && underdogXg >= favoriteXg * 0.85 && underdogXga <= favoriteXga * 1.15) confirmations.push("xg_xga_competitivo");
  if (dataset.fixture?.neutralVenue) confirmations.push("sede_neutral");
  const gap = standingGap(research);
  if (Number.isFinite(gap) && gap <= 5) confirmations.push("brecha_clasificacion_reducida");
  const favoriteLineup = favorite === "home" ? research.lineups?.homeStartingXI : research.lineups?.awayStartingXI;
  const favoriteProbable = favorite === "home" ? research.lineups?.probableHomeXI : research.lineups?.probableAwayXI;
  if ((favoriteProbable?.length || 0) > 0 && !(favoriteLineup?.length || 0)) confirmations.push("rotacion_posible_favorito");
  return confirmations;
}

function valueScore(calculation) {
  const ev = numeric(calculation.expectedValuePct);
  return ev === null ? 0 : clamp(Math.round(50 + ev * 1.5));
}

function baseConfidence(dataset, calculation) {
  const dataCoverage = numeric(dataset.dataQuality?.score) || 0;
  const researchCoverage = numeric(dataset.researchData?.totalConfidenceScore);
  const coverage = researchCoverage !== null ? Math.min(dataCoverage, researchCoverage) : dataCoverage;
  const probability = numeric(calculation.estimatedProbabilityPct);
  const probabilitySignal = probability !== null ? (probability - 50) * 0.35 : 0;
  const sample = numeric(calculation.sampleSize) || 0;
  return clamp(Math.round(coverage + probabilitySignal + (sample >= 8 ? 6 : sample < 4 ? -12 : 0) - (calculation.requiresReview ? 25 : 0)));
}

function profileAlignment(selectionKey, profile) {
  const positive = {
    favorite_open: ["over_2_5", "btts_yes"],
    favorite_defensive: ["under_2_5", "btts_no"],
    closed_balanced: ["under_2_5", "btts_no"],
    competitive_open: ["over_2_5", "btts_yes"],
    false_value_risk: ["over_2_5"]
  }[profile] || [];
  const negative = {
    favorite_open: ["under_2_5", "btts_no"],
    favorite_defensive: ["over_2_5", "btts_yes"],
    closed_balanced: ["over_2_5", "btts_yes"],
    competitive_open: ["under_2_5", "btts_no"],
    false_value_risk: []
  }[profile] || [];
  return positive.includes(selectionKey) ? 12 : negative.includes(selectionKey) ? -18 : 0;
}

function safetyScore(calculation, context, confirmations) {
  const side = sideForSelection(calculation.selectionKey);
  if (side && context.favorite.side === side) return ["strong", "medium"].includes(context.favorite.strength) ? 90 : 72;
  if (side && context.favorite.side && side !== context.favorite.side) {
    if (confirmations.length >= 3) return 68;
    return context.favorite.strength === "strong" ? 18 : context.favorite.strength === "medium" ? 30 : 48;
  }
  let score = 55 + profileAlignment(calculation.selectionKey, context.profile) * 1.2;
  if (numeric(calculation.estimatedProbabilityPct) >= 60) score += 8;
  return clamp(Math.round(score));
}

function riskFlagsFor(calculation, context, confirmations) {
  const flags = [];
  const side = sideForSelection(calculation.selectionKey);
  const againstFavorite = side && context.favorite.side && side !== context.favorite.side;
  if (againstFavorite && ["strong", "medium"].includes(context.favorite.strength) && confirmations.length < 2) flags.push("false_value_underdog");
  if (numeric(calculation.decimalOdds) >= 2.5 && numeric(calculation.expectedValuePct) > 15) flags.push("high_odds_ev_inflation");
  if (calculation.selectionKey === "over_2_5" && ["closed_balanced", "favorite_defensive"].includes(context.profile)) flags.push("over_against_profile");
  if (calculation.selectionKey === "under_2_5" && ["favorite_open", "competitive_open"].includes(context.profile)) flags.push("under_against_profile");
  if (calculation.selectionKey === "btts_yes" && ["favorite_defensive", "closed_balanced"].includes(context.profile)) flags.push("btts_yes_weak_attack");
  if (calculation.selectionKey === "btts_no" && context.profile === "competitive_open") flags.push("btts_no_open_match");
  if (numeric(calculation.estimatedProbabilityPct) < 50) flags.push("model_probability_low");
  if (numeric(calculation.expectedValuePct) < 0 && !(side && side === context.favorite.side)) flags.push("negative_ev_non_conservative");
  return flags;
}

function riskScore(flags, calculation) {
  let score = flags.reduce((total, flag) => total + (flag === "false_value_underdog" ? 45 : flag === "high_odds_ev_inflation" ? 18 : 22), 0);
  if (calculation.requiresReview) score += 25;
  return clamp(score);
}

function explanationFor(item, favoriteName) {
  if (item.riskFlags.includes("false_value_underdog")) return `El EV es alto, pero el pick va contra un favorito real fuerte (${favoriteName}).`;
  if (item.highlightColor === "red") return "Falso valor probable o pick contrario al perfil del partido.";
  if (item.expectedValuePct < 0 && item.safetyScore >= 75) return "Aunque el EV es negativo por cuota baja, la confianza futbolística y la seguridad son superiores.";
  if (item.selectionKey === "over_2_5" && item.profileAligned) return "El perfil del partido es abierto y hay señales ofensivas suficientes.";
  if (item.selectionKey === "under_2_5" && item.profileAligned) return "El perfil del partido es cerrado y las señales favorecen marcador corto.";
  if (item.selectionKey === "btts_yes" && item.profileAligned) return "Ambos equipos muestran señal ofensiva suficiente.";
  if (item.selectionKey === "btts_no" && item.profileAligned) return "El rival muestra baja señal ofensiva y el perfil apunta a marcador corto.";
  return item.highlightColor === "green" ? "Pick alineado con el perfil del partido y con buena confianza futbolística."
    : "Pick con valor, pero condicionado por riesgo medio.";
}

function classifyVisual(finalPickScore, riskFlags, risk) {
  const severe = riskFlags.includes("false_value_underdog") || riskFlags.includes("negative_ev_non_conservative") || risk >= 70;
  if (!severe && finalPickScore >= 70) return { highlightColor: "green", confidenceLevel: "Alta", colorMeaning: "Confiable" };
  if (!severe && finalPickScore >= 50) return { highlightColor: "orange", confidenceLevel: "Media", colorMeaning: "Riesgo" };
  return { highlightColor: "red", confidenceLevel: "Baja", colorMeaning: "Evitar" };
}

function evaluatePick(dataset, calculation, context) {
  const side = sideForSelection(calculation.selectionKey);
  const contradiction = Boolean(side && context.favorite.side && side !== context.favorite.side);
  const confirmations = contradiction ? underdogConfirmations(dataset, context.favorite.side, side) : [];
  const flags = riskFlagsFor(calculation, context, confirmations);
  const value = valueScore(calculation);
  const alignment = profileAlignment(calculation.selectionKey, context.profile);
  const confidence = clamp(baseConfidence(dataset, calculation) + alignment - (flags.includes("false_value_underdog") ? 30 : 0));
  const safety = safetyScore(calculation, context, confirmations);
  const risk = riskScore(flags, calculation);
  const penalty = risk >= 75 ? 30 : risk >= 50 ? 20 : risk >= 25 ? 10 : 0;
  const finalPickScore = clamp(Math.round(confidence * 0.40 + safety * 0.25 + value * 0.25 - penalty));
  const visual = classifyVisual(finalPickScore, flags, risk);
  const pickCategory = flags.includes("false_value_underdog") ? "high_risk_value"
    : visual.highlightColor === "green" ? "pick_fuerte"
      : visual.highlightColor === "orange" ? "agresivo_stake_bajo" : "evitar";
  const item = {
    ...calculation,
    valueScore: value,
    confidenceScore: confidence,
    safetyScore: safety,
    riskScore: risk,
    riskPenalty: penalty,
    finalPickScore,
    riskFlags: flags,
    pickCategory,
    legacyPickCategory: flags.includes("false_value_underdog") ? "value_sospechoso" : pickCategory,
    highlightColor: visual.highlightColor,
    confidenceLevel: visual.confidenceLevel,
    colorMeaning: visual.colorMeaning,
    contradictsFavorite: contradiction,
    confirmations,
    matchProfile: context.profile,
    profileAligned: alignment > 0,
    discardReason: visual.highlightColor === "red" ? (flags.includes("false_value_underdog") ? "EV positivo, pero falso valor probable contra favorito real." : "Pick contrario al perfil o con riesgo alto.") : ""
  };
  return { ...item, explanation: explanationFor(item, context.favorite.team), warning: explanationFor(item, context.favorite.team) };
}

function compactPick(item) {
  if (!item) return null;
  return {
    marketKey: item.marketKey, selectionKey: item.selectionKey, market: item.market, selection: item.selection,
    decimalOdds: item.decimalOdds, estimatedProbabilityPct: item.estimatedProbabilityPct,
    expectedValuePct: item.expectedValuePct, valueScore: item.valueScore, confidenceScore: item.confidenceScore,
    safetyScore: item.safetyScore, riskScore: item.riskScore, finalPickScore: item.finalPickScore,
    riskFlags: item.riskFlags, pickCategory: item.pickCategory, highlightColor: item.highlightColor,
    confidenceLevel: item.confidenceLevel, colorMeaning: item.colorMeaning, explanation: item.explanation,
    warning: item.warning, discardReason: item.discardReason,
    contradictsFavorite: item.contradictsFavorite, confirmations: item.confirmations
  };
}

export function evaluatePickRecommendations(dataset = {}) {
  const calculations = Array.isArray(dataset.marketAnalysis) ? dataset.marketAnalysis : [];
  const favorite = detectFavorite(dataset);
  const profile = classifyMatchProfile(dataset, favorite);
  const context = { favorite, profile };
  const reviewed = calculations.map((calculation) => evaluatePick(dataset, calculation, context));
  const ranked = [...reviewed].sort((a, b) => b.finalPickScore - a.finalPickScore || b.confidenceScore - a.confidenceScore || b.valueScore - a.valueScore);
  const recommended = ranked.find((item) => item.highlightColor === "green")
    || ranked.find((item) => item.highlightColor === "orange" && !item.contradictsFavorite) || null;
  const conservative = ranked.filter((item) => item !== recommended && item.highlightColor !== "red").sort((a, b) => b.safetyScore - a.safetyScore)[0] || null;
  const valueAlternative = ranked.filter((item) => item !== recommended && item !== conservative && item.highlightColor !== "red").sort((a, b) => b.valueScore - a.valueScore)[0] || null;
  const highestEv = [...reviewed].filter((item) => Number.isFinite(item.expectedValuePct)).sort((a, b) => b.expectedValuePct - a.expectedValuePct)[0] || null;
  const discarded = ranked.filter((item) => item.highlightColor === "red");
  const confidencePicks = ranked.slice(0, 5).map((item, index) => ({ ...compactPick(item), rank: index + 1, confidencePct: item.finalPickScore }));
  return {
    favoriteTeam: favorite.team,
    favoriteTeamId: favorite.teamId,
    favoriteSide: favorite.side,
    favoriteStrength: favorite.strength,
    favoriteSource: favorite.source,
    qualityGap: qualityGap(favorite.strength, standingGap(dataset.researchData)),
    matchProfile: profile,
    highestEvPick: compactPick(highestEv),
    recommendedPick: compactPick(recommended),
    conservativeAlternative: compactPick(conservative),
    valueAlternative: compactPick(valueAlternative),
    discardedPicks: discarded.map(compactPick),
    picks: reviewed.map(compactPick),
    pickCategory: recommended?.pickCategory || "sin_pick",
    valueScore: recommended?.valueScore || 0,
    confidenceScore: recommended?.confidenceScore || 0,
    safetyScore: recommended?.safetyScore || 0,
    riskScore: recommended?.riskScore || 0,
    finalPickScore: recommended?.finalPickScore || 0,
    riskFlags: recommended?.riskFlags || [],
    highlightColor: recommended?.highlightColor || "red",
    confidenceLevel: recommended?.confidenceLevel || "Baja",
    colorMeaning: recommended?.colorMeaning || COLOR_MEANING.red,
    explanation: recommended?.explanation || "No hay un pick principal con confianza suficiente.",
    warning: highestEv?.warning || recommended?.warning || "No hay valor suficiente para recomendar un pick principal.",
    confidencePicks,
    reviewedPicks: reviewed
  };
}
