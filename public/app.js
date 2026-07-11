import { ALLOWED_LEAGUES, DATA_CATEGORIES, MOCK_FIXTURES } from "./mock-data.js?v=20260624-premium-dashboard-2";
import { footballDataService } from "./services.js?v=20260705-player-goal-v1";
import { applyAnalysisTiming, resolveAnalysisTiming } from "./analysis-timing.js?v=20260630-timing";
import {
  calculateHistoryMetrics, calculateParlayResult, createSavedParlay, createSavedPick, loadParlayDraft, loadSavedParlays,
  hasDuplicatePick, loadSavedPicks, moveParlayToTrash, normalizePickLeg, restoreParlayFromTrash, saveParlayDraft, saveSavedParlays, saveSavedPicks, settleLegResult
} from "./parlay-store.js?v=20260705-team-performance-picks-v1";
import { createEvidenceSnapshot, evidenceSnapshotToText, latestEvidenceForFixture, loadEvidenceSnapshots, saveEvidenceSnapshot } from "./evidence-store.js?v=20260702-evidence-v2";
import { infoTooltip, initializeInfoTooltips, labelWithTooltip } from "./info-tooltip.js?v=20260704-v3";
import { collapseGuideModules, resetModuleButton } from "./guide-state.js?v=20260704-v1";
import { pickOriginLabel } from "./pick-origins.js?v=20260705-player-goal-v1";
import { findLowestOdds } from "./odds-monitor.js?v=20260703";

const ALERTS_KEY = "football-ai.alerts.v1";
const PREFERENCES_KEY = "football-ai.preferences.v1";
const ANALYSIS_USAGE_KEY = "football-ai.analysis-usage.v1";
const TEAM_PERFORMANCE_VISIBILITY_KEY = "football-ai.team-performance-visible.v1";
const readLocalJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
};
const writeLocalJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* La app funciona aunque el almacenamiento esté bloqueado. */ }
};

const state = {
  fixtures: [],
  selectedFixtureId: null,
  analysisByFixture: new Map(),
  dataPicksByFixture: new Map(),
  outcomeByFixture: new Map(),
  poissonByFixture: new Map(),
  teamGoalsByFixture: new Map(),
  cornersByFixture: new Map(),
  specificMarketsByFixture: new Map(),
  teamPerformanceByFixture: new Map(),
  playerGoalByFixture: new Map(),
  parlayDraft: loadParlayDraft(),
  savedParlays: loadSavedParlays(),
  savedPicks: loadSavedPicks(),
  evidenceSnapshots: loadEvidenceSnapshots(),
  savedTab: "individual",
  expandedParlays: new Set(),
  alerts: readLocalJson(ALERTS_KEY, []),
  preferences: readLocalJson(PREFERENCES_KEY, { theme: "dark", dailyLimit: "none", name: "", alertLive: true, alertScore: true, alertData: true }),
  currentView: "dashboard",
  hasSearched: false,
  isSearching: false,
  isAnalyzing: false,
  isLoadingDataPicks: false,
  isLoadingOutcome: false,
  isLoadingPoisson: false,
  isLoadingTeamGoals: false,
  isLoadingCorners: false,
  isLoadingSpecificMarkets: false,
  isLoadingSimulation: false,
  isLoadingAdvancedSimulation: false,
  teamPerformanceLoadingFixtures: new Set(),
  playerGoalLoadingFixtures: new Set(),
  isRefreshingResearch: false,
  isRefreshingStatuses: false,
  isRefreshingLive: false,
  isCapturingEvidence: false,
  lastLiveRefreshAt: null
};

const elements = {
  form: document.querySelector("#filters-form"),
  leagueOptions: document.querySelector("#league-options"),
  leagueCount: document.querySelector("#league-count"),
  dateFrom: document.querySelector("#date-from"),
  dateTo: document.querySelector("#date-to"),
  competition: document.querySelector("#competition-main"),
  clearFilters: document.querySelector("#clear-filters"),
  setToday: document.querySelector("#set-today"),
  season: document.querySelector("#season"),
  status: document.querySelector("#match-status"),
  filterError: document.querySelector("#filter-error"),
  searchFeedback: document.querySelector("#search-feedback"),
  matchCount: document.querySelector("#match-count"),
  refreshFixtureStatuses: document.querySelector("#refresh-fixture-statuses"),
  matchesList: document.querySelector("#matches-list"),
  selectedSummary: document.querySelector("#selected-match-summary"),
  dataStatus: document.querySelector("#data-overall-status"),
  dataGrid: document.querySelector("#data-grid"),
  openOddsDetail: document.querySelector("#open-odds-detail"),
  evidenceToolbar: document.querySelector("#evidence-toolbar"), savePreMatchEvidence: document.querySelector("#save-pre-match-evidence"), downloadEvidenceTxt: document.querySelector("#download-evidence-txt"), evidenceStatus: document.querySelector("#evidence-status"),
  refreshCoverage: document.querySelector("#refresh-coverage"),
  researchContent: document.querySelector("#research-content"),
  researchSummary: document.querySelector("#research-summary"),
  sourceCoverage: document.querySelector("#source-coverage"),
  researchGrid: document.querySelector("#research-grid"),
  refreshResearch: document.querySelector("#refresh-research"),
  dataDialog: document.querySelector("#data-detail-dialog"),
  dataDialogTitle: document.querySelector("#data-detail-title"),
  dataDialogSubtitle: document.querySelector("#data-detail-subtitle"),
  dataDialogContent: document.querySelector("#data-detail-content"),
  dataDialogClose: document.querySelector("#data-detail-close"),
  analysisStatus: document.querySelector("#analysis-status"),
  analysisContent: document.querySelector("#analysis-content"),
  generateSelectedAnalysis: document.querySelector("#generate-selected-analysis"),
  explainSelectedAnalysis: document.querySelector("#explain-selected-analysis"), toggleAnalysis: document.querySelector("#toggle-analysis"),
  showDataPicks: document.querySelector("#show-data-picks"),
  dataPicksStatus: document.querySelector("#data-picks-status"),
  dataPicksContent: document.querySelector("#data-picks-content"),
  showOutcome: document.querySelector("#show-outcome"),
  outcomeStatus: document.querySelector("#outcome-status"),
  outcomeContent: document.querySelector("#outcome-content"),
  showPoisson: document.querySelector("#show-poisson"),
  poissonStatus: document.querySelector("#poisson-status"),
  poissonContent: document.querySelector("#poisson-content"),
  showTeamGoals: document.querySelector("#show-team-goals"),
  teamGoalsStatus: document.querySelector("#team-goals-status"),
  teamGoalsContent: document.querySelector("#team-goals-content"),
  showCorners: document.querySelector("#show-corners"), cornersStatus: document.querySelector("#corners-status"), cornersContent: document.querySelector("#corners-content"),
  showSpecificMarkets: document.querySelector("#show-specific-markets"), specificMarketsStatus: document.querySelector("#specific-markets-status"), specificMarketsContent: document.querySelector("#specific-markets-content"),
  teamPerformanceTitle: document.querySelector("#team-performance-title"), teamPerformanceStatus: document.querySelector("#team-performance-status"),
  teamPerformanceContent: document.querySelector("#team-performance-content"), toggleTeamPerformance: document.querySelector("#toggle-team-performance"),
  playerGoalStatus: document.querySelector("#player-goal-status"), playerGoalContent: document.querySelector("#player-goal-content"), togglePlayerGoal: document.querySelector("#toggle-player-goal"),
  parlaySlip: document.querySelector("#parlay-slip"),
  parlayMinimize: document.querySelector("#parlay-slip-minimize"),
  parlayDraftList: document.querySelector("#parlay-draft-list"),
  parlayLegCount: document.querySelector("#parlay-leg-count"),
  parlayFab: document.querySelector("#open-parlay-slip"),
  parlayFabCount: document.querySelector("#parlay-fab-count"),
  parlayName: document.querySelector("#parlay-name"),
  saveParlay: document.querySelector("#save-parlay"),
  savedParlayCount: document.querySelector("#saved-parlay-count"),
  savedParlaysList: document.querySelector("#saved-parlays-list"),
  savedPicksList: document.querySelector("#saved-picks-list"),
  trashParlaysList: document.querySelector("#trash-parlays-list"),
  historyMetrics: document.querySelector("#history-metrics"),
  updateParlayResults: document.querySelector("#update-parlay-results")
};

Object.assign(elements, {
  simulationCompetition: document.querySelector("#simulation-competition"),
  simulationWindow: document.querySelector("#simulation-window"),
  simulationTeamAId: document.querySelector("#simulation-team-a-id"),
  simulationTeamAName: document.querySelector("#simulation-team-a-name"),
  simulationTeamBId: document.querySelector("#simulation-team-b-id"),
  simulationTeamBName: document.querySelector("#simulation-team-b-name"),
  simulationFixtureDate: document.querySelector("#simulation-fixture-date"),
  simulationUseSelected: document.querySelector("#simulation-use-selected"),
  simulationCompare: document.querySelector("#simulation-compare"),
  simulationAdvanced: document.querySelector("#simulation-advanced"),
  simulationStatus: document.querySelector("#simulation-status"),
  simulationResults: document.querySelector("#simulation-results"),
  simulationAdvancedResults: document.querySelector("#simulation-advanced-results")
});

Object.assign(elements, {
  themeToggle: document.querySelector("#theme-toggle"), alertCount: document.querySelector("#alert-count"),
  notificationToggle: document.querySelector("#notification-toggle"), notificationCount: document.querySelector("#notification-count"),
  notificationPopover: document.querySelector("#notification-popover"), notificationList: document.querySelector("#notification-list"),
  markNotificationsRead: document.querySelector("#mark-notifications-read"), alertsList: document.querySelector("#alerts-list"),
  markAllAlertsRead: document.querySelector("#mark-all-alerts-read"), clearAlerts: document.querySelector("#clear-alerts"),
  alertLive: document.querySelector("#alert-live"), alertScore: document.querySelector("#alert-score"), alertData: document.querySelector("#alert-data"),
  accountForm: document.querySelector("#account-form"), accountName: document.querySelector("#account-name"),
  accountDarkMode: document.querySelector("#account-dark-mode"),
  accountDailyLimit: document.querySelector("#account-daily-limit")
});
Object.assign(elements, {
  auditFixture: document.querySelector("#audit-fixture"), runAudit: document.querySelector("#run-audit"), auditResults: document.querySelector("#audit-results")
});
Object.assign(elements, {
  analysisGuideContent: document.querySelector("#analysis-guide-content"), guideOddsContent: document.querySelector("#guide-odds-content"),
  guideCoverageSummary: document.querySelector("#guide-coverage-summary")
});
Object.assign(elements, {
  liveEventsStatus: document.querySelector("#live-events-status"), liveEventsContent: document.querySelector("#live-events-content"),
  livePlayersStatus: document.querySelector("#live-players-status"), livePlayersContent: document.querySelector("#live-players-content"),
  refreshLiveNow: document.querySelector("#refresh-live-now"), liveLastUpdated: document.querySelector("#live-last-updated")
});

document.querySelector("#guide-data-picks-slot")?.append(document.querySelector("#data-picks-panel"));
document.querySelector("#guide-poisson-slot")?.append(document.querySelector("#poisson-panel"));
document.querySelector("#guide-team-goals-slot")?.append(document.querySelector("#team-goals-panel"));
document.querySelector("#transparency-coverage-slot")?.append(document.querySelector("#coverage-panel"));
document.querySelector("#transparency-research-slot")?.append(document.querySelector("#research-panel"));

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function statusClass(status) {
  return {
    "Disponible": "available",
    "Programado": "available",
    "Completo": "complete",
    "En vivo": "live",
    "Parcial": "partial",
    "Falló": "failed",
    "No configurada": "unavailable",
    "Bloqueada": "failed",
    "Necesita revisión": "review",
    "Procesando": "processing",
    "No disponible": "unavailable"
  }[status] || "unavailable";
}

const RESEARCH_MODULES = Object.freeze([
  { key: "injuriesSuspensions", label: "Lesiones / sanciones" },
  { key: "lineups", label: "Alineaciones" },
  { key: "statsForm", label: "Estadísticas / forma" },
  { key: "xgXga", label: "xG / xGA" },
  { key: "contextCalendar", label: "Contexto / calendario" },
  { key: "standings", label: "Clasificación" },
  { key: "odds", label: "Cuotas" },
  { key: "h2h", label: "Head to head" },
  { key: "weatherPitch", label: "Clima / cancha" }
]);

const CATEGORY_TO_RESEARCH_MODULE = Object.freeze({
  standings: "standings", statistics: "statsForm", h2h: "h2h", injuries: "injuriesSuspensions",
  lineups: "lineups", odds: "odds", xg: "xgXga", context: "contextCalendar", weather: "weatherPitch"
});

const SUPPORTING_MODULES = Object.freeze([
  { key: "teamSeasonStatistics", label: "Estadísticas de temporada", use: "Contexto prepartido" },
  { key: "fixtureEvents", label: "Eventos del partido", use: "Solo auditoría posterior" },
  { key: "playerPerformance", label: "Rendimiento de jugadores", use: "Solo auditoría posterior" }
]);

const researchStatusLabels = Object.freeze({
  available: "Disponible",
  partial: "Parcial",
  not_available: "No disponible",
  failed: "Falló",
  needs_review: "Necesita revisión",
  not_configured: "No configurada",
  blocked: "Bloqueada"
});

const analysisStatusLabels = Object.freeze({ complete: "Completo", partial: "Parcial", needs_review: "Necesita revisión" });

function statusBadge(status) {
  return `<span class="status-badge status-badge--${statusClass(status)}">${escapeHtml(status)}</span>`;
}

function showNotice(message) {
  const notice = document.querySelector("#app-notice");
  notice.textContent = message;
  notice.hidden = false;
  window.clearTimeout(Number(notice.dataset.timeoutId || 0));
  const timeoutId = window.setTimeout(() => { notice.hidden = true; }, 3500);
  notice.dataset.timeoutId = String(timeoutId);
}

function renderLeagueOptions() {
  elements.leagueOptions.innerHTML = ALLOWED_LEAGUES.map((league) => `
    <label class="checkbox-row">
      <input type="checkbox" name="league" value="${escapeHtml(league.slug)}" />
      <span>${escapeHtml(league.name)} — ${escapeHtml(league.country)}</span>
    </label>
  `).join("");
}

function selectedLeagueSlugs() {
  return [...elements.form.querySelectorAll('input[name="league"]:checked')].map((input) => input.value);
}

function pickSignalClass(pick = {}) {
  const odds = Number(pick.decimalOdds ?? pick.cuota_decimal);
  const ev = Number(pick.expectedValuePct ?? pick.valor_esperado);
  const confidence = Number(pick.finalPickScore ?? pick.confidenceScore ?? pick.confidencePct ?? 0);
  const contradictions = [...(pick.contradictingData || []), ...(pick.riskFlags || [])];
  const requiresReview = Boolean(pick.requiresReview || pick.requiere_revision);
  if (pick.highlightColor) {
    return ["green", "blue"].includes(pick.highlightColor) && !requiresReview
      ? "pick-signal--pass"
      : "pick-signal--fail";
  }
  const passes = odds > 1 && Number.isFinite(ev) && ev > 0 && confidence >= 60
    && contradictions.length === 0 && !requiresReview;
  return passes ? "pick-signal--pass" : "pick-signal--fail";
}

function decoratePickSignals(container, selector, picks = []) {
  container.querySelectorAll(selector).forEach((element, index) => element.classList.add(pickSignalClass(picks[index] || {})));
}

function showModuleReady(button, content) {
  content.hidden = false;
  button.textContent = "Ocultar";
  button.classList.remove("button--ready");
  button.setAttribute("aria-expanded", "true");
}

function toggleReadyModule(button, content) {
  content.hidden = !content.hidden;
  button.textContent = content.hidden ? "Mostrar" : "Ocultar";
  button.classList.remove("button--ready");
  button.setAttribute("aria-expanded", String(!content.hidden));
}

const guideModuleParts = {
  "guide-coverage-module": { contents: () => [], buttons: () => [] },
  "guide-team-goals-module": { contents: () => [elements.teamGoalsContent], buttons: () => [elements.showTeamGoals], load: () => loadTeamGoals() },
  "guide-outcome-module": { contents: () => [elements.outcomeContent], buttons: () => [elements.showOutcome], load: () => loadOutcomeScenarios() },
  "guide-poisson-module": { contents: () => [elements.poissonContent], buttons: () => [elements.showPoisson], load: () => loadPoisson() },
  "guide-odds-module": { contents: () => [], buttons: () => [] },
  "guide-data-picks-module": { contents: () => [elements.dataPicksContent], buttons: () => [elements.showDataPicks], load: () => loadDataPicks() }
};

function resetAnalysisGuide() {
  collapseGuideModules({
    details: document.querySelectorAll("#analysis-guide-content details.guide-module"),
    parts: Object.values(guideModuleParts),
    extraContents: [elements.analysisContent],
    extraButtons: [elements.toggleAnalysis]
  });
}

function handleGuideModuleToggle(details) {
  const part = guideModuleParts[details.id];
  if (!part) return;
  if (!details.open) {
    part.contents().forEach((content) => { if (content) content.hidden = true; });
    part.buttons().forEach(resetModuleButton);
    return;
  }
  if (!selectedFixture()) return;
  part.load?.();
}

function competitionLeagues(value = elements.competition.value) {
  if (value === "world-cup") return ["world-cup"];
  if (value === "liga-mx") return ["liga-mx"];
  if (value === "europe") return ["la-liga", "bundesliga", "primeira-liga", "ligue-1"];
  if (value === "all") return ALLOWED_LEAGUES.map((league) => league.slug);
  return selectedLeagueSlugs();
}

function syncCompetitionCheckboxes() {
  if (elements.competition.value === "custom") return;
  const selected = new Set(competitionLeagues());
  elements.form.querySelectorAll('input[name="league"]').forEach((input) => { input.checked = selected.has(input.value); });
  updateLeagueCount();
}

function updateLeagueCount() {
  elements.leagueCount.textContent = `${selectedLeagueSlugs().length} de ${ALLOWED_LEAGUES.length}`;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

function applyTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  elements.themeToggle.setAttribute("aria-pressed", String(dark));
  elements.themeToggle.textContent = dark ? "Modo claro" : "Modo oscuro";
  elements.accountDarkMode.checked = dark;
  state.preferences.theme = dark ? "dark" : "light";
  writeLocalJson(PREFERENCES_KEY, state.preferences);
}

function addAlert(type, title, message, fixture = null) {
  const alert = {
    id: globalThis.crypto?.randomUUID?.() || `alert-${Date.now()}-${Math.random()}`,
    type, title, message, fixtureId: fixture?.id || null,
    match: fixture ? `${fixture.home} vs ${fixture.away}` : "", createdAt: new Date().toISOString(),
    read: false, missedWhileAway: document.visibilityState !== "visible" || state.currentView !== "alerts"
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 100);
  writeLocalJson(ALERTS_KEY, state.alerts);
  renderAlerts();
}

function renderAlerts() {
  const unread = state.alerts.filter((item) => !item.read);
  elements.alertCount.textContent = unread.length;
  elements.notificationCount.textContent = unread.length;
  elements.notificationToggle.classList.toggle("notification-menu__toggle--active", unread.length > 0);
  const alertHtml = (item, compact = false) => `<article class="alert-item alert-item--${escapeHtml(item.type)}${item.read ? " alert-item--read" : ""}">
    <div><strong>${escapeHtml(item.title)}</strong>${item.missedWhileAway ? '<span class="missed-badge">Mientras estabas fuera</span>' : ""}</div>
    <p>${escapeHtml(item.message)}</p>${item.match ? `<small>${escapeHtml(item.match)} · Hora del Pacífico</small>` : ""}
    ${compact ? "" : `<time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatUpdatedAt(item.createdAt))}</time>`}
  </article>`;
  elements.alertsList.innerHTML = state.alerts.length ? state.alerts.map((item) => alertHtml(item)).join("")
    : '<div class="saved-empty"><h3>Sin alertas</h3><p>Los cambios detectados al actualizar datos aparecerán aquí.</p></div>';
  elements.notificationList.innerHTML = unread.length ? unread.slice(0, 8).map((item) => alertHtml(item, true)).join("")
    : '<p class="notification-empty">No tienes notificaciones nuevas.</p>';
}

function markAlertsRead() {
  state.alerts.forEach((item) => { item.read = true; });
  writeLocalJson(ALERTS_KEY, state.alerts);
  renderAlerts();
}

function penaltyShootoutText(fixture) {
  const home = fixture?.penaltyScore?.home;
  const away = fixture?.penaltyScore?.away;
  return home !== null && home !== undefined && away !== null && away !== undefined
    ? `(${home}–${away} pen.)`
    : "";
}

function fixtureProgressBanner(fixture) {
  if (!fixture) return "";
  const hasScore = fixture.score?.home !== null && fixture.score?.away !== null;
  const penalties = penaltyShootoutText(fixture);
  const score = hasScore ? `${fixture.score.home} - ${fixture.score.away}${penalties ? ` ${penalties}` : ""}` : "VS";
  const clock = fixture.status === "live" && fixture.elapsed !== null ? `${fixture.elapsed}'` : fixture.statusLabel;
  return `<div class="fixture-progress fixture-progress--${escapeHtml(fixture.status)}"><span>${teamCrest(fixture.home, fixture.homeLogo)}</span><strong>${escapeHtml(fixture.home)} <b>${escapeHtml(score)}</b> ${escapeHtml(fixture.away)}</strong><span>${teamCrest(fixture.away, fixture.awayLogo)}</span><em>${escapeHtml(clock)} · Hora del Pacífico</em></div>`;
}

function showDataDialog() {
  if (!elements.dataDialog.open) {
    history.pushState({ ...(history.state || {}), dataDialogOpen: true }, "");
    elements.dataDialog.showModal();
  }
}

function closeDataDialog() {
  if (history.state?.dataDialogOpen) history.back();
  else if (elements.dataDialog.open) elements.dataDialog.close();
}

function pacificToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function shiftIsoDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clearSelectedFixtureData() {
  state.selectedFixtureId = null;
  elements.selectedSummary.className = "selected-summary selected-summary--empty";
  elements.selectedSummary.textContent = "Selecciona un partido para revisar la cobertura de datos.";
  elements.dataGrid.innerHTML = "";
  elements.dataStatus.className = "status-badge status-badge--unavailable";
  elements.dataStatus.textContent = "No disponible";
  renderResearchData(null);
  renderLiveData(null, null);
  showAnalysisEmpty();
}

function clearFilters() {
  const today = pacificToday();
  elements.dateFrom.value = today;
  elements.dateTo.value = today;
  elements.competition.value = "world-cup";
  elements.season.value = "auto";
  elements.status.value = "all";
  elements.form.querySelectorAll('input[name="league"]').forEach((input) => { input.checked = false; });
  syncCompetitionCheckboxes();
  state.fixtures = [];
  state.hasSearched = false;
  elements.searchFeedback.textContent = "";
  clearSelectedFixtureData();
  renderMatches();
}

function analysisUsageToday() {
  const stored = readLocalJson(ANALYSIS_USAGE_KEY, { date: pacificToday(), count: 0 });
  return stored.date === pacificToday() ? stored : { date: pacificToday(), count: 0 };
}

function responsibleLimitReached() {
  const limit = Number(state.preferences.dailyLimit);
  return Number.isFinite(limit) && limit > 0 && analysisUsageToday().count >= limit;
}

function recordAnalysisUsage() {
  const usage = analysisUsageToday();
  writeLocalJson(ANALYSIS_USAGE_KEY, { ...usage, count: usage.count + 1 });
}

function teamInitials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "FC";
}

function teamCrest(name, logo, size = "default") {
  const modifier = size === "large" ? " team-crest--large" : "";
  return logo
    ? `<span class="team-crest${modifier}"><img src="${escapeHtml(logo)}" alt="Logo de ${escapeHtml(name)}" loading="lazy" /></span>`
    : `<span class="team-crest team-crest--fallback${modifier}" aria-label="${escapeHtml(name)}">${escapeHtml(teamInitials(name))}</span>`;
}

function renderMatches() {
  elements.matchCount.textContent = `${state.fixtures.length} ${state.fixtures.length === 1 ? "partido" : "partidos"}`;
  elements.refreshFixtureStatuses.disabled = state.isRefreshingStatuses || !state.fixtures.some((fixture) => fixture.dataSource === "api-football");

  if (!state.fixtures.length) {
    elements.matchesList.innerHTML = `<div class="empty-results">${state.hasSearched ? "No se encontraron partidos para los filtros seleccionados." : "Selecciona una liga y un rango de fechas para buscar partidos."}</div>`;
    return;
  }

  const groups = ALLOWED_LEAGUES.map((league) => ({
    league,
    fixtures: state.fixtures.filter((fixture) => fixture.leagueSlug === league.slug)
  })).filter((group) => group.fixtures.length);

  elements.matchesList.innerHTML = groups.map(({ league, fixtures }) => `
    <section class="league-group" aria-labelledby="league-${escapeHtml(league.slug)}">
      <h3 id="league-${escapeHtml(league.slug)}"><span class="league-code">${escapeHtml(league.code)}</span>${escapeHtml(league.name)} · ${escapeHtml(league.country)}</h3>
      ${fixtures.map((fixture) => {
        const selected = state.selectedFixtureId === fixture.id;
        const isFinished = fixture.status === "finished";
        const showScore = ["finished", "live"].includes(fixture.status) && fixture.score?.home !== null && fixture.score?.away !== null;
        const homeFavorite = Boolean(fixture.favorite && fixture.favorite.teamId === fixture.homeTeamId);
        const awayFavorite = Boolean(fixture.favorite && fixture.favorite.teamId === fixture.awayTeamId);
        const probabilities = fixture.favorite?.probabilities;
        const probabilitySummary = probabilities && [probabilities.home, probabilities.draw, probabilities.away].every((value) => value !== null)
          ? ` Local gana: ${probabilities.home}%. Empate: ${probabilities.draw}%. Visitante gana: ${probabilities.away}%.`
          : "";
        const favoriteTitle = fixture.favorite ? `${fixture.favorite.note}${probabilitySummary}` : "";
        const teamName = (name, logo, favorite) => `<div class="match-card__team${favorite ? " match-card__team--favorite" : ""}">${teamCrest(name, logo)}<div><strong>${escapeHtml(name)}</strong>${favorite ? `<span class="favorite-badge" title="${escapeHtml(favoriteTitle)}">Favorito 1X2${fixture.favorite.percent !== null ? ` · ${escapeHtml(fixture.favorite.percent)}%` : ""}</span>` : ""}</div></div>`;
        const quality = fixture.dataQuality;
        return `
          <article class="match-card${selected ? " match-card--selected" : ""}" data-fixture-id="${escapeHtml(fixture.id)}" tabindex="0" ${selected ? 'aria-current="true"' : ""}>
            <div class="match-card__topline">
              <span class="match-card__league">${escapeHtml(fixture.leagueName)}</span>
              ${statusBadge(fixture.statusLabel)}
            </div>
            <div class="match-card__teams">
              ${teamName(fixture.home, fixture.homeLogo, homeFavorite)}
              <span class="match-card__versus">${showScore ? `<strong class="match-score">${escapeHtml(fixture.score.home)} – ${escapeHtml(fixture.score.away)}${penaltyShootoutText(fixture) ? `<small class="penalty-score">${escapeHtml(penaltyShootoutText(fixture))}</small>` : ""}</strong>` : "<strong>VS</strong>"}</span>
              ${teamName(fixture.away, fixture.awayLogo, awayFavorite)}
            </div>
            <div class="match-card__meta">
              <time datetime="${escapeHtml(fixture.utcDateTime || `${fixture.date}T${fixture.time}`)}">${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)} PT</time>
              <span>${escapeHtml(fixture.stadium || "Sede por confirmar")}</span>
              ${quality ? `<span class="data-quality data-quality--${escapeHtml(String(quality.level || "").toLowerCase())}">Calidad ${escapeHtml(quality.level)} · ${escapeHtml(quality.score)}/100</span>` : ""}
              ${fixture.status === "live" && fixture.elapsed !== null ? `<small>${escapeHtml(fixture.elapsed)} minutos</small>` : ""}
            </div>
            <div class="match-card__actions">
              <button class="button button--secondary" type="button" data-action="season">Ver temporada</button>
              <button class="button button--primary" type="button" data-action="data">Analizar datos</button>
            </div>
          </article>`;
      }).join("")}
    </section>
  `).join("") + `
    <div class="matches-footer">
      <span>Mostrando ${state.fixtures.length} de ${state.fixtures.length} partidos</span>
      <span>Fuente: ${state.fixtures.some((fixture) => fixture.dataSource === "api-football") ? "API-Football" : "demostración sintética"} · Horario del Pacífico (PT)</span>
      ${state.fixtures.some((fixture) => fixture.favorite) ? "<span>Verde = favorito estadístico del proveedor; no es una votación pública.</span>" : ""}
    </div>`;
}

function selectedFixture() {
  return state.fixtures.find((fixture) => fixture.id === state.selectedFixtureId) || MOCK_FIXTURES.find((fixture) => fixture.id === state.selectedFixtureId);
}

function renderFixtureData() {
  const fixture = selectedFixture();
  if (!fixture) return;

  const statuses = Object.values(fixture.dataAvailability);
  const overall = statuses.some((status) => status !== "Disponible") ? "Necesita revisión" : "Disponible";
  elements.dataStatus.className = `status-badge status-badge--${statusClass(overall)}`;
  elements.dataStatus.textContent = overall;
  elements.selectedSummary.className = "selected-summary";
  const sourceLabel = fixture.dataSource === "api-football" ? "API-Football" : "escenario sintético";
  const qualityLabel = fixture.dataQuality ? ` · Calidad ${fixture.dataQuality.level} ${fixture.dataQuality.score}/100` : "";
  const venueLabel = fixture.neutralVenue ? " · Sede neutral; equipo 1 y equipo 2" : "";
  const cacheStatus = fixture.cacheInfo?.status === "hit" ? "Cache" : fixture.cacheInfo?.status === "miss" ? "API" : "Fuente";
  const cacheReason = fixture.cacheInfo?.reason ? ` - ${fixture.cacheInfo.reason.replaceAll("_", " ")}` : "";
  const probabilities = fixture.favorite?.probabilities;
  const probabilityLine = probabilities && [probabilities.home, probabilities.draw, probabilities.away].every((value) => value !== null)
    ? `<small>1X2: ${escapeHtml(fixture.home)} ${escapeHtml(probabilities.home)}% · Empate ${escapeHtml(probabilities.draw)}% · ${escapeHtml(fixture.away)} ${escapeHtml(probabilities.away)}%</small>`
    : "";
  const score = ["finished", "live"].includes(fixture.status) && fixture.score?.home !== null && fixture.score?.away !== null
    ? `${escapeHtml(fixture.score.home)} <i>–</i> ${escapeHtml(fixture.score.away)}${penaltyShootoutText(fixture) ? `<small class="penalty-score">${escapeHtml(penaltyShootoutText(fixture))}</small>` : ""}`
    : `<span>VS</span>`;
  elements.selectedSummary.innerHTML = `
    <div class="selected-match__meta">
      <span>${escapeHtml(fixture.leagueName)}</span>
      ${statusBadge(fixture.statusLabel)}
    </div>
    <div class="selected-match__scoreboard">
      <div class="selected-match__team">${teamCrest(fixture.home, fixture.homeLogo, "large")}<span><strong>${escapeHtml(fixture.home)}</strong><small>ID API-Football: ${escapeHtml(fixture.homeTeamId || "No disponible")}</small></span></div>
      <div class="selected-match__score"><b>${score}</b><time>${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)} PT</time></div>
      <div class="selected-match__team">${teamCrest(fixture.away, fixture.awayLogo, "large")}<span><strong>${escapeHtml(fixture.away)}</strong><small>ID API-Football: ${escapeHtml(fixture.awayTeamId || "No disponible")}</small></span></div>
    </div>
    <div class="selected-match__details">
      <span>${escapeHtml(fixture.stadium || "Sede por confirmar")}${escapeHtml(venueLabel)}</span>
      <span class="source-chip source-chip--api">${escapeHtml(sourceLabel)}</span>
      <span class="source-chip source-chip--model">${escapeHtml(cacheStatus)}${escapeHtml(cacheReason)}</span>
      ${fixture.dataQuality ? `<span class="data-quality data-quality--${escapeHtml(String(fixture.dataQuality.level || "").toLowerCase())}">Confianza de datos ${escapeHtml(fixture.dataQuality.score)}/100</span>` : ""}
    </div>
    ${probabilityLine}`;
  updateAnalysisActionState();
  elements.showDataPicks.disabled = state.isLoadingDataPicks;
  const savedDataPicks = state.dataPicksByFixture.get(fixture.id);
  if (savedDataPicks) renderDataPicks(savedDataPicks);
  else {
    elements.dataPicksStatus.className = "status-badge status-badge--unavailable";
    elements.dataPicksStatus.textContent = "No disponible";
    elements.dataPicksContent.innerHTML = '<div class="research-empty">Pulsa “Mostrar” para evaluar este partido con los datos disponibles.</div>';
  }
  elements.dataPicksContent.hidden = true;
  if (savedDataPicks) { elements.showDataPicks.textContent = "Mostrar"; elements.showDataPicks.classList.remove("button--ready"); }
  elements.showOutcome.disabled = state.isLoadingOutcome;
  const savedOutcome = state.outcomeByFixture.get(fixture.id);
  if (savedOutcome) renderOutcomeScenarios(savedOutcome);
  else {
    elements.outcomeStatus.className = "status-badge status-badge--unavailable";
    elements.outcomeStatus.textContent = "No disponible";
    elements.outcomeContent.innerHTML = '<div class="research-empty">Pulsa "Mostrar" para revisar local, empate y visitante.</div>';
  }
  elements.outcomeContent.hidden = true;
  if (savedOutcome) { elements.showOutcome.textContent = "Mostrar"; elements.showOutcome.classList.remove("button--ready"); }
  elements.showPoisson.disabled = state.isLoadingPoisson;
  const savedPoisson = state.poissonByFixture.get(fixture.id);
  if (savedPoisson) renderPoisson(savedPoisson);
  else {
    elements.poissonStatus.className = "status-badge status-badge--unavailable";
    elements.poissonStatus.textContent = "No disponible";
    elements.poissonContent.innerHTML = '<div class="research-empty">Pulsa “Mostrar” para calcular el modelo Poisson.</div>';
  }
  elements.poissonContent.hidden = true;
  if (savedPoisson) { elements.showPoisson.textContent = "Mostrar"; elements.showPoisson.classList.remove("button--ready"); }
  elements.showTeamGoals.disabled = state.isLoadingTeamGoals;
  const savedTeamGoals = state.teamGoalsByFixture.get(fixture.id);
  if (savedTeamGoals) renderTeamGoals(savedTeamGoals);
  else {
    elements.teamGoalsStatus.className = "status-badge status-badge--unavailable";
    elements.teamGoalsStatus.textContent = "No disponible";
    elements.teamGoalsContent.innerHTML = '<div class="research-empty">Pulsa “Mostrar” para evaluar ataque y defensa.</div>';
  }
  elements.teamGoalsContent.hidden = true;
  if (savedTeamGoals) { elements.showTeamGoals.textContent = "Mostrar"; elements.showTeamGoals.classList.remove("button--ready"); }
  const savedPlayerGoals = state.playerGoalByFixture.get(fixture.id);
  elements.togglePlayerGoal.disabled = state.playerGoalLoadingFixtures.has(fixture.id);
  if (savedPlayerGoals) renderPlayerGoalCandidates(savedPlayerGoals);
  else {
    elements.playerGoalStatus.className = "status-badge status-badge--unavailable";
    elements.playerGoalStatus.textContent = "No disponible";
    elements.playerGoalContent.innerHTML = '<div class="research-empty">Analizando jugadores con mayor amenaza de gol…</div>';
  }
  elements.playerGoalContent.hidden = false;
  elements.togglePlayerGoal.textContent = "Ocultar";
  elements.togglePlayerGoal.setAttribute("aria-expanded", "true");
  elements.showCorners.disabled = state.isLoadingCorners;
  const savedCorners = state.cornersByFixture.get(fixture.id);
  if (savedCorners) renderCorners(savedCorners);
  else { elements.cornersStatus.className = "status-badge status-badge--unavailable"; elements.cornersStatus.textContent = "No disponible"; elements.cornersContent.innerHTML = '<div class="research-empty">Pulsa “Mostrar” para analizar corners oficiales.</div>'; }
  elements.cornersContent.hidden = true;
  if (savedCorners) { elements.showCorners.textContent = "Mostrar"; elements.showCorners.classList.remove("button--ready"); }
  elements.showSpecificMarkets.disabled = state.isLoadingSpecificMarkets;
  const savedSpecificMarkets = state.specificMarketsByFixture.get(fixture.id);
  if (savedSpecificMarkets) renderSpecificMarkets(savedSpecificMarkets);
  else {
    elements.specificMarketsStatus.className = "status-badge status-badge--unavailable";
    elements.specificMarketsStatus.textContent = "No disponible";
    elements.specificMarketsContent.innerHTML = '<div class="research-empty">Pulsa “Mostrar” para evaluar mercados específicos sin inventar datos.</div>';
  }
  elements.specificMarketsContent.hidden = false;
  elements.refreshCoverage.disabled = state.isRefreshingResearch;
  elements.openOddsDetail.disabled = false;
  const evidence = latestEvidenceForFixture(state.evidenceSnapshots, fixture.id);
  elements.evidenceToolbar.hidden = fixture.status !== "scheduled";
  elements.savePreMatchEvidence.disabled = fixture.status !== "scheduled" || state.isCapturingEvidence;
  elements.downloadEvidenceTxt.disabled = fixture.status !== "scheduled" || !evidence;
  elements.evidenceStatus.textContent = evidence
    ? `Evidencia guardada: ${formatUpdatedAt(evidence.capturedAt)} · Lista para auditoría después del resultado final.`
    : fixture.status === "scheduled" ? "Sin evidencia prepartido guardada." : "La evidencia solo puede guardarse antes del inicio.";
  elements.guideOddsContent.innerHTML = renderOddsDetail(fixture.confirmedData?.odds || []);
  renderGuideCoverageSummary(fixture);
  renderCoverageTable(fixture);
  renderResearchData(fixture.researchData);
  elements.researchContent.hidden = false;
  renderLiveData(fixture.researchData, fixture);
}

function renderGuideCoverageSummary(fixture) {
  const research = fixture?.researchData;
  if (!research) {
    elements.guideCoverageSummary.innerHTML = '<div class="research-empty">No hay investigación normalizada para construir el resumen de cobertura.</div>';
    return;
  }
  const score = Number(research.totalConfidenceScore ?? fixture.dataQuality?.score ?? 0);
  const status = research.analysisStatus === "complete" ? "Completo" : research.analysisStatus === "partial" ? "Parcial" : score > 0 ? "Parcial" : "No disponible";
  const activeSources = [...new Set((research.sourceCoverage || []).flatMap((item) => item.activeSources || []))];
  const criticalKeys = ["statsForm", "odds", "injuriesSuspensions", "lineups", "xgXga"];
  const criticalLabels = { statsForm: "Forma", odds: "Cuotas", injuriesSuspensions: "Bajas", lineups: "Alineaciones", xgXga: "xG / xGA" };
  const availableCritical = criticalKeys.filter((key) => ["available", "partial"].includes(research[key]?.status));
  const missing = research.missingData || [];
  const highImpact = new Set((research.criticalMissingData || []).map((item) => item.module || item.key || item));
  const impact = (item) => highImpact.has(item.module) || criticalKeys.includes(item.module)
    ? "high" : ["standings", "contextCalendar"].includes(item.module) ? "medium" : "low";
  const impactLabel = { high: "Alto impacto", medium: "Impacto medio", low: "Bajo impacto" };
  elements.guideCoverageSummary.innerHTML = `
    <div class="coverage-executive__score" style="--coverage-score:${Math.max(0, Math.min(100, score))}"><strong>${escapeHtml(score)}</strong><span>Confianza / 100</span></div>
    <div class="coverage-executive__kpis"><article><span>Estado</span>${statusBadge(status)}</article><article><span>Fuentes activas</span><strong>${activeSources.length}</strong><small>${escapeHtml(activeSources.slice(0, 3).join(" · ") || "Sin fuente activa")}</small></article><article><span>Críticos disponibles</span><strong>${availableCritical.length}/${criticalKeys.length}</strong><small>${escapeHtml(availableCritical.map((key) => criticalLabels[key]).join(" · ") || "Ninguno")}</small></article><article><span>Críticos faltantes</span><strong>${criticalKeys.length - availableCritical.length}</strong><small>Revisar antes de decidir</small></article></div>
    <div class="coverage-impact"><strong>Impacto de datos faltantes</strong>${missing.length ? missing.map((item) => { const level = impact(item); return `<span class="impact-chip impact-chip--${level}"><b>${impactLabel[level]}</b>${escapeHtml(item.label || item.module || "Dato")}</span>`; }).join("") : '<span class="impact-chip impact-chip--ok"><b>Sin bloqueo</b>No se reportan faltantes en la matriz.</span>'}</div>`;
}

function renderCoverageTable(fixture) {
  const coverageRows = new Map((fixture.researchData?.sourceCoverage || []).map((row) => [row.moduleKey, row]));
  elements.dataGrid.innerHTML = `
    <div class="detail-table-wrap coverage-table-wrap">
      <table class="detail-table coverage-table">
        <thead>
          <tr>
            <th>Dato</th>
            <th>Estado</th>
            <th>Fuente principal</th>
            <th>Respaldo</th>
            <th>Fuente activa</th>
            <th>Actualización</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          ${DATA_CATEGORIES.map((category) => {
            const moduleKey = CATEGORY_TO_RESEARCH_MODULE[category.key];
            const researchModule = fixture.researchData?.[moduleKey];
            const coverage = coverageRows.get(moduleKey);
            const status = researchModule ? researchStatusLabel(researchModule.status) : fixture.dataAvailability[category.key] || "No disponible";
            const primary = coverage?.primarySources?.join(" / ") || "API-Football";
            const backup = coverage?.secondarySources?.join(" / ") || "Sin respaldo activo";
            const active = coverage?.activeSources?.join(" / ") || (researchModule?.source ? researchSourceLabel(moduleKey, researchModule) : "Ninguna");
            const sourceType = active.includes("modelo interno") ? "model" : active.includes("API-Football") ? "api" : "external";
            return `<tr class="coverage-row coverage-row--${sourceType}">
              <td data-label="Dato"><strong>${labelWithTooltip(category.label, category.key === "xg" ? "xg" : category.key === "odds" ? "odds" : null)}</strong></td>
              <td data-label="Estado">${statusBadge(status)}</td>
              <td data-label="Fuente principal">${escapeHtml(primary)}</td>
              <td data-label="Respaldo">${escapeHtml(backup)}</td>
              <td data-label="Fuente activa"><span class="source-chip source-chip--${sourceType}">${escapeHtml(active)}</span></td>
              <td data-label="Actualización">${escapeHtml(formatUpdatedAt(researchModule?.updatedAt || coverage?.updatedAt))}</td>
              <td data-label="Detalle"><button class="button button--secondary button--compact" type="button" data-category="${escapeHtml(category.key)}">Ver datos</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function updateAnalysisActionState() {
  const fixture = selectedFixture();
  elements.generateSelectedAnalysis.disabled = !fixture || state.isAnalyzing;
  elements.explainSelectedAnalysis.disabled = !fixture || fixture.status === "finished" || state.isAnalyzing;
  elements.generateSelectedAnalysis.textContent = state.isAnalyzing ? "Procesando…" : "Analizar con datos";
  elements.explainSelectedAnalysis.textContent = state.isAnalyzing ? "Procesando…" : "Explicar con IA";
}

function researchStatusLabel(status) {
  return researchStatusLabels[status] || "No disponible";
}

function formatUpdatedAt(value) {
  if (!value) return "Sin actualización registrada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin actualización registrada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function researchSourceLabel(moduleKey, module) {
  if (module?.source === "api-football") return "API-Football";
  if (module?.source === "oddspedia") return "Oddspedia · búsqueda web";
  if (module?.source === "fotmob") return "FotMob · búsqueda web";
  if (module?.source === "whoScored") return "WhoScored · búsqueda web";
  if (module?.source === "fbref") return "FBref · búsqueda web";
  if (module?.source === "weather") return "Open-Meteo";
  if (module?.source === "soccerway") return "Soccerway · búsqueda web";
  if (module?.source === "api-football-internal-model") return "API-Football + modelo interno";
  if (module?.source) return module.source;
  if (["xgXga", "weatherPitch"].includes(moduleKey)) return "Sin fuente configurada";
  return "API-Football consultada sin datos";
}

function renderResearchData(research) {
  elements.refreshResearch.disabled = !selectedFixture() || state.isRefreshingResearch;
  if (!research) {
    elements.researchSummary.className = "research-empty";
    elements.researchSummary.textContent = "Este partido todavía no tiene una investigación normalizada disponible.";
    elements.sourceCoverage.hidden = true;
    elements.sourceCoverage.innerHTML = "";
    elements.researchGrid.innerHTML = "";
    return;
  }

  const score = Math.max(0, Math.min(100, Number(research.totalConfidenceScore) || 0));
  const analysisLabel = analysisStatusLabels[research.analysisStatus] || "Necesita revisión";
  const critical = (research.criticalMissingData || []).map((item) => item.label).filter(Boolean);
  const consultedSources = Object.values(research.sources || {}).filter((source) => ["available", "partial"].includes(source.status)).map((source) => source.label);
  elements.researchSummary.className = "research-summary";
  elements.researchSummary.innerHTML = `
    <div class="confidence-score confidence-score--${score >= 75 ? "high" : score >= 45 ? "medium" : "low"}">
      <strong>${score}</strong><span>/100</span>
    </div>
    <div class="research-summary__content">
      <div><strong>Nivel de confianza del análisis ${infoTooltip("confidence")}</strong>${statusBadge(analysisLabel)}</div>
      <div class="confidence-track" role="progressbar" aria-label="Nivel de confianza" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><span style="width:${score}%"></span></div>
      <p>${critical.length ? `<strong>Datos críticos faltantes:</strong> ${escapeHtml(critical.join(", "))}` : "No se detectaron tres o más faltantes críticos."}</p>
      <p><strong>Fuentes consultadas:</strong> ${escapeHtml(consultedSources.join(", ") || "Ninguna fuente activa")}</p>
      <small>Última actualización: ${escapeHtml(formatUpdatedAt(research.lastUpdated))}</small>
    </div>`;
  renderSourceCoverage(research);

  elements.researchGrid.innerHTML = "";
}

function renderSourceCoverage(research) {
  const sources = Object.values(research.sources || {});
  const rows = research.sourceCoverage || [];
  elements.sourceCoverage.hidden = false;
  elements.sourceCoverage.innerHTML = `
    <section class="source-registry" aria-labelledby="source-registry-title">
      <div class="source-registry__heading"><div><h3 id="source-registry-title">Estado de fuentes</h3><p>Las fuentes complementarias solo aparecen activas cuando aportan datos verificables.</p></div></div>
      <div class="source-pills">${sources.map((source) => `<span class="source-pill" title="${escapeHtml((source.notes || []).join(" "))}"><strong>${escapeHtml(source.label)}</strong>${statusBadge(researchStatusLabel(source.status))}</span>`).join("")}</div>
    </section>
    <section class="source-matrix" aria-labelledby="source-matrix-title">
      <div class="source-registry__heading"><div><h3 id="source-matrix-title">Matriz por módulo</h3><p>Plan de fuente principal, respaldo y cobertura realmente disponible.</p></div></div>
      <div class="detail-table-wrap"><table class="detail-table source-table"><thead><tr><th>Módulo</th><th>Fuente principal</th><th>Respaldo</th><th>Fuente activa</th><th>Estado</th><th>Calidad</th><th>Actualización</th><th>Observación</th></tr></thead><tbody>${rows.map((row) => `<tr><td data-label="Módulo"><strong>${escapeHtml(row.label)}</strong></td><td data-label="Fuente principal">${escapeHtml(row.primarySources.join(" / ") || "—")}</td><td data-label="Respaldo">${escapeHtml(row.secondarySources.join(" / ") || "—")}</td><td data-label="Fuente activa">${escapeHtml(row.activeSources.join(" / ") || "Ninguna")}</td><td data-label="Estado">${statusBadge(researchStatusLabel(row.status))}</td><td data-label="Calidad"><strong>${escapeHtml(row.quality?.label || (row.status === "available" ? "Alta" : row.status === "partial" ? "Parcial" : "No disponible"))}</strong></td><td data-label="Actualización">${escapeHtml(formatUpdatedAt(row.updatedAt))}</td><td data-label="Observación">${escapeHtml(row.observation)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

function researchMeta(moduleKey, module) {
  return `<div class="research-detail-meta"><div><span>Estado</span>${statusBadge(researchStatusLabel(module.status))}</div><div><span>Fuente</span><strong>${escapeHtml(researchSourceLabel(moduleKey, module))}</strong></div><div><span>Actualización</span><strong>${escapeHtml(formatUpdatedAt(module.updatedAt))}</strong></div></div>${module.message ? `<div class="detail-note"><strong>Observación</strong><span>${escapeHtml(module.message)}</span></div>` : ""}`;
}

function researchTeamStats(title, values) {
  return `<section class="team-stat-card"><h3>${escapeHtml(title)}</h3>${values.map(([label, value]) => `<div class="stat-row"><span>${escapeHtml(label)}</span><strong>${displayValue(value)}</strong></div>`).join("")}</section>`;
}

function renderResearchModuleDetail(moduleKey, research) {
  const module = research?.[moduleKey];
  if (!module) return emptyDetail("No existe información normalizada para este módulo.");
  let content = "";
  if (moduleKey === "standings") {
    content = `<div class="team-stat-grid">${researchTeamStats(research.homeTeam.name, [["Posición", module.home?.rank], ["Puntos", module.home?.points], ["Partidos", module.home?.played], ["Diferencia de gol", module.home?.goalDifference], ["Forma", module.home?.form]])}${researchTeamStats(research.awayTeam.name, [["Posición", module.away?.rank], ["Puntos", module.away?.points], ["Partidos", module.away?.played], ["Diferencia de gol", module.away?.goalDifference], ["Forma", module.away?.form]])}</div>`;
  } else if (moduleKey === "h2h") {
    const rows = (module.matches || []).map((match) => [displayValue(match.date), displayValue(match.homeTeam), `<strong>${displayValue(match.homeGoals)} – ${displayValue(match.awayGoals)}</strong>`, displayValue(match.awayTeam)]);
    content = `<div class="research-kpis"><span>Victorias ${escapeHtml(research.homeTeam.name)} <strong>${displayValue(module.homeWins)}</strong></span><span>Empates <strong>${displayValue(module.draws)}</strong></span><span>Victorias ${escapeHtml(research.awayTeam.name)} <strong>${displayValue(module.awayWins)}</strong></span></div>${rows.length ? detailTable(["Fecha", "Local", "Marcador", "Visitante"], rows) : emptyDetail("No hay enfrentamientos disponibles.")}`;
  } else if (moduleKey === "odds") {
    const decision = research.pickDecision || {};
    const roleFor = (market) => market.selectionKey === decision.recommendedPick?.selectionKey ? "Mejor pick"
      : market.selectionKey === decision.conservativeAlternative?.selectionKey ? "Conservador"
        : market.selectionKey === decision.valueAlternative?.selectionKey ? "Valor"
          : market.highlightColor === "red" ? "Evitar" : "Evaluado";
    const rows = (module.markets || []).map((market) => [
      `<span class="pick-highlight pick-highlight--${escapeHtml(market.highlightColor || "orange")}">${escapeHtml(market.colorMeaning || "Riesgo")}</span>`,
      labelWithTooltip(market.market),
      `<div class="selection-add"><div><strong>${displayValue(market.selection)}</strong><small class="pick-role">${escapeHtml(roleFor(market))}</small></div><button class="selection-add__button" type="button" data-add-odds-pick="${escapeHtml(market.selectionKey || "")}" ${!["green", "orange"].includes(market.highlightColor) || !market.selectionKey ? "disabled" : ""} aria-label="Agregar ${escapeHtml(market.selection || "selección")} al parlay" title="Agregar al parlay">+</button></div>`,
      displayValue(market.decimalOdds),
      `${displayValue(market.impliedProbabilityPct)}%`,
      `${displayValue(market.estimatedProbabilityPct)}%`,
      `${displayValue(market.expectedValuePct)}%`,
      `<strong>${escapeHtml(market.confidenceLevel || "Baja")}</strong><small>${displayValue(market.finalPickScore, 0)}/100</small>`,
      `<span title="${escapeHtml(market.explanation || "Sin explicación adicional")}">${escapeHtml(market.explanation || (market.requiresReview ? "Requiere revisión" : "Verificado"))}</span>`
    ]);
    const legend = `<div class="pick-color-legend" aria-label="Leyenda de colores"><strong>Leyenda</strong><span><i class="pick-dot pick-dot--green"></i>Confiable</span><span><i class="pick-dot pick-dot--orange"></i>Riesgo</span><span><i class="pick-dot pick-dot--red"></i>Evitar</span></div>`;
    const summary = decision.matchProfile ? `<div class="pick-decision-summary"><div><span>Favorito real</span><strong>${escapeHtml(decision.favoriteTeam || "No identificado")}</strong><small>${escapeHtml(decision.favoriteStrength || "none")}</small></div><div><span>Perfil</span><strong>${escapeHtml(decision.matchProfile)}</strong></div><div><span>Mejor pick</span><strong>${escapeHtml(decision.recommendedPick?.selection || "Sin pick")}</strong></div><div><span>Alternativa conservadora</span><strong>${escapeHtml(decision.conservativeAlternative?.selection || "Sin alternativa")}</strong></div></div>` : "";
    const rowClasses = (module.markets || []).map(pickSignalClass);
    content = rows.length ? `${renderOddsMonitor(selectedFixture()?.confirmedData?.odds || [])}${summary}${legend}${detailTable(["Nivel", "Mercado", "Selección", "Cuota", "Implícita", "Modelo", "EV", "Confianza", "Explicación"], rows, rowClasses)}` : emptyDetail("No hay cuotas principales verificables.");
  } else if (moduleKey === "contextCalendar") {
    content = `<div class="team-stat-grid">${researchTeamStats(research.homeTeam.name, [["Días de descanso", module.homeRestDays], ["Próximos partidos", module.homeUpcomingMatches?.length || 0]])}${researchTeamStats(research.awayTeam.name, [["Días de descanso", module.awayRestDays], ["Próximos partidos", module.awayUpcomingMatches?.length || 0]])}</div>${(module.notes || []).length ? `<ul class="detail-list">${module.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}`;
  } else if (moduleKey === "statsForm") {
    const matchRows = (team, matches) => (matches || []).map((match) => [escapeHtml(team), displayValue(match.date), displayValue(match.opponent), displayValue(match.venue), `<strong>${displayValue(match.goalsFor)}–${displayValue(match.goalsAgainst)}</strong>`, displayValue(match.result)]);
    content = `<div class="team-stat-grid">${researchTeamStats(research.homeTeam.name, [["Goles a favor", module.homeGoalsFor], ["Goles en contra", module.homeGoalsAgainst], ["Tasa de victoria", module.homeWinRate === null ? null : `${module.homeWinRate}%`], ["Porterías a cero", module.homeCleanSheets]])}${researchTeamStats(research.awayTeam.name, [["Goles a favor", module.awayGoalsFor], ["Goles en contra", module.awayGoalsAgainst], ["Tasa de victoria", module.awayWinRate === null ? null : `${module.awayWinRate}%`], ["Porterías a cero", module.awayCleanSheets]])}</div>${detailTable(["Equipo", "Fecha", "Rival", "Sede", "Marcador", "Resultado"], [...matchRows(research.homeTeam.name, module.homeLastMatches), ...matchRows(research.awayTeam.name, module.awayLastMatches)])}`;
  } else if (moduleKey === "injuriesSuspensions") {
    const absenceRows = (team, side) => ["injuries", "suspensions", "doubts"].flatMap((kind) => (side?.[kind] || []).map((player) => [escapeHtml(team), kind === "injuries" ? "Lesión" : kind === "suspensions" ? "Sanción" : "Duda", displayValue(player.name), displayValue(player.reason || player.type)]));
    const rows = [...absenceRows(research.homeTeam.name, module.home), ...absenceRows(research.awayTeam.name, module.away)];
    content = rows.length ? detailTable(["Equipo", "Tipo", "Jugador", "Motivo"], rows) : emptyDetail("No se recibieron registros. Esto no confirma que no existan bajas.");
  } else if (moduleKey === "lineups") {
    const playerList = (team, formation, players) => `<section class="lineup-card"><h3>${escapeHtml(team)} · ${displayValue(formation)}</h3>${players?.length ? `<ol class="player-list">${players.map((player) => `<li><span>${displayValue(player.number)}</span>${displayValue(player.name)}<small>${displayValue(player.position)}</small></li>`).join("")}</ol>` : `<p class="muted-text">Sin once inicial disponible.</p>`}</section>`;
    const homePlayers = module.homeStartingXI?.length ? module.homeStartingXI : module.probableHomeXI;
    const awayPlayers = module.awayStartingXI?.length ? module.awayStartingXI : module.probableAwayXI;
    content = `<div class="detail-note"><strong>${module.confirmed ? "Alineaciones confirmadas" : "Alineaciones probables / sin confirmación"}</strong><span>La confirmación exige once inicial oficial para ambos equipos.</span></div><div class="lineups-grid">${playerList(research.homeTeam.name, module.homeFormation, homePlayers)}${playerList(research.awayTeam.name, module.awayFormation, awayPlayers)}</div>`;
  } else if (moduleKey === "xgXga") {
    const historicalEstimated = module.type === "historical_estimated" || module.dataSource === "historical_api_estimate";
    const estimated = historicalEstimated || ["estimated", "fixture_estimated"].includes(module.type);
    const confidenceLabel = (value) => ({
      high: historicalEstimated ? "Aceptable" : "Alta",
      medium: "Media",
      low: "Baja",
      not_available: "No disponible"
    }[value] || "No disponible");
    const modeLabel = historicalEstimated ? "Estimado con partidos anteriores" : estimated ? "Fixture actual" : "Oficial";
    const teamRows = [
      [escapeHtml(research.homeTeam.name), displayValue(module.homeXG), displayValue(module.homeXGA), modeLabel, displayValue(module.homeSampleSize ?? module.sampleSize), confidenceLabel(module.homeConfidence?.label || module.confidenceLabel)],
      [escapeHtml(research.awayTeam.name), displayValue(module.awayXG), displayValue(module.awayXGA), modeLabel, displayValue(module.awaySampleSize ?? module.sampleSize), confidenceLabel(module.awayConfidence?.label || module.confidenceLabel)]
    ];
    const teams = detailTable(["Equipo", estimated ? "xG estimado" : "xG", estimated ? "xGA estimado" : "xGA", "Modo", "Muestra", "Confianza"], teamRows);
    const mandatoryText = historicalEstimated
      ? "xG / xGA estimado con base en partidos anteriores. No requiere enfrentamiento directo entre ambos equipos. No corresponde a xG real ni oficial del partido actual."
      : "xG/xGA estimado calculado internamente con estadísticas del partido desde API-Football. No corresponde a xG oficial.";
    const metadata = estimated
      ? `<div class="detail-note detail-note--info"><strong>API-Football + modelo interno · ${escapeHtml(module.modelVersion || (historicalEstimated ? "historical-estimated-xg-v1" : "fixture-estimated-xg-v1"))}</strong><span>${escapeHtml(mandatoryText)}</span></div>
        ${module.missingFields?.length ? `<div class="detail-note"><strong>Datos faltantes</strong><span>${escapeHtml(module.missingFields.join(", "))}</span></div>` : ""}
        ${module.notes?.length ? `<div class="detail-note"><strong>Notas de revisión</strong><span>${escapeHtml(module.notes.join(" "))}</span></div>` : ""}`
      : "";
    const fixtureRows = historicalEstimated
      ? ["home", "away"].flatMap((side) => (module.fixturesUsed?.[side] || []).map((fixture) => [
        escapeHtml(side === "home" ? research.homeTeam.name : research.awayTeam.name),
        displayValue(fixture.date),
        displayValue(fixture.opponent),
        fixture.venue === "home" ? "Local" : "Visitante",
        displayValue(fixture.estimatedXG),
        displayValue(fixture.estimatedXGA)
      ]))
      : [];
    const rawStatLabels = {
      totalShots: "Tiros totales", shotsOnGoal: "Tiros a puerta", shotsOffGoal: "Tiros fuera",
      shotsInsideBox: "Tiros dentro del área", shotsOutsideBox: "Tiros fuera del área",
      blockedShots: "Tiros bloqueados", cornerKicks: "Corners", ballPossession: "Posesión",
      goalkeeperSaves: "Atajadas", penalties: "Penales detectados", bigChances: "Grandes ocasiones",
      dangerousAttacks: "Ataques peligrosos"
    };
    const rawStats = !historicalEstimated && estimated && module.rawStats
      ? `<section class="detail-section"><h3>Datos base usados</h3>${detailTable(
        ["Dato", research.homeTeam.name, research.awayTeam.name],
        Object.entries(rawStatLabels).map(([key, label]) => [
          escapeHtml(label),
          displayValue(module.rawStats.home?.[key]),
          displayValue(module.rawStats.away?.[key])
        ])
      )}</section>`
      : "";
    const skippedReasonLabel = {
      invalid_fixture: "Fixture inválido",
      statistics_request_failed: "Falló la consulta de estadísticas",
      insufficient_statistics: "Estadísticas insuficientes"
    };
    const diagnostics = historicalEstimated && module.diagnostics
      ? `<section class="detail-section"><h3>Trazabilidad de la muestra</h3>${detailTable(
        ["Equipo", "Intentados", "Usados", "Omitidos"],
        ["home", "away"].map((side) => {
          const item = module.diagnostics?.[side] || {};
          const skipped = (item.skippedFixtures || []).map((fixture) =>
            `${fixture.fixtureId || "Sin ID"}: ${skippedReasonLabel[fixture.reason] || fixture.reason}`
          ).join("; ");
          return [
            escapeHtml(side === "home" ? research.homeTeam.name : research.awayTeam.name),
            displayValue(item.attemptedFixtures, 0),
            displayValue(item.usedFixtures, 0),
            escapeHtml(skipped || "Ninguno")
          ];
        })
      )}</section>`
      : !historicalEstimated && estimated && module.diagnostics
        ? `<div class="detail-note"><strong>Diagnóstico de cobertura</strong><span>Estadísticas local: ${module.diagnostics.statisticsAvailable?.home ? "sí" : "no"} · Estadísticas visitante: ${module.diagnostics.statisticsAvailable?.away ? "sí" : "no"} · Eventos: ${module.diagnostics.eventsAvailable ? "sí" : "no"} · Penales detectados: ${displayValue(module.diagnostics.detectedPenalties?.home, 0)} / ${displayValue(module.diagnostics.detectedPenalties?.away, 0)}</span></div>`
        : "";
    const fixtures = fixtureRows.length
      ? `<section class="detail-section"><h3>Partidos usados</h3>${detailTable(["Equipo", "Fecha", "Rival", "Sede", "xG estimado", "xGA estimado"], fixtureRows)}</section>`
      : "";
    content = `${metadata}${teams}${diagnostics}${rawStats}${fixtures}`;
  } else if (moduleKey === "weatherPitch") {
    content = `${researchTeamStats("Clima y cancha", [["Temperatura (°C)", module.temperature], ["Probabilidad de lluvia (%)", module.rainProbability], ["Viento (km/h)", module.windSpeed], ["Humedad (%)", module.humidity], ["Condición", module.condition], ["Ubicación verificada", module.matchedLocation], ["Cancha estimada", module.pitchNotes]])}`;
  }
  return `${researchMeta(moduleKey, module)}${content || emptyDetail("No hay detalle adicional disponible.")}`;
}

function openResearchDetail(moduleKey) {
  const fixture = selectedFixture();
  const research = fixture?.researchData;
  const config = RESEARCH_MODULES.find((item) => item.key === moduleKey);
  if (!research || !config) return;
  elements.dataDialogTitle.textContent = config.label;
  elements.dataDialogSubtitle.textContent = `${fixture.home} vs ${fixture.away} · Investigación normalizada`;
  elements.dataDialogContent.innerHTML = `${fixtureProgressBanner(fixture)}${renderResearchModuleDetail(moduleKey, research)}`;
  showDataDialog();
}

function renderSupportingDetail(moduleKey, research) {
  const module = research?.supportingData?.[moduleKey];
  if (!module) return emptyDetail("No existe información complementaria para este módulo.");
  const caution = module.analysisUse === "post_match_audit_only"
    ? '<div class="detail-note"><strong>Solo auditoría posterior</strong><span>Estos datos no se envían como evidencia a OpenAI para justificar una predicción prepartido.</span></div>'
    : `<div class="detail-note detail-note--info"><strong>Corte temporal protegido</strong><span>Estadísticas consultadas hasta ${displayValue(module.cutoffDate)}, antes del fixture.</span></div>`;
  let content = "";
  if (moduleKey === "fixtureEvents") {
    const rows = (module.events || []).map((event) => [`${displayValue(event.elapsed)}${event.extra ? `+${displayValue(event.extra)}` : ""}'`, displayValue(event.team), displayValue(event.player), displayValue(event.type), displayValue(event.detail)]);
    content = `<div class="research-kpis"><span>Goles <strong>${displayValue(module.summary?.goals, 0)}</strong></span><span>Tarjetas <strong>${displayValue(module.summary?.cards, 0)}</strong></span><span>Cambios <strong>${displayValue(module.summary?.substitutions, 0)}</strong></span></div>${rows.length ? detailTable(["Minuto", "Equipo", "Jugador", "Tipo", "Detalle"], rows) : emptyDetail("No hay eventos publicados para este fixture.")}`;
  } else if (moduleKey === "playerPerformance") {
    const rows = (module.teams || []).flatMap((team) => (team.players || []).map((player) => [displayValue(team.team), displayValue(player.name), displayValue(player.position), displayValue(player.minutes), displayValue(player.rating), displayValue(player.shotsOnTarget), displayValue(player.goals), displayValue(player.assists), displayValue(player.keyPasses), displayValue(player.tackles)])).sort((a, b) => Number(b[4] || 0) - Number(a[4] || 0)).slice(0, 30);
    content = rows.length ? detailTable(["Equipo", "Jugador", "Pos.", "Min.", "Rating", "Tiros arco", "Goles", "Asist.", "Pases clave", "Entradas"], rows) : emptyDetail("No hay rendimiento individual publicado.");
  } else if (moduleKey === "teamSeasonStatistics") {
    const seasonCard = (teamName, data) => researchTeamStats(teamName, [["Forma", data?.form], ["Partidos", data?.played], ["G / E / P", data ? `${displayValue(data.wins)} / ${displayValue(data.draws)} / ${displayValue(data.losses)}` : null], ["Goles a favor", data?.goalsFor], ["Goles en contra", data?.goalsAgainst], ["Promedio GF / GC", data ? `${displayValue(data.averageGoalsFor)} / ${displayValue(data.averageGoalsAgainst)}` : null], ["Porterías a cero", data?.cleanSheets], ["Sin marcar", data?.failedToScore], ["Formación más usada", data?.commonLineups?.[0]?.formation]]);
    content = `<div class="team-stat-grid">${seasonCard(research.homeTeam.name, module.home)}${seasonCard(research.awayTeam.name, module.away)}</div>`;
  }
  return `${researchMeta(moduleKey, module)}${caution}${content || emptyDetail("No hay detalle complementario disponible.")}`;
}

function renderLiveData(research, fixture = selectedFixture()) {
  if (elements.refreshLiveNow) elements.refreshLiveNow.disabled = !fixture || state.isRefreshingLive;
  if (elements.liveLastUpdated) {
    const updatedAt = state.lastLiveRefreshAt || fixture?.fetchedAt || research?.updatedAt || research?.generatedAt || null;
    elements.liveLastUpdated.textContent = updatedAt ? `Última actualización: ${formatUpdatedAt(updatedAt)}` : "Última actualización: sin datos";
  }
  const entries = [
    ["fixtureEvents", elements.liveEventsStatus, elements.liveEventsContent, "La API todavía no publica eventos para este encuentro."],
    ["playerPerformance", elements.livePlayersStatus, elements.livePlayersContent, "La API todavía no publica rendimiento individual para este encuentro."]
  ];
  for (const [key, statusElement, contentElement, emptyMessage] of entries) {
    const module = research?.supportingData?.[key];
    const label = module ? researchStatusLabel(module.status) : "No disponible";
    statusElement.className = `status-badge status-badge--${statusClass(label)}`;
    statusElement.textContent = label;
    contentElement.innerHTML = fixture && research
      ? `${fixtureProgressBanner(fixture)}${renderSupportingDetail(key, research)}`
      : `<div class="research-empty">${escapeHtml(fixture ? emptyMessage : "Selecciona un partido para consultar esta información.")}</div>`;
  }
}

function localDatetimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function useSelectedFixtureForSimulation() {
  const fixture = selectedFixture();
  if (!fixture) return showNotice("Selecciona primero un encuentro en Dashboard.");
  elements.simulationCompetition.value = fixture.leagueName || "";
  elements.simulationTeamAId.value = fixture.homeTeamId || "";
  elements.simulationTeamAName.value = fixture.home || "";
  elements.simulationTeamBId.value = fixture.awayTeamId || "";
  elements.simulationTeamBName.value = fixture.away || "";
  elements.simulationFixtureDate.value = localDatetimeValue(fixture.utcDateTime || fixture.date);
  elements.simulationCompare.dataset.fixtureId = fixture.id || "";
  showNotice("Simulación preparada con el encuentro seleccionado.");
}

function renderSimulationComparison(result) {
  const status = result.status === "available" ? "Disponible" : result.status === "partial" ? "Parcial" : "No disponible";
  elements.simulationStatus.className = `status-badge status-badge--${statusClass(status)}`;
  elements.simulationStatus.textContent = status;
  if (!result.metrics?.length) {
    elements.simulationResults.innerHTML = `<div class="research-empty"><strong>${escapeHtml(status)}</strong><p>${escapeHtml(result.message || "No hay datos suficientes para comparar equipos.")}</p></div>`;
    return;
  }
  const rows = result.metrics.map((row) => `<tr>
    <td>${escapeHtml(row.label)}</td>
    <td>${displayValue(row.teamA)}${escapeHtml(row.suffix || "")}</td>
    <td>${displayValue(row.teamB)}${escapeHtml(row.suffix || "")}</td>
    <td>${row.difference === null ? "No disponible" : `${displayValue(row.difference)}${escapeHtml(row.suffix || "")}`}</td>
    <td>${escapeHtml(row.advantage)}</td>
    <td>${escapeHtml(row.quality === "available" ? "Disponible" : "Parcial")}</td>
  </tr>`).join("");
  const fixtureList = (team) => `<article><strong>${escapeHtml(team.name)}</strong><span>${displayValue(team.matchesWithStatistics, 0)} / ${displayValue(result.windowSize, 0)} partidos con estadística</span><small>${team.fixturesUsed.map((item) => `${(item.date || "").slice(0, 10)} ${item.home} vs ${item.away}`).join(" | ") || "Sin fixtures útiles"}</small></article>`;
  elements.simulationResults.innerHTML = `<div class="simulation-summary">
    <article><span>Fuente</span><strong>${escapeHtml(result.source)}</strong><small>${escapeHtml(result.modelVersion || "")}</small></article>
    <article><span>Ventana</span><strong>${displayValue(result.windowSize, 0)}</strong><small>Partidos previos por equipo</small></article>
    <article><span>Competición</span><strong>${escapeHtml(result.competition || "No especificada")}</strong><small>${escapeHtml(formatUpdatedAt(result.generatedAt))}</small></article>
  </div>${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Métrica</th><th>${escapeHtml(result.teamA.name)}</th><th>${escapeHtml(result.teamB.name)}</th><th>Diferencia</th><th>Ventaja</th><th>Calidad</th></tr></thead><tbody>${rows}</tbody></table></div><div class="simulation-fixtures">${fixtureList(result.teamA)}${fixtureList(result.teamB)}</div>`;
}

function simulationParamsFromForm() {
  const params = {
    competition: elements.simulationCompetition.value,
    window: elements.simulationWindow.value || "5",
    teamAId: elements.simulationTeamAId.value,
    teamAName: elements.simulationTeamAName.value,
    teamBId: elements.simulationTeamBId.value,
    teamBName: elements.simulationTeamBName.value,
    fixtureDate: elements.simulationFixtureDate.value ? new Date(elements.simulationFixtureDate.value).toISOString() : ""
  };
  if (elements.simulationCompare.dataset.fixtureId) params.fixtureId = elements.simulationCompare.dataset.fixtureId;
  return params;
}

async function runSimulationComparison() {
  if (state.isLoadingSimulation) return;
  const params = simulationParamsFromForm();
  state.isLoadingSimulation = true;
  elements.simulationCompare.disabled = true;
  elements.simulationCompare.textContent = "Comparando...";
  elements.simulationStatus.className = "status-badge status-badge--processing";
  elements.simulationStatus.textContent = "Procesando";
  elements.simulationResults.innerHTML = '<div class="research-empty"><div class="loading-spinner" aria-hidden="true"></div><p>Consultando histórico desde API-Football o caché...</p></div>';
  try {
    const result = await footballDataService.compareSimulationTeams(params);
    renderSimulationComparison(result);
  } catch (error) {
    renderSimulationComparison({ status: "not_available", metrics: [], message: error.message });
  } finally {
    state.isLoadingSimulation = false;
    elements.simulationCompare.disabled = false;
    elements.simulationCompare.textContent = "Comparar";
  }
}

function renderAdvancedSimulation(result = {}) {
  if (!elements.simulationAdvancedResults) return;
  if (!result.summary) {
    elements.simulationAdvancedResults.innerHTML = `<div class="research-empty"><strong>Simulación avanzada no disponible</strong><p>${escapeHtml(result.message || "Ejecuta una comparación con datos históricos suficientes.")}</p></div>`;
    return;
  }
  const summary = result.summary;
  const probabilityCards = [["Local", result.finalProbabilities?.homeWin], ["Empate", result.finalProbabilities?.draw], ["Visitante", result.finalProbabilities?.awayWin]]
    .map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${displayValue(value)}%</strong><small>Probabilidad final calibrada</small></article>`).join("");
  const scoreChips = (result.dixonColes?.likelyScores || []).map((row) => `<span class="score-chip">${escapeHtml(row.score)} · ${displayValue(row.probabilityPct)}%</span>`).join("");
  const marketRows = (result.marketComparison || []).slice(0, 8).map((row) => `<tr>
    <td>${escapeHtml(row.market || "Mercado")}</td><td>${escapeHtml(row.selection || "Selección")}</td>
    <td>${displayValue(row.modelProbabilityPct)}%</td><td>${displayValue(row.decimalOdds)}</td>
    <td>${displayValue(row.fairOdds)}</td><td>${displayValue(row.edgePct)}%</td>
    <td class="${Number(row.expectedValuePct) >= 0 ? "value-positive" : "value-negative"}">${displayValue(row.expectedValuePct)}%</td>
    <td>${escapeHtml(row.status || "observacion")}</td>
  </tr>`).join("");
  const matrixRows = (result.dixonColes?.goalMatrix || []).slice(0, 16).map((row) => `<tr><td>${escapeHtml(`${row.homeGoals}-${row.awayGoals}`)}</td><td>${displayValue(row.probabilityPct)}%</td></tr>`).join("");
  const list = (items = []) => items.length ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>No disponible</li>";
  const api = result.audit?.apiConsumption || {};
  const cache = result.cacheInfo || {};
  elements.simulationAdvancedResults.innerHTML = `<section class="simulation-advanced">
    <div class="panel-heading">
      <div><p class="eyebrow">Elo + Dixon-Coles + contexto</p><h3>Resumen final de simulación avanzada</h3></div>
      <span class="status-badge status-badge--${statusClass(result.status === "available" ? "Disponible" : "Parcial")}">${escapeHtml(result.status === "available" ? "Disponible" : "Parcial")}</span>
    </div>
    <div class="simulation-summary simulation-summary--advanced">
      <article><span>Pick sugerido</span><strong>${escapeHtml(summary.pick)}</strong><small>${escapeHtml(summary.decision)}</small></article>
      <article><span>Mercado</span><strong>${escapeHtml(summary.market)}</strong><small>Cuota ${displayValue(summary.decimalOdds)} · EV ${displayValue(summary.expectedValuePct)}%</small></article>
      <article><span>Confianza / riesgo</span><strong>${escapeHtml(summary.confidence)} · ${escapeHtml(summary.risk)}</strong><small>${escapeHtml(summary.explanation)}</small></article>
    </div>
    <div class="simulation-summary">${probabilityCards}</div>
    <div class="simulation-steps">
      <article><h4>Paso 1 — Elo</h4><dl><div><dt>Elo local</dt><dd>${displayValue(result.elo?.teamA, 0)}</dd></div><div><dt>Elo visitante</dt><dd>${displayValue(result.elo?.teamB, 0)}</dd></div><div><dt>Diferencia</dt><dd>${displayValue(result.elo?.difference, 0)}</dd></div><div><dt>Localía</dt><dd>${displayValue(result.elo?.homeAdvantage, 0)}</dd></div><div><dt>Fuerza</dt><dd>${escapeHtml(result.elo?.strengthClass || "No disponible")}</dd></div><div><dt>Calidad</dt><dd>${escapeHtml(result.elo?.quality || "No disponible")}</dd></div></dl></article>
      <article><h4>Paso 2 — Dixon-Coles</h4><dl><div><dt>Lambda local</dt><dd>${displayValue(result.dixonColes?.lambdaHome)}</dd></div><div><dt>Lambda visitante</dt><dd>${displayValue(result.dixonColes?.lambdaAway)}</dd></div><div><dt>Rho</dt><dd>${displayValue(result.dixonColes?.rho)}</dd></div><div><dt>Over 2.5</dt><dd>${displayValue(result.dixonColes?.probabilities?.over25)}%</dd></div><div><dt>BTTS Sí</dt><dd>${displayValue(result.dixonColes?.probabilities?.bttsYes)}%</dd></div></dl><div class="score-chip-row">${scoreChips || "<span class=\"score-chip\">Sin marcadores</span>"}</div></article>
      <article><h4>Paso 3 — Contexto</h4><dl><div><dt>Modo</dt><dd>${escapeHtml(result.context?.mode || "rule_based")}</dd></div><div><dt>Antes</dt><dd>${displayValue(result.context?.probabilityBefore?.homeWin)} / ${displayValue(result.context?.probabilityBefore?.draw)} / ${displayValue(result.context?.probabilityBefore?.awayWin)}</dd></div><div><dt>Después</dt><dd>${displayValue(result.context?.probabilityAfter?.homeWin)} / ${displayValue(result.context?.probabilityAfter?.draw)} / ${displayValue(result.context?.probabilityAfter?.awayWin)}</dd></div></dl><ul>${list(result.context?.variablesMissing)}</ul></article>
    </div>
    <div class="simulation-grid-two">
      <article><h4>Comparación con mercado</h4>${marketRows ? `<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Mercado</th><th>Selección</th><th>Modelo</th><th>Cuota</th><th>Justa</th><th>Edge</th><th>EV</th><th>Estado</th></tr></thead><tbody>${marketRows}</tbody></table></div>` : "<p class=\"muted-text\">No hay cuotas compatibles para comparar.</p>"}</article>
      <article><h4>Matriz de goles</h4>${matrixRows ? `<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Marcador</th><th>Prob.</th></tr></thead><tbody>${matrixRows}</tbody></table></div>` : "<p class=\"muted-text\">Matriz no disponible.</p>"}</article>
    </div>
    <div class="simulation-grid-two">
      <article><h4>Advertencias</h4><ul>${list(result.warnings)}</ul></article>
      <article><h4>Auditoría</h4><ul><li>ID: ${escapeHtml(result.audit?.recordId || "No disponible")}</li><li>Versión Elo: ${escapeHtml(result.audit?.versions?.elo || "")}</li><li>Versión Dixon-Coles: ${escapeHtml(result.audit?.versions?.dixonColes || "")}</li><li>Cache: ${escapeHtml(cache.status || (result.cached ? "hit" : "miss"))} · ${escapeHtml(cache.reason || "Sin detalle")}</li><li>API real usada: ${displayValue(api.networkRequests, 0)} solicitudes · hits cache ${displayValue(api.cacheHits, 0)} · misses ${displayValue(api.cacheMisses, 0)}</li><li>${escapeHtml(result.audit?.cachePolicy || "")}</li></ul></article>
    </div>
  </section>`;
}

async function runAdvancedSimulation() {
  if (state.isLoadingAdvancedSimulation) return;
  const params = simulationParamsFromForm();
  state.isLoadingAdvancedSimulation = true;
  elements.simulationAdvanced.disabled = true;
  elements.simulationAdvanced.textContent = "Simulando...";
  elements.simulationAdvancedResults.innerHTML = '<div class="research-empty"><div class="loading-spinner" aria-hidden="true"></div><p>Ejecutando Elo, Dixon-Coles y ajuste contextual...</p></div>';
  try {
    renderAdvancedSimulation(await footballDataService.runAdvancedSimulation(params));
  } catch (error) {
    renderAdvancedSimulation({ status: "not_available", message: error.message });
  } finally {
    state.isLoadingAdvancedSimulation = false;
    elements.simulationAdvanced.disabled = false;
    elements.simulationAdvanced.textContent = "Ejecutar simulación avanzada";
  }
}

function openSupportingDetail(moduleKey) {
  const fixture = selectedFixture();
  const research = fixture?.researchData;
  const config = SUPPORTING_MODULES.find((item) => item.key === moduleKey);
  if (!research || !config) return;
  elements.dataDialogTitle.textContent = config.label;
  elements.dataDialogSubtitle.textContent = `${fixture.home} vs ${fixture.away} · ${config.use}`;
  elements.dataDialogContent.innerHTML = `${fixtureProgressBanner(fixture)}${renderSupportingDetail(moduleKey, research)}`;
  showDataDialog();
}

function displayValue(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : escapeHtml(value);
}

function emptyDetail(message) {
  return `<div class="detail-empty"><strong>No hay datos para mostrar</strong><p>${escapeHtml(message)}</p></div>`;
}

function detailTable(headers, rows, rowClasses = []) {
  if (!rows.length) return "";
  return `<div class="detail-table-wrap"><table class="detail-table"><thead><tr>${headers.map((header) => `<th>${labelWithTooltip(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr class="${escapeHtml(rowClasses[rowIndex] || "")}">${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index] || "Dato")}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function formatSiteRelease(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Sin fecha de despliegue";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Tijuana", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  }).format(date);
}

function renderStandingsDetail(data, fixture) {
  const groups = data.flatMap((entry) => entry?.league?.standings || []);
  if (!groups.length) return emptyDetail("API-Football no devolvió una clasificación para este partido.");
  const relatedGroups = groups.filter((group) => group.some((row) => [fixture.home, fixture.away].includes(row.team?.name)));
  const visibleGroups = relatedGroups.length ? relatedGroups : groups.slice(0, 2);
  return visibleGroups.map((group) => {
    const groupName = group[0]?.group || "Clasificación";
    const rows = group.map((row) => [
      displayValue(row.rank),
      `<span class="team-cell">${row.team?.logo ? `<img src="${escapeHtml(row.team.logo)}" alt="" />` : ""}<strong>${displayValue(row.team?.name)}</strong></span>`,
      displayValue(row.all?.played), displayValue(row.all?.win), displayValue(row.all?.draw), displayValue(row.all?.lose),
      displayValue(row.all?.goals?.for), displayValue(row.all?.goals?.against), displayValue(row.goalsDiff), `<strong>${displayValue(row.points)}</strong>`
    ]);
    return `<section class="detail-section"><h3>${escapeHtml(groupName)}</h3>${detailTable(["Pos.", "Equipo", "PJ", "G", "E", "P", "GF", "GC", "DG", "Pts"], rows)}</section>`;
  }).join("");
}

function renderStatisticsDetail(data, xgOnly = false) {
  if (!data.length) return emptyDetail("Las estadísticas todavía no están publicadas para este partido.");
  return `<div class="team-stat-grid">${data.map((team) => {
    const stats = (team.statistics || []).filter((stat) => !xgOnly || /expected goals|xg/i.test(stat.type));
    return `<section class="team-stat-card"><div class="team-stat-card__heading">${team.team?.logo ? `<img src="${escapeHtml(team.team.logo)}" alt="" />` : ""}<h3>${displayValue(team.team?.name)}</h3></div>${stats.length ? stats.map((stat) => `<div class="stat-row"><span>${displayValue(stat.type)}</span><strong>${displayValue(stat.value)}</strong></div>`).join("") : `<p class="muted-text">No hay ${xgOnly ? "xG/xGA" : "estadísticas"} disponibles.</p>`}</section>`;
  }).join("")}</div>`;
}

function renderH2HDetail(data, fixture) {
  const historical = data.filter((match) => {
    const value = match.fixture?.date || "";
    const matchDate = value ? new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(value)) : "";
    const short = match.fixture?.status?.short;
    const hasFinalScore = Number.isFinite(match.goals?.home) && Number.isFinite(match.goals?.away);
    const played = ["FT", "AET", "PEN"].includes(short) || (!short && hasFinalScore);
    return played && matchDate < fixture.date && String(match.fixture?.id || "") !== String(fixture.id);
  });
  if (!historical.length) return emptyDetail("No hay enfrentamientos directos finalizados anteriores a este partido.");
  const rows = historical.slice(0, 10).map((match) => [
    displayValue(match.fixture?.date ? formatDate(match.fixture.date.slice(0, 10)) : null),
    displayValue(match.teams?.home?.name),
    `<strong>${displayValue(match.goals?.home)} – ${displayValue(match.goals?.away)}</strong>`,
    displayValue(match.teams?.away?.name),
    displayValue(match.league?.name)
  ]);
  return detailTable(["Fecha", "Local", "Marcador", "Visitante", "Competición"], rows);
}

function renderInjuriesDetail(data) {
  if (!data.length) return emptyDetail("API-Football no reporta lesiones o sanciones para este fixture. Esto no confirma que no existan; solo indica que no fueron proporcionadas.");
  const rows = data.map((item) => [displayValue(item.team?.name), displayValue(item.player?.name), displayValue(item.player?.type), displayValue(item.player?.reason)]);
  return detailTable(["Equipo", "Jugador", "Tipo", "Motivo"], rows);
}

function renderLineupsDetail(data) {
  if (!data.length) return emptyDetail("Las alineaciones todavía no están disponibles.");
  return `<div class="lineups-grid">${data.map((lineup) => `<section class="lineup-card"><div class="team-stat-card__heading">${lineup.team?.logo ? `<img src="${escapeHtml(lineup.team.logo)}" alt="" />` : ""}<div><h3>${displayValue(lineup.team?.name)}</h3><p>Formación: ${displayValue(lineup.formation)} · DT: ${displayValue(lineup.coach?.name)}</p></div></div><h4>Titulares</h4><ol class="player-list">${(lineup.startXI || []).map((item) => `<li><span>${displayValue(item.player?.number)}</span>${displayValue(item.player?.name)} <small>${displayValue(item.player?.pos)}</small></li>`).join("")}</ol><details><summary>Ver suplentes (${(lineup.substitutes || []).length})</summary><ul class="player-list">${(lineup.substitutes || []).map((item) => `<li><span>${displayValue(item.player?.number)}</span>${displayValue(item.player?.name)} <small>${displayValue(item.player?.pos)}</small></li>`).join("")}</ul></details></section>`).join("")}</div>`;
}

function renderOddsMonitor(data) {
  const lowest = findLowestOdds(data, 2);
  return lowest.length ? `<section class="odds-monitor" aria-label="Alertas de cuotas"><header><div><p class="eyebrow">Panel de monitoreo</p><h3>Alertas de cuotas ${infoTooltip("odds")}</h3></div><span>${lowest.length} detectadas</span></header><div class="odds-monitor__grid">${lowest.map((item) => `<article><span>${escapeHtml(item.market)}</span><strong>${escapeHtml(item.selection)} · ${displayValue(item.odd)}</strong><small>${escapeHtml(item.bookmaker)}</small><p>Cuota baja: menor pago y mayor probabilidad implícita según la casa.</p></article>`).join("")}</div><p class="odds-monitor__warning">Una cuota baja no significa automáticamente que sea una buena apuesta. Solo indica que el mercado paga menos y probablemente tiene mayor probabilidad implícita según la casa.</p></section>` : "";
}

function renderOddsDetail(data) {
  const bookmaker = data[0]?.bookmakers?.[0];
  if (!bookmaker) return emptyDetail("No hay cuotas publicadas para este partido.");
  const preferred = /match winner|double chance|goals over\/under|both teams score/i;
  const bets = bookmaker.bets || [];
  const markets = bets.filter((bet) => preferred.test(bet.name)).slice(0, 6);
  const visibleMarkets = markets.length ? markets : bets.slice(0, 4);
  const lowest = findLowestOdds(data, 2);
  const relevant = lowest[0];
  const marketOverview = `<div class="market-panel-summary"><article><span>Casa mostrada</span><strong>${displayValue(bookmaker.name)}</strong><small>Fuente disponible</small></article><article><span>Alertas detectadas</span><strong>${lowest.length}</strong><small>Cuotas bajas observadas</small></article><article><span>Cuota más baja</span><strong>${displayValue(relevant?.odd)}</strong><small>${displayValue(relevant?.selection)}</small></article><article><span>Señal relevante</span><strong>${displayValue(relevant?.market)}</strong><small>Dato de mercado, no recomendación</small></article></div>`;
  return `${marketOverview}${renderOddsMonitor(data)}<div class="detail-note detail-note--warning"><strong>Precio no equivale a seguridad</strong><span>Una cuota baja paga menos y refleja mayor probabilidad implícita de la casa; no convierte la selección en un pick seguro.</span></div><div class="odds-grid">${visibleMarkets.map((bet) => `<section class="odds-market"><h3>${displayValue(bet.name)}</h3>${(bet.values || []).slice(0, 12).map((value) => `<div class="odd-row"><span>${displayValue(value.value)}</span><strong>${displayValue(value.odd)}</strong></div>`).join("")}</section>`).join("")}</div>`;
}

function renderPreMatchDetail(fixture) {
  const preMatch = fixture.preMatch;
  if (!preMatch) return emptyDetail("Todavía no se ha construido la ficha prepartido.");
  const teamCard = (team, venue) => {
    const neutral = fixture.neutralVenue;
    const nonLossLabel = neutral ? "Rendimiento general sin perder" : `Rendimiento ${venue === "home" ? "local sin perder" : "visitante sin perder"}`;
    const nonLossValue = neutral ? team.nonLossRate : venue === "home" ? team.homeNonLossRate : team.awayNonLossRate;
    return `<section class="team-stat-card"><h3>${escapeHtml(team.team)}</h3><div class="stat-row"><span>Forma reciente</span><strong>${displayValue(team.form)}</strong></div><div class="stat-row"><span>Partidos analizados</span><strong>${displayValue(team.played)}</strong></div><div class="stat-row"><span>Goles a favor / contra</span><strong>${displayValue(team.avgGoalsFor)} / ${displayValue(team.avgGoalsAgainst)}</strong></div><div class="stat-row"><span>Over 2.5</span><strong>${displayValue(team.over25Rate)}%</strong></div><div class="stat-row"><span>Ambos anotan</span><strong>${displayValue(team.bttsRate)}%</strong></div><div class="stat-row"><span>${escapeHtml(nonLossLabel)}</span><strong>${displayValue(nonLossValue)}%</strong></div><div class="stat-row"><span>Días de descanso</span><strong>${displayValue(team.restDays)}</strong></div></section>`;
  };
  const calculations = fixture.marketAnalysis || [];
  const rows = calculations.map((item) => [displayValue(item.selection), displayValue(item.decimalOdds), `${displayValue(item.impliedProbabilityPct)}%`, `${displayValue(item.noVigImpliedProbabilityPct)}%`, `${displayValue(item.bookmakerMarginPct)}%`, `${displayValue(item.estimatedProbabilityPct)}%`, displayValue(item.fairOdds), `<strong class="${item.expectedValuePct >= 0 ? "value-positive" : "value-negative"}">${displayValue(item.expectedValuePct)}%</strong>`]);
  return `<div class="quality-summary"><strong>Cobertura de datos ${escapeHtml(fixture.dataQuality?.level || "Baja")} · ${displayValue(fixture.dataQuality?.score, 0)}/100</strong><span>Este puntaje mide disponibilidad, no certeza predictiva. ${escapeHtml(preMatch.note)}</span></div><div class="team-stat-grid">${teamCard(preMatch.home, "home")}${teamCard(preMatch.away, "away")}</div><section class="detail-section"><h3>Cálculos de mercados permitidos</h3>${rows.length ? detailTable(["Selección", "Cuota", "Implícita", "Sin margen", "Margen", "Modelo", "Cuota justa", "EV"], rows) : emptyDetail("No hay cuotas principales suficientes para calcular valor esperado.")}</section>`;
}

function categoryDetail(categoryKey, fixture) {
  const data = fixture.confirmedData?.[categoryKey] || [];
  if (categoryKey === "standings") return renderStandingsDetail(data, fixture);
  if (categoryKey === "statistics") return renderStatisticsDetail(data);
  if (categoryKey === "h2h") return renderH2HDetail(data, fixture);
  if (categoryKey === "injuries") return renderInjuriesDetail(data);
  if (categoryKey === "lineups") return renderLineupsDetail(data);
  if (categoryKey === "odds") return renderOddsDetail(data);
  if (categoryKey === "xg") return renderStatisticsDetail(fixture.confirmedData?.statistics || [], true);
  if (categoryKey === "context") return renderPreMatchDetail(fixture);
  if (categoryKey === "weather") return emptyDetail("La integración actual no consulta clima ni condiciones de cancha.");
  return emptyDetail("No hay información disponible para esta categoría.");
}

function openDataDetail(categoryKey) {
  const fixture = selectedFixture();
  const category = DATA_CATEGORIES.find((item) => item.key === categoryKey);
  if (!fixture || !category) return;
  const moduleKey = CATEGORY_TO_RESEARCH_MODULE[categoryKey];
  const research = fixture.researchData;
  const status = research?.[moduleKey] ? researchStatusLabel(research[moduleKey].status) : fixture.dataAvailability?.[categoryKey] || "No disponible";
  elements.dataDialogTitle.textContent = category.label;
  elements.dataDialogSubtitle.textContent = `${fixture.home} vs ${fixture.away} · ${status}`;
  elements.dataDialogContent.innerHTML = research?.[moduleKey]
    ? renderResearchModuleDetail(moduleKey, research)
    : categoryDetail(categoryKey, fixture);
  elements.dataDialogContent.insertAdjacentHTML("afterbegin", fixtureProgressBanner(fixture));
  if (fixture.dataSource !== "api-football") {
    elements.dataDialogContent.insertAdjacentHTML("afterbegin", '<div class="detail-note"><strong>Modo demostración</strong><span>No existen datos reales detallados para este escenario sintético.</span></div>');
  }
  showDataDialog();
}

const resultLabels = Object.freeze({ pending: "Pendiente", won: "Ganado", lost: "Perdido", void: "Anulado" });

function persistParlayDraft() {
  saveParlayDraft(state.parlayDraft);
}

function persistSavedParlays() {
  saveSavedParlays(state.savedParlays);
}

function persistSavedPicks() {
  saveSavedPicks(state.savedPicks);
}

function normalizedSavedStatus(value) {
  const status = String(value || "").toLowerCase();
  if (["live", "1h", "ht", "2h", "et", "p", "int"].includes(status)) return "En vivo";
  if (["finished", "ft", "aet", "pen", "completo"].includes(status)) return "Finalizado";
  if (["scheduled", "ns", "tbd", "programado"].includes(status)) return "Programado";
  if (["susp", "suspended", "suspendido"].includes(status)) return "Suspendido";
  if (["pst", "postponed", "postergado"].includes(status)) return "Postergado";
  if (["canc", "cancelled", "cancelado"].includes(status)) return "Cancelado";
  return value || "No disponible";
}

function saveIndividualLeg(leg) {
  if (!leg?.fixtureId || !leg.market || !leg.selection) {
    showNotice("Selecciona un partido, mercado y selección antes de guardar el pick.");
    return;
  }
  const duplicate = hasDuplicatePick(state.savedPicks, leg);
  if (duplicate && !window.confirm("Este pick ya está guardado. ¿Deseas guardar otro registro igual?")) return;
  state.savedPicks.unshift(createSavedPick({ ...leg, id: `${leg.id || "pick"}:${Date.now()}` }));
  persistSavedPicks();
  renderSavedPicks();
  showNotice("Pick individual guardado en Mis apuestas.");
}

function appendPickToParlay(leg, successMessage = "Pick agregado a Mi parlay.") {
  if (!leg?.fixtureId || !leg.market || !leg.selection) {
    showNotice("Selecciona un partido, mercado y selección antes de agregar el pick.");
    return false;
  }
  const normalized = normalizePickLeg(leg);
  const duplicate = hasDuplicatePick(state.parlayDraft, normalized);
  if (duplicate) {
    showNotice("Este pick ya fue agregado.");
    renderParlayDraft(true);
    return false;
  }
  if (state.parlayDraft.length >= 12) {
    showNotice("El cupón admite hasta 12 selecciones.");
    return false;
  }
  state.parlayDraft.push(normalized);
  persistParlayDraft();
  renderParlayDraft(true);
  showNotice(successMessage);
  return true;
}

function renderParlayDraft(open = false) {
  const count = state.parlayDraft.length;
  elements.parlayLegCount.textContent = count;
  elements.parlayFabCount.textContent = count;
  elements.parlayFab.hidden = count === 0 || !elements.parlaySlip.hidden;
  elements.saveParlay.disabled = count < 2;

  if (!count) {
    elements.parlaySlip.hidden = true;
    elements.parlayDraftList.innerHTML = "";
    return;
  }

  elements.parlayDraftList.innerHTML = state.parlayDraft.map((storedLeg, index) => {
    const leg = applyAnalysisTiming(storedLeg);
    return `
    <article class="parlay-draft-leg">
      <div class="parlay-draft-leg__number">${index + 1}</div>
      <div>
        <strong>${escapeHtml(leg.selection)}</strong>
        <span>${escapeHtml(leg.market)}</span>
        <small>${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)} · ${escapeHtml(leg.date)}</small>
        <small>Confianza: ${escapeHtml(leg.confidence)} · Riesgo: ${escapeHtml(leg.risk)}</small>
        <small>Cuota ${displayValue(leg.decimalOdds)} · EV ${displayValue(leg.expectedValue)}%</small>
        <small>Origen: ${escapeHtml(pickOriginLabel(leg.sourceModule))} ${infoTooltip("pick_origin")}</small>
        <small class="timing-label">${escapeHtml(leg.analysisTiming.label)}${leg.analysisTiming.minutesToKickoff === null ? "" : ` · ${escapeHtml(leg.analysisTiming.minutesToKickoff)} min al inicio`}</small>
        ${leg.analysisTiming.warning ? `<em>${escapeHtml(leg.analysisTiming.warning)}</em>` : ""}
        ${leg.requiresReview ? '<em>Requiere revisión antes de considerar una apuesta</em>' : ""}
      </div>
      <button type="button" data-remove-draft="${escapeHtml(leg.id)}" aria-label="Quitar selección">×</button>
    </article>
  `; }).join("");

  if (open) {
    elements.parlaySlip.hidden = false;
    setParlayMinimized(false);
  }
  elements.parlayFab.hidden = !elements.parlaySlip.hidden;
}

function setParlayMinimized(minimized) {
  elements.parlaySlip.classList.toggle("parlay-slip--minimized", minimized);
  elements.parlayMinimize.textContent = minimized ? "+" : "−";
  elements.parlayMinimize.setAttribute("aria-expanded", String(!minimized));
  elements.parlayMinimize.setAttribute("aria-label", minimized ? "Expandir cupón" : "Minimizar cupón");
}

function addMarketToParlay(analysis, marketIndex) {
  const fixture = selectedFixture();
  const market = analysis?.mercados_sugeridos?.[marketIndex];
  const calculation = analysis?._context?.marketAnalysis?.find((item) => item.selectionKey === market?.codigo_seleccion);
  if (!fixture || !market) return;
  if (analysis._source === "mock" || /^sin mercado$/i.test(market.mercado || "")) {
    showNotice("Las selecciones sintéticas o sin mercado verificable no pueden agregarse al historial.");
    return;
  }
  if (market.requiere_revision
    || ["value_sospechoso", "agresivo_stake_bajo", "evitar", "sin_pick"].includes(market.pickCategory)
    || !analysis._context?.quality?.canSuggest) {
    showNotice("La calidad o el valor esperado de esta selección requieren revisión; no puede agregarse al parlay.");
    return;
  }

  appendPickToParlay({
    id: `${fixture.id}:${market.mercado}:${market.seleccion}`,
    fixtureId: fixture.id,
    league: fixture.leagueName,
    home: fixture.home,
    away: fixture.away,
    date: fixture.date,
    market: market.mercado,
    selection: market.seleccion,
    marketCode: market.codigo_mercado,
    selectionCode: market.codigo_seleccion,
    decimalOdds: market.cuota_decimal,
    originalOdds: market.cuota_decimal,
    updatedOdds: null,
    impliedProbability: calculation?.impliedProbabilityPct ?? null,
    modelProbability: market.probabilidad_modelo ?? calculation?.estimatedProbabilityPct ?? null,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: fixture.fetchedAt || null,
    estimatedProbability: market.probabilidad_modelo,
    expectedValue: market.valor_esperado,
    reasoning: market.razonamiento,
    confidence: market.confianza,
    risk: market.nivel_riesgo,
    requiresReview: Boolean(market.requiere_revision),
    analysisStatus: analysis.estado_analisis,
    sourceModule: market.sourceModule || (analysis.analysisMode === "rule_engine" ? "odds_rule_engine" : "odds"),
    source: analysis._source || "openai",
    supportingData: market.datos_que_apoyan || [], contradictingData: market.datos_que_contradicen || []
  }, "Selección agregada a Mi parlay.");
}

function addOddsPickToParlay(selectionKey) {
  const fixture = selectedFixture();
  const market = fixture?.researchData?.odds?.markets?.find((item) => item.selectionKey === selectionKey);
  if (!fixture || !market || !["green", "orange"].includes(market.highlightColor)) {
    showNotice("Esta cuota no cumple los controles mínimos para agregarla al parlay.");
    return;
  }
  appendPickToParlay({
    id: `${fixture.id}:${market.marketKey}:${market.selectionKey}`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away,
    date: fixture.date, market: market.market, selection: market.selection,
    marketCode: market.marketKey, selectionCode: market.selectionKey,
    decimalOdds: market.decimalOdds, estimatedProbability: market.estimatedProbabilityPct,
    originalOdds: market.decimalOdds, updatedOdds: null, impliedProbability: market.impliedProbabilityPct,
    modelProbability: market.estimatedProbabilityPct, fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: market.updatedAt || fixture.fetchedAt || null,
    expectedValue: market.expectedValuePct, reasoning: market.explanation || "",
    confidence: market.confidenceLevel || "Media", risk: market.colorMeaning || "Riesgo",
    requiresReview: market.highlightColor !== "green", analysisStatus: fixture.researchData.analysisStatus,
    sourceModule: "odds", source: market.source || "api-football",
    supportingData: market.supportingData || [], contradictingData: market.contradictingData || []
  }, "Cuota agregada a Mi parlay.");
}

function saveOddsPick(selectionKey) {
  const fixture = selectedFixture();
  const market = fixture?.researchData?.odds?.markets?.find((item) => item.selectionKey === selectionKey);
  if (!fixture || !market || !market.market || !market.selection) return;
  saveIndividualLeg({
    id: `${fixture.id}:${market.marketKey}:${market.selectionKey}`, fixtureId: fixture.id,
    league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: market.market, selection: market.selection, marketCode: market.marketKey, selectionCode: market.selectionKey,
    decimalOdds: market.decimalOdds, originalOdds: market.decimalOdds, updatedOdds: null,
    impliedProbability: market.impliedProbabilityPct, modelProbability: market.estimatedProbabilityPct,
    expectedValue: market.expectedValuePct,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: market.updatedAt || fixture.fetchedAt || null, confidence: market.confidenceLevel || "No disponible",
    result: "pending", sourceModule: "odds", source: market.source || "api-football",
    supportingData: market.supportingData || [], contradictingData: market.contradictingData || []
  });
}

function saveAnalysisMarket(analysis, marketIndex) {
  const fixture = selectedFixture();
  const market = analysis?.mercados_sugeridos?.[marketIndex];
  const calculation = analysis?._context?.marketAnalysis?.find((item) => item.selectionKey === market?.codigo_seleccion);
  if (!fixture || !market || /^sin mercado$/i.test(market.mercado || "")) return;
  saveIndividualLeg({
    id: `${fixture.id}:${market.codigo_mercado}:${market.codigo_seleccion}`, fixtureId: fixture.id,
    league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: market.mercado, selection: market.seleccion, marketCode: market.codigo_mercado,
    selectionCode: market.codigo_seleccion, decimalOdds: market.cuota_decimal,
    originalOdds: market.cuota_decimal, updatedOdds: null, impliedProbability: calculation?.impliedProbabilityPct ?? null,
    modelProbability: market.probabilidad_modelo ?? calculation?.estimatedProbabilityPct ?? null,
    expectedValue: market.valor_esperado ?? calculation?.expectedValuePct ?? null, fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: fixture.fetchedAt || null,
    confidence: market.confianza || "No disponible", result: "pending",
    sourceModule: market.sourceModule || (analysis.analysisMode === "rule_engine" ? "odds_rule_engine" : "odds"),
    source: analysis._source || "openai"
  });
}

function saveCurrentParlay() {
  if (state.parlayDraft.length < 2) {
    showNotice("Agrega al menos dos selecciones para guardar un parlay.");
    return;
  }
  state.savedParlays.unshift(createSavedParlay(elements.parlayName.value, state.parlayDraft));
  state.parlayDraft = [];
  elements.parlayName.value = "";
  persistSavedParlays();
  persistParlayDraft();
  renderParlayDraft();
  renderSavedParlays();
  switchView("saved");
  showNotice("Parlay guardado. Ya puedes registrar sus resultados.");
}

function oddsUpdateHtml(item) {
  if (item.updatedOdds === null || item.updatedOdds === undefined) return '<span class="muted-text">Sin actualización</span>';
  const original = Number(item.originalOdds ?? item.decimalOdds);
  const updated = Number(item.updatedOdds);
  const trend = Number.isFinite(original) && Number.isFinite(updated) ? (updated > original ? "up" : updated < original ? "down" : "same") : "same";
  return `<strong class="odds-change odds-change--${trend}">${displayValue(updated)}</strong>`;
}

function renderSavedPicks() {
  elements.savedParlayCount.textContent = state.savedParlays.filter((parlay) => !parlay.trashed).length + state.savedPicks.length;
  if (!state.savedPicks.length) {
    elements.savedPicksList.innerHTML = '<div class="saved-empty"><h3>Aún no hay picks individuales</h3><p>Usa “Guardar pick” desde Cuotas o desde el análisis IA.</p><button class="button button--primary" type="button" data-view="dashboard">Ir al dashboard</button></div>';
    return;
  }
  elements.savedPicksList.innerHTML = state.savedPicks.map((storedPick) => { const pick = applyAnalysisTiming(storedPick); return `<article class="saved-pick" data-pick-id="${escapeHtml(pick.id)}">
    <div><span>${escapeHtml(pick.league || "Competición")}</span><strong>${escapeHtml(pick.home)} vs ${escapeHtml(pick.away)}</strong><small>${escapeHtml(pick.date || "Fecha no disponible")} · ${escapeHtml(normalizedSavedStatus(pick.fixtureStatus))}</small></div>
    <div><span>Selección</span><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)}</small></div>
    <div class="saved-market-metrics"><span>Cuota<strong>${displayValue(pick.originalOdds ?? pick.decimalOdds)}</strong></span><span>Actualizada${oddsUpdateHtml(pick)}</span><span>Implícita<strong>${displayValue(pick.impliedProbability)}%</strong></span><span>Modelo<strong>${displayValue(pick.modelProbability ?? pick.estimatedProbability)}%</strong></span><span>EV<strong>${displayValue(pick.expectedValue)}%</strong></span></div>
    <div><span>Confianza / resultado</span><strong>${pick.effectiveConfidenceScore === null ? escapeHtml(pick.confidence || "No disponible") : `${escapeHtml(pick.effectiveConfidenceScore)}% efectiva`}</strong><small>${escapeHtml(resultLabels[pick.result] || "Pendiente")} · Origen: ${escapeHtml(pickOriginLabel(pick.sourceModule))} ${infoTooltip("pick_origin")}</small><small class="timing-label">${escapeHtml(pick.analysisTiming.label)}</small>${pick.analysisTiming.warning ? `<small class="timing-warning">${escapeHtml(pick.analysisTiming.warning)}</small>` : ""}${pick.oddsMovement.changed ? `<small class="timing-warning">${escapeHtml(pick.oddsMovement.warning)}</small>` : ""}</div>
    <button class="button button--danger button--compact" type="button" data-delete-pick>Eliminar</button>
  </article>`; }).join("");
}

function renderSavedParlays() {
  const activeParlays = state.savedParlays.filter((parlay) => !parlay.trashed);
  elements.savedParlayCount.textContent = activeParlays.length + state.savedPicks.length;
  const metrics = calculateHistoryMetrics(activeParlays);
  elements.historyMetrics.innerHTML = `
    <article><span>Parlays</span><strong>${metrics.total}</strong></article>
    <article><span>Evaluados</span><strong>${metrics.settled}</strong></article>
    <article><span>Ganados / perdidos</span><strong>${metrics.won} / ${metrics.lost}</strong></article>
    <article><span>Acierto</span><strong>${metrics.winRate === null ? "—" : `${metrics.winRate}%`}</strong></article>
    <article><span>Unidades teóricas</span><strong class="${metrics.theoreticalUnits >= 0 ? "value-positive" : "value-negative"}">${metrics.theoreticalUnits}</strong></article>`;
  elements.updateParlayResults.disabled = activeParlays.length === 0 && state.savedPicks.length === 0;
  if (!activeParlays.length) {
    elements.savedParlaysList.innerHTML = '<div class="saved-empty"><h3>Aún no hay parlays guardados</h3><p>Agrega dos o más mercados desde un análisis IA y guarda el cupón para comenzar el seguimiento.</p><button class="button button--primary" type="button" data-view="dashboard">Ir al dashboard</button></div>';
    return;
  }

  elements.savedParlaysList.innerHTML = activeParlays.map((parlay) => {
    const result = calculateParlayResult(parlay.legs);
    const expanded = state.expandedParlays.has(parlay.id);
    parlay.result = result;
    return `<article class="saved-parlay saved-parlay--${result}" data-parlay-id="${escapeHtml(parlay.id)}">
      <header class="saved-parlay__header">
        <div><span>Parlay · ${parlay.legs.length} selecciones</span><h3>${escapeHtml(parlay.name)}</h3><time datetime="${escapeHtml(parlay.createdAt)}">Guardado ${escapeHtml(new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(parlay.createdAt)))}</time></div>
        <div class="saved-parlay__summary"><strong class="result-badge result-badge--${result}">${resultLabels[result]}</strong><button class="parlay-expand" type="button" data-toggle-parlay aria-expanded="${expanded}">${expanded ? "−" : "+"}</button></div>
      </header>
      <div class="saved-parlay__legs" ${expanded ? "" : "hidden"}>${parlay.legs.map((storedLeg, index) => { const leg = applyAnalysisTiming(storedLeg); return `
        <section class="saved-leg saved-leg--${escapeHtml(leg.result)}" data-leg-id="${escapeHtml(leg.id)}">
          <div class="saved-leg__index">${index + 1}</div>
          <div class="saved-leg__content"><strong>${escapeHtml(leg.selection)}</strong><span>${escapeHtml(leg.market)}</span><small>${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)} · ${escapeHtml(leg.date)} · ${escapeHtml(normalizedSavedStatus(leg.fixtureStatus))}${leg.finalScore ? ` · Final ${escapeHtml(leg.finalScore)}` : ""}</small><small>Cuota ${displayValue(leg.originalOdds ?? leg.decimalOdds)} · Actualizada ${leg.updatedOdds ?? "Sin actualización"} · Implícita ${displayValue(leg.impliedProbability)}% · Modelo ${displayValue(leg.modelProbability ?? leg.estimatedProbability)}% · EV ${displayValue(leg.expectedValue)}%</small><small>Confianza efectiva: ${leg.effectiveConfidenceScore === null ? escapeHtml(leg.confidence) : `${escapeHtml(leg.effectiveConfidenceScore)}%`} · ${escapeHtml(leg.analysisTiming.label)} · Origen ${escapeHtml(pickOriginLabel(leg.sourceModule))} ${infoTooltip("pick_origin")}</small>${leg.analysisTiming.warning ? `<small class="timing-warning">${escapeHtml(leg.analysisTiming.warning)}</small>` : ""}${leg.oddsMovement.changed ? `<small class="timing-warning">${escapeHtml(leg.oddsMovement.warning)}</small>` : ""}</div>
          <label>Resultado<select data-leg-result><option value="pending" ${leg.result === "pending" ? "selected" : ""}>Pendiente</option><option value="won" ${leg.result === "won" ? "selected" : ""}>Ganada</option><option value="lost" ${leg.result === "lost" ? "selected" : ""}>Perdida</option><option value="void" ${leg.result === "void" ? "selected" : ""}>Anulada</option></select></label>
        </section>`; }).join("")}</div>
      <div class="saved-parlay__notes" ${expanded ? "" : "hidden"}><label for="notes-${escapeHtml(parlay.id)}">Notas del resultado</label><textarea id="notes-${escapeHtml(parlay.id)}" data-parlay-notes maxlength="500">${escapeHtml(parlay.notes || "")}</textarea></div>
      <footer class="saved-parlay__footer" ${expanded ? "" : "hidden"}><span>El resultado general se calcula con los estados de las selecciones.</span><button class="button button--danger" type="button" data-delete-parlay>Mover a Papelera</button></footer>
    </article>`;
  }).join("");
  persistSavedParlays();
  renderTrashParlays();
}

function parlayTotalOdds(legs, key) {
  const values = legs.map((leg) => Number(leg[key] ?? (key === "originalOdds" ? leg.decimalOdds : null)));
  return values.length && values.every((value) => value > 1) ? Number(values.reduce((product, value) => product * value, 1).toFixed(2)) : null;
}

function renderTrashParlays() {
  const trashed = state.savedParlays.filter((parlay) => parlay.trashed);
  if (!trashed.length) {
    elements.trashParlaysList.innerHTML = '<div class="saved-empty"><h3>No hay parlays eliminados.</h3><p>Los parlays enviados a Papelera podrán recuperarse desde aquí.</p></div>';
    return;
  }
  elements.trashParlaysList.innerHTML = trashed.map((parlay) => {
    const originalTotal = parlayTotalOdds(parlay.legs, "originalOdds");
    const updatedTotal = parlayTotalOdds(parlay.legs, "updatedOdds");
    return `<article class="trash-parlay" data-trash-parlay-id="${escapeHtml(parlay.id)}"><header><div><span>Papelera · ${parlay.legs.length} selecciones</span><h3>${escapeHtml(parlay.name)}</h3><small>Creado ${escapeHtml(formatUpdatedAt(parlay.createdAt))} · Eliminado ${escapeHtml(formatUpdatedAt(parlay.deletedAt))}</small></div><div><strong>Cuota ${displayValue(originalTotal)}</strong><small>Actualizada ${displayValue(updatedTotal)}</small></div></header><details><summary>Ver detalles</summary><div class="trash-parlay__legs">${parlay.legs.map((leg) => `<div><strong>${escapeHtml(leg.selection)}</strong><span>${escapeHtml(leg.market)} · ${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)}</span><small>${escapeHtml(normalizedSavedStatus(leg.fixtureStatus))} · ${escapeHtml(resultLabels[leg.result] || "Pendiente")}</small></div>`).join("")}</div></details><footer><button class="button button--primary button--compact" type="button" data-restore-parlay>Recuperar</button><button class="button button--danger button--compact" type="button" data-delete-parlay-forever>Eliminar definitivamente</button></footer></article>`;
  }).join("");
}

async function updateSavedParlayResults() {
  const allSavedLegs = [...state.savedPicks, ...state.savedParlays.filter((parlay) => !parlay.trashed).flatMap((parlay) => parlay.legs)];
  const fixtureIds = [...new Set(allSavedLegs.filter((leg) => leg.fixtureId && leg.selectionCode).map((leg) => leg.fixtureId))];
  if (!fixtureIds.length) {
    showNotice("No hay selecciones compatibles pendientes de actualización automática.");
    return;
  }
  elements.updateParlayResults.disabled = true;
  elements.updateParlayResults.textContent = "Consultando resultados…";
  try {
    const updates = await Promise.all(fixtureIds.map(async (fixtureId) => {
      const fixture = { id: fixtureId };
      const [result, details] = await Promise.all([
        footballDataService.getFixtureResult(fixtureId).catch(() => null),
        footballDataService.getFixtureData(fixture, true).catch(() => null)
      ]);
      return { fixtureId: String(fixtureId), result, details };
    }));
    const byFixture = new Map(updates.map((item) => [item.fixtureId, item]));
    let updated = 0;
    const updateLeg = (leg) => {
      const update = byFixture.get(String(leg.fixtureId));
      if (!update) return;
      const fixtureResult = update.result;
      leg.originalOdds ??= leg.decimalOdds ?? null;
      leg.fixtureStatus = fixtureResult?.statusLabel || update.details?.statusLabel || fixtureResult?.appStatus || leg.fixtureStatus;
      const currentMarket = [...(update.details?.marketAnalysis || []), ...(update.details?.researchData?.odds?.markets || [])]
        .find((market) => market.selectionKey === leg.selectionCode && (!leg.marketCode || market.marketKey === leg.marketCode));
      const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
      if (hasNumber(currentMarket?.decimalOdds)) leg.updatedOdds = Number(currentMarket.decimalOdds);
      if (hasNumber(currentMarket?.impliedProbabilityPct)) leg.impliedProbability = Number(currentMarket.impliedProbabilityPct);
      if (hasNumber(currentMarket?.estimatedProbabilityPct)) leg.modelProbability = Number(currentMarket.estimatedProbabilityPct);
      if (hasNumber(currentMarket?.expectedValuePct)) leg.expectedValue = Number(currentMarket.expectedValuePct);
      leg.lastUpdatedAt = new Date().toISOString();
      Object.assign(leg, applyAnalysisTiming(leg));
      if (leg.result !== "pending") return;
      const nextResult = settleLegResult(leg.selectionCode, fixtureResult);
      if (nextResult !== "pending") {
        leg.result = nextResult;
        leg.finalScore = `${fixtureResult.goals.home}-${fixtureResult.goals.away}`;
        leg.resolvedAt = new Date().toISOString();
        updated += 1;
      }
    };
    state.savedPicks.forEach(updateLeg);
    state.savedParlays.filter((parlay) => !parlay.trashed).forEach((parlay) => {
      parlay.legs.forEach(updateLeg);
      parlay.result = calculateParlayResult(parlay.legs);
      parlay.lastCheckedAt = new Date().toISOString();
    });
    persistSavedParlays();
    persistSavedPicks();
    renderSavedPicks();
    renderSavedParlays();
    showNotice(updated ? `${updated} selección(es) actualizadas con API-Football.` : "Los partidos pendientes todavía no tienen resultado final.");
  } finally {
    elements.updateParlayResults.disabled = state.savedParlays.filter((parlay) => !parlay.trashed).length === 0 && state.savedPicks.length === 0;
    elements.updateParlayResults.textContent = "Actualizar resultados";
  }
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll(".main-nav [data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("main-nav__item--active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (view === "saved") { renderSavedPicks(); renderSavedParlays(); }
  if (view === "audit") renderAuditFixtureOptions();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAnalysis(analysis) {
  elements.analysisStatus.className = `status-badge status-badge--${statusClass(analysis.estado_analisis)}`;
  elements.analysisStatus.textContent = analysis.estado_analisis;
  const list = (items, fallback) => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(fallback)}</p>`;
  const context = analysis._context;
  const quality = context?.quality;
  const formCard = (team) => team ? `<article><span>${escapeHtml(team.team)}</span><strong>${displayValue(team.form)}</strong><small>${displayValue(team.avgGoalsFor)} GF · ${displayValue(team.avgGoalsAgainst)} GC · ${displayValue(team.restDays)} días descanso</small></article>` : "";
  const calculations = context?.marketAnalysis || [];
  const calculationRows = calculations.map((item) => `<tr><td>${escapeHtml(item.selection)}</td><td>${displayValue(item.decimalOdds)}</td><td>${displayValue(item.estimatedProbabilityPct)}%</td><td class="${item.expectedValuePct >= 0 ? "value-positive" : "value-negative"}">${displayValue(item.expectedValuePct)}%</td></tr>`).join("");
  const pickReview = analysis.pickReview;
  const categoryLabels = {
    pick_fuerte: "Pick fuerte", pick_logico: "Pick lógico",
    value_sospechoso: "Value sospechoso", high_risk_value: "Falso valor probable",
    agresivo_stake_bajo: "Agresivo · exposición baja",
    evitar: "Evitar", sin_pick: "Sin pick"
  };
  const strengthLabels = { strong: "Fuerte", medium: "Medio", slight: "Ligero", none: "Sin favorito claro" };
  const gapLabels = { very_high: "Muy alta", high: "Alta", medium: "Media", low: "Baja" };
  const recommendedQualityScore = Number(pickReview?.recommendedPick?.confidenceScore);
  const qualityScoreHtml = Number.isFinite(recommendedQualityScore)
    ? `<div class="pick-quality" aria-label="Pick Quality Score ${recommendedQualityScore} de 100"><span>Pick Quality Score</span><div><i style="width:${Math.max(0, Math.min(100, recommendedQualityScore))}%"></i></div><strong>${recommendedQualityScore}/100</strong></div>`
    : '<div class="pick-quality pick-quality--empty"><span>Pick Quality Score</span><strong>No disponible</strong></div>';
  const pickReviewHtml = pickReview ? `
    <section class="pick-review">
      <div><span>Favorito real</span><strong>${escapeHtml(pickReview.favoriteTeam || "No identificado")}</strong><small>${escapeHtml(strengthLabels[pickReview.favoriteStrength] || pickReview.favoriteStrength)}</small></div>
      <div><span>Brecha de calidad</span><strong>${escapeHtml(gapLabels[pickReview.qualityGap] || pickReview.qualityGap)}</strong></div>
      <div><span>Mayor EV</span><strong>${escapeHtml(pickReview.highestEvPick?.selection || "Sin cálculo")}</strong><small>${displayValue(pickReview.highestEvPick?.expectedValuePct)}% · ${escapeHtml(categoryLabels[pickReview.highestEvPick?.pickCategory] || "Sin categoría")}</small></div>
      <div><span>Pick lógico recomendado</span><strong>${escapeHtml(pickReview.recommendedPick?.selection || "Sin pick principal")}</strong><small>${escapeHtml(categoryLabels[pickReview.recommendedPick?.pickCategory] || "Sin pick")} · Confianza ${displayValue(pickReview.recommendedPick?.confidenceScore, 0)}/100</small>${qualityScoreHtml}</div>
      <p>${escapeHtml(pickReview.warning || "Sin advertencias adicionales.")}</p>
    </section>` : "";
  const confidenceColor = (pick) => {
    if (pick.highlightColor) return pick.highlightColor;
    if (pick.confidencePct >= 70 && ["pick_fuerte", "pick_logico"].includes(pick.pickCategory)) return "green";
    if (pick.confidencePct >= 50 && pick.pickCategory !== "evitar") return "orange";
    return "red";
  };
  const confidencePicksHtml = pickReview?.confidencePicks?.length ? `
    <section class="confidence-picks">
      <div class="confidence-picks__heading"><h3>Matriz de oportunidades</h3><small>Ordenada por confianza evaluada, no únicamente por EV.</small></div>
      <div class="confidence-picks__table" role="table" aria-label="Posibles picks ordenados por confianza">
        ${pickReview.confidencePicks.map((pick) => `<div class="confidence-pick confidence-pick--${confidenceColor(pick)} ${pickSignalClass(pick)}" role="row">
          <span role="cell">${pick.rank}</span>
          <div role="cell"><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)} · ${escapeHtml(categoryLabels[pick.pickCategory] || pick.pickCategory)}</small>${pick.warning ? `<small>${escapeHtml(pick.warning)}</small>` : ""}</div>
          <div role="cell"><strong>${displayValue(pick.confidencePct)}%</strong><small>Prob. modelo ${displayValue(pick.estimatedProbabilityPct)}% · EV ${displayValue(pick.expectedValuePct)}%</small></div>
        </div>`).join("")}
      </div>
      <p>Verde: opción lógica con respaldo suficiente. Naranja: riesgo o validación parcial. Rojo: evitar o sin valor confirmado.</p>
    </section>` : "";
  const suggestedMarketsHtml = analysis.mercados_sugeridos.length
    ? analysis.mercados_sugeridos.map((market, index) => `<div class="market-row market-row--actionable"><div><span>${escapeHtml(market.seleccion)}</span><small>${escapeHtml(market.mercado)} · Cuota ${displayValue(market.cuota_decimal)} · Prob. ${displayValue(market.probabilidad_modelo)}% · EV ${displayValue(market.valor_esperado)}%</small><small>${escapeHtml(categoryLabels[market.pickCategory] || "Sin categoría")} · Confianza lógica ${displayValue(market.confidenceScore, 0)}/100${market.requiere_revision ? " · Requiere revisión" : ""}</small>${market.warning ? `<small>${escapeHtml(market.warning)}</small>` : ""}</div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-market="${index}" ${analysis._source === "mock" ? "disabled" : ""}>Guardar pick</button><button class="button button--add" type="button" data-add-market="${index}" ${analysis._source === "mock" || market.requiere_revision || !quality?.canSuggest ? "disabled" : ""}>Agregar al parlay</button></div></div>`).join("")
    : '<p>No se identificó un mercado con cobertura y valor suficiente.</p>';
  const avoidMarketsHtml = analysis.mercados_a_evitar?.length
    ? analysis.mercados_a_evitar.map((market) => `<div class="avoid-market"><strong>${escapeHtml(market.mercado || "Mercado")}</strong><span>${escapeHtml(market.razonamiento || "No cumple los controles de riesgo.")}</span></div>`).join("")
    : '<p>No se identificaron mercados adicionales para evitar.</p>';

  elements.analysisContent.innerHTML = `
    <div class="analysis-hero">
      <div class="analysis-hero__title"><h3>${escapeHtml(analysis.partido.local)} vs ${escapeHtml(analysis.partido.visitante)}</h3><div class="analysis-mode-badges">${analysis.analysisMode === "rule_engine" ? '<span class="source-chip source-chip--model">Solo datos · Motor de Reglas</span>' : '<span class="source-chip source-chip--external">Explicación IA</span>'}${quality ? `<span class="quality-badge quality-badge--${quality.level.toLowerCase()}">Cobertura ${escapeHtml(quality.level)} · ${quality.score}/100</span>` : ""}</div></div>
      <p>${escapeHtml(analysis.resumen_partido)}</p>
    </div>
    ${pickReviewHtml}
    ${confidencePicksHtml}
    <section class="analysis-card analysis-card--opportunities">
      <h3>Picks secundarios y acciones</h3>
      ${suggestedMarketsHtml}
      <p class="market-disclaimer">Agregar conserva la sugerencia para seguimiento; no realiza una apuesta.</p>
    </section>
    <section class="analysis-card analysis-card--avoid"><h3>Mercados a evitar</h3>${avoidMarketsHtml}</section>
    ${context ? `<section class="analysis-context"><div class="form-summary">${formCard(context.preMatch?.home)}${formCard(context.preMatch?.away)}</div>${calculationRows ? `<div class="calculation-table"><h3>Cálculos verificados antes de la IA</h3><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Selección</th><th>Cuota</th><th>Prob. estimada</th><th>EV</th></tr></thead><tbody>${calculationRows}</tbody></table></div></div>` : '<p class="analysis-context__empty">No hubo cuotas suficientes para calcular valor esperado.</p>'}</section>` : ""}
    <div class="analysis-grid">
      <section class="analysis-card">
        <h3>Datos confirmados</h3>
        ${list(analysis.datos_confirmados, "No hay datos confirmados.")}
      </section>
      <section class="analysis-card">
        <h3>Datos faltantes</h3>
        ${list(analysis.datos_faltantes, "No se detectaron faltantes en la simulación.")}
      </section>
      <section class="analysis-card">
        <h3>Riesgos principales</h3>
        ${list(analysis.riesgos_principales, "Sin riesgos adicionales identificados.")}
      </section>
      <section class="analysis-card analysis-card--wide">
        <h3>Decisión responsable para parlay · ${escapeHtml(analysis.prediccion_prudente.confianza)}</h3>
        <p><strong>${escapeHtml(analysis.prediccion_prudente.seleccion)}</strong></p>
        <p>${escapeHtml(analysis.prediccion_prudente.razonamiento)}</p>
        <p><strong>Parlay:</strong> ${escapeHtml(analysis.apto_para_parlay.respuesta)}. ${escapeHtml(analysis.apto_para_parlay.razonamiento)}</p>
      </section>
    </div>
    <p class="analysis-warning">${escapeHtml(analysis.advertencia)}${analysis._source === "mock" ? " Esta salida usa datos sintéticos y no debe utilizarse para apostar." : ""}</p>
  `;
  decoratePickSignals(elements.analysisContent, ".market-row--actionable", analysis.mercados_sugeridos);
}

function openGuideCoverage() {
  switchView("guide");
  const coverage = document.querySelector("#guide-coverage-module");
  if (coverage) coverage.open = true;
  window.requestAnimationFrame(() => coverage?.scrollIntoView({ behavior: "auto", block: "start" }));
}

function showAnalysisEmpty() {
  elements.analysisStatus.className = "status-badge status-badge--unavailable";
  elements.analysisStatus.textContent = "No disponible";
  elements.analysisContent.innerHTML = '<div class="empty-state"><span class="empty-state__icon" aria-hidden="true">✦</span><h3>Partido seleccionado</h3><p>Analiza primero con el Motor de Reglas. OpenAI queda como explicación opcional.</p></div>';
}

function renderAuditFixtureOptions() {
  const fixtures = state.fixtures.filter((fixture) => fixture.status === "finished");
  elements.auditFixture.innerHTML = fixtures.length
    ? `<option value="">Selecciona un partido</option>${fixtures.map((fixture) => `<option value="${escapeHtml(fixture.id)}">${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)}${latestEvidenceForFixture(state.evidenceSnapshots, fixture.id) ? " · Evidencia guardada" : " · Sin snapshot"}</option>`).join("")}`
    : '<option value="">Busca partidos finalizados en el Dashboard</option>';
  elements.runAudit.disabled = !fixtures.length;
}

function renderAuditResults(audit) {
  const metrics = audit.metrics || {};
  const readiness = metrics.calibrationReadiness || {};
  const calibrationRows = (metrics.calibrationBands || []).filter((band) => band.count > 0).map((band) => `<tr><td>${escapeHtml(band.band)}</td><td>${displayValue(band.count, 0)}</td><td>${displayValue(band.predictedPct)}%</td><td>${displayValue(band.observedPct)}%</td><td>${displayValue(band.gapPct)} pp</td></tr>`).join("");
  const rows = (audit.records || []).map((row) => `<tr class="audit-row audit-row--${escapeHtml(row.color)}">
    <td data-label="Decisión"><span class="audit-decision audit-decision--${escapeHtml(row.color)}">${escapeHtml(row.decision)}</span></td><td data-label="Fecha">${escapeHtml(String(row.date || "").slice(0, 10))}</td><td data-label="Partido">${escapeHtml(row.match)}</td><td data-label="Liga">${escapeHtml(row.league)}</td>
    <td data-label="Mercado">${escapeHtml(row.market)}</td><td data-label="Pick">${escapeHtml(row.pick)}</td><td data-label="Cuota">${displayValue(row.odds)}</td>
    <td data-label="Implícita">${displayValue(row.impliedProbability)}%</td><td data-label="Modelo">${displayValue(row.modelProbability)}%</td><td data-label="EV">${displayValue(row.expectedValue)}%</td><td data-label="EV conservador">${displayValue(row.conservativeExpectedValue)}%</td>
    <td data-label="Confianza">${displayValue(row.confidence)}/100</td><td data-label="Calidad">${escapeHtml(row.dataQuality)}</td><td data-label="Resultado">${escapeHtml(row.finalScore)}</td>
    <td data-label="Estado"><strong>${escapeHtml(row.outcome)}</strong></td><td data-label="Error">${escapeHtml(row.errorDetected || "Sin error crítico")}</td><td data-label="Recomendación">${escapeHtml(row.recommendation)}</td></tr>`).join("");
  elements.auditResults.innerHTML = `<div class="history-metrics"><article><span>Candidatos evaluados</span><strong>${displayValue(metrics.totalPicks, 0)}</strong></article><article><span>Picks con cuota elegibles</span><strong>${displayValue(metrics.eligiblePicks, 0)}</strong></article><article><span>Hit rate descriptivo</span><strong>${displayValue(metrics.hitRate)}%</strong><small>IC 95% ${displayValue(metrics.hitRateInterval95?.lowPct)}-${displayValue(metrics.hitRateInterval95?.highPct)}%</small></article><article><span>ROI elegible</span><strong>${displayValue(metrics.ROI)}%</strong></article><article><span>ECE</span><strong>${displayValue(metrics.expectedCalibrationError)} pp</strong></article><article><span>Brier Score</span><strong>${displayValue(metrics.brierScore, 4)}</strong><small>Muestra ${displayValue(metrics.calibrationSampleSize, 0)}</small></article><article><span>Log Loss</span><strong>${displayValue(metrics.logLoss, 4)}</strong></article><article><span>NO BET</span><strong>${displayValue(metrics.noBets, 0)}</strong></article></div><div class="detail-note ${readiness.canRecalibrate ? "detail-note--info" : ""}"><strong>${escapeHtml(readiness.label || "Calibración no evaluada")}</strong><span>${readiness.canRecalibrate ? "La muestra permite estudiar una recalibración por versión y mercado." : `No recalibrar automáticamente: se requieren al menos ${displayValue(readiness.minimumRequired, 0)} resultados válidos en la misma versión y mercado.`}</span></div><p class="market-disclaimer">El ROI usa únicamente picks elegibles con cuota válida. Brier Score, Log Loss y ECE solo usan resultados HIT/MISS con probabilidad válida; menor es mejor. La tabla completa también enseña candidatos descartados para explicar por qué fueron NO BET.</p>${calibrationRows ? `<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Banda modelo</th><th>Muestra</th><th>Prob. media</th><th>Acierto real</th><th>Brecha</th></tr></thead><tbody>${calibrationRows}</tbody></table></div>` : ""}<div class="detail-table-wrap audit-table-wrap"><table class="detail-table"><thead><tr><th>Decisión</th><th>Fecha</th><th>Partido</th><th>Liga</th><th>Mercado</th><th>Pick</th><th>Cuota</th><th>Prob. implícita</th><th>Prob. modelo</th><th>EV</th><th>EV conservador</th><th>Confianza</th><th>Data Quality</th><th>Resultado final</th><th>Estado</th><th>Error detectado</th><th>Recomendación</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const evidenceNote = audit.mode === "saved_pre_match_evidence"
    ? `<div class="detail-note detail-note--info"><strong>Snapshot prepartido verificado</strong><span>Capturado ${escapeHtml(formatUpdatedAt(audit.capturedAt))}. Se usan exactamente los picks guardados antes del inicio.</span></div>`
    : '<div class="detail-note"><strong>Reconstrucción histórica</strong><span>No se encontró un snapshot guardado para este partido.</span></div>';
  elements.auditResults.insertAdjacentHTML("afterbegin", evidenceNote);
}

async function runSelectedAudit() {
  if (!elements.auditFixture.value) return;
  elements.runAudit.disabled = true;
  elements.runAudit.textContent = "Auditando…";
  try {
    const evidence = latestEvidenceForFixture(state.evidenceSnapshots, elements.auditFixture.value);
    renderAuditResults(await footballDataService.auditFixture(elements.auditFixture.value, evidence));
  }
  catch (error) { elements.auditResults.innerHTML = `<div class="saved-empty"><h3>No se pudo ejecutar la auditoría</h3><p>${escapeHtml(error.message)}</p></div>`; }
  finally { elements.runAudit.disabled = false; elements.runAudit.textContent = "Ejecutar auditoría"; }
}

async function capturePreMatchEvidence() {
  const fixture = selectedFixture();
  if (!fixture || state.isCapturingEvidence) return;
  if (fixture.status !== "scheduled") return showNotice("La evidencia debe guardarse antes de que inicie el partido.");
  state.isCapturingEvidence = true;
  elements.savePreMatchEvidence.disabled = true;
  elements.savePreMatchEvidence.textContent = "Guardando…";
  elements.evidenceStatus.textContent = "Recopilando módulos sin usar OpenAI…";
  const fallback = (status, warning) => ({ status, warning, picks: [], suggestedMarkets: [] });
  try {
    const results = await Promise.allSettled([
      footballDataService.getDataPicks(fixture), footballDataService.getPoissonModel(fixture),
      footballDataService.getTeamGoalProbability(fixture), footballDataService.getCornersModel(fixture)
    ]);
    const value = (index, warning) => results[index].status === "fulfilled" ? results[index].value : fallback("not_available", warning);
    const dataPicks = value(0, "Picks basados en datos no disponibles al capturar."), poisson = value(1, "Poisson no disponible al capturar.");
    const teamGoals = value(2, "Gol por equipo no disponible al capturar."), corners = value(3, "Corners no disponible al capturar.");
    state.dataPicksByFixture.set(fixture.id, dataPicks);
    state.poissonByFixture.set(fixture.id, poisson);
    state.teamGoalsByFixture.set(fixture.id, teamGoals);
    state.cornersByFixture.set(fixture.id, corners);
    const snapshot = createEvidenceSnapshot({ fixture, dataPicks, poisson, teamGoals, corners });
    state.evidenceSnapshots = saveEvidenceSnapshot(snapshot);
    showNotice("Evidencia prepartido guardada. No se utilizó OpenAI.");
  } catch (error) {
    showNotice(error.message || "No fue posible guardar la evidencia prepartido.");
  } finally {
    state.isCapturingEvidence = false;
    elements.savePreMatchEvidence.textContent = "Guardar evidencia";
    renderFixtureData();
  }
}

function downloadCurrentEvidence() {
  const fixture = selectedFixture();
  const snapshot = latestEvidenceForFixture(state.evidenceSnapshots, fixture?.id);
  if (!fixture || !snapshot) return showNotice("Primero guarda la evidencia prepartido.");
  const safeName = (value) => String(value || "equipo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase();
  const blob = new Blob([evidenceSnapshotToText(snapshot)], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `evidencia_${fixture.date}_${safeName(fixture.home)}_vs_${safeName(fixture.away)}.txt`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function renderDataPicks(result) {
  const status = result.status === "available" ? "Disponible" : result.status === "partial" ? "Parcial" : "No disponible";
  elements.dataPicksStatus.className = `status-badge status-badge--${statusClass(status)}`;
  elements.dataPicksStatus.textContent = status;
  if (!result.picks?.length) {
    elements.dataPicksContent.innerHTML = `<div class="research-empty">${escapeHtml(result.warnings?.[0] || "No hay respaldo estadístico suficiente para evaluar mercados.")}</div>`;
    return;
  }
  const fixture = selectedFixture();
  const timing = resolveAnalysisTiming({ kickoffAt: fixture?.utcDateTime, lastUpdatedAt: result.generatedAt });
  const picks = result.picks || [];
  const strongPicks = picks.filter((pick) => pick.highlightColor === "green" && pick.canAdd);
  const avoidedPicks = picks.filter((pick) => pick.highlightColor === "red" || /evitar/i.test(pick.decision || pick.level || ""));
  const reviewPicks = picks.filter((pick) => !strongPicks.includes(pick) && !avoidedPicks.includes(pick));
  const pickCard = (pick, compact = false) => `
    <article class="data-pick data-pick--${escapeHtml(pick.highlightColor)} ${pickSignalClass(pick)}${compact ? " data-pick--compact" : ""}">
      <div class="data-pick__heading"><div><small>${labelWithTooltip(pick.market)}</small><strong>${escapeHtml(pick.selection)}</strong></div><span>${escapeHtml(pick.decision || pick.level)}</span></div>
      <div class="data-pick__metrics"><span>${labelWithTooltip("Modelo")} <b>${displayValue(pick.modelProbabilityPct)}%</b></span><span>${labelWithTooltip("Cuota")} <b>${displayValue(pick.decimalOdds)}</b></span><span>${labelWithTooltip("EV")} <b>${pick.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(pick.expectedValuePct)}%`}</b></span><span>EV conservador <b>${pick.conservativeExpectedValuePct === null ? "Sin muestra" : `${escapeHtml(pick.conservativeExpectedValuePct)}%`}</b></span><span>Conf. estadística <b>${displayValue(pick.statisticalConfidenceScore)}/100</b></span><span>Conf. futbolística <b>${displayValue(pick.footballConfidenceScore)}/100</b></span><span>Riesgo <b>${displayValue(pick.riskScore)}/100</b></span><span>${labelWithTooltip("Poisson")} <b>${displayValue(pick.poissonSupportScore)}/100</b></span></div>
      <p>${escapeHtml(pick.explanation)}</p>
      <small>Bookmaker: ${escapeHtml(pick.bookmaker || "No disponible")} · Contradicción: ${escapeHtml(pick.contradictionLevel || "No disponible")} · Origen: ${escapeHtml(pickOriginLabel(pick.sourceModule || "data_picks"))} ${infoTooltip("pick_origin")}</small>
      <div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-data-pick="${escapeHtml(pick.selectionKey)}" ${pick.canAdd ? "" : "disabled"}>Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-data-pick="${escapeHtml(pick.selectionKey)}" ${pick.canAdd ? "" : "disabled"}>Agregar pick</button></div>
    </article>`;
  const pickSection = (title, type, group, compact = false) => `<section class="decision-pick-group decision-pick-group--${type}"><header><h3>${escapeHtml(title)}</h3><span>${group.length}</span></header>${group.length ? `<div class="data-picks-grid">${group.map((pick) => pickCard(pick, compact)).join("")}</div>` : '<p class="muted-text">No hay selecciones en esta categoría.</p>'}</section>`;
  elements.dataPicksContent.innerHTML = `
    <div class="decision-engine-summary"><article><span>Decisión final</span><strong>${escapeHtml(result.finalDecision || "NO BET")}</strong><small>Motor ${escapeHtml(result.modelVersion || "v1")}</small></article><article><span>Evaluadas</span><strong>${picks.length}</strong><small>Calidad ${escapeHtml(result.quality?.label || "No disponible")} · ${displayValue(result.dataQualityScore)}/100</small></article><article class="decision-engine-summary__strong"><span>Picks fuertes</span><strong>${strongPicks.length}</strong><small>Con acción disponible</small></article><article class="decision-engine-summary__review"><span>En revisión</span><strong>${reviewPicks.length}</strong><small>Requieren contraste</small></article><article class="decision-engine-summary__avoid"><span>Evitados</span><strong>${avoidedPicks.length}</strong><small>Bloqueados por riesgo</small></article></div>
    <div class="analysis-timing analysis-timing--${escapeHtml(timing.window)}"><strong>${escapeHtml(timing.label)}</strong><span>${timing.minutesToKickoff === null ? "Hora del partido no disponible" : `${escapeHtml(timing.minutesToKickoff)} minutos para el inicio`}${timing.isConfirmed ? " · Confirmado por frescura" : ""}</span>${timing.warning ? `<small>${escapeHtml(timing.warning)}</small>` : ""}</div>
    ${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}
    ${pickSection("Recomendables", "strong", strongPicks)}${pickSection("En revisión", "review", reviewPicks)}${pickSection("Evitados", "avoid", avoidedPicks, true)}`;
}

async function loadDataPicks() {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingDataPicks) return;
  if (state.dataPicksByFixture.has(fixture.id)) return toggleReadyModule(elements.showDataPicks, elements.dataPicksContent);
  state.isLoadingDataPicks = true;
  elements.showDataPicks.disabled = true;
  elements.showDataPicks.textContent = "Evaluando…";
  elements.dataPicksStatus.className = "status-badge status-badge--processing";
  elements.dataPicksStatus.textContent = "Procesando";
  try {
    const result = await footballDataService.getDataPicks(fixture);
    state.dataPicksByFixture.set(fixture.id, result);
    renderDataPicks(result);
    showModuleReady(elements.showDataPicks, elements.dataPicksContent);
  } catch (error) {
    renderDataPicks({ status: "not_available", picks: [], warnings: [error.message] });
    elements.dataPicksContent.hidden = false;
  } finally {
    state.isLoadingDataPicks = false;
    elements.showDataPicks.disabled = !selectedFixture();
    if (!state.dataPicksByFixture.has(fixture.id)) elements.showDataPicks.textContent = "Mostrar";
  }
}

function addDataPickToParlay(selectionKey) {
  const fixture = selectedFixture();
  const result = state.dataPicksByFixture.get(fixture?.id);
  const pick = result?.picks?.find((item) => item.selectionKey === selectionKey);
  if (!fixture || !pick || !pick.canAdd) return showNotice("Solo se permiten picks VALOR o PRECAUCIÓN.");
  appendPickToParlay({
    id: `${fixture.id}:${pick.marketKey}:${pick.selectionKey}`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey,
    decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null,
    impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
    estimatedProbability: pick.estimatedProbabilityPct, expectedValue: pick.expectedValuePct,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.decision, decision: pick.decision,
    reasoning: pick.explanation, requiresReview: pick.highlightColor !== "green" && pick.highlightColor !== "blue",
    analysisStatus: pick.status, sourceModule: "data_picks", source: pick.sourceProvider, bookmaker: pick.bookmaker, dataQualityScore: pick.dataQualityScore, poissonSupportScore: pick.poissonSupportScore, teamGoalSupportScore: pick.teamGoalSupportScore, contradictionLevel: pick.contradictionLevel,
    supportingData: pick.supportingData, contradictingData: pick.contradictingData
  }, "Pick agregado a Mi parlay. Se guardará únicamente cuando nombres y guardes el parlay.");
}

function saveDataPick(selectionKey) {
  const fixture = selectedFixture();
  const result = state.dataPicksByFixture.get(fixture?.id);
  const pick = result?.picks?.find((item) => item.selectionKey === selectionKey);
  if (!fixture || !pick || !pick.canAdd) return showNotice("Solo se permiten picks VALOR o PRECAUCIÓN.");
  saveIndividualLeg({
    id: `${fixture.id}:${pick.marketKey}:${pick.selectionKey}`, fixtureId: fixture.id,
    league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey,
    decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null,
    impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
    estimatedProbability: pick.estimatedProbabilityPct, expectedValue: pick.expectedValuePct,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.decision, decision: pick.decision,
    reasoning: pick.explanation, requiresReview: pick.highlightColor !== "green" && pick.highlightColor !== "blue",
    result: "pending", sourceModule: "data_picks", source: pick.sourceProvider, bookmaker: pick.bookmaker, dataQualityScore: pick.dataQualityScore, poissonSupportScore: pick.poissonSupportScore, teamGoalSupportScore: pick.teamGoalSupportScore, contradictionLevel: pick.contradictionLevel,
    supportingData: pick.supportingData, contradictingData: pick.contradictingData
  });
}

function outcomeDecisionClass(decision = "") {
  if (decision === "apuesta_recomendada") return "green";
  if (decision === "apuesta_con_valor_pero_riesgo_alto" || decision === "modelos_contradictorios") return "orange";
  if (decision === "sin_valor" || decision === "datos_insuficientes") return "red";
  return "gray";
}

function renderOutcomeScenarios(result) {
  const scenarios = result?.scenarios || [];
  const statusLabels = {
    available: ["Disponible", "available"], partial: ["Parcial", "partial"],
    not_available: ["No disponible", "unavailable"], error: ["Error", "unavailable"]
  };
  const [label, status] = statusLabels[result?.status] || statusLabels.not_available;
  elements.outcomeStatus.className = `status-badge status-badge--${status}`;
  elements.outcomeStatus.textContent = label;
  if (!scenarios.length) {
    elements.outcomeContent.innerHTML = `<div class="research-empty"><strong>${escapeHtml(result?.decisionLabel || label)}</strong><p>${escapeHtml((result?.missingData || []).join("; ") || result?.warning || "No hay datos suficientes para calcular 1X2.")}</p></div>`;
    return;
  }
  const warningText = result.warning || "EV positivo no decide por si solo.";
  const scenarioCards = scenarios.map((item) => {
    const support = item.supportingData?.slice(0, 4).join(" | ") || "Sin soporte suficiente.";
    const contradictions = item.contradictingData?.length ? item.contradictingData.join(" ") : "Sin contradicciones fuertes.";
    return `<article class="outcome-card outcome-card--${escapeHtml(outcomeDecisionClass(item.decision))}">
      <header><span>${escapeHtml(item.label)}</span><strong>${displayValue(item.probabilityPct)}%</strong></header>
      <div class="outcome-bar"><i style="width:${Math.min(100, Number(item.probabilityPct || 0))}%"></i></div>
      <dl><div><dt>Confianza futbolistica</dt><dd>${displayValue(item.footballConfidenceScore, 0)}/100</dd></div><div><dt>Cuota</dt><dd>${item.decimalOdds ? `${displayValue(item.decimalOdds)} (${escapeHtml(item.bookmaker)})` : "No disponible"}</dd></div><div><dt>EV</dt><dd>${item.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(item.expectedValuePct)}%`}</dd></div><div><dt>Decision</dt><dd>${escapeHtml(item.decisionLabel)}</dd></div></dl>
      <p><b>Apoya:</b> ${escapeHtml(support)}</p><p><b>Contradice:</b> ${escapeHtml(contradictions)}</p>
    </article>`;
  }).join("");
  elements.outcomeContent.innerHTML = `<div class="outcome-summary">
    <article><span>Resultado mas probable</span><strong>${escapeHtml(result.resultMostLikely || "No disponible")}</strong><small>${escapeHtml(result.decisionLabel || "No bet")}</small></article>
    <article><span>Confianza</span><strong>${displayValue(result.confidenceScore, 0)}/100</strong><small>Riesgo ${escapeHtml(result.risk || "medium")}</small></article>
    <article><span>Fuentes</span><strong>${escapeHtml((result.supportingData || []).join(" + ") || "Modelo interno")}</strong><small>${escapeHtml((result.missingData || []).slice(0, 2).join(" | "))}</small></article>
  </div><div class="outcome-grid">${scenarioCards}</div><p class="market-disclaimer">${escapeHtml(warningText)}</p>`;
}

async function loadOutcomeScenarios() {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingOutcome) return;
  if (state.outcomeByFixture.has(fixture.id)) return toggleReadyModule(elements.showOutcome, elements.outcomeContent);
  state.isLoadingOutcome = true;
  elements.showOutcome.disabled = true;
  elements.showOutcome.textContent = "Calculando...";
  elements.outcomeStatus.className = "status-badge status-badge--processing";
  elements.outcomeStatus.textContent = "Calculando";
  try {
    const result = await footballDataService.getOutcomeScenarios(fixture);
    state.outcomeByFixture.set(fixture.id, result);
    renderOutcomeScenarios(result);
    showModuleReady(elements.showOutcome, elements.outcomeContent);
  } catch (error) {
    renderOutcomeScenarios({ status: "error", scenarios: [], warning: error.message, decisionLabel: "Error" });
  } finally {
    state.isLoadingOutcome = false;
    elements.showOutcome.disabled = !selectedFixture();
    if (!state.outcomeByFixture.has(fixture.id)) elements.showOutcome.textContent = "Mostrar";
  }
}

function renderPoisson(result) {
  const status = result.status === "available" ? "Disponible" : result.status === "partial" ? "Parcial" : "No disponible";
  elements.poissonStatus.className = `status-badge status-badge--${statusClass(status)}`;
  elements.poissonStatus.textContent = status;
  if (result.status === "not_available") {
    elements.poissonContent.innerHTML = `<div class="research-empty">${escapeHtml(result.warning || "Modelo Poisson no disponible.")}</div>`;
    return;
  }
  const fixture = selectedFixture();
  const expectedTotal = Number.isFinite(Number(result.lambdaHome)) && Number.isFinite(Number(result.lambdaAway))
    ? Number((Number(result.lambdaHome) + Number(result.lambdaAway)).toFixed(2)) : null;
  const probabilityRows = [
    ["Local gana", result.probabilities.homeWin], ["Empate", result.probabilities.draw], ["Visitante gana", result.probabilities.awayWin],
    ["Doble oportunidad 1X", result.probabilities.doubleChance1X], ["Doble oportunidad X2", result.probabilities.doubleChanceX2],
    ["Over 0.5", result.probabilities.over05], ["Over 1.5", result.probabilities.over15], ["Over 2.5", result.probabilities.over25],
    ["Under 2.5", result.probabilities.under25], ["Under 3.5", result.probabilities.under35],
    ["BTTS Sí", result.probabilities.bttsYes], ["BTTS No", result.probabilities.bttsNo]
  ];
  elements.poissonContent.innerHTML = `
    <div class="poisson-summary poisson-summary--intelligence"><article><span>λ ${escapeHtml(fixture?.home || "Local")}</span><strong>${displayValue(result.lambdaHome)}</strong><small>Intensidad esperada</small></article><article><span>λ ${escapeHtml(fixture?.away || "Visitante")}</span><strong>${displayValue(result.lambdaAway)}</strong><small>Intensidad esperada</small></article><article><span>Total esperado</span><strong>${displayValue(expectedTotal)}</strong><small>λ local + λ visitante</small></article><article><span>Calidad</span><strong>${escapeHtml(result.quality?.label || "No disponible")} · ${displayValue(result.dataQualityScore)}/100</strong><small>Calidad de entrada</small></article><article><span>Versión</span><strong>${escapeHtml(result.modelVersion)}</strong><small>Motor estadístico</small></article></div>
    ${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}
    <div class="poisson-layout">
      <section><h3>Probabilidades</h3><div class="poisson-probabilities">${probabilityRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${displayValue(value)}%</strong></div>`).join("")}</div></section>
      <section><h3>Marcadores más probables</h3><div class="likely-scores">${result.likelyScores.map((row) => `<div><strong>${escapeHtml(row.score)}</strong><span>${escapeHtml(row.probabilityPct)}%</span></div>`).join("")}</div></section>
    </div>
    <section class="poisson-markets"><h3>Mercados derivados</h3>${result.suggestedMarkets.length ? result.suggestedMarkets.map((pick) => `<article class="poisson-market poisson-market--${escapeHtml(pick.highlightColor)}"><div><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)} · Modelo ${escapeHtml(pick.probabilityPct)}% · Cuota ${displayValue(pick.decimalOdds)} · EV ${pick.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(pick.expectedValuePct)}%`}</small><small>Confianza ${escapeHtml(pick.confidenceScore)}/100 · ${escapeHtml(pick.level)}</small></div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-poisson="${escapeHtml(pick.selectionKey)}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-poisson="${escapeHtml(pick.selectionKey)}">Agregar al parlay</button></div></article>`).join("") : '<p class="muted-text">No hay mercados con respaldo mínimo suficiente.</p>'}</section>
    <p class="market-disclaimer">Poisson es una referencia matemática parcial y no decide por sí solo el pick final.</p>`;
  decoratePickSignals(elements.poissonContent, ".poisson-market", result.suggestedMarkets);
}

async function loadPoisson() {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingPoisson) return;
  if (state.poissonByFixture.has(fixture.id)) return toggleReadyModule(elements.showPoisson, elements.poissonContent);
  state.isLoadingPoisson = true;
  elements.showPoisson.disabled = true;
  elements.showPoisson.textContent = "Calculando…";
  elements.poissonStatus.className = "status-badge status-badge--processing";
  elements.poissonStatus.textContent = "Procesando";
  try {
    const result = await footballDataService.getPoissonModel(fixture);
    state.poissonByFixture.set(fixture.id, result);
    renderPoisson(result);
    showModuleReady(elements.showPoisson, elements.poissonContent);
  } catch (error) {
    renderPoisson({ status: "not_available", warning: error.message, suggestedMarkets: [] });
    elements.poissonContent.hidden = false;
  } finally {
    state.isLoadingPoisson = false;
    elements.showPoisson.disabled = !selectedFixture();
    if (!state.poissonByFixture.has(fixture.id)) elements.showPoisson.textContent = "Mostrar";
  }
}

function poissonLeg(selectionKey) {
  const fixture = selectedFixture();
  const result = state.poissonByFixture.get(fixture?.id);
  const pick = result?.suggestedMarkets?.find((item) => item.selectionKey === selectionKey);
  if (!fixture || !pick) return null;
  return {
    id: `${fixture.id}:${pick.marketKey}:${pick.selectionKey}:poisson`, fixtureId: fixture.id,
    league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey,
    decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null,
    impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
    estimatedProbability: pick.modelProbabilityPct, expectedValue: pick.expectedValuePct,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null,
    lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore,
    risk: pick.level, reasoning: `Modelo Poisson: λ ${result.lambdaHome} y ${result.lambdaAway}.`,
    requiresReview: result.status !== "available" || pick.highlightColor === "orange", analysisStatus: result.status,
    sourceModule: "poisson", source: result.source, supportingData: pick.supportingData,
    contradictingData: [...(pick.contradictingData || []), ...(result.warnings || [])]
  };
}

function addPoissonPick(selectionKey) {
  const leg = poissonLeg(selectionKey);
  if (leg) appendPickToParlay(leg, "Pick Poisson agregado a Mi parlay. Se guardará únicamente al guardar el parlay.");
}

function savePoissonPick(selectionKey) {
  const leg = poissonLeg(selectionKey);
  if (leg) saveIndividualLeg({ ...leg, result: "pending" });
}

function renderTeamGoals(result) {
  const status = result.status === "available" ? "Disponible" : result.status === "partial" ? "Parcial" : "No disponible";
  elements.teamGoalsStatus.className = `status-badge status-badge--${statusClass(status)}`;
  elements.teamGoalsStatus.textContent = status;
  if (result.status === "not_available") {
    elements.teamGoalsContent.innerHTML = `<div class="research-empty">${escapeHtml(result.warning || "Datos ofensivos insuficientes.")}</div>`;
    return;
  }
  const progress = (label, value, suffix = "%") => { const numeric = Math.max(0, Math.min(100, Number(value) || 0)); return `<div class="goal-progress"><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}${suffix}</strong></div><div><i style="width:${numeric}%"></i></div></div>`; };
  const teamCard = (team) => `<article class="team-goal-card team-goal-card--intelligence"><div class="team-goal-card__heading"><div><small>${escapeHtml(team.side === "home" ? "Equipo 1 / local" : "Equipo 2 / visitante")}</small><h3>${escapeHtml(team.team)}</h3></div>${statusBadge(team.status === "available" ? "Disponible" : "Parcial")}</div><div class="goal-progress-list">${progress("Marca 0.5+", team.over05Pct)}${progress("No marca", team.noGoalPct)}${progress("Marca 1.5+", team.over15Pct)}${progress("Confianza", team.confidenceScore, "/100")}</div><div class="team-goal-evidence"><div><strong>Señales a favor</strong>${team.supportingData.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div><div><strong>Contradicciones</strong>${team.contradictingData.length ? team.contradictingData.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : "<span>Sin contradicción fuerte detectada.</span>"}</div></div></article>`;
  const picks = result.picks || [];
  const renderMarket = (pick) => `<article class="poisson-market poisson-market--${escapeHtml(pick.highlightColor)}"><div><strong>${escapeHtml(pick.selection)}</strong><small>Modelo ${escapeHtml(pick.modelProbabilityPct)}% · Cuota ${displayValue(pick.decimalOdds)} · EV ${pick.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(pick.expectedValuePct)}%`}</small><small>Confianza ${escapeHtml(pick.confidenceScore)}/100 · ${escapeHtml(pick.level)}</small></div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-team-goal="${escapeHtml(pick.selectionKey)}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-team-goal="${escapeHtml(pick.selectionKey)}">Agregar al parlay</button></div></article>`;
  const marketGroup = (title, className, filtered) => filtered.length ? `<section class="derived-market-group derived-market-group--${className}"><h4>${escapeHtml(title)} <span>${filtered.length}</span></h4>${filtered.map(renderMarket).join("")}</section>` : "";
  elements.teamGoalsContent.innerHTML = `<div class="team-goal-summary"><strong>BTTS: ${escapeHtml(result.btts.support)}</strong><span>Sí ${escapeHtml(result.btts.yesProbabilityPct)}% · No ${escapeHtml(result.btts.noProbabilityPct)}% · Confianza ${escapeHtml(result.confidenceScore)}/100</span></div>${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}<div class="team-goal-grid">${teamCard(result.teams.home)}${teamCard(result.teams.away)}</div><div class="derived-markets">${marketGroup("Recomendables", "recommended", picks.filter((pick) => pick.highlightColor === "green"))}${marketGroup("Conservadores", "conservative", picks.filter((pick) => pick.highlightColor === "blue"))}${marketGroup("Revisar / Evitar", "review", picks.filter((pick) => !["green", "blue"].includes(pick.highlightColor)))}</div>${!picks.length ? '<p class="muted-text">No hay mercado con respaldo mínimo.</p>' : ""}<p class="market-disclaimer">La probabilidad combina varias señales. Posesión aislada no implica peligro real ni alta confianza.</p>`;
  decoratePickSignals(elements.teamGoalsContent, ".poisson-market", result.picks);
}

async function loadTeamGoals() {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingTeamGoals) return;
  if (state.teamGoalsByFixture.has(fixture.id)) return toggleReadyModule(elements.showTeamGoals, elements.teamGoalsContent);
  state.isLoadingTeamGoals = true; elements.showTeamGoals.disabled = true; elements.showTeamGoals.textContent = "Calculando…";
  elements.teamGoalsStatus.className = "status-badge status-badge--processing"; elements.teamGoalsStatus.textContent = "Procesando";
  try { const result = await footballDataService.getTeamGoalProbability(fixture); state.teamGoalsByFixture.set(fixture.id, result); renderTeamGoals(result); showModuleReady(elements.showTeamGoals, elements.teamGoalsContent); }
  catch (error) { renderTeamGoals({ status: "not_available", warning: error.message, picks: [] }); elements.teamGoalsContent.hidden = false; }
  finally { state.isLoadingTeamGoals = false; elements.showTeamGoals.disabled = !selectedFixture(); if (!state.teamGoalsByFixture.has(fixture.id)) elements.showTeamGoals.textContent = "Mostrar"; }
}

function teamGoalLeg(selectionKey) {
  const fixture = selectedFixture(); const result = state.teamGoalsByFixture.get(fixture?.id);
  const pick = result?.picks?.find((item) => item.selectionKey === selectionKey); if (!fixture || !pick) return null;
  return { id: `${fixture.id}:${pick.marketKey}:${pick.selectionKey}:team-goals`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date, market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey, decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null, impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct, estimatedProbability: pick.modelProbabilityPct, expectedValue: pick.expectedValuePct, fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.level, reasoning: pick.supportingData.join("; "), requiresReview: result.status !== "available" || pick.highlightColor === "orange", analysisStatus: result.status, sourceModule: "team_goal_probability", source: result.source, supportingData: pick.supportingData, contradictingData: pick.contradictingData };
}

function addTeamGoalPick(selectionKey) { const leg = teamGoalLeg(selectionKey); if (leg) appendPickToParlay(leg, "Pick de gol por equipo agregado a Mi parlay."); }
function saveTeamGoalPick(selectionKey) { const leg = teamGoalLeg(selectionKey); if (leg) saveIndividualLeg({ ...leg, result: "pending" }); }

function renderCorners(result) {
  const status = result.status === "available" ? "Disponible" : result.status === "partial" ? "Parcial" : "No disponible";
  elements.cornersStatus.className = `status-badge status-badge--${statusClass(status)}`; elements.cornersStatus.textContent = status;
  if (result.status === "not_available") { elements.cornersContent.innerHTML = `<div class="research-empty">${escapeHtml(result.warning || "Corners no disponible.")}</div>`; return; }
  const team = (data, label) => `<article class="corner-team"><div><small>${escapeHtml(label)}</small><h3>${escapeHtml(data.tier)}</h3></div><div class="team-goal-kpis"><span>A favor<strong>${displayValue(data.cornersForAvg)}</strong></span><span>En contra<strong>${displayValue(data.cornersAgainstAvg)}</strong></span><span>Posesión<strong>${displayValue(data.possessionAvg)}%</strong></span><span>Tiros<strong>${displayValue(data.shotsAvg)}</strong></span><span>Bloqueados<strong>${displayValue(data.blockedShotsAvg)}</strong></span><span>Esperados<strong>${displayValue(data.expectedCorners)}</strong></span></div><small>${data.useful} oficiales usados · ${data.excludedFriendlies} amistosos excluidos</small><small>${escapeHtml(data.competitions.join(" · ") || "Competición no informada")}</small></article>`;
  elements.cornersContent.innerHTML = `<div class="corner-summary"><strong>${escapeHtml(result.preMatchSignal)}</strong><span>Total esperado ${escapeHtml(result.totalExpectedCorners)} · Disparidad ${escapeHtml(result.disparity)} · Confianza ${escapeHtml(result.confidenceScore)}/100</span></div>${result.live?.alert ? `<div class="live-corner-alert">${escapeHtml(result.live.alert)}</div>` : ""}${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}<div class="corner-grid">${team(result.teams.home, selectedFixture()?.home || "Local")}${team(result.teams.away, selectedFixture()?.away || "Visitante")}</div><div class="detail-note detail-note--info"><strong>Game State</strong><span>${escapeHtml(result.live?.competitiveNeed || "Necesidad competitiva no disponible")}</span></div>${result.picks?.length ? `<section class="poisson-markets"><h3>Mercados con cuota disponible</h3>${result.picks.map((pick) => `<article class="poisson-market poisson-market--${escapeHtml(pick.highlightColor)}"><div><strong>${escapeHtml(pick.selection)}</strong><small>Cuota ${displayValue(pick.decimalOdds)} · Modelo ${displayValue(pick.modelProbabilityPct)}% · EV ${displayValue(pick.expectedValuePct)}%</small></div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-corners="${escapeHtml(pick.selectionKey)}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-corners="${escapeHtml(pick.selectionKey)}">Agregar al parlay</button></div></article>`).join("")}</section>` : '<p class="market-disclaimer">No se muestra Agregar pick porque no hay una cuota de corners compatible.</p>'}`;
  decoratePickSignals(elements.cornersContent, ".poisson-market", result.picks);
}

async function loadCorners() {
  const fixture = selectedFixture(); if (!fixture || state.isLoadingCorners) return;
  if (state.cornersByFixture.has(fixture.id)) return toggleReadyModule(elements.showCorners, elements.cornersContent);
  state.isLoadingCorners = true; elements.showCorners.disabled = true; elements.showCorners.textContent = "Calculando…";
  try { const result = await footballDataService.getCornersModel(fixture); state.cornersByFixture.set(fixture.id, result); renderCorners(result); showModuleReady(elements.showCorners, elements.cornersContent); }
  catch (error) { renderCorners({ status: "not_available", warning: error.message, picks: [] }); elements.cornersContent.hidden = false; }
  finally { state.isLoadingCorners = false; elements.showCorners.disabled = !selectedFixture(); if (!state.cornersByFixture.has(fixture.id)) elements.showCorners.textContent = "Mostrar"; }
}

function cornerLeg(selectionKey) { const fixture = selectedFixture(); const result = state.cornersByFixture.get(fixture?.id); const pick = result?.picks?.find((item) => item.selectionKey === selectionKey); if (!fixture || !pick) return null; return { id: `${fixture.id}:corners:${selectionKey}`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date, market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey, decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null, impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct, expectedValue: pick.expectedValuePct, fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.level, reasoning: result.preMatchSignal, requiresReview: result.status !== "available", sourceModule: "corners", source: result.source, supportingData: pick.supportingData, contradictingData: pick.contradictingData }; }
function addCornerPick(key) { const leg = cornerLeg(key); if (leg) appendPickToParlay(leg, "Pick de corners agregado a Mi parlay."); }
function saveCornerPick(key) { const leg = cornerLeg(key); if (leg) saveIndividualLeg({ ...leg, result: "pending" }); }

const SPECIFIC_MARKET_TOOLTIPS = Object.freeze({
  corners: "corners", asian_handicap: "asian_handicap", btts: "btts",
  team_scores_over: "over_under", team_concedes_under: "over_under",
  double_chance_goals: "double_chance", conservative: "risk", medium_risk: "risk", high_value_risk: "ev"
});

function renderSpecificMarkets(result) {
  const status = result.status === "available" ? "Disponible" : result.status === "partial" ? "Parcial" : "No disponible";
  elements.specificMarketsStatus.className = `status-badge status-badge--${statusClass(status)}`;
  elements.specificMarketsStatus.textContent = status;
  if (!result.groups?.length) {
    elements.specificMarketsContent.innerHTML = `<div class="research-empty">${escapeHtml(result.warnings?.[0] || "Datos insuficientes para recomendar mercados específicos.")}</div>`;
    return;
  }
  const intentDefinitions = [
    { key: "offensive", label: "Mercados ofensivos", groups: ["player_goal", "btts", "team_scores_over"] },
    { key: "defensive", label: "Mercados defensivos", groups: ["team_concedes_under"] },
    { key: "result", label: "Mercados de resultado", groups: ["asian_handicap", "result_goals", "double_chance_goals"] },
    { key: "volume", label: "Mercados de volumen", groups: ["corners"] },
    { key: "risk", label: "Mercados por nivel de riesgo", groups: ["conservative", "medium_risk", "high_value_risk"] }
  ];
  const renderGroup = (group) => {
    const groupStatus = group.status === "available" ? "Disponible" : group.status === "partial" ? "Parcial" : "No disponible";
    const picks = (group.picks || []).map((pick, index) => `<article class="specific-pick specific-pick--${escapeHtml(pick.highlightColor)}">
      <div><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)} · Cuota ${displayValue(pick.decimalOdds)} · Modelo ${displayValue(pick.modelProbabilityPct)}% · EV ${displayValue(pick.expectedValuePct)}%</small><small>Confianza ${displayValue(pick.confidenceScore, 0)}/100 · Origen ${escapeHtml(pickOriginLabel(pick.sourceModule))}</small><small>${escapeHtml(pick.explanation || pick.decision)}</small></div>
      <div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-specific="${escapeHtml(group.key)}:${index}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-specific="${escapeHtml(group.key)}:${index}">Agregar al parlay</button></div>
    </article>`).join("");
    const missing = group.missingData?.length ? `<div class="specific-market__missing"><strong>Datos faltantes</strong><span>${group.missingData.map(escapeHtml).join(" · ")}</span></div>` : "";
    const observed = group.observedCandidates?.length ? `<small class="specific-market__observed">${group.observedCandidates.length} cuota(s) observada(s), pero sin respaldo suficiente para recomendar.</small>` : "";
    return `<article class="specific-market specific-market--${escapeHtml(group.status)}">
      <header><h3>${labelWithTooltip(group.label, SPECIFIC_MARKET_TOOLTIPS[group.key])}</h3>${statusBadge(groupStatus)}</header>
      ${picks || `<p>${escapeHtml(group.warning || "Datos insuficientes para recomendar este mercado.")}</p>`}
      ${missing}${group.alternativeData ? `<div class="specific-market__alternative"><strong>Dato alternativo</strong><span>${escapeHtml(group.alternativeData)}</span></div>` : ""}${observed}
      <footer><span>Confianza ${displayValue(group.confidenceScore, 0)}/100</span><span>Fuente: ${escapeHtml(result.source || "Datos normalizados")}</span></footer>
    </article>`;
  };
  const groupedHtml = intentDefinitions.map((intent) => {
    const groups = result.groups.filter((group) => intent.groups.includes(group.key));
    if (!groups.length) return "";
    return `<section class="market-intent market-intent--${intent.key}"><header><h3>${intent.label}</h3><span>${groups.length} categorías</span></header><div class="specific-markets-grid">${groups.map(renderGroup).join("")}</div></section>`;
  }).join("");
  elements.specificMarketsContent.innerHTML = `${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}<div class="market-intents">${groupedHtml}</div>`;
}

async function loadSpecificMarkets() {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingSpecificMarkets) return;
  if (state.specificMarketsByFixture.has(fixture.id)) {
    renderSpecificMarkets(state.specificMarketsByFixture.get(fixture.id));
    elements.specificMarketsContent.hidden = false;
    return;
  }
  state.isLoadingSpecificMarkets = true;
  elements.showSpecificMarkets.disabled = true;
  elements.showSpecificMarkets.textContent = "Evaluando…";
  try {
    const result = await footballDataService.getSpecificMarkets(fixture);
    state.specificMarketsByFixture.set(fixture.id, result);
    renderSpecificMarkets(result);
    elements.specificMarketsContent.hidden = false;
  } catch (error) {
    renderSpecificMarkets({ status: "not_available", groups: [], warnings: [error.message] });
    elements.specificMarketsContent.hidden = false;
  } finally {
    state.isLoadingSpecificMarkets = false;
    elements.showSpecificMarkets.disabled = !selectedFixture();
    elements.specificMarketsContent.hidden = false;
  }
}

function specificMarketLeg(reference) {
  const [groupKey, indexText] = String(reference || "").split(":");
  const fixture = selectedFixture();
  const result = state.specificMarketsByFixture.get(fixture?.id);
  const pick = result?.groups?.find((group) => group.key === groupKey)?.picks?.[Number(indexText)];
  if (!fixture || !pick) return null;
  return {
    id: `${fixture.id}:specific:${groupKey}:${pick.selectionKey}`, fixtureId: fixture.id,
    league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey,
    decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null,
    impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
    estimatedProbability: pick.modelProbabilityPct, expectedValue: pick.expectedValuePct,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null,
    lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore,
    risk: pick.decision, reasoning: pick.explanation, requiresReview: false,
    sourceModule: pick.sourceModule || "data_picks", source: result.source
  };
}

function addSpecificMarketPick(reference) { const leg = specificMarketLeg(reference); if (leg) appendPickToParlay(leg, "Pick de mercado específico agregado a Mi parlay."); }
function saveSpecificMarketPick(reference) { const leg = specificMarketLeg(reference); if (leg) saveIndividualLeg({ ...leg, result: "pending" }); }

const teamPerformanceVisible = () => readLocalJson(TEAM_PERFORMANCE_VISIBILITY_KEY, true) !== false;

function applyTeamPerformanceVisibility(visible) {
  elements.teamPerformanceContent.hidden = !visible;
  elements.toggleTeamPerformance.textContent = visible ? "Ocultar" : "Mostrar";
  elements.toggleTeamPerformance.setAttribute("aria-expanded", String(visible));
  writeLocalJson(TEAM_PERFORMANCE_VISIBILITY_KEY, visible);
}

function renderTeamPerformance(performance, fixture = selectedFixture()) {
  const k = Number(performance?.k || 0);
  elements.teamPerformanceTitle.textContent = k
    ? `Rendimiento promedio por equipo · últimos ${k} partidos`
    : "Rendimiento promedio por equipo";
  if (!performance || performance.status !== "available" || k === 0) {
    elements.teamPerformanceStatus.className = "status-badge status-badge--unavailable";
    elements.teamPerformanceStatus.textContent = "Sin historial";
    elements.teamPerformanceContent.innerHTML = `<div class="research-empty"><strong>Sin historial comparable</strong><p>${escapeHtml(performance?.message || "No hay suficientes partidos previos con estadísticas individuales completas para ambos equipos.")}</p></div>`;
    applyTeamPerformanceVisibility(teamPerformanceVisible());
    return;
  }
  elements.teamPerformanceStatus.className = "status-badge status-badge--available";
  elements.teamPerformanceStatus.textContent = `k = ${k}`;
  const metrics = [
    ["entradas", "Entradas", ""], ["tarjetas", "Tarjetas ponderadas", ""],
    ["tiros", "Tiros", ""], ["pases_acertados", "Pases acertados", "%"], ["faltas", "Faltas", ""]
  ];
  const sides = [performance.equipo_local, performance.equipo_visitante];
  const pickGroups = performance.picks || { home: [], away: [] };
  const maxima = Object.fromEntries(metrics.map(([key]) => [key, Math.max(...sides.map((side) => Number(side.metricas?.[key] || 0)), 0)]));
  const renderPerformancePicks = (side) => {
    const picks = pickGroups[side] || [];
    if (!picks.length) return '<div class="team-performance-picks__empty">Sin pick recomendado por rendimiento: datos contradictorios o insuficientes.</div>';
    return picks.map((pick, index) => `<article class="team-performance-pick team-performance-pick--${escapeHtml(pick.color)}">
      <header><div><small>${escapeHtml(pick.market)}</small><strong>${escapeHtml(pick.selection)}</strong></div><span>${escapeHtml(pick.confidence)}</span></header>
      <div class="team-performance-pick__meta"><span>Score <b>${displayValue(pick.confidenceScore)}/100</b></span><span>Cuota <b>${pick.odds ? displayValue(pick.odds) : "No disponible"}</b></span><span>Origen <b>${escapeHtml(pickOriginLabel(pick.origin))}</b></span></div>
      <p>${escapeHtml(pick.explanation)}</p>
      ${["localhost", "127.0.0.1"].includes(window.location.hostname) && pick.diagnostics?.mode === "moderate_composite_advantage" ? `<details class="performance-diagnostics"><summary>Diagnóstico</summary><span>Diferencia tiros: ${pick.diagnostics.shotsDiff >= 0 ? "+" : ""}${displayValue(pick.diagnostics.shotsDiff)}</span><span>Diferencia pases: ${pick.diagnostics.passesDiff >= 0 ? "+" : ""}${displayValue(pick.diagnostics.passesDiff)}</span><span>Disciplina: ${escapeHtml(pick.diagnostics.discipline)}</span><span>Entradas: ${escapeHtml(pick.diagnostics.tackles)}</span><span>Muestra: ${escapeHtml(pick.diagnostics.sampleComparison)}</span><strong>${escapeHtml(pick.diagnostics.result)}</strong></details>` : ""}
      ${pick.odds ? "" : '<small class="team-performance-pick__odds-note">Pick pendiente de cuota; puede guardarse sin afectar el cálculo del parlay.</small>'}
      <div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-team-performance-pick="${side}:${index}" ${pick.canAdd ? "" : "disabled"}>Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-team-performance-pick="${side}:${index}" ${pick.canAdd ? "" : "disabled"} ${pick.canAdd ? "" : 'title="No se puede agregar: riesgo alto"'}>Agregar pick</button></div>
    </article>`).join("");
  };
  const teamColumn = (team, sideLabel, side) => `<div class="team-performance__column"><section class="team-performance__team">
    <div class="team-performance__team-heading"><span>${escapeHtml(sideLabel)}</span><strong>${escapeHtml(team.nombre)}</strong><small>${escapeHtml(team.jugadores || 0)} jugadores distintos</small></div>
    ${metrics.map(([key, label, suffix]) => {
      const value = Number(team.metricas?.[key] || 0);
      const width = maxima[key] > 0 ? Math.max(2, (value / maxima[key]) * 100) : 0;
      return `<div class="performance-metric"><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value.toFixed(2))}${suffix}</strong></div><div class="performance-bar" aria-label="${escapeHtml(label)}: ${escapeHtml(value.toFixed(2))}${suffix}"><i style="width:${width.toFixed(2)}%"></i></div></div>`;
    }).join("")}</section>
    <section class="team-performance-picks"><div class="team-performance-picks__heading"><strong>Picks sugeridos por rendimiento</strong><span><i class="pick-dot pick-dot--green"></i>Fuerte <i class="pick-dot pick-dot--orange"></i>Medio <i class="pick-dot pick-dot--red"></i>Riesgo</span></div>${renderPerformancePicks(side)}</section>
  </div>`;
  elements.teamPerformanceContent.innerHTML = `<div class="team-performance__note">Muestra común: ${k} partidos previos completos por equipo. Cada jugador tiene el mismo peso y las ausencias dentro de la ventana cuentan como cero. Los picks priorizan tiros y pases; disciplina y muestra actúan como filtros.</div><div class="team-performance__grid">${teamColumn(sides[0], "Equipo local", "home")}${teamColumn(sides[1], "Equipo visitante", "away")}</div>`;
  applyTeamPerformanceVisibility(teamPerformanceVisible());
}

function renderPlayerGoalCandidatesLegacy(result) {
  const candidates = result?.candidates || [];
  const statusLabels = {
    available: ["Disponible", "available"], insufficient_data: ["Datos insuficientes", "partial"],
    no_player_coverage: ["Sin cobertura", "unavailable"], not_available: ["No disponible", "unavailable"], error: ["Error", "unavailable"]
  };
  const [label, status] = statusLabels[result?.status] || statusLabels.not_available;
  elements.playerGoalStatus.className = `status-badge status-badge--${status}`;
  elements.playerGoalStatus.textContent = label;
  if (!candidates.length) {
    elements.playerGoalContent.innerHTML = `<div class="research-empty"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(result?.message || "Datos insuficientes para sugerir jugador con posible gol.")}</p></div>`;
    return;
  }
  elements.playerGoalContent.innerHTML = `<div class="player-goal-note">Modelo interno con datos reales de API-Football. Prioriza minutos, titularidad, tiros y tiros a puerta; un gol reciente por sí solo no genera recomendación.</div><div class="player-goal-grid">${candidates.map((candidate, index) => `<article class="player-goal-card player-goal-card--${escapeHtml(candidate.color)}">
    <header><span class="player-goal-rank">${index + 1}</span><div><strong>${escapeHtml(candidate.playerName)}</strong><small>${escapeHtml(candidate.teamName)}</small></div><b>${escapeHtml(candidate.confidence)}</b></header>
    <div class="player-goal-score"><span>GoalThreatScore</span><strong>${displayValue(candidate.goalThreatScore, 0)}/100</strong><div><i style="width:${Math.min(100, Number(candidate.goalThreatScore || 0))}%"></i></div></div>
    <dl><div><dt>Mercado</dt><dd>${escapeHtml(candidate.market)}</dd></div><div><dt>Cuota</dt><dd>${candidate.odds ? `${displayValue(candidate.odds)} · ${escapeHtml(candidate.bookmaker || "API-Football")}` : "No disponible"}</dd></div><div><dt>Muestra</dt><dd>${displayValue(candidate.stats?.appearancesLast5, 0)} partidos · ${displayValue(candidate.stats?.minutesLast5, 0)} min</dd></div><div><dt>Amenaza</dt><dd>${displayValue(candidate.stats?.shotsPer90)} tiros/90 · ${displayValue(candidate.stats?.shotsOnTargetPer90)} a puerta/90</dd></div></dl>
    <p>${escapeHtml(candidate.explanation)}</p>${candidate.odds ? "" : '<small class="player-goal-pending">Cuota no disponible · pick pendiente de cuota.</small>'}
    <div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-player-goal="${index}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-player-goal="${index}">Agregar pick</button></div>
  </article>`).join("")}</div>`;
}

function renderPlayerGoalCandidates(result) {
  const candidates = result?.candidates || [];
  const statusLabels = {
    available: ["Disponible", "available"], insufficient_data: ["Datos insuficientes", "partial"],
    no_player_coverage: ["Sin cobertura", "unavailable"], not_available: ["No disponible", "unavailable"], error: ["Error", "unavailable"]
  };
  const [label, status] = statusLabels[result?.status] || statusLabels.not_available;
  elements.playerGoalStatus.className = `status-badge status-badge--${status}`;
  elements.playerGoalStatus.textContent = label;
  if (!candidates.length) {
    const coverage = result?.coverage ? ` Jugadores evaluados: ${displayValue(result.playersEvaluated, 0)}. Fixtures con jugadores: local ${displayValue(result.coverage.homePlayerFixtures, 0)}, visitante ${displayValue(result.coverage.awayPlayerFixtures, 0)}.` : "";
    elements.playerGoalContent.innerHTML = `<div class="research-empty"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(result?.message || "Datos insuficientes para sugerir jugador con posible gol.")}${escapeHtml(coverage)}</p></div>`;
    return;
  }
  const warningText = (candidate) => (candidate.warnings?.length ? candidate.warnings.join(" ") : "Sin advertencias criticas.");
  const candidateRows = candidates.map((candidate) => `<tr>
    <td>${escapeHtml(candidate.playerName)}</td><td>${escapeHtml(candidate.teamName)}</td>
    <td>${displayValue(candidate.stats?.appearancesLast5, 0)}/${displayValue(candidate.stats?.matchesEvaluated, 0)}</td>
    <td>${displayValue(candidate.stats?.minutesLast5, 0)}</td><td>${displayValue(candidate.stats?.goalsLast5, 0)}</td>
    <td>${displayValue(candidate.stats?.shotsLast5, 0)}</td><td>${displayValue(candidate.stats?.shotsOnTargetLast5, 0)}</td>
    <td>${candidate.stats?.xgLast5 ? displayValue(candidate.stats.xgLast5) : "No disp."}</td>
    <td>${displayValue(candidate.conservativeGoalProbability, 1)}%</td><td>${escapeHtml(candidate.confidence)}</td>
    <td>${escapeHtml(warningText(candidate))}</td>
  </tr>`).join("");
  elements.playerGoalContent.innerHTML = `<div class="player-goal-note">Modelo interno con datos reales de API-Football. Prioriza minutos, titularidad, tiros y tiros a puerta; un gol reciente por si solo no genera recomendacion. Motivo de actualizacion: ${escapeHtml(result?.updateReason || "cache_or_api_snapshot")}.</div><div class="player-goal-grid">${candidates.map((candidate, index) => `<article class="player-goal-card player-goal-card--${escapeHtml(candidate.color)}">
    <header><span class="player-goal-rank">${index + 1}</span><div><strong>${escapeHtml(candidate.playerName)}</strong><small>${escapeHtml(candidate.teamName)}</small></div><b>${escapeHtml(candidate.confidence)}</b></header>
    <div class="player-goal-score"><span>GoalThreatScore</span><strong>${displayValue(candidate.goalThreatScore, 0)}/100</strong><div><i style="width:${Math.min(100, Number(candidate.goalThreatScore || 0))}%"></i></div></div>
    <dl><div><dt>Mercado</dt><dd>${escapeHtml(candidate.market)}</dd></div><div><dt>Cuota</dt><dd>${candidate.odds ? `${displayValue(candidate.odds)} - ${escapeHtml(candidate.bookmaker || "API-Football")}` : "No disponible"}</dd></div><div><dt>Muestra</dt><dd>${displayValue(candidate.stats?.appearancesLast5, 0)}/${displayValue(candidate.stats?.matchesEvaluated, 0)} partidos - ${displayValue(candidate.stats?.minutesLast5, 0)} min</dd></div><div><dt>Amenaza</dt><dd>${displayValue(candidate.stats?.shotsPer90)} tiros/90 - ${displayValue(candidate.stats?.shotsOnTargetPer90)} a puerta/90</dd></div><div><dt>Prob. estimada</dt><dd>${displayValue(candidate.conservativeGoalProbability, 1)}%</dd></div><div><dt>Calidad muestra</dt><dd>${escapeHtml(candidate.sampleQuality || "No disponible")}</dd></div></dl>
    <p>${escapeHtml(candidate.explanation)}</p><small class="player-goal-warnings">${escapeHtml(warningText(candidate))}</small>${candidate.odds ? "" : '<small class="player-goal-pending">Cuota no disponible - pick pendiente de cuota.</small>'}
    <div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-player-goal="${index}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-player-goal="${index}">Agregar pick</button></div>
  </article>`).join("")}</div><div class="table-scroll player-goal-table-wrap"><table class="compact-table player-goal-table"><thead><tr><th>Jugador</th><th>Equipo</th><th>Partidos</th><th>Min.</th><th>Goles</th><th>Tiros</th><th>Arco</th><th>xG</th><th>Prob.</th><th>Conf.</th><th>Advertencias</th></tr></thead><tbody>${candidateRows}</tbody></table></div>`;
}

function playerGoalPickLeg(index) {
  const fixture = selectedFixture();
  const result = state.playerGoalByFixture.get(fixture?.id);
  const candidate = result?.candidates?.[Number(index)];
  if (!fixture || !candidate) return null;
  return {
    id: `${fixture.id}:player-goal:${candidate.playerId}`, fixtureId: fixture.id, matchId: fixture.id,
    league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    teamId: candidate.teamId, teamName: candidate.teamName, playerId: candidate.playerId, playerName: candidate.playerName,
    market: candidate.market, selection: candidate.selection, marketCode: candidate.marketKey, selectionCode: candidate.selectionKey,
    decimalOdds: candidate.odds, originalOdds: candidate.odds, updatedOdds: null,
    impliedProbability: candidate.odds ? Number((100 / candidate.odds).toFixed(1)) : null,
    modelProbability: null, expectedValue: null, fixtureStatus: fixture.statusLabel || fixture.status,
    kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt,
    confidence: candidate.confidence, confidenceScore: candidate.goalThreatScore,
    risk: candidate.color === "green" ? "Fuerte" : "Medio", reasoning: candidate.explanation,
    requiresReview: candidate.requiresReview, sourceModule: "player_goal_candidate", source: result.source,
    sourceLabel: candidate.sourceLabel, bookmaker: candidate.bookmaker || "",
    supportingData: [`${candidate.stats?.minutesLast5 || 0} minutos`, `${candidate.stats?.shotsLast5 || 0} tiros`, `${candidate.stats?.shotsOnTargetLast5 || 0} tiros a puerta`], contradictingData: []
  };
}

function addPlayerGoalPick(index) { const leg = playerGoalPickLeg(index); if (leg) appendPickToParlay(leg, "Pick de jugador agregado a Mi parlay."); }
function savePlayerGoalPick(index) { const leg = playerGoalPickLeg(index); if (leg) saveIndividualLeg({ ...leg, result: "pending" }); }

async function loadPlayerGoalCandidates(fixture) {
  if (!fixture || state.playerGoalLoadingFixtures.has(fixture.id)) return;
  const saved = state.playerGoalByFixture.get(fixture.id);
  if (saved) return renderPlayerGoalCandidates(saved);
  state.playerGoalLoadingFixtures.add(fixture.id);
  elements.togglePlayerGoal.disabled = true;
  elements.playerGoalStatus.className = "status-badge status-badge--processing";
  elements.playerGoalStatus.textContent = "Analizando";
  elements.playerGoalContent.innerHTML = '<div class="research-empty"><div class="loading-spinner" aria-hidden="true"></div><p>Analizando jugadores con mayor amenaza de gol…</p></div>';
  try {
    const result = await footballDataService.getPlayerGoalCandidates(fixture);
    state.playerGoalByFixture.set(fixture.id, result);
    if (String(state.selectedFixtureId) === String(fixture.id)) renderPlayerGoalCandidates(result);
  } catch (error) {
    if (String(state.selectedFixtureId) === String(fixture.id)) renderPlayerGoalCandidates({ status: "error", candidates: [], message: error.message });
  } finally {
    state.playerGoalLoadingFixtures.delete(fixture.id);
    if (String(state.selectedFixtureId) === String(fixture.id)) elements.togglePlayerGoal.disabled = false;
  }
}

function teamPerformancePickLeg(reference) {
  const [side, indexText] = String(reference || "").split(":");
  const fixture = selectedFixture();
  const performance = state.teamPerformanceByFixture.get(fixture?.id);
  const pick = performance?.picks?.[side]?.[Number(indexText)];
  if (!fixture || !pick || !pick.canAdd) return null;
  return {
    id: `${fixture.id}:team-performance:${pick.selectionKey}`,
    fixtureId: fixture.id, matchId: fixture.id, league: fixture.leagueName,
    home: fixture.home, away: fixture.away, date: fixture.date,
    market: pick.market, selection: pick.selection,
    marketCode: pick.marketKey, selectionCode: pick.selectionKey,
    decimalOdds: pick.odds, originalOdds: pick.odds, updatedOdds: null,
    impliedProbability: pick.odds ? Number((100 / pick.odds).toFixed(1)) : null,
    modelProbability: null, estimatedProbability: null, expectedValue: null,
    fixtureStatus: fixture.statusLabel || fixture.status,
    kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: performance.updatedAt || pick.createdAt,
    confidence: pick.confidence, confidenceScore: pick.confidenceScore,
    risk: pick.color === "green" ? "Fuerte" : "Medio",
    reasoning: pick.explanation, requiresReview: pick.requiresReview,
    analysisStatus: performance.status, sourceModule: "team_average_performance",
    source: performance.source || "api-football", sourceLabel: pick.sourceLabel,
    bookmaker: pick.bookmaker || "", supportingData: pick.supportingData || [],
    contradictingData: pick.contradictingData || []
  };
}

function addTeamPerformancePick(reference) {
  const leg = teamPerformancePickLeg(reference);
  if (leg) appendPickToParlay(leg, "Pick de rendimiento agregado a Mi parlay.");
}

function saveTeamPerformancePick(reference) {
  const leg = teamPerformancePickLeg(reference);
  if (leg) saveIndividualLeg({ ...leg, result: "pending" });
}

async function loadTeamPerformance(fixture) {
  if (!fixture || state.teamPerformanceLoadingFixtures.has(fixture.id)) return;
  const saved = state.teamPerformanceByFixture.get(fixture.id);
  if (saved) return renderTeamPerformance(saved, fixture);
  state.teamPerformanceLoadingFixtures.add(fixture.id);
  elements.teamPerformanceTitle.textContent = "Rendimiento promedio por equipo";
  elements.teamPerformanceStatus.className = "status-badge status-badge--processing";
  elements.teamPerformanceStatus.textContent = "Calculando";
  elements.teamPerformanceContent.innerHTML = '<div class="research-empty"><div class="loading-spinner" aria-hidden="true"></div><p>Comparando la misma ventana histórica para ambos equipos…</p></div>';
  applyTeamPerformanceVisibility(teamPerformanceVisible());
  try {
    const result = await footballDataService.getTeamPerformance(fixture);
    state.teamPerformanceByFixture.set(fixture.id, result);
    if (String(state.selectedFixtureId) === String(fixture.id)) renderTeamPerformance(result, fixture);
  } catch (error) {
    if (String(state.selectedFixtureId) === String(fixture.id)) renderTeamPerformance({ status: "not_available", k: 0, message: error.message }, fixture);
  } finally {
    state.teamPerformanceLoadingFixtures.delete(fixture.id);
  }
}

async function selectFixture(fixtureId, analysisMode = null) {
  if (state.isAnalyzing) return;
  if (state.selectedFixtureId !== fixtureId) resetAnalysisGuide();
  state.selectedFixtureId = fixtureId;
  renderMatches();
  const fixtureIndex = state.fixtures.findIndex((fixture) => fixture.id === fixtureId);

  try {
    const detailedFixture = await footballDataService.getFixtureData(selectedFixture());
    if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = detailedFixture;
    renderMatches();
    renderFixtureData();
    void loadSpecificMarkets();
    void loadTeamPerformance(detailedFixture).then(() => loadPlayerGoalCandidates(detailedFixture));
  } catch (error) {
    elements.filterError.hidden = false;
    elements.filterError.textContent = error.message;
    return;
  }

  if (!analysisMode) {
    const saved = state.analysisByFixture.get(fixtureId);
    saved ? renderAnalysis(saved) : showAnalysisEmpty();
    return;
  }

  if (responsibleLimitReached()) {
    showNotice("Alcanzaste el límite responsable diario configurado en Mi cuenta.");
    return;
  }

  state.isAnalyzing = true;
  elements.analysisContent.hidden = false;
  elements.toggleAnalysis.textContent = "Ocultar";
  elements.toggleAnalysis.setAttribute("aria-expanded", "true");
  elements.analysisStatus.className = "status-badge status-badge--processing";
  elements.analysisStatus.textContent = "Procesando";
  elements.analysisContent.innerHTML = '<div class="empty-state"><div class="loading-spinner" aria-hidden="true"></div><h3>Evaluando cobertura</h3><p>Generando una respuesta JSON simulada sin completar datos ausentes…</p></div>';

  try {
    const analysis = analysisMode === "data"
      ? await footballDataService.generateDataAnalysis(selectedFixture())
      : await footballDataService.generateAnalysis(selectedFixture());
    recordAnalysisUsage();
    state.analysisByFixture.set(fixtureId, analysis);
    renderAnalysis(analysis);
  } catch (error) {
    elements.analysisStatus.className = "status-badge status-badge--review";
    elements.analysisStatus.textContent = "Necesita revisión";
    elements.analysisContent.innerHTML = `<div class="empty-state"><h3>No se pudo generar el análisis</h3><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    state.isAnalyzing = false;
    updateAnalysisActionState();
  }
}

async function analyzeSelectedFixture() {
  const fixture = selectedFixture();
  if (!fixture || state.isAnalyzing) return;
  await selectFixture(fixture.id, "data");
}

async function explainSelectedFixture() {
  const fixture = selectedFixture();
  if (!fixture || fixture.status === "finished" || state.isAnalyzing) return;
  await selectFixture(fixture.id, "ai");
}

async function refreshFixtureStatuses() {
  const apiFixtures = state.fixtures.filter((fixture) => fixture.dataSource === "api-football");
  if (!apiFixtures.length || state.isRefreshingStatuses) return;
  state.isRefreshingStatuses = true;
  elements.refreshFixtureStatuses.disabled = true;
  elements.refreshFixtureStatuses.textContent = "Actualizando…";
  try {
    const updates = await Promise.all(apiFixtures.map(async (fixture) => {
      try { return { id: String(fixture.id), result: await footballDataService.getFixtureResult(fixture.id) }; }
      catch { return { id: String(fixture.id), result: null }; }
    }));
    const byId = new Map(updates.filter((item) => item.result).map((item) => [item.id, item.result]));
    state.fixtures = state.fixtures.map((fixture) => {
      const result = byId.get(String(fixture.id));
      if (!result) return fixture;
      const nextStatus = result.appStatus || fixture.status;
      const nextScore = result.goals || fixture.score;
      if (state.preferences.alertLive && fixture.status !== nextStatus) {
        addAlert("status", "Estado del partido actualizado", `${fixture.statusLabel} → ${result.statusLabel || nextStatus}.`, fixture);
      }
      if (state.preferences.alertScore && nextScore
        && (fixture.score?.home !== nextScore.home || fixture.score?.away !== nextScore.away)) {
        addAlert("score", "Cambio de marcador", `${nextScore.home ?? 0} - ${nextScore.away ?? 0} · ${result.elapsed ?? 0}'`, fixture);
      }
      return {
        ...fixture,
        status: nextStatus,
        statusLabel: result.statusLabel || fixture.statusLabel,
        statusShort: result.status || fixture.statusShort,
        elapsed: result.elapsed ?? fixture.elapsed,
        score: nextScore,
        penaltyScore: result.penaltyScore?.home !== null && result.penaltyScore?.home !== undefined
          && result.penaltyScore?.away !== null && result.penaltyScore?.away !== undefined
          ? result.penaltyScore : fixture.penaltyScore
      };
    });
    renderMatches();
    if (selectedFixture()) renderFixtureData();
    showNotice(`Estados actualizados: ${byId.size} de ${apiFixtures.length} partido(s).`);
  } finally {
    state.isRefreshingStatuses = false;
    elements.refreshFixtureStatuses.textContent = "Actualizar estados";
    renderMatches();
  }
}

async function refreshResearchData() {
  const fixture = selectedFixture();
  if (!fixture || state.isRefreshingResearch) return;
  state.isRefreshingResearch = true;
  elements.refreshResearch.disabled = true;
  elements.refreshCoverage.disabled = true;
  elements.refreshCoverage.textContent = "Actualizando…";
  elements.refreshResearch.textContent = "Actualizando…";
  try {
    const detailedFixture = await footballDataService.getFixtureData(fixture, true);
    const previousSignature = JSON.stringify((fixture.researchData?.sourceCoverage || []).map((item) => [item.moduleKey, item.status]));
    const nextSignature = JSON.stringify((detailedFixture.researchData?.sourceCoverage || []).map((item) => [item.moduleKey, item.status]));
    const fixtureIndex = state.fixtures.findIndex((item) => item.id === fixture.id);
    if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = detailedFixture;
    if (state.preferences.alertData && previousSignature !== nextSignature) {
      addAlert("data", "Cobertura actualizada", "Cambió la disponibilidad de uno o más módulos del partido.", detailedFixture);
    }
    renderFixtureData();
    showNotice("Cobertura y fuentes actualizadas desde API-Football.");
  } catch (error) {
    try {
      const researchData = await footballDataService.getResearchData(fixture.id, true);
      const fixtureIndex = state.fixtures.findIndex((item) => item.id === fixture.id);
      if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = { ...state.fixtures[fixtureIndex], researchData };
      renderFixtureData();
      showNotice("Fuentes actualizadas; algunos datos del partido no se pudieron refrescar.");
    } catch {
      showNotice(error.message || "No fue posible actualizar la investigación.");
    }
  } finally {
    state.isRefreshingResearch = false;
    elements.refreshResearch.disabled = !selectedFixture();
    elements.refreshCoverage.disabled = !selectedFixture();
    elements.refreshResearch.textContent = "Actualizar datos";
    elements.refreshCoverage.textContent = "Actualizar";
  }
}

async function refreshLiveDataNow() {
  if (!selectedFixture() || state.isRefreshingLive) return;
  state.isRefreshingLive = true;
  elements.refreshLiveNow.disabled = true;
  elements.refreshLiveNow.textContent = "Actualizando...";
  try {
    await refreshResearchData();
    state.lastLiveRefreshAt = new Date().toISOString();
    renderLiveData(selectedFixture()?.researchData, selectedFixture());
    showNotice("Datos En vivo actualizados manualmente.");
  } catch (error) {
    showNotice(error.message || "No fue posible actualizar En vivo.");
  } finally {
    state.isRefreshingLive = false;
    elements.refreshLiveNow.disabled = !selectedFixture();
    elements.refreshLiveNow.textContent = "Actualizar ahora";
    renderLiveData(selectedFixture()?.researchData, selectedFixture());
  }
}

function validateFilters() {
  if (!competitionLeagues().length) return "Selecciona al menos una liga.";
  if (!elements.dateFrom.value || !elements.dateTo.value) return "Selecciona las fechas desde y hasta.";
  if (elements.dateFrom.value && elements.dateTo.value && elements.dateFrom.value > elements.dateTo.value) return "La fecha inicial no puede ser posterior a la fecha final.";
  return "";
}

async function searchFixtures(event) {
  event.preventDefault();
  const error = validateFilters();
  elements.filterError.hidden = !error;
  elements.filterError.textContent = error;
  if (error || state.isSearching) return;

  resetAnalysisGuide();
  clearSelectedFixtureData();
  state.hasSearched = true;
  state.isSearching = true;
  const submitButton = elements.form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  elements.searchFeedback.textContent = "Buscando partidos…";

  try {
    state.fixtures = await footballDataService.searchFixtures({
      leagues: competitionLeagues(),
      season: elements.season.value,
      dateFrom: elements.dateFrom.value,
      dateTo: elements.dateTo.value,
      status: elements.status.value
    });
    const source = state.fixtures.some((fixture) => fixture.dataSource === "api-football") ? "API-Football" : "simulación";
    elements.searchFeedback.textContent = `Búsqueda ${source} completada · ${new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    renderMatches();
  } catch (error) {
    elements.filterError.hidden = false;
    elements.filterError.textContent = error.message;
    state.fixtures = [];
    renderMatches();
  } finally {
    state.isSearching = false;
    submitButton.disabled = false;
  }
}

function handleFilterChange(event) {
  const input = event.target;
  if (input === elements.competition) syncCompetitionCheckboxes();
  if (input.matches('input[name="league"]')) {
    elements.competition.value = "custom";
    const leagueInputs = [...elements.form.querySelectorAll('input[name="league"]')];
    if (input.value === "world-cup" && input.checked) {
      leagueInputs.forEach((item) => { if (item !== input) item.checked = false; });
      elements.season.value = "2026";
      elements.status.value = "all";
    } else if (input.value !== "world-cup" && input.checked) {
      const worldCupInput = elements.form.querySelector('input[name="league"][value="world-cup"]');
      if (worldCupInput) worldCupInput.checked = false;
    }
  }
  updateLeagueCount();
}

elements.form.addEventListener("change", handleFilterChange);
elements.form.addEventListener("submit", searchFixtures);
document.querySelectorAll("#analysis-guide-content details.guide-module").forEach((details) => {
  details.addEventListener("toggle", () => handleGuideModuleToggle(details));
});
elements.clearFilters.addEventListener("click", clearFilters);
elements.form.querySelector(".quick-filters").addEventListener("click", (event) => {
  const dateButton = event.target.closest("[data-quick-date]");
  const statusButton = event.target.closest("[data-quick-status]");
  if (dateButton) {
    const today = pacificToday();
    const mode = dateButton.dataset.quickDate;
    elements.dateFrom.value = mode === "tomorrow" ? shiftIsoDate(today, 1) : today;
    elements.dateTo.value = mode === "week" ? shiftIsoDate(today, 6) : elements.dateFrom.value;
  }
  if (statusButton) elements.status.value = statusButton.dataset.quickStatus;
});
elements.setToday.addEventListener("click", () => {
  const today = pacificToday();
  elements.dateFrom.value = today;
  elements.dateTo.value = today;
});
elements.dataGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-category]");
  if (card) openDataDetail(card.dataset.category);
});
elements.openOddsDetail.addEventListener("click", () => openDataDetail("odds"));
elements.researchGrid.addEventListener("click", (event) => {
  const supportingButton = event.target.closest("[data-supporting-module]");
  if (supportingButton) {
    openSupportingDetail(supportingButton.dataset.supportingModule);
    return;
  }
  const button = event.target.closest("[data-research-module]");
  if (button) openResearchDetail(button.dataset.researchModule);
});
elements.refreshResearch.addEventListener("click", refreshResearchData);
elements.refreshCoverage.addEventListener("click", refreshResearchData);
elements.refreshFixtureStatuses.addEventListener("click", refreshFixtureStatuses);
elements.refreshLiveNow.addEventListener("click", refreshLiveDataNow);
elements.simulationUseSelected.addEventListener("click", useSelectedFixtureForSimulation);
elements.simulationCompare.addEventListener("click", runSimulationComparison);
elements.simulationAdvanced.addEventListener("click", runAdvancedSimulation);
[elements.simulationTeamAId, elements.simulationTeamBId].forEach((input) => input.addEventListener("input", () => { elements.simulationCompare.dataset.fixtureId = ""; }));
elements.generateSelectedAnalysis.addEventListener("click", analyzeSelectedFixture);
elements.toggleAnalysis.addEventListener("click", () => toggleReadyModule(elements.toggleAnalysis, elements.analysisContent));
elements.downloadEvidenceTxt.addEventListener("click", downloadCurrentEvidence);
elements.showDataPicks.addEventListener("click", loadDataPicks);
elements.dataPicksContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-data-pick]");
  const saveButton = event.target.closest("[data-save-data-pick]");
  if (addButton) addDataPickToParlay(addButton.dataset.addDataPick);
  if (saveButton) saveDataPick(saveButton.dataset.saveDataPick);
});
elements.showOutcome.addEventListener("click", loadOutcomeScenarios);
elements.showPoisson.addEventListener("click", loadPoisson);
elements.poissonContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-poisson]");
  const saveButton = event.target.closest("[data-save-poisson]");
  if (addButton) addPoissonPick(addButton.dataset.addPoisson);
  if (saveButton) savePoissonPick(saveButton.dataset.savePoisson);
});
elements.showTeamGoals.addEventListener("click", loadTeamGoals);
elements.teamGoalsContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-team-goal]"); const saveButton = event.target.closest("[data-save-team-goal]");
  if (addButton) addTeamGoalPick(addButton.dataset.addTeamGoal);
  if (saveButton) saveTeamGoalPick(saveButton.dataset.saveTeamGoal);
});
elements.showCorners.addEventListener("click", loadCorners);
elements.cornersContent.addEventListener("click", (event) => { const add = event.target.closest("[data-add-corners]"); const save = event.target.closest("[data-save-corners]"); if (add) addCornerPick(add.dataset.addCorners); if (save) saveCornerPick(save.dataset.saveCorners); });
elements.showSpecificMarkets.addEventListener("click", loadSpecificMarkets);
elements.specificMarketsContent.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-specific]");
  const save = event.target.closest("[data-save-specific]");
  if (add) addSpecificMarketPick(add.dataset.addSpecific);
  if (save) saveSpecificMarketPick(save.dataset.saveSpecific);
});
elements.dataDialogClose.addEventListener("click", closeDataDialog);
elements.dataDialogContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-odds-pick]");
  const saveButton = event.target.closest("[data-save-odds-pick]");
  if (addButton) addOddsPickToParlay(addButton.dataset.addOddsPick);
  if (saveButton) saveOddsPick(saveButton.dataset.saveOddsPick);
});
elements.dataDialog.addEventListener("click", (event) => {
  if (event.target === elements.dataDialog) closeDataDialog();
});
elements.dataDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDataDialog();
});
window.addEventListener("popstate", () => {
  if (elements.dataDialog.open) elements.dataDialog.close();
});
elements.analysisContent.addEventListener("click", (event) => {
  const analysis = state.analysisByFixture.get(state.selectedFixtureId);
  const addButton = event.target.closest("[data-add-market]");
  const saveButton = event.target.closest("[data-save-market]");
  if (addButton) addMarketToParlay(analysis, Number(addButton.dataset.addMarket));
  if (saveButton) saveAnalysisMarket(analysis, Number(saveButton.dataset.saveMarket));
});
elements.parlayDraftList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-draft]");
  if (!button) return;
  state.parlayDraft = state.parlayDraft.filter((leg) => leg.id !== button.dataset.removeDraft);
  persistParlayDraft();
  renderParlayDraft();
});
document.querySelector("#parlay-slip-close").addEventListener("click", () => {
  elements.parlaySlip.hidden = true;
  elements.parlayFab.hidden = state.parlayDraft.length === 0;
});
elements.parlayMinimize.addEventListener("click", () => {
  setParlayMinimized(!elements.parlaySlip.classList.contains("parlay-slip--minimized"));
});
elements.parlayFab.addEventListener("click", () => renderParlayDraft(true));
elements.saveParlay.addEventListener("click", saveCurrentParlay);
elements.updateParlayResults.addEventListener("click", updateSavedParlayResults);
elements.savedParlaysList.addEventListener("change", (event) => {
  const select = event.target.closest("[data-leg-result]");
  const card = event.target.closest("[data-parlay-id]");
  const legRow = event.target.closest("[data-leg-id]");
  if (!select || !card || !legRow) return;
  const parlay = state.savedParlays.find((item) => item.id === card.dataset.parlayId);
  const leg = parlay?.legs.find((item) => item.id === legRow.dataset.legId);
  if (!leg) return;
  leg.result = select.value;
  parlay.result = calculateParlayResult(parlay.legs);
  persistSavedParlays();
  renderSavedParlays();
});
elements.savedParlaysList.addEventListener("input", (event) => {
  const notes = event.target.closest("[data-parlay-notes]");
  const card = event.target.closest("[data-parlay-id]");
  if (!notes || !card) return;
  const parlay = state.savedParlays.find((item) => item.id === card.dataset.parlayId);
  if (parlay) {
    parlay.notes = notes.value;
    persistSavedParlays();
  }
});
elements.savedParlaysList.addEventListener("click", (event) => {
  const toggleButton = event.target.closest("[data-toggle-parlay]");
  const deleteButton = event.target.closest("[data-delete-parlay]");
  const card = event.target.closest("[data-parlay-id]");
  if (toggleButton && card) {
    if (state.expandedParlays.has(card.dataset.parlayId)) state.expandedParlays.delete(card.dataset.parlayId);
    else state.expandedParlays.add(card.dataset.parlayId);
    renderSavedParlays();
    return;
  }
  if (!deleteButton || !card) return;
  state.savedParlays = state.savedParlays.map((item) => item.id === card.dataset.parlayId ? moveParlayToTrash(item) : item);
  state.expandedParlays.delete(card.dataset.parlayId);
  persistSavedParlays();
  renderSavedParlays();
  showNotice("Parlay enviado a Papelera. Puedes recuperarlo desde Mis apuestas.");
});
elements.trashParlaysList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-trash-parlay-id]");
  if (!card) return;
  const id = card.dataset.trashParlayId;
  if (event.target.closest("[data-restore-parlay]")) {
    state.savedParlays = state.savedParlays.map((parlay) => parlay.id === id ? restoreParlayFromTrash(parlay) : parlay);
    persistSavedParlays(); renderSavedParlays(); showNotice("Parlay recuperado y devuelto a Parlays guardados."); return;
  }
  if (!event.target.closest("[data-delete-parlay-forever]")) return;
  if (!window.confirm("¿Eliminar definitivamente este parlay? Esta acción no se puede deshacer.")) return;
  state.savedParlays = state.savedParlays.filter((parlay) => parlay.id !== id);
  persistSavedParlays(); renderSavedParlays(); showNotice("Parlay eliminado definitivamente.");
});
elements.savedPicksList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-pick-id]");
  if (!card || !event.target.closest("[data-delete-pick]")) return;
  state.savedPicks = state.savedPicks.filter((pick) => pick.id !== card.dataset.pickId);
  persistSavedPicks();
  renderSavedPicks();
});
document.addEventListener("click", (event) => {
  const savedTab = event.target.closest("[data-saved-tab]");
  if (savedTab) {
    state.savedTab = savedTab.dataset.savedTab;
    document.querySelectorAll("[data-saved-tab]").forEach((button) => button.classList.toggle("saved-tab--active", button === savedTab));
    elements.savedPicksList.hidden = state.savedTab !== "individual";
    elements.savedParlaysList.hidden = state.savedTab !== "parlays";
    elements.trashParlaysList.hidden = state.savedTab !== "trash";
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) switchView(viewButton.dataset.view);
  if (!event.target.closest(".notification-menu")) {
    elements.notificationPopover.hidden = true;
    elements.notificationToggle.setAttribute("aria-expanded", "false");
  }
});
elements.matchesList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-fixture-id]");
  if (!card) return;
  await selectFixture(card.dataset.fixtureId, button?.dataset.action === "data" ? "data" : null);
  if (button?.dataset.action === "season") {
    openSupportingDetail("teamSeasonStatistics");
    return;
  }
  if (button?.dataset.action === "data") {
    switchView("guide");
    const decision = document.querySelector("#guide-data-picks-module");
    if (decision) decision.open = true;
    window.requestAnimationFrame(() => decision?.scrollIntoView({ behavior: "auto", block: "start" }));
    return;
  }
  switchView("transparency");
});
elements.matchesList.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-fixture-id]");
  if (!card || event.target.closest("button")) return;
  event.preventDefault();
  await selectFixture(card.dataset.fixtureId, false);
  switchView("transparency");
});

elements.themeToggle.addEventListener("click", () => applyTheme(state.preferences.theme === "dark" ? "light" : "dark"));
elements.toggleTeamPerformance.addEventListener("click", () => applyTeamPerformanceVisibility(elements.teamPerformanceContent.hidden));
elements.togglePlayerGoal.addEventListener("click", () => toggleReadyModule(elements.togglePlayerGoal, elements.playerGoalContent));
elements.playerGoalContent.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-player-goal]");
  const save = event.target.closest("[data-save-player-goal]");
  if (add) addPlayerGoalPick(add.dataset.addPlayerGoal);
  if (save) savePlayerGoalPick(save.dataset.savePlayerGoal);
});
elements.teamPerformanceContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-team-performance-pick]");
  const saveButton = event.target.closest("[data-save-team-performance-pick]");
  if (addButton) addTeamPerformancePick(addButton.dataset.addTeamPerformancePick);
  if (saveButton) saveTeamPerformancePick(saveButton.dataset.saveTeamPerformancePick);
});
elements.savePreMatchEvidence.addEventListener("click", capturePreMatchEvidence);
elements.auditFixture.addEventListener("change", () => { elements.runAudit.disabled = !elements.auditFixture.value; });
elements.runAudit.addEventListener("click", runSelectedAudit);
elements.notificationToggle.addEventListener("click", () => {
  const open = elements.notificationToggle.getAttribute("aria-expanded") === "true";
  elements.notificationToggle.setAttribute("aria-expanded", String(!open));
  elements.notificationPopover.hidden = open;
});
elements.markNotificationsRead.addEventListener("click", markAlertsRead);
elements.markAllAlertsRead.addEventListener("click", markAlertsRead);
elements.clearAlerts.addEventListener("click", () => {
  state.alerts = [];
  writeLocalJson(ALERTS_KEY, state.alerts);
  renderAlerts();
});
[elements.alertLive, elements.alertScore, elements.alertData].forEach((input) => input.addEventListener("change", () => {
  state.preferences.alertLive = elements.alertLive.checked;
  state.preferences.alertScore = elements.alertScore.checked;
  state.preferences.alertData = elements.alertData.checked;
  writeLocalJson(PREFERENCES_KEY, state.preferences);
}));
elements.accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.preferences.name = elements.accountName.value.trim();
  state.preferences.dailyLimit = elements.accountDailyLimit.value;
  applyTheme(elements.accountDarkMode.checked ? "dark" : "light");
  writeLocalJson(PREFERENCES_KEY, state.preferences);
  showNotice("Preferencias guardadas en este navegador.");
});

document.querySelectorAll("[data-nav-label]").forEach((button) => {
  button.addEventListener("click", () => {
    showNotice(`${button.dataset.navLabel} es un módulo preparado, pero todavía no está habilitado.`);
  });
});

initializeInfoTooltips();

async function initializeApp() {
  renderLeagueOptions();
  const today = pacificToday();
  elements.dateFrom.value ||= today;
  elements.dateTo.value ||= today;
  elements.competition.value = "world-cup";
  elements.season.value = "auto";
  syncCompetitionCheckboxes();
  elements.accountName.value = state.preferences.name || "";
  elements.accountDailyLimit.value = state.preferences.dailyLimit || "none";
  elements.alertLive.checked = state.preferences.alertLive !== false;
  elements.alertScore.checked = state.preferences.alertScore !== false;
  elements.alertData.checked = state.preferences.alertData !== false;
  applyTheme(state.preferences.theme || "dark");
  renderAlerts();
  renderParlayDraft();
  renderSavedPicks();
  renderSavedParlays();
  applyTeamPerformanceVisibility(teamPerformanceVisible());
  const runtime = await footballDataService.getRuntime();
  const releaseElement = document.querySelector("#site-last-update");
  const releaseDate = runtime.release?.deployedAt || document.lastModified;
  const releaseCommit = runtime.release?.commit ? ` · versión ${runtime.release.commit}` : "";
  releaseElement.textContent = `Última actualización: ${formatSiteRelease(releaseDate)} PT${releaseCommit}`;
  document.querySelector("#runtime-api").textContent = `API · ${runtime.providers?.apiFootball?.configured ? "activa" : "no disponible"}`;
  document.querySelector("#runtime-ai").textContent = `IA · ${runtime.providers?.openai?.configured ? "disponible" : "no configurada"}`;
  document.querySelector("#runtime-version").textContent = `Versión · ${runtime.release?.commit || "local"}`;
  if (runtime.mode === "live") {
    document.querySelector("#runtime-mode").textContent = runtime.liveReady ? "Datos reales" : "Configuración pendiente";
    document.querySelector("#runtime-description").textContent = runtime.liveReady
      ? "API-Football y OpenAI están configurados en el backend."
      : `Faltan variables del servidor: ${(runtime.missing || []).join(", ")}.`;
    document.querySelector("#data-mode-note").textContent = "Los partidos y la cobertura se consultan desde API-Football. El análisis IA solo se ejecuta al solicitarlo.";
  } else if (window.location.hostname.endsWith("github.io")) {
    document.querySelector("#runtime-mode").textContent = "Demo pública sin APIs";
    document.querySelector("#runtime-description").textContent = "GitHub Pages no ejecuta el backend; los partidos y análisis mostrados son sintéticos.";
  }
  renderMatches();
}

initializeApp();
