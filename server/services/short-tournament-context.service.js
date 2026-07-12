const numeric = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const normalize = (value = "") => String(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

function resolvePhase(dataset = {}) {
  const fixture = dataset.fixture || {};
  const context = dataset.researchData?.context || dataset.preMatch?.context || {};
  const phase = fixture.phase || fixture.round || fixture.stage || context.phase || context.round || context.stage || "";
  return String(phase).trim();
}

function sampleSize(dataset = {}) {
  const research = dataset.researchData || {};
  const xg = research.xgXga || {};
  const form = research.statsForm || {};
  const home = numeric(xg.homeSampleSize ?? xg.sampleSizeHome ?? form.homePlayed);
  const away = numeric(xg.awaySampleSize ?? xg.sampleSizeAway ?? form.awayPlayed);
  return home !== null && away !== null ? Math.min(home, away) : home ?? away ?? 0;
}

export function buildShortTournamentContext(dataset = {}) {
  const fixture = dataset.fixture || {};
  const competition = normalize(`${fixture.leagueSlug || ""} ${fixture.leagueName || ""} ${fixture.country || ""}`);
  const isWorldCup = /world.?cup|mundial/.test(competition);
  const configuredType = normalize(fixture.competitionType || fixture.competitionScope || "");
  const isShortTournament = isWorldCup || ["cup", "qualifying"].includes(configuredType) || /(^|\s)cup(\s|$)|copa|torneo corto/.test(competition);
  const phase = resolvePhase(dataset);
  const normalizedPhase = normalize(phase);
  const isKnockout = Boolean(fixture.isKnockoutRound || fixture.isQualifyingRound) || /qualifying|round of|octavos|quarter|cuartos|semi|final|knockout|eliminacion/.test(normalizedPhase);
  const isGroupStage = /group|grupo/.test(normalizedPhase);
  const sample = sampleSize(dataset);
  const warnings = [];

  if (isShortTournament && sample < 3) warnings.push(`Muestra muy limitada para torneo corto: ${sample} partidos comparables.`);
  else if (isShortTournament && sample < 5) warnings.push(`Muestra reducida para torneo corto: ${sample} partidos comparables.`);
  if (isKnockout) warnings.push("La evaluación 1X2 corresponde a 90 minutos; tiempo extra y penales deben analizarse en un mercado separado.");
  if (isShortTournament && !phase) warnings.push("La fase del torneo no está disponible; no se aplican supuestos sobre eliminación directa.");

  const confidenceCap = !isShortTournament ? 100 : sample < 3 ? 45 : sample < 5 ? 60 : 78;
  const riskAdjustment = !isShortTournament ? 0 : (sample < 3 ? 18 : sample < 5 ? 10 : 5) + (isKnockout ? 8 : 0);

  return {
    isShortTournament,
    isWorldCup,
    phase: phase || "No disponible",
    isKnockout,
    isGroupStage,
    neutralVenue: Boolean(fixture.neutralVenue),
    sampleSize: sample,
    confidenceCap,
    riskAdjustment,
    scope: "regular_time_90_minutes",
    warnings
  };
}
