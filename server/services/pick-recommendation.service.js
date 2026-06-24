const CATEGORY_PRIORITY = Object.freeze({
  pick_fuerte: 5,
  pick_logico: 4,
  agresivo_stake_bajo: 3,
  value_sospechoso: 2,
  evitar: 1,
  sin_pick: 0
});

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function favoriteStrength(percent) {
  if (!Number.isFinite(percent)) return "none";
  if (percent >= 60) return "strong";
  if (percent >= 50) return "medium";
  if (percent >= 42) return "slight";
  return "none";
}

function qualityGap(strength, standingsGap = null) {
  if (strength === "strong" && Number.isFinite(standingsGap) && standingsGap >= 12) return "very_high";
  if (strength === "strong") return "high";
  if (strength === "medium") return Number.isFinite(standingsGap) && standingsGap >= 8 ? "high" : "medium";
  if (strength === "slight") return "low";
  return "low";
}

function sideForSelection(selectionKey) {
  if (selectionKey === "1X") return "home";
  if (selectionKey === "X2") return "away";
  return null;
}

function favoriteSide(dataset) {
  const favoriteId = dataset?.fixture?.favorite?.teamId;
  if (favoriteId === dataset?.fixture?.homeTeamId) return "home";
  if (favoriteId === dataset?.fixture?.awayTeamId) return "away";
  return null;
}

function standingGap(research) {
  const homeRank = research?.standings?.home?.rank;
  const awayRank = research?.standings?.away?.rank;
  return Number.isFinite(homeRank) && Number.isFinite(awayRank) ? Math.abs(homeRank - awayRank) : null;
}

function absenceCount(side = {}) {
  return ["injuries", "suspensions"].reduce((total, key) => total + (side[key]?.length || 0), 0);
}

function formScore(team = {}) {
  if (!team.played) return null;
  return (Number(team.winRate) || 0) + (Number(team.nonLossRate) || 0) * 0.35;
}

function underdogConfirmations(dataset, favorite, underdog) {
  const research = dataset.researchData || {};
  const confirmations = [];
  const favoriteAbsences = absenceCount(research.injuriesSuspensions?.[favorite]);
  const underdogAbsences = absenceCount(research.injuriesSuspensions?.[underdog]);
  if (favoriteAbsences >= 2 && favoriteAbsences > underdogAbsences) confirmations.push("bajas_importantes_favorito");

  const favoriteForm = formScore(dataset.preMatch?.[favorite]);
  const underdogForm = formScore(dataset.preMatch?.[underdog]);
  if (Number.isFinite(favoriteForm) && Number.isFinite(underdogForm) && underdogForm >= favoriteForm + 12) {
    confirmations.push("mejor_forma_underdog");
  }

  const xg = research.xgXga;
  const favoriteXg = favorite === "home" ? xg?.homeXG : xg?.awayXG;
  const underdogXg = underdog === "home" ? xg?.homeXG : xg?.awayXG;
  const favoriteXga = favorite === "home" ? xg?.homeXGA : xg?.awayXGA;
  const underdogXga = underdog === "home" ? xg?.homeXGA : xg?.awayXGA;
  if ([favoriteXg, underdogXg, favoriteXga, underdogXga].every(Number.isFinite)
    && underdogXg >= favoriteXg * 0.85 && underdogXga <= favoriteXga * 1.15) {
    confirmations.push("xg_xga_competitivo");
  }

  if (dataset.fixture?.neutralVenue) confirmations.push("sede_neutral");
  const gap = standingGap(research);
  if (Number.isFinite(gap) && gap <= 5) confirmations.push("brecha_clasificacion_reducida");

  const favoriteLineup = favorite === "home" ? research.lineups?.homeStartingXI : research.lineups?.awayStartingXI;
  const favoriteProbable = favorite === "home" ? research.lineups?.probableHomeXI : research.lineups?.probableAwayXI;
  if ((favoriteProbable?.length || 0) > 0 && !(favoriteLineup?.length || 0)) confirmations.push("rotacion_posible_favorito");
  return confirmations;
}

function confidenceScore(dataset, calculation) {
  const dataCoverage = Number(dataset.dataQuality?.score) || 0;
  const researchCoverage = Number(dataset.researchData?.totalConfidenceScore);
  const coverage = Number.isFinite(researchCoverage) ? Math.min(dataCoverage, researchCoverage) : dataCoverage;
  const sample = Number(calculation.sampleSize) || 0;
  const sampleAdjustment = sample >= 8 ? 8 : sample >= 6 ? 4 : sample < 4 ? -15 : 0;
  const reviewAdjustment = calculation.requiresReview ? -25 : 0;
  return clamp(Math.round(coverage + sampleAdjustment + reviewAdjustment));
}

function valueScore(calculation) {
  const ev = Number(calculation.expectedValuePct);
  return Number.isFinite(ev) ? clamp(Math.round(50 + ev * 2)) : 0;
}

function classifyPick({ calculation, contradiction, strength, confirmations, confidence }) {
  if (!Number.isFinite(calculation.expectedValuePct) || calculation.expectedValuePct <= 0) return "evitar";
  if (!calculation.positiveValue || calculation.requiresReview) return "sin_pick";
  if (contradiction && strength === "strong") {
    if (confirmations.length >= 3 && confidence >= 65) return "pick_logico";
    if (confirmations.length >= 2) return "agresivo_stake_bajo";
    return "value_sospechoso";
  }
  if (contradiction && strength === "medium") {
    if (confirmations.length >= 2 && confidence >= 65) return "pick_logico";
    return "agresivo_stake_bajo";
  }
  if (calculation.decimalOdds >= 2.5 || confidence < 55) return "agresivo_stake_bajo";
  if (confidence >= 75 && calculation.expectedValuePct >= 5) return "pick_fuerte";
  if (confidence >= 55) return "pick_logico";
  return "sin_pick";
}

function evaluatedConfidence(baseConfidence, calculation, category, confirmations) {
  const categoryAdjustment = {
    pick_fuerte: 10,
    pick_logico: 5,
    agresivo_stake_bajo: -8,
    value_sospechoso: -15,
    evitar: -25,
    sin_pick: -18
  }[category] || 0;
  const probability = Number(calculation.estimatedProbabilityPct);
  const probabilityAdjustment = Number.isFinite(probability) ? Math.round((probability - 50) * 0.25) : 0;
  const confirmationAdjustment = Math.min(confirmations.length * 3, 9);
  return clamp(baseConfidence + categoryAdjustment + probabilityAdjustment + confirmationAdjustment);
}

function warningFor(category, favoriteName, confirmations) {
  if (category === "value_sospechoso") {
    return `EV positivo, pero contradice al favorito fuerte ${favoriteName}. No recomendado como pick principal sin validación adicional.`;
  }
  if (category === "agresivo_stake_bajo") {
    return confirmations.length
      ? `Selección agresiva respaldada solo parcialmente (${confirmations.length} confirmaciones). Considerar exposición baja.`
      : "Cuota o contradicción de jerarquía elevan el riesgo. Considerar exposición baja.";
  }
  if (category === "evitar") return "EV negativo o ausencia de ventaja matemática suficiente.";
  if (category === "sin_pick") return "No alcanza los criterios mínimos de valor, cobertura y confianza.";
  return "";
}

function logicalAlternative(calculations, reviewed, favorite) {
  const eligible = reviewed
    .filter((item) => ["pick_fuerte", "pick_logico"].includes(item.pickCategory))
    .sort((a, b) => CATEGORY_PRIORITY[b.pickCategory] - CATEGORY_PRIORITY[a.pickCategory]
      || b.confidenceScore - a.confidenceScore
      || b.expectedValuePct - a.expectedValuePct);
  if (eligible[0]) return eligible[0];
  const goals = calculations.find((item) => item.marketKey === "over_under_2_5" && item.positiveValue && !item.requiresReview)
    || calculations.find((item) => item.marketKey === "btts" && item.positiveValue && !item.requiresReview);
  if (!goals) return null;
  return reviewed.find((item) => item.marketKey === goals.marketKey && item.selectionKey === goals.selectionKey) || null;
}

export function evaluatePickRecommendations(dataset = {}) {
  const calculations = Array.isArray(dataset.marketAnalysis) ? dataset.marketAnalysis : [];
  const favorite = dataset.fixture?.favorite || null;
  const favSide = favoriteSide(dataset);
  const strength = favoriteStrength(favorite?.percent);
  const gap = qualityGap(strength, standingGap(dataset.researchData));
  const favoriteName = favorite?.team || "No identificado";

  const reviewed = calculations.map((calculation) => {
    const pickSide = sideForSelection(calculation.selectionKey);
    const contradiction = Boolean(favSide && pickSide && pickSide !== favSide);
    const underdog = contradiction ? pickSide : null;
    const confirmations = contradiction ? underdogConfirmations(dataset, favSide, underdog) : [];
    const confidence = confidenceScore(dataset, calculation);
    const pickCategory = classifyPick({
      calculation, contradiction, strength, confirmations, confidence
    });
    const finalConfidence = evaluatedConfidence(confidence, calculation, pickCategory, confirmations);
    return {
      ...calculation,
      valueScore: valueScore(calculation),
      confidenceScore: finalConfidence,
      pickCategory,
      contradictsFavorite: contradiction,
      confirmations,
      warning: warningFor(pickCategory, favoriteName, confirmations)
    };
  });

  const highestEv = [...reviewed]
    .filter((item) => Number.isFinite(item.expectedValuePct))
    .sort((a, b) => b.expectedValuePct - a.expectedValuePct)[0] || null;
  const recommended = logicalAlternative(calculations, reviewed, favorite);
  const confidencePicks = [...reviewed]
    .sort((a, b) => b.confidenceScore - a.confidenceScore
      || b.estimatedProbabilityPct - a.estimatedProbabilityPct
      || b.expectedValuePct - a.expectedValuePct)
    .slice(0, 5)
    .map((item, index) => ({
      rank: index + 1,
      marketKey: item.marketKey,
      selectionKey: item.selectionKey,
      market: item.market,
      selection: item.selection,
      confidencePct: item.confidenceScore,
      estimatedProbabilityPct: item.estimatedProbabilityPct,
      expectedValuePct: item.expectedValuePct,
      pickCategory: item.pickCategory,
      warning: item.warning
    }));
  return {
    favoriteTeam: favoriteName,
    favoriteTeamId: favorite?.teamId || null,
    favoriteStrength: strength,
    qualityGap: gap,
    highestEvPick: highestEv,
    recommendedPick: recommended,
    pickCategory: recommended?.pickCategory || "sin_pick",
    confidenceScore: recommended?.confidenceScore || 0,
    warning: highestEv?.warning || (recommended ? recommended.warning : "No hay valor suficiente para recomendar un pick principal."),
    confidencePicks,
    reviewedPicks: reviewed
  };
}
