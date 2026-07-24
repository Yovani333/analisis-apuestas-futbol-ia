import { ALLOWED_LEAGUES, DATA_CATEGORIES, MOCK_FIXTURES } from "./mock-data.js?v=20260712-expanded-competitions-v1";
import { footballDataService } from "./services.js?v=20260718-evidence-batch-v1";
import { applyAnalysisTiming, resolveAnalysisTiming } from "./analysis-timing.js?v=20260630-timing";
import {
  calculateCompetitionPerformance, calculateHistoryMetrics, calculateOriginPerformance, calculateOriginRecommendations, calculateParlayLegCounts, calculateParlayPickTypePerformance, calculateParlayResult, createSavedParlay, createSavedPick,
  filterParlaysByFixtureDate, filterPicksByFixtureDate, hasDuplicatePick, loadParlayDraft, loadSavedParlays, loadSavedPicks, moveParlayToTrash, needsSettlementRefresh, normalizePickLeg,
  permanentlyDeleteRemovedParlayLeg, removeParlayLeg, resolveSelectionCode, restoreParlayFromTrash, restoreRemovedParlayLeg, saveParlayDraft, saveSavedParlays, saveSavedPicks, SETTLEMENT_VERIFICATION_VERSION, settlePickResult
} from "./parlay-store.js?v=20260724-parlay-trash-v1";
import { EVIDENCE_SNAPSHOTS_KEY, evidenceSnapshotToText, latestEvidenceForFixture, loadEvidenceSnapshots, saveEvidenceSnapshot } from "./evidence-store.js?v=20260719-remove-invalid-v1";
import { infoTooltip, initializeInfoTooltips, labelWithTooltip } from "./info-tooltip.js?v=20260704-v3";
import { collapseGuideModules, resetModuleButton } from "./guide-state.js?v=20260704-v1";
import { pickOriginLabel } from "./pick-origins.js?v=20260722-recent-form-v1";
import { findLowestOdds } from "./odds-monitor.js?v=20260703";
import { cloudSyncClient, mergeCloudState } from "./cloud-sync.js?v=20260724-parlay-trash-v1";
import { buildExpectedCornersPick } from "./expected-corners-pick.js?v=20260722-corners-v2";
import { activeFavoriteTeams, isFavoriteTeam, toggleFavoriteTeam } from "./favorite-teams.js?v=20260718-favorite-teams-v1";
import { pendingEvidenceForCompetition, summarizeEvidenceByCompetition } from "./evidence-readiness.js?v=20260719-remove-invalid-v1";
import { filterValidEvidenceSnapshots, isValidEvidenceSnapshot } from "./evidence-validity.js?v=20260719-remove-invalid-v1";
import { evaluateH2HRecommendation } from "./h2h-recommendation.js?v=20260719-h2h-suggestion-v1";
import { evaluateRecentFormRecommendation } from "./recent-form-recommendation.js?v=20260722-recent-form-v1";

const ALERTS_KEY = "football-ai.alerts.v1";
const PREFERENCES_KEY = "football-ai.preferences.v1";
const ANALYSIS_USAGE_KEY = "football-ai.analysis-usage.v1";
const TEAM_PERFORMANCE_VISIBILITY_KEY = "football-ai.team-performance-visible.v1";
const PICK_COLLECTION_CACHE_KEY = "football-ai.pick-collection-cache.v1";
let cloudSyncTimer = null;
const readLocalJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
};
const writeLocalJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* La app funciona aunque el almacenamiento esté bloqueado. */ }
  if ([ALERTS_KEY, PREFERENCES_KEY, ANALYSIS_USAGE_KEY].includes(key)) queueCloudSync();
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
  pickCollectionByFixture: new Map(Object.entries(readLocalJson(PICK_COLLECTION_CACHE_KEY, {}))),
  favoriteTeamStatsById: new Map(),
  favoriteTeamLoadingIds: new Set(),
  parlayDraft: loadParlayDraft(),
  savedParlays: loadSavedParlays(),
  savedPicks: loadSavedPicks(),
  evidenceSnapshots: loadEvidenceSnapshots(),
  evidenceLibrary: [],
  evidenceEvaluationByCompetition: new Map(),
  savedTab: "individual",
  savedDateFilter: pacificToday(),
  expandedParlays: new Set(),
  expandedMatchGroups: new Set(),
  alerts: readLocalJson(ALERTS_KEY, []),
  preferences: readLocalJson(PREFERENCES_KEY, { theme: "dark", dailyLimit: "none", name: "", alertLive: true, alertScore: true, alertData: true, favoriteTeams: [] }),
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
  isRefreshingWeather: false,
  isRefreshingStatuses: false,
  isRefreshingLive: false,
  isCapturingEvidence: false,
  isLoadingEvidenceLibrary: false,
  isCollectingPickInfo: false,
  lastLiveRefreshAt: null,
  simulationTeamOptionByValue: new Map(),
  simulationCompetitionOptionByValue: new Map(),
  cloud: {
    enabled: false, ready: false, syncing: false, dirty: false, lastSyncedAt: null, error: "", notice: "",
    automaticEvidence: false, watchedFixtures: 0, scheduledEvidence: 0, capturedEvidence: 0, evidenceFailures: 0
  },
  cloudApplying: false
};

const elements = {
  form: document.querySelector("#filters-form"),
  leagueOptions: document.querySelector("#league-options"),
  leagueCount: document.querySelector("#league-count"),
  dateFrom: document.querySelector("#date-from"),
  dateTo: document.querySelector("#date-to"),
  competition: document.querySelector("#competition-main"),
  competitionCountry: document.querySelector("#competition-country"),
  competitionConfederation: document.querySelector("#competition-confederation"),
  competitionType: document.querySelector("#competition-type"),
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
  refreshOutcome: document.querySelector("#refresh-outcome"),
  outcomeStatus: document.querySelector("#outcome-status"),
  outcomeContent: document.querySelector("#outcome-content"),
  showPoisson: document.querySelector("#show-poisson"),
  poissonStatus: document.querySelector("#poisson-status"),
  poissonContent: document.querySelector("#poisson-content"),
  showTeamGoals: document.querySelector("#show-team-goals"),
  teamGoalsStatus: document.querySelector("#team-goals-status"),
  teamGoalsContent: document.querySelector("#team-goals-content"),
  showCorners: document.querySelector("#show-corners"), refreshCorners: document.querySelector("#refresh-corners"), cornersStatus: document.querySelector("#corners-status"), cornersContent: document.querySelector("#corners-content"),
  showSpecificMarkets: document.querySelector("#show-specific-markets"), specificMarketsStatus: document.querySelector("#specific-markets-status"), specificMarketsContent: document.querySelector("#specific-markets-content"),
  teamPerformanceTitle: document.querySelector("#team-performance-title"), teamPerformanceStatus: document.querySelector("#team-performance-status"),
  teamPerformanceContent: document.querySelector("#team-performance-content"), toggleTeamPerformance: document.querySelector("#toggle-team-performance"), refreshTeamPerformance: document.querySelector("#refresh-team-performance"),
  playerGoalStatus: document.querySelector("#player-goal-status"), playerGoalContent: document.querySelector("#player-goal-content"), togglePlayerGoal: document.querySelector("#toggle-player-goal"), refreshPlayerGoal: document.querySelector("#refresh-player-goal"),
  fixtureReadyDialog: document.querySelector("#fixture-ready-dialog"),
  fixtureReadyAccept: document.querySelector("#fixture-ready-accept"),
  deleteConfirmationDialog: document.querySelector("#delete-confirmation-dialog"),
  deleteConfirmationTitle: document.querySelector("#delete-confirmation-title"),
  deleteConfirmationMessage: document.querySelector("#delete-confirmation-message"),
  deleteConfirmationCancel: document.querySelector("#delete-confirmation-cancel"),
  deleteConfirmationConfirm: document.querySelector("#delete-confirmation-confirm"),
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
  originPerformance: document.querySelector("#origin-performance"),
  originLostPerformance: document.querySelector("#origin-lost-performance"),
  originRecommendations: document.querySelector("#origin-recommendations"),
  competitionPerformance: document.querySelector("#competition-performance"),
  pickTypesWon: document.querySelector("#pick-types-won"),
  pickTypesLost: document.querySelector("#pick-types-lost"),
  updateParlayResults: document.querySelector("#update-parlay-results"),
  updateIndividualResults: document.querySelector("#update-individual-results"),
  updateOriginResults: document.querySelector("#update-origin-results"),
  updateOriginLostResults: document.querySelector("#update-origin-lost-results"),
  updateOriginRecommendations: document.querySelector("#update-origin-recommendations"),
  updateCompetitionResults: document.querySelector("#update-competition-results"),
  originPicksDialog: document.querySelector("#origin-picks-dialog"),
  originPicksTitle: document.querySelector("#origin-picks-title"),
  originPicksSubtitle: document.querySelector("#origin-picks-subtitle"),
  originPicksContent: document.querySelector("#origin-picks-content"),
  originPicksClose: document.querySelector("#origin-picks-close"),
  savedDateFilterPanel: document.querySelector("#saved-date-filter-panel"),
  savedDateFilter: document.querySelector("#saved-date-filter"),
  applySavedDateFilter: document.querySelector("#apply-saved-date-filter"),
  clearSavedDateFilter: document.querySelector("#clear-saved-date-filter"),
  savedDateFilterStatus: document.querySelector("#saved-date-filter-status"),
  savedIndividualSection: document.querySelector("#saved-individual-section"),
  originResultsSection: document.querySelector("#origin-results-section"),
  originLostResultsSection: document.querySelector("#origin-lost-results-section"),
  originRecommendationsSection: document.querySelector("#origin-recommendations-section"),
  competitionResultsSection: document.querySelector("#competition-results-section"),
  pickTypesWonSection: document.querySelector("#pick-types-won-section"),
  pickTypesLostSection: document.querySelector("#pick-types-lost-section"),
  savedParlaysSection: document.querySelector("#saved-parlays-section"),
  trashResultsSection: document.querySelector("#trash-results-section")
};

Object.assign(elements, {
  simulationCompetition: document.querySelector("#simulation-competition"),
  simulationCompetitionOptions: document.querySelector("#simulation-competition-options"),
  simulationWindow: document.querySelector("#simulation-window"),
  simulationTeamOptions: document.querySelector("#simulation-team-options"),
  simulationTeamASearch: document.querySelector("#simulation-team-a-search"),
  simulationTeamAId: document.querySelector("#simulation-team-a-id"),
  simulationTeamAName: document.querySelector("#simulation-team-a-name"),
  simulationTeamBSearch: document.querySelector("#simulation-team-b-search"),
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
  collectPickInfo: document.querySelector("#collect-pick-info"),
  pickCollectionStatus: document.querySelector("#pick-collection-status"),
  pickCollectionContent: document.querySelector("#pick-collection-content-inner"),
  themeToggle: document.querySelector("#theme-toggle"),
  accountForm: document.querySelector("#account-form"), accountName: document.querySelector("#account-name"),
  accountDarkMode: document.querySelector("#account-dark-mode"),
  accountDailyLimit: document.querySelector("#account-daily-limit"),
  cloudAccountStatus: document.querySelector("#cloud-account-status"), cloudAuthFields: document.querySelector("#cloud-auth-fields"),
  cloudConnected: document.querySelector("#cloud-connected"), cloudEmail: document.querySelector("#cloud-email"),
  cloudLastSync: document.querySelector("#cloud-last-sync"), cloudEmailInput: document.querySelector("#cloud-email-input"),
  cloudPasswordInput: document.querySelector("#cloud-password-input"), cloudSignIn: document.querySelector("#cloud-sign-in"),
  cloudSignUp: document.querySelector("#cloud-sign-up"), cloudSyncNow: document.querySelector("#cloud-sync-now"),
  cloudSignOut: document.querySelector("#cloud-sign-out"), cloudAccountMessage: document.querySelector("#cloud-account-message"),
  automaticEvidenceStatus: document.querySelector("#automatic-evidence-status")
});
Object.assign(elements, {
  auditFixture: document.querySelector("#audit-fixture"), runAudit: document.querySelector("#run-audit"), auditResults: document.querySelector("#audit-results"),
  viewAuditEvidence: document.querySelector("#view-audit-evidence"), auditEvidencePreview: document.querySelector("#audit-evidence-preview"),
  auditEvidenceTitle: document.querySelector("#audit-evidence-title"), auditEvidenceText: document.querySelector("#audit-evidence-text"),
  closeAuditEvidence: document.querySelector("#close-audit-evidence")
});
Object.assign(elements, {
  evidenceReadinessTotal: document.querySelector("#evidence-readiness-total"),
  evidenceReadinessList: document.querySelector("#evidence-readiness-list")
});
Object.assign(elements, {
  favoriteTeamCount: document.querySelector("#favorite-team-count"),
  favoriteTeamsList: document.querySelector("#favorite-teams-list"),
  refreshFavoriteTeams: document.querySelector("#refresh-favorite-teams")
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

function localCloudState() {
  return {
    preferences: state.preferences,
    parlayDraft: state.parlayDraft,
    savedPicks: state.savedPicks,
    savedParlays: state.savedParlays,
    evidenceSnapshots: state.evidenceSnapshots,
    alerts: state.alerts,
    analysisUsage: readLocalJson(ANALYSIS_USAGE_KEY, {})
  };
}

function renderCloudAccount() {
  const session = cloudSyncClient.session;
  const connected = Boolean(session?.accessToken);
  elements.cloudAuthFields.hidden = connected || !state.cloud.enabled;
  elements.cloudConnected.hidden = !connected;
  elements.cloudSignIn.disabled = state.cloud.syncing;
  elements.cloudSignUp.disabled = state.cloud.syncing;
  elements.cloudSyncNow.disabled = state.cloud.syncing;
  elements.cloudSignOut.disabled = state.cloud.syncing;
  if (!state.cloud.enabled) {
    elements.cloudAccountStatus.className = "status-badge status-badge--unavailable";
    elements.cloudAccountStatus.textContent = "No configurada";
    elements.cloudAccountMessage.textContent = "Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY en Render.";
    elements.automaticEvidenceStatus.textContent = "Evidencia automática: sincronización en línea no configurada.";
    return;
  }
  if (state.cloud.syncing) {
    elements.cloudAccountStatus.className = "status-badge status-badge--processing";
    elements.cloudAccountStatus.textContent = "Sincronizando";
  } else if (connected && !state.cloud.error) {
    elements.cloudAccountStatus.className = "status-badge status-badge--available";
    elements.cloudAccountStatus.textContent = "Conectada";
  } else if (state.cloud.error) {
    elements.cloudAccountStatus.className = "status-badge status-badge--partial";
    elements.cloudAccountStatus.textContent = "Revisar";
  } else {
    elements.cloudAccountStatus.className = "status-badge status-badge--partial";
    elements.cloudAccountStatus.textContent = "Sin sesión";
  }
  elements.cloudEmail.textContent = session?.user?.email || "Cuenta autenticada";
  elements.cloudLastSync.textContent = state.cloud.lastSyncedAt
    ? `Última sincronización: ${formatSiteRelease(state.cloud.lastSyncedAt)} PT`
    : "Todavía no sincronizada";
  elements.cloudAccountMessage.textContent = state.cloud.error
    ? state.cloud.error
    : state.cloud.notice ? state.cloud.notice
    : connected ? "Los cambios se guardan en línea y mantienen una copia local para trabajar sin conexión."
      : "Inicia sesión con el mismo correo en tu teléfono y computadora.";
  elements.automaticEvidenceStatus.textContent = !state.cloud.automaticEvidence
    ? "Evidencia automática: pendiente de configurar en el servidor."
    : !connected ? "Evidencia automática: inicia sesión para vigilar los partidos encontrados."
    : `Evidencia automática activa · ${state.cloud.scheduledEvidence} pendiente(s) · ${state.cloud.capturedEvidence} capturada(s)${state.cloud.evidenceFailures ? ` · ${state.cloud.evidenceFailures} con error` : ""}.`;
}

function automaticEvidenceFixtures(fixtures = state.fixtures) {
  return fixtures.filter((fixture) => fixture.status === "scheduled" && fixture.utcDateTime).map((fixture) => ({
    id: fixture.id,
    utcDateTime: fixture.utcDateTime,
    date: fixture.date,
    time: fixture.time,
    status: fixture.status,
    statusLabel: fixture.statusLabel,
    leagueName: fixture.leagueName,
    leagueSlug: fixture.leagueSlug,
    leagueId: fixture.leagueId,
    season: fixture.season,
    country: fixture.country,
    home: fixture.home,
    away: fixture.away,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId
  }));
}

function applyEvidenceAutomationStatus(status) {
  if (!status) return;
  state.cloud.watchedFixtures = Number(status.watched || 0);
  state.cloud.scheduledEvidence = Number(status.scheduled || 0);
  state.cloud.capturedEvidence = Number(status.captured || 0);
  state.cloud.evidenceFailures = Number(status.failed || 0);
  renderCloudAccount();
}

async function registerAutomaticEvidence(fixtures = state.fixtures) {
  if (!state.cloud.automaticEvidence || !cloudSyncClient.session?.accessToken) return null;
  const scheduled = automaticEvidenceFixtures(fixtures);
  try {
    const status = scheduled.length
      ? await cloudSyncClient.watchEvidence(scheduled)
      : await cloudSyncClient.evidenceAutomationStatus();
    applyEvidenceAutomationStatus(status);
    return status;
  } catch (error) {
    state.cloud.notice = `Evidencia automática pendiente: ${error.message}`;
    renderCloudAccount();
    return null;
  }
}

function applyCloudState(remoteState) {
  state.cloudApplying = true;
  try {
    state.preferences = { ...state.preferences, ...(remoteState.preferences || {}) };
    state.parlayDraft = remoteState.parlayDraft || [];
    state.savedPicks = remoteState.savedPicks || [];
    state.savedParlays = remoteState.savedParlays || [];
    state.evidenceSnapshots = filterValidEvidenceSnapshots(remoteState.evidenceSnapshots || []);
    state.alerts = remoteState.alerts || [];
    saveParlayDraft(state.parlayDraft);
    saveSavedPicks(state.savedPicks);
    saveSavedParlays(state.savedParlays);
    writeLocalJson(EVIDENCE_SNAPSHOTS_KEY, state.evidenceSnapshots);
    writeLocalJson(PREFERENCES_KEY, state.preferences);
    writeLocalJson(ALERTS_KEY, state.alerts);
    writeLocalJson(ANALYSIS_USAGE_KEY, remoteState.analysisUsage || {});
    elements.accountName.value = state.preferences.name || "";
    elements.accountDailyLimit.value = state.preferences.dailyLimit || "none";
    applyTheme(state.preferences.theme || "dark");
    renderParlayDraft();
    renderSavedPicks();
    renderSavedParlays();
    renderAlerts();
    renderAuditFixtureOptions();
    renderFavoriteTeams();
    refreshActivePickIndicators();
  } finally {
    state.cloudApplying = false;
  }
}

async function connectCloudAccount() {
  const session = cloudSyncClient.session;
  if (!session?.accessToken) return;
  state.cloud.syncing = true;
  state.cloud.error = "";
  state.cloud.notice = "";
  renderCloudAccount();
  try {
    const remote = await cloudSyncClient.loadState();
    const userId = session.user?.id || "";
    const nextState = mergeCloudState(localCloudState(), remote || {});
    applyCloudState(nextState);
    const saved = await cloudSyncClient.saveState(nextState);
    state.cloud.lastSyncedAt = saved?.updated_at || nextState.updatedAt || new Date().toISOString();
    if (cloudSyncClient.evidenceSyncError) state.cloud.notice = `La cuenta se sincronizó, pero el archivo completo de evidencias quedó pendiente: ${cloudSyncClient.evidenceSyncError}`;
    state.cloud.dirty = false;
    if (userId) cloudSyncClient.markInitialized(userId);
    state.cloud.ready = true;
  } catch (error) {
    state.cloud.error = error.message;
    state.cloud.ready = true;
  } finally {
    state.cloud.syncing = false;
    renderCloudAccount();
  }
  await registerAutomaticEvidence();
}

async function syncCloudState({ announce = false, refreshFirst = false } = {}) {
  if (!state.cloud.ready || state.cloudApplying || state.cloud.syncing || !cloudSyncClient.session?.accessToken) return;
  state.cloud.syncing = true;
  state.cloud.error = "";
  state.cloud.notice = "";
  renderCloudAccount();
  try {
    const remote = await cloudSyncClient.loadState();
    const merged = mergeCloudState(localCloudState(), remote || {});
    applyCloudState(merged);
    const saved = await cloudSyncClient.saveState(merged);
    state.cloud.lastSyncedAt = saved?.updated_at || new Date().toISOString();
    state.cloud.dirty = false;
    if (cloudSyncClient.evidenceSyncError) {
      state.cloud.notice = `La copia local se conserva; el archivo completo de evidencias quedó pendiente: ${cloudSyncClient.evidenceSyncError}`;
      if (announce) showNotice(state.cloud.notice);
    } else if (announce) showNotice(`Datos combinados y sincronizados sin eliminar picks, parlays ni evidencias (${merged.evidenceSnapshots.length}).`);
  } catch (error) {
    state.cloud.error = `${error.message} La copia local se conserva.`;
    if (announce) showNotice(state.cloud.error);
  } finally {
    state.cloud.syncing = false;
    renderCloudAccount();
  }
  if (refreshFirst) await registerAutomaticEvidence();
}

function queueCloudSync() {
  if (!state?.cloud?.ready || state.cloudApplying || !cloudSyncClient.session?.accessToken) return;
  state.cloud.dirty = true;
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => void syncCloudState(), 500);
}

function clearLocalAccountData() {
  state.cloudApplying = true;
  try {
    state.parlayDraft = [];
    state.savedPicks = [];
    state.savedParlays = [];
    state.evidenceSnapshots = [];
    state.alerts = [];
    state.preferences = { theme: state.preferences.theme || "dark", dailyLimit: "none", name: "", alertLive: true, alertScore: true, alertData: true };
    saveParlayDraft([]);
    saveSavedPicks([]);
    saveSavedParlays([]);
    localStorage.removeItem(EVIDENCE_SNAPSHOTS_KEY);
    localStorage.removeItem(ANALYSIS_USAGE_KEY);
    localStorage.setItem(ALERTS_KEY, "[]");
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences));
    elements.accountName.value = "";
    elements.accountDailyLimit.value = "none";
    renderParlayDraft(); renderSavedPicks(); renderSavedParlays(); renderAuditFixtureOptions();
  } finally { state.cloudApplying = false; }
}

async function initializeCloudAccount() {
  try {
    const config = await cloudSyncClient.configuration();
    state.cloud.enabled = Boolean(config.enabled);
    state.cloud.automaticEvidence = Boolean(config.automaticEvidence);
  } catch (error) {
    state.cloud.error = error.message;
  }
  if (state.cloud.enabled && cloudSyncClient.session?.accessToken) await connectCloudAccount();
  else state.cloud.ready = true;
  renderCloudAccount();
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
  { key: "offensiveSideProduction", label: "Lado ofensivo", use: "Disponible solo con ubicación de jugadas" },
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

function showFixtureReadyDialog() {
  if (!elements.fixtureReadyDialog?.showModal) {
    showNotice("Listo. Encuentro seleccionado.");
    return;
  }
  if (!elements.fixtureReadyDialog.open) elements.fixtureReadyDialog.showModal();
}

function renderLeagueOptions() {
  const groups = new Map();
  for (const league of ALLOWED_LEAGUES) {
    const label = league.region || "Otras";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(league);
  }
  elements.leagueOptions.innerHTML = [...groups.entries()].map(([group, leagues]) => `<div class="league-option-group"><h4>${escapeHtml(group)}</h4>${leagues.map((league) => `
      <label class="checkbox-row">
        <input type="checkbox" name="league" value="${escapeHtml(league.slug)}" />
        <span>${escapeHtml(league.name)} — ${escapeHtml(league.country)}${league.coverageLevel ? ` · cobertura ${escapeHtml(league.coverageLevel)}` : ""}</span>
      </label>`).join("")}</div>`).join("");
}

function renderCompetitionFilters() {
  const optionList = (values, allLabel) => `<option value="all">${allLabel}</option>${[...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  elements.competitionCountry.innerHTML = optionList(ALLOWED_LEAGUES.map((league) => league.country), "Todos");
  elements.competitionConfederation.innerHTML = optionList(ALLOWED_LEAGUES.map((league) => league.confederation), "Todas");
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
    extraContents: [elements.analysisContent, elements.playerGoalContent, elements.teamPerformanceContent, elements.cornersContent, elements.specificMarketsContent],
    extraButtons: [elements.toggleAnalysis, elements.togglePlayerGoal, elements.toggleTeamPerformance, elements.showCorners]
  });
  if (elements.specificMarketsContent) elements.specificMarketsContent.hidden = false;
  if (elements.refreshOutcome) elements.refreshOutcome.disabled = !selectedFixture();
  if (elements.refreshPlayerGoal) elements.refreshPlayerGoal.disabled = !selectedFixture();
  if (elements.refreshTeamPerformance) elements.refreshTeamPerformance.disabled = !selectedFixture();
  if (elements.refreshCorners) elements.refreshCorners.disabled = !selectedFixture();
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
  if (value === "americas") return ALLOWED_LEAGUES.filter((league) => league.region === "Americas").map((league) => league.slug);
  if (value === "europe") return ALLOWED_LEAGUES.filter((league) => league.region === "Europe").map((league) => league.slug);
  if (value === "international-clubs") return ALLOWED_LEAGUES.filter((league) => league.region === "International Clubs").map((league) => league.slug);
  if (value === "leagues") return ALLOWED_LEAGUES.filter((league) => league.competitionType === "league").map((league) => league.slug);
  if (value === "cups") return ALLOWED_LEAGUES.filter((league) => ["cup", "qualifying"].includes(league.competitionType)).map((league) => league.slug);
  if (value === "all") return ALLOWED_LEAGUES.map((league) => league.slug);
  return selectedLeagueSlugs();
}

function applyCompetitionMetadataFilters() {
  const country = elements.competitionCountry.value;
  const confederation = elements.competitionConfederation.value;
  const type = elements.competitionType.value;
  elements.competition.value = "custom";
  elements.form.querySelectorAll('input[name="league"]').forEach((input) => {
    const league = ALLOWED_LEAGUES.find((item) => item.slug === input.value);
    input.checked = Boolean(league)
      && (country === "all" || league.country === country)
      && (confederation === "all" || league.confederation === confederation)
      && (type === "all" || league.competitionType === type);
  });
  updateLeagueCount();
}

function syncCompetitionCheckboxes() {
  if (elements.competition.value === "custom") return;
  elements.competitionCountry.value = "all";
  elements.competitionConfederation.value = "all";
  elements.competitionType.value = "all";
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

function applyTheme(theme, { userInitiated = false } = {}) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  elements.themeToggle.setAttribute("aria-pressed", String(dark));
  elements.themeToggle.querySelector(".nav-label").textContent = dark ? "Modo claro" : "Modo oscuro";
  elements.accountDarkMode.checked = dark;
  state.preferences.theme = dark ? "dark" : "light";
  if (userInitiated) state.preferences.themeUpdatedAt = new Date().toISOString();
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
  // Se conserva la lectura del estado legado para sincronización, pero ya no existe interfaz de alertas o avisos.
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
  elements.collectPickInfo.disabled = true;
  setPickCollectionStatus("Listo para recopilar", "unavailable");
  renderPickCollection(null);
  showAnalysisEmpty();
}

function clearFilters() {
  const today = pacificToday();
  elements.dateFrom.value = today;
  elements.dateTo.value = today;
  elements.competition.value = "all";
  elements.season.value = "auto";
  elements.status.value = "all";
  elements.competitionCountry.value = "all";
  elements.competitionConfederation.value = "all";
  elements.competitionType.value = "all";
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

function fixtureQualityView(fixture) {
  const numericScore = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const baseScore = numericScore(fixture?.dataQuality?.score);
  const researchScore = numericScore(fixture?.researchData?.totalConfidenceScore);
  const score = baseScore ?? researchScore;
  const currentScore = score;
  const evidence = fixture?.id ? latestEvidenceForFixture(allEvidenceSnapshots(), fixture.id) : null;
  const evidenceScore = numericScore(evidence?.dataQuality?.score);
  const displayScore = evidenceScore !== null && (currentScore === null || evidenceScore > currentScore) ? evidenceScore : currentScore;
  if (displayScore === null) return null;
  const level = displayScore >= 80 ? "Alta" : displayScore >= 55 ? "Media" : displayScore > 0 ? "Baja" : "No disponible";
  return {
    score: Math.max(0, Math.min(100, Math.round(displayScore))),
    level,
    source: evidenceScore !== null && evidenceScore === displayScore ? "evidence" : "current",
    currentScore,
    evidence,
    evidenceScore
  };
}

const FAVORITE_TEAM_METRICS = Object.freeze([
  { key: "shots", label: "Remates", max: 20 },
  { key: "shotsOnGoal", label: "Al arco", max: 10 },
  { key: "possession", label: "Posesión", max: 100, suffix: "%" },
  { key: "passAccuracy", label: "Precisión de pase", max: 100, suffix: "%" },
  { key: "corners", label: "Corners", max: 10 },
  { key: "fouls", label: "Faltas", max: 20 }
]);

function favoriteTeams() {
  return activeFavoriteTeams(state.preferences.favoriteTeams);
}

function favoriteTeamFromFixture(fixture, side) {
  return {
    id: side === "home" ? fixture.homeTeamId : fixture.awayTeamId,
    name: side === "home" ? fixture.home : fixture.away,
    logo: side === "home" ? fixture.homeLogo : fixture.awayLogo,
    leagueName: fixture.leagueName || "Competición no disponible",
    country: fixture.country || "",
    addedAt: new Date().toISOString()
  };
}

function persistFavoriteTeams() {
  writeLocalJson(PREFERENCES_KEY, state.preferences);
  renderMatches();
  renderFavoriteTeams();
}

async function toggleTeamFavorite(team) {
  if (!team?.id) return showNotice("API-Football no proporcionó el ID de este equipo.");
  const wasFavorite = isFavoriteTeam(state.preferences.favoriteTeams, team.id);
  state.preferences.favoriteTeams = toggleFavoriteTeam(state.preferences.favoriteTeams, team);
  persistFavoriteTeams();
  showNotice(wasFavorite ? `${team.name} se quitó de equipos favoritos.` : `${team.name} se agregó a equipos favoritos.`);
  if (!wasFavorite) await loadFavoriteTeamStats(team);
}

function favoriteMetricBar(metric, value) {
  const numeric = Number(value);
  const available = Number.isFinite(numeric);
  const width = available ? Math.max(0, Math.min(100, numeric / metric.max * 100)) : 0;
  return `<div class="favorite-team-metric">
    <div><span>${escapeHtml(metric.label)}</span><strong>${available ? `${escapeHtml(numeric.toFixed(2))}${metric.suffix || ""}` : "No disponible"}</strong></div>
    <div class="favorite-team-metric__track" role="img" aria-label="${escapeHtml(metric.label)}: ${available ? numeric : "no disponible"}"><i style="width:${width}%"></i></div>
  </div>`;
}

function renderFavoriteTeams() {
  if (!elements.favoriteTeamsList) return;
  const teams = favoriteTeams();
  elements.favoriteTeamCount.textContent = teams.length;
  elements.refreshFavoriteTeams.disabled = !teams.length || state.favoriteTeamLoadingIds.size > 0;
  if (!teams.length) {
    elements.favoriteTeamsList.innerHTML = '<div class="saved-empty"><h3>Sin equipos favoritos</h3><p>Marca la estrella junto a un equipo desde los encuentros del Dashboard.</p></div>';
    return;
  }
  elements.favoriteTeamsList.innerHTML = teams.map((team) => {
    const stats = state.favoriteTeamStatsById.get(String(team.id));
    const loading = state.favoriteTeamLoadingIds.has(String(team.id));
    const metrics = stats?.team?.metrics || {};
    const sample = stats?.team?.matchesWithStatistics || 0;
    const status = loading ? "Consultando" : stats?.status === "available" ? "Disponible" : stats?.status === "partial" ? "Parcial" : "Pendiente";
    const statusClassName = loading ? "processing" : stats?.status === "available" ? "available" : stats?.status === "partial" ? "partial" : "unavailable";
    return `<article class="favorite-team-card" data-favorite-team-id="${escapeHtml(team.id)}">
      <header>${teamCrest(team.name, team.logo, "large")}<div><h3>${escapeHtml(team.name)}</h3><p>${escapeHtml(team.leagueName || "Competición no disponible")}${team.country ? ` · ${escapeHtml(team.country)}` : ""}</p></div><span class="status-badge status-badge--${statusClassName}">${status}</span></header>
      ${stats ? `<div class="favorite-team-chart">${FAVORITE_TEAM_METRICS.map((metric) => favoriteMetricBar(metric, metrics[metric.key])).join("")}</div>
        <footer><span>Muestra: ${escapeHtml(sample)} de ${escapeHtml(stats.windowSize || 5)} partidos con estadísticas</span><span>${escapeHtml(stats.source || "API-Football")}</span><small>Actualizado: ${escapeHtml(formatUpdatedAt(stats.generatedAt))}</small></footer>`
        : `<div class="research-empty">${loading ? "Consultando los últimos partidos oficiales…" : "Pulsa Cargar estadísticas para generar la gráfica."}</div>`}
      <div class="favorite-team-card__actions"><button class="button button--primary button--compact" type="button" data-refresh-favorite-team="${escapeHtml(team.id)}" ${loading ? "disabled" : ""}>${stats ? "Actualizar" : "Cargar estadísticas"}</button><button class="button button--secondary button--compact" type="button" data-remove-favorite-team="${escapeHtml(team.id)}">Quitar favorito</button></div>
    </article>`;
  }).join("");
}

async function loadFavoriteTeamStats(team, announce = false) {
  const id = String(team?.id || "");
  if (!id || state.favoriteTeamLoadingIds.has(id)) return;
  state.favoriteTeamLoadingIds.add(id);
  renderFavoriteTeams();
  try {
    const result = await footballDataService.getFavoriteTeamStats(team, 5);
    state.favoriteTeamStatsById.set(id, result);
    if (announce) showNotice(`Estadísticas de ${team.name} actualizadas.`);
  } catch (error) {
    state.favoriteTeamStatsById.set(id, { status: "not_available", message: error.message, team: { metrics: {}, matchesWithStatistics: 0 }, generatedAt: new Date().toISOString() });
    if (announce) showNotice(error.message || `No fue posible actualizar ${team.name}.`);
  } finally {
    state.favoriteTeamLoadingIds.delete(id);
    renderFavoriteTeams();
  }
}

async function refreshAllFavoriteTeams() {
  const teams = favoriteTeams();
  if (!teams.length || state.favoriteTeamLoadingIds.size) return;
  elements.refreshFavoriteTeams.disabled = true;
  for (const team of teams) await loadFavoriteTeamStats(team);
  showNotice(`Se actualizaron ${teams.length} equipo(s) favorito(s) usando la caché disponible de API-Football.`);
}

function evidenceFixtureSnapshot(fixtureOrId) {
  const fixtureId = typeof fixtureOrId === "object" ? fixtureOrId?.id : fixtureOrId;
  return fixtureId ? latestEvidenceForFixture(allEvidenceSnapshots(), fixtureId) : null;
}

function numericQualityScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hydrateFixtureFromEvidence(fixture) {
  const evidence = evidenceFixtureSnapshot(fixture);
  if (!fixture || !evidence) return fixture;
  const currentScore = numericQualityScore(fixture.dataQuality?.score ?? fixture.researchData?.totalConfidenceScore);
  const evidenceScore = numericQualityScore(evidence.dataQuality?.score);
  const shouldUseEvidence = evidenceScore !== null && (currentScore === null || evidenceScore > currentScore);
  if (!shouldUseEvidence) return fixture;
  return {
    ...fixture,
    dataQuality: evidence.dataQuality || fixture.dataQuality,
    preMatch: evidence.preMatch || fixture.preMatch,
    marketAnalysis: evidence.marketAnalysis?.length ? evidence.marketAnalysis : fixture.marketAnalysis,
    researchData: evidence.researchData || fixture.researchData,
    evidenceFallback: {
      capturedAt: evidence.capturedAt,
      score: evidenceScore,
      currentScore,
      source: evidence.auditMetadata?.captureMode || "saved_pre_match_evidence"
    },
    qualityAlerts: [
      ...new Set([
        ...(fixture.qualityAlerts || []),
        `Evidencia prepartido disponible: se conserva snapshot ${evidenceScore}/100 cuando API-Football actual llega incompleta.`
      ])
    ]
  };
}

function hydrateModulesFromEvidence(fixture) {
  const evidence = evidenceFixtureSnapshot(fixture);
  if (!fixture?.id || !evidence?.modules) return;
  const modules = evidence.modules;
  if (modules.dataPicks?.picks?.length && !state.dataPicksByFixture.has(fixture.id)) state.dataPicksByFixture.set(fixture.id, modules.dataPicks);
  if (modules.poisson && modules.poisson.status !== "not_available" && !state.poissonByFixture.has(fixture.id)) state.poissonByFixture.set(fixture.id, modules.poisson);
  if (modules.teamGoals && modules.teamGoals.status !== "not_available" && !state.teamGoalsByFixture.has(fixture.id)) state.teamGoalsByFixture.set(fixture.id, modules.teamGoals);
  if (modules.corners && modules.corners.status !== "not_available" && !state.cornersByFixture.has(fixture.id)) state.cornersByFixture.set(fixture.id, modules.corners);
}

function activePickCountForFixture(fixture) {
  if (!fixture?.id || !["scheduled", "live"].includes(fixture.status)) return 0;
  const fixtureId = String(fixture.id);
  const individual = state.savedPicks.filter((pick) => !pick.trashed && !pick.deletedPermanently
    && pick.result === "pending" && String(pick.fixtureId) === fixtureId).length;
  const parlayLegs = state.savedParlays.filter((parlay) => !parlay.trashed && !parlay.deletedPermanently)
    .flatMap((parlay) => Array.isArray(parlay.legs) ? parlay.legs : [])
    .filter((leg) => leg.result === "pending" && String(leg.fixtureId) === fixtureId).length;
  return individual + parlayLegs;
}

function renderMatches() {
  elements.matchCount.textContent = `${state.fixtures.length} ${state.fixtures.length === 1 ? "partido" : "partidos"}`;
  elements.refreshFixtureStatuses.disabled = state.isRefreshingStatuses || !state.fixtures.some((fixture) => fixture.dataSource === "api-football");
  refreshSimulationPickers();

  if (!state.fixtures.length) {
    elements.matchesList.innerHTML = `<div class="empty-results">${state.hasSearched ? "No se encontraron partidos para los filtros seleccionados." : "Selecciona una liga y un rango de fechas para buscar partidos."}</div>`;
    return;
  }

  const groups = ALLOWED_LEAGUES.map((league) => ({
    league,
    fixtures: state.fixtures.filter((fixture) => fixture.leagueSlug === league.slug)
  })).filter((group) => group.fixtures.length);

  elements.matchesList.innerHTML = groups.map(({ league, fixtures }) => {
    const expanded = state.expandedMatchGroups.has(league.slug);
    return `
    <section class="league-group" aria-labelledby="league-${escapeHtml(league.slug)}">
      <header class="league-group__header">
        <h3 id="league-${escapeHtml(league.slug)}"><span class="league-code">${escapeHtml(league.code)}</span><span>${escapeHtml(league.name)} · ${escapeHtml(league.country)}</span><small>${fixtures.length} ${fixtures.length === 1 ? "encuentro" : "encuentros"}</small></h3>
        <button class="league-group__toggle" type="button" data-toggle-league="${escapeHtml(league.slug)}" aria-expanded="${expanded}" aria-controls="league-matches-${escapeHtml(league.slug)}" aria-label="${expanded ? "Ocultar" : "Mostrar"} encuentros de ${escapeHtml(league.name)}" title="${expanded ? "Ocultar encuentros" : "Mostrar encuentros"}">${expanded ? "−" : "+"}</button>
      </header>
      <div id="league-matches-${escapeHtml(league.slug)}" class="league-group__matches" ${expanded ? "" : "hidden"}>
      ${fixtures.map((fixture) => {
        const selected = state.selectedFixtureId === fixture.id;
        const activePickCount = activePickCountForFixture(fixture);
        const showScore = ["finished", "live"].includes(fixture.status) && fixture.score?.home !== null && fixture.score?.away !== null;
        const homeFavorite = Boolean(fixture.favorite && fixture.favorite.teamId === fixture.homeTeamId);
        const awayFavorite = Boolean(fixture.favorite && fixture.favorite.teamId === fixture.awayTeamId);
        const probabilities = fixture.favorite?.probabilities;
        const probabilitySummary = probabilities && [probabilities.home, probabilities.draw, probabilities.away].every((value) => value !== null)
          ? ` Local gana: ${probabilities.home}%. Empate: ${probabilities.draw}%. Visitante gana: ${probabilities.away}%.`
          : "";
        const favoriteTitle = fixture.favorite ? `${fixture.favorite.note}${probabilitySummary}` : "";
        const teamName = (name, logo, teamId, side, favorite) => {
          const savedFavorite = isFavoriteTeam(state.preferences.favoriteTeams, teamId);
          return `<div class="match-card__team${favorite ? " match-card__team--favorite" : ""}">${teamCrest(name, logo)}<div><span class="match-card__team-name"><strong>${escapeHtml(name)}</strong><button class="team-favorite-toggle${savedFavorite ? " team-favorite-toggle--active" : ""}" type="button" data-favorite-side="${side}" aria-pressed="${savedFavorite}" aria-label="${savedFavorite ? "Quitar" : "Agregar"} ${escapeHtml(name)} ${savedFavorite ? "de" : "a"} equipos favoritos" title="${savedFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}">★</button></span>${favorite ? `<span class="favorite-badge" title="${escapeHtml(favoriteTitle)}">Favorito 1X2${fixture.favorite.percent !== null ? ` · ${escapeHtml(fixture.favorite.percent)}%` : ""}</span>` : ""}</div></div>`;
        };
        const quality = fixtureQualityView(fixture);
        return `
          <article class="match-card${selected ? " match-card--selected" : ""}" data-fixture-id="${escapeHtml(fixture.id)}" tabindex="0" ${selected ? 'aria-current="true"' : ""}>
            <div class="match-card__topline">
              <span class="match-card__league">${escapeHtml(fixture.leagueName)}</span>
              <div class="match-card__status-stack">${activePickCount ? `<span class="match-active-pick">Pick Activo${activePickCount > 1 ? ` · ${activePickCount}` : ""}</span>` : ""}${statusBadge(fixture.statusLabel)}</div>
            </div>
            <div class="match-card__teams">
              ${teamName(fixture.home, fixture.homeLogo, fixture.homeTeamId, "home", homeFavorite)}
              <span class="match-card__versus">${showScore ? `<strong class="match-score">${escapeHtml(fixture.score.home)} – ${escapeHtml(fixture.score.away)}${penaltyShootoutText(fixture) ? `<small class="penalty-score">${escapeHtml(penaltyShootoutText(fixture))}</small>` : ""}</strong>` : "<strong>VS</strong>"}</span>
              ${teamName(fixture.away, fixture.awayLogo, fixture.awayTeamId, "away", awayFavorite)}
            </div>
            <div class="match-card__meta">
              <time datetime="${escapeHtml(fixture.utcDateTime || `${fixture.date}T${fixture.time}`)}">${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)} PT</time>
              <span>${escapeHtml(fixture.stadium && fixture.stadium !== "No disponible" ? fixture.stadium : "Estadio pendiente en API-Football")}</span>
              ${quality ? `<span class="data-quality data-quality--${escapeHtml(String(quality.level || "").toLowerCase())}" title="${quality.source === "evidence" ? "Calidad respaldada por evidencia prepartido guardada/importada." : "Calidad calculada con la respuesta actual de API-Football."}">Calidad ${escapeHtml(quality.level)} · ${escapeHtml(quality.score)}/100${quality.source === "evidence" ? " · evidencia" : ""}</span>` : '<span class="data-quality">Calidad pendiente · abre el encuentro</span>'}
              ${fixture.status === "live" && fixture.elapsed !== null ? `<small>${escapeHtml(fixture.elapsed)} minutos</small>` : ""}
            </div>
            <div class="match-card__actions">
              <button class="button button--secondary" type="button" data-action="season">Ver temporada</button>
              <button class="button button--primary" type="button" data-action="data">Analizar datos</button>
            </div>
          </article>`;
      }).join("")}
      </div>
    </section>
  `;
  }).join("") + `
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
  const fixture = hydrateFixtureFromEvidence(selectedFixture());
  if (!fixture) return;
  hydrateModulesFromEvidence(fixture);

  const statuses = Object.values(fixture.dataAvailability);
  const overall = statuses.some((status) => status !== "Disponible") ? "Necesita revisión" : "Disponible";
  elements.dataStatus.className = `status-badge status-badge--${statusClass(overall)}`;
  elements.dataStatus.textContent = overall;
  elements.selectedSummary.className = "selected-summary";
  const sourceLabel = fixture.dataSource === "api-football" ? "API-Football" : "escenario sintético";
  const quality = fixtureQualityView(fixture);
  const qualityLabel = quality ? ` · Calidad ${quality.level} ${quality.score}/100` : " · Calidad pendiente";
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
      <span>${escapeHtml(fixture.stadium && fixture.stadium !== "No disponible" ? fixture.stadium : "Estadio pendiente en API-Football")}${escapeHtml(venueLabel)} · ${escapeHtml(fixture.stadiumSource === "api-football-venues" ? "Catálogo de estadios API-Football" : fixture.stadiumSource === "api-football-fixture" ? "Fixture API-Football" : "Sin ubicación verificable")}</span>
      <span class="source-chip source-chip--api">${escapeHtml(sourceLabel)}</span>
      <span class="source-chip source-chip--model">${escapeHtml(cacheStatus)}${escapeHtml(cacheReason)}</span>
      ${quality ? `<span class="data-quality data-quality--${escapeHtml(String(quality.level || "").toLowerCase())}">Confianza de datos ${escapeHtml(quality.score)}/100${quality.source === "evidence" ? " · evidencia" : ""}</span>` : '<span class="data-quality">Calidad pendiente</span>'}
      <small>${quality?.source === "evidence"
        ? `Se conserva evidencia prepartido de ${formatUpdatedAt(quality.evidence?.capturedAt)}. API actual: ${displayValue(quality.currentScore, 0)}/100; no se reemplaza el snapshot por una respuesta posterior incompleta.`
        : "La cobertura prepartido puede aumentar cuando API-Football publica cuotas, alineaciones o lesiones cerca del inicio."}</small>
    </div>
    ${probabilityLine}`;
  updateAnalysisActionState();
  elements.refreshOutcome.disabled = false;
  elements.refreshPlayerGoal.disabled = false;
  elements.refreshTeamPerformance.disabled = false;
  elements.refreshCorners.disabled = false;
  elements.collectPickInfo.disabled = false;
  renderPickCollection(state.pickCollectionByFixture.get(fixture.id));
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
    elements.outcomeContent.innerHTML = '<div class="research-empty">Pulsa “Actualizar datos” para calcular local, empate y visitante; después usa Mostrar u Ocultar.</div>';
  }
  elements.outcomeContent.hidden = true;
  if (savedOutcome) { elements.showOutcome.textContent = "Mostrar"; elements.showOutcome.classList.remove("button--ready"); }
  elements.showOutcome.setAttribute("aria-expanded", "false");
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
  elements.playerGoalContent.hidden = true;
  resetModuleButton(elements.togglePlayerGoal);
  elements.showCorners.disabled = state.isLoadingCorners;
  const savedCorners = state.cornersByFixture.get(fixture.id);
  if (savedCorners) renderCorners(savedCorners);
  else { elements.cornersStatus.className = "status-badge status-badge--unavailable"; elements.cornersStatus.textContent = "No disponible"; elements.cornersContent.innerHTML = '<div class="research-empty">Pulsa “Actualizar datos” para analizar corners oficiales; después usa Mostrar u Ocultar.</div>'; }
  elements.cornersContent.hidden = true;
  if (savedCorners) { elements.showCorners.textContent = "Mostrar"; elements.showCorners.classList.remove("button--ready"); }
  elements.showCorners.setAttribute("aria-expanded", "false");
  elements.showSpecificMarkets.disabled = state.isLoadingSpecificMarkets;
  const savedSpecificMarkets = state.specificMarketsByFixture.get(fixture.id);
  if (savedSpecificMarkets) renderSpecificMarkets(savedSpecificMarkets);
  else {
    elements.specificMarketsStatus.className = "status-badge status-badge--unavailable";
    elements.specificMarketsStatus.textContent = "No disponible";
    elements.specificMarketsContent.innerHTML = '<div class="research-empty">Pulsa “Actualizar mercados” para evaluar los mercados disponibles sin inventar datos.</div>';
  }
  elements.specificMarketsContent.hidden = false;
  elements.refreshCoverage.disabled = state.isRefreshingResearch;
  elements.openOddsDetail.disabled = false;
  const evidence = evidenceFixtureSnapshot(fixture.id);
  elements.evidenceToolbar.hidden = fixture.status !== "scheduled";
  elements.savePreMatchEvidence.disabled = fixture.status !== "scheduled" || state.isCapturingEvidence;
  elements.downloadEvidenceTxt.disabled = fixture.status !== "scheduled" || !evidence;
  elements.evidenceStatus.textContent = evidence
    ? `Evidencia guardada: ${formatUpdatedAt(evidence.capturedAt)} · Lista para auditoría después del resultado final.`
    : fixture.status === "scheduled" && state.cloud.automaticEvidence && cloudSyncClient.session?.accessToken
      ? "Vigilancia automática activa: se guardará alrededor de una hora antes del inicio."
      : fixture.status === "scheduled" ? "Sin evidencia prepartido guardada." : "La evidencia solo puede guardarse antes del inicio.";
  elements.guideOddsContent.innerHTML = renderOddsDetail(fixture.confirmedData?.odds || [], fixture.researchData?.odds);
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
  const currentScore = Number(research.totalConfidenceScore ?? fixture.dataQuality?.score ?? 0);
  const quality = fixtureQualityView(fixture);
  const score = quality?.score ?? currentScore;
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
    <div class="coverage-executive__score" style="--coverage-score:${Math.max(0, Math.min(100, score))}"><strong>${escapeHtml(score)}</strong><span>${quality?.source === "evidence" ? "Evidencia / 100" : "Confianza / 100"}</span></div>
    <div class="coverage-executive__kpis"><article><span>Estado</span>${statusBadge(status)}</article><article><span>Fuentes activas</span><strong>${activeSources.length}</strong><small>${escapeHtml(activeSources.slice(0, 3).join(" · ") || "Sin fuente activa")}</small></article><article><span>Críticos disponibles</span><strong>${availableCritical.length}/${criticalKeys.length}</strong><small>${escapeHtml(availableCritical.map((key) => criticalLabels[key]).join(" · ") || "Ninguno")}</small></article><article><span>Críticos faltantes</span><strong>${criticalKeys.length - availableCritical.length}</strong><small>Revisar antes de decidir</small></article></div>
    ${quality?.source === "evidence" ? `<div class="detail-note detail-note--info"><strong>Snapshot prepartido disponible</strong><span>Calidad guardada ${escapeHtml(quality.evidenceScore)}/100 el ${escapeHtml(formatUpdatedAt(quality.evidence?.capturedAt))}. La consulta actual de API-Football marca ${escapeHtml(displayValue(currentScore, 0))}/100, pero no se descarta la evidencia histórica.</span></div>` : ""}
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
  elements.explainSelectedAnalysis.textContent = state.isAnalyzing ? "Procesando…" : "Explicar con datos";
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

  const fixture = selectedFixture();
  const quality = fixtureQualityView(fixture);
  const currentScore = Math.max(0, Math.min(100, Number(research.totalConfidenceScore) || 0));
  const score = quality?.score ?? currentScore;
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
      ${quality?.source === "evidence" ? `<p><strong>Respaldo histórico:</strong> evidencia prepartido ${escapeHtml(quality.evidenceScore)}/100 capturada ${escapeHtml(formatUpdatedAt(quality.evidence?.capturedAt))}. API actual: ${escapeHtml(displayValue(currentScore, 0))}/100.</p>` : ""}
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
  const updateMeta = moduleKey === "odds"
    ? `<div><span>Consulta del sistema</span><strong>${escapeHtml(formatUpdatedAt(module.queriedAt))}</strong></div><div><span>Actualización del proveedor</span><strong>${escapeHtml(formatUpdatedAt(module.providerUpdatedAt))}</strong></div>`
    : `<div><span>Actualización</span><strong>${escapeHtml(formatUpdatedAt(module.updatedAt))}</strong></div>`;
  return `<div class="research-detail-meta"><div><span>Estado</span>${statusBadge(researchStatusLabel(module.status))}</div><div><span>Fuente</span><strong>${escapeHtml(researchSourceLabel(moduleKey, module))}</strong></div>${updateMeta}</div>${module.message ? `<div class="detail-note"><strong>Observación</strong><span>${escapeHtml(module.message)}</span></div>` : ""}`;
}

function researchTeamStats(title, values) {
  return `<section class="team-stat-card"><h3>${escapeHtml(title)}</h3>${values.map(([label, value]) => `<div class="stat-row"><span>${escapeHtml(label)}</span><strong>${displayValue(value)}</strong></div>`).join("")}</section>`;
}

function renderH2HSuggestion(analysis, homeName, awayName) {
  const recommended = Boolean(analysis?.recommendedMarket);
  const confidenceClass = analysis?.confidence === "Alta" ? "available" : analysis?.confidence === "Media" ? "partial" : "unavailable";
  const winner = analysis?.calculationDetails?.winningCandidate;
  const general = analysis?.generalMetrics || {};
  const goalRows = [
    ["Más de 0.5", general.over05], ["Más de 1.5", general.over15], ["Más de 2.5", general.over25],
    ["Menos de 3.5", general.under35], ["Ambos anotan: Sí", general.bttsYes], ["Ambos anotan: No", general.bttsNo]
  ];
  const rejected = analysis?.rejectedCandidates || [];
  const warnings = analysis?.warnings || [];
  return `<section class="h2h-suggestion h2h-suggestion--${recommended ? confidenceClass : "unavailable"}">
    <header><div><p class="eyebrow">Análisis contextual</p><h3>Sugerencia H2H</h3></div><span class="status-badge status-badge--${confidenceClass}">${escapeHtml(recommended ? analysis.confidence : "Sin pick")}</span></header>
    <div class="h2h-suggestion__summary">
      <div><span>Pick sugerido</span><div class="h2h-suggestion__pick-line"><strong>${escapeHtml(analysis?.recommendedSelection || "Sin pick H2H recomendado")}</strong>${recommended && winner?.key ? `<button class="pick-add-icon" type="button" data-add-h2h-pick data-h2h-key="${escapeHtml(winner.key)}" data-h2h-market="${escapeHtml(analysis.recommendedMarket)}" data-h2h-selection="${escapeHtml(analysis.recommendedSelection)}" data-h2h-confidence="${escapeHtml(analysis.confidence)}" data-h2h-rate="${escapeHtml(analysis.weightedRate)}" data-h2h-explanation="${escapeHtml(analysis.explanation)}" aria-label="Agregar ${escapeHtml(analysis.recommendedSelection)} al cupón" title="Agregar al parlay">+</button>` : ""}</div><small>${recommended ? escapeHtml(analysis.recommendedMarket) : "No se fuerza una recomendación"}</small></div>
      <div><span>Confianza de la tendencia H2H</span><strong>${escapeHtml(analysis?.confidence || "Baja")}</strong><small>No es una probabilidad real de acierto</small></div>
      <div><span>Muestra utilizada</span><strong>${displayValue(analysis?.sampleSize, 0)} de ${displayValue(analysis?.totalAvailable, 0)}</strong><small>${displayValue(analysis?.comparableHomeMatches, 0)} con localías comparables</small></div>
      <div><span>Cumplimiento ponderado</span><strong>${analysis?.weightedRate === null || analysis?.weightedRate === undefined ? "—" : `${displayValue(analysis.weightedRate)}%`}</strong><small>${winner ? `Puntuación interna ${displayValue(winner.score)}/100` : "Sin candidato ganador"}</small></div>
    </div>
    <p class="h2h-suggestion__explanation">${escapeHtml(analysis?.explanation || "Sin información suficiente para evaluar la tendencia.")}</p>
    <div class="detail-note detail-note--warning"><strong>Uso responsable</strong><span>El H2H es evidencia contextual y no un pronóstico completo. No debe utilizarse solo para tomar una decisión de apuesta.</span></div>
    <details class="h2h-calculation"><summary>Ver cálculo</summary>
      <div class="h2h-calculation__counts"><span>H2H disponibles <strong>${displayValue(analysis?.totalAvailable, 0)}</strong></span><span>Utilizados <strong>${displayValue(analysis?.sampleSize, 0)}</strong></span><span>${escapeHtml(homeName)} en casa <strong>${displayValue(analysis?.comparableHomeMatches, 0)}</strong></span><span>${escapeHtml(awayName)} fuera <strong>${displayValue(analysis?.comparableAwayMatches, 0)}</strong></span></div>
      <div class="team-stat-grid">
        ${researchTeamStats(`${homeName} como local`, [["Victorias / Empates / Derrotas", `${analysis?.homeSummary?.wins ?? 0} / ${analysis?.homeSummary?.draws ?? 0} / ${analysis?.homeSummary?.losses ?? 0}`], ["Victoria simple / ponderada", `${analysis?.homeSummary?.winRatePct ?? 0}% / ${analysis?.homeSummary?.weightedWinRatePct ?? 0}%`], ["No derrota simple / ponderada", `${analysis?.homeSummary?.nonLossRatePct ?? 0}% / ${analysis?.homeSummary?.weightedNonLossRatePct ?? 0}%`], ["Goles anotados / recibidos", `${analysis?.homeSummary?.goalsFor ?? 0} / ${analysis?.homeSummary?.goalsAgainst ?? 0}`]])}
        ${researchTeamStats(`${awayName} como visitante`, [["Victorias / Empates / Derrotas", `${analysis?.awaySummary?.wins ?? 0} / ${analysis?.awaySummary?.draws ?? 0} / ${analysis?.awaySummary?.losses ?? 0}`], ["Victoria simple / ponderada", `${analysis?.awaySummary?.winRatePct ?? 0}% / ${analysis?.awaySummary?.weightedWinRatePct ?? 0}%`], ["No derrota simple / ponderada", `${analysis?.awaySummary?.nonLossRatePct ?? 0}% / ${analysis?.awaySummary?.weightedNonLossRatePct ?? 0}%`], ["Goles anotados / recibidos", `${analysis?.awaySummary?.goalsFor ?? 0} / ${analysis?.awaySummary?.goalsAgainst ?? 0}`]])}
      </div>
      <div class="h2h-goal-summary"><span>Promedio <strong>${displayValue(general.averageGoals)}</strong></span><span>Mediana <strong>${displayValue(general.medianGoals)}</strong></span><span>Mínimo <strong>${displayValue(general.minimumGoals)}</strong></span><span>Máximo <strong>${displayValue(general.maximumGoals)}</strong></span></div>
      ${detailTable(["Mercado", "Conteo", "Simple", "Ponderado"], goalRows.map(([label, metric]) => [escapeHtml(label), `${displayValue(metric?.hits, 0)}/${displayValue(analysis?.sampleSize, 0)}`, `${displayValue(metric?.simpleRatePct, 0)}%`, `${displayValue(metric?.weightedRatePct, 0)}%`]))}
      <div class="h2h-rejected"><h4>Mercados descartados</h4>${rejected.length ? `<ul>${rejected.map((candidate) => `<li><strong>${escapeHtml(candidate.selection)}</strong><span>${escapeHtml((candidate.reasons || []).join(" "))}</span></li>`).join("")}</ul>` : "<p>No hubo mercados descartados adicionales.</p>"}</div>
      ${warnings.length ? `<div class="h2h-warnings"><h4>Advertencias</h4><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
    </details>
  </section>`;
}

function h2hRecommendationLeg(dataset = {}) {
  const fixture = selectedFixture();
  const codes = {
    home_win: ["match_winner", "home_win"],
    away_win: ["match_winner", "away_win"],
    home_double_chance: ["double_chance", "1X"],
    away_double_chance: ["double_chance", "X2"],
    over05: ["total_goals", "over_0_5"],
    over15: ["total_goals", "over_1_5"],
    over25: ["total_goals", "over_2_5"],
    under35: ["total_goals", "under_3_5"],
    btts_yes: ["both_teams_to_score", "btts_yes"],
    btts_no: ["both_teams_to_score", "btts_no"]
  };
  const [marketCode, selectionCode] = codes[dataset.h2hKey] || [];
  if (!fixture || !marketCode || !selectionCode || !dataset.h2hMarket || !dataset.h2hSelection) return null;
  const weightedRate = Number(dataset.h2hRate);
  return {
    id: `${fixture.id}:h2h:${dataset.h2hKey}`,
    fixtureId: fixture.id,
    league: fixture.leagueName,
    home: fixture.home,
    away: fixture.away,
    date: fixture.date,
    market: dataset.h2hMarket,
    selection: dataset.h2hSelection,
    marketCode,
    selectionCode,
    decimalOdds: null,
    originalOdds: null,
    updatedOdds: null,
    impliedProbability: null,
    modelProbability: null,
    expectedValue: null,
    fixtureStatus: fixture.statusLabel || fixture.status,
    kickoffAt: fixture.utcDateTime || null,
    lastUpdatedAt: new Date().toISOString(),
    confidence: `Tendencia H2H ${dataset.h2hConfidence || "Media"}`,
    risk: dataset.h2hConfidence === "Alta" ? "contextual" : "review",
    reasoning: dataset.h2hExplanation || "Sugerencia contextual basada en enfrentamientos directos.",
    requiresReview: true,
    sourceModule: "h2h",
    source: "API-Football + análisis H2H determinístico",
    supportingData: Number.isFinite(weightedRate) ? [`Cumplimiento H2H ponderado: ${weightedRate}%`] : [],
    contradictingData: ["El H2H es evidencia contextual y no un pronóstico completo."]
  };
}

function addH2HRecommendationToParlay(dataset) {
  const leg = h2hRecommendationLeg(dataset);
  if (leg) appendPickToParlay(leg, "Pick H2H agregado a Mi parlay. Se guardará únicamente cuando nombres y guardes el parlay.");
}

function renderRecentFormSuggestion(analysis, homeName, awayName) {
  const recommended = Boolean(analysis?.recommendedMarket);
  const confidenceClass = analysis?.confidence === "Alta" ? "available" : analysis?.confidence === "Media" ? "partial" : "unavailable";
  const winner = analysis?.calculationDetails?.winningCandidate;
  const home = analysis?.calculationDetails?.home || {};
  const away = analysis?.calculationDetails?.away || {};
  const candidates = analysis?.calculationDetails?.candidates || [];
  const warnings = analysis?.warnings || [];
  const metricRows = (team, metrics, contextLabel) => [
    [team, "Partidos", displayValue(metrics.sampleSize, 0)],
    [team, "Victorias / Empates / Derrotas", `${displayValue(metrics.wins, 0)} / ${displayValue(metrics.draws, 0)} / ${displayValue(metrics.losses, 0)}`],
    [team, "Victoria simple / ponderada", `${displayValue(metrics.simpleWinRatePct, 0)}% / ${displayValue(metrics.weightedWinRatePct, 0)}%`],
    [team, "No derrota ponderada", `${displayValue(metrics.weightedNonLossRatePct, 0)}%`],
    [team, "Goles a favor / en contra", `${displayValue(metrics.goalsFor, 0)} / ${displayValue(metrics.goalsAgainst, 0)}`],
    [team, "Promedio ponderado GF / GC", `${displayValue(metrics.weightedGoalsFor)} / ${displayValue(metrics.weightedGoalsAgainst)}`],
    [team, "Diferencia ponderada", displayValue(metrics.weightedGoalDifference)],
    [team, contextLabel, `${displayValue(metrics.contextualMatches, 0)} partido(s) · ${displayValue(metrics.contextualWinRatePct, 0)}% victorias`],
    [team, "Porterías a cero", `${displayValue(metrics.cleanSheetRatePct, 0)}%`],
    [team, "Marca / No marca", `${displayValue(metrics.scoredRatePct, 0)}% / ${displayValue(metrics.failedToScoreRatePct, 0)}%`],
    [team, "Over 1.5 / Over 2.5", `${displayValue(metrics.over15RatePct, 0)}% / ${displayValue(metrics.over25RatePct, 0)}%`],
    [team, "Under 3.5 / BTTS", `${displayValue(metrics.under35RatePct, 0)}% / ${displayValue(metrics.bttsRatePct, 0)}%`]
  ];
  const candidateRows = candidates.map((candidate) => [
    escapeHtml(candidate.selection), `${displayValue(candidate.weightedRatePct, 0)}%`, `${displayValue(candidate.score, 0)}/100`,
    candidate.status === "Candidato" ? '<span class="status-badge status-badge--available">Candidato</span>' : '<span class="status-badge status-badge--unavailable">Descartado</span>',
    escapeHtml(candidate.reasons?.join(" ") || (candidate.status === "Candidato" ? "Supera los filtros mínimos." : "No supera los filtros mínimos."))
  ]);
  return `<section class="recent-form-suggestion recent-form-suggestion--${recommended ? confidenceClass : "unavailable"}">
    <header><div><p class="eyebrow">Análisis contextual</p><h3>Sugerencia por forma reciente</h3></div><span class="status-badge status-badge--${confidenceClass}">${escapeHtml(recommended ? analysis.confidence : "Sin pick")}</span></header>
    <div class="recent-form-suggestion__summary">
      <div><span>Pick sugerido</span><div class="h2h-suggestion__pick-line"><strong>${escapeHtml(analysis?.recommendedSelection || "Sin pick recomendado por forma reciente")}</strong>${recommended && winner?.key ? `<button class="pick-add-icon" type="button" data-add-recent-form-pick data-recent-form-key="${escapeHtml(winner.key)}" data-recent-form-market="${escapeHtml(analysis.recommendedMarket)}" data-recent-form-selection="${escapeHtml(analysis.recommendedSelection)}" data-recent-form-confidence="${escapeHtml(analysis.confidence)}" data-recent-form-rate="${escapeHtml(analysis.weightedRate)}" data-recent-form-explanation="${escapeHtml(analysis.explanation)}" aria-label="Agregar ${escapeHtml(analysis.recommendedSelection)} al cupón" title="Agregar al parlay">+</button>` : ""}</div><small>${escapeHtml(analysis?.recommendedMarket || "No se fuerza una recomendación")}</small></div>
      <div><span>Confianza de la tendencia reciente</span><strong>${escapeHtml(analysis?.confidence || "Baja")}</strong><small>No es una probabilidad real de acierto</small></div>
      <div><span>Muestra</span><strong>${escapeHtml(homeName)}: ${displayValue(analysis?.homeSampleSize, 0)} · ${escapeHtml(awayName)}: ${displayValue(analysis?.awaySampleSize, 0)}</strong><small>Calidad ${escapeHtml(analysis?.dataQuality || "Baja")}</small></div>
      <div><span>Cumplimiento ponderado</span><strong>${analysis?.weightedRate === null || analysis?.weightedRate === undefined ? "—" : `${displayValue(analysis.weightedRate)}%`}</strong><small>Recencia y localía ajustadas</small></div>
    </div>
    <p class="recent-form-suggestion__explanation">${escapeHtml(analysis?.explanation || "Sin información suficiente para evaluar la forma reciente.")}</p>
    <div class="detail-note detail-note--warning"><strong>Uso responsable</strong><span>La forma reciente es evidencia contextual. No representa por sí sola una probabilidad completa del partido y debe complementarse con disponibilidad de jugadores, alineaciones, cuotas, rendimiento colectivo y otros modelos.</span></div>
    <details class="recent-form-calculation"><summary>Ver cálculo</summary>
      ${detailTable(["Equipo", "Indicador", "Valor"], [...metricRows(homeName, home, "Rendimiento en casa"), ...metricRows(awayName, away, "Rendimiento fuera")])}
      <section class="detail-section"><h4>Comparación de candidatos</h4>${candidateRows.length ? detailTable(["Mercado", "Frecuencia", "Puntuación", "Estado", "Motivo"], candidateRows) : emptyDetail("No fue posible construir candidatos evaluables.")}</section>
      ${warnings.length ? `<div class="recent-form-warnings"><h4>Advertencias</h4><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
    </details>
  </section>`;
}

function recentFormRecommendationLeg(dataset = {}) {
  const fixture = selectedFixture();
  const codes = {
    home_win: ["match_winner", "home_win"],
    away_win: ["match_winner", "away_win"],
    home_double_chance: ["double_chance", "1X"],
    away_double_chance: ["double_chance", "X2"],
    over05: ["total_goals", "over_0_5"],
    over15: ["total_goals", "over_1_5"],
    over25: ["total_goals", "over_2_5"],
    under35: ["total_goals", "under_3_5"],
    btts_yes: ["both_teams_to_score", "btts_yes"],
    btts_no: ["both_teams_to_score", "btts_no"]
  };
  const [marketCode, selectionCode] = codes[dataset.recentFormKey] || [];
  if (!fixture || !marketCode || !selectionCode || !dataset.recentFormMarket || !dataset.recentFormSelection) return null;
  const weightedRate = Number(dataset.recentFormRate);
  return {
    id: `${fixture.id}:recent-form:${dataset.recentFormKey}`,
    fixtureId: fixture.id,
    leagueId: fixture.leagueId ?? fixture.league?.id ?? null,
    league: fixture.leagueName,
    home: fixture.home,
    away: fixture.away,
    date: fixture.date,
    market: dataset.recentFormMarket,
    selection: dataset.recentFormSelection,
    marketCode,
    selectionCode,
    decimalOdds: null,
    originalOdds: null,
    updatedOdds: null,
    impliedProbability: null,
    modelProbability: null,
    expectedValue: null,
    fixtureStatus: fixture.statusLabel || fixture.status,
    kickoffAt: fixture.utcDateTime || null,
    lastUpdatedAt: new Date().toISOString(),
    confidence: `Tendencia reciente ${dataset.recentFormConfidence || "Media"}`,
    risk: dataset.recentFormConfidence === "Alta" ? "contextual" : "review",
    reasoning: dataset.recentFormExplanation || "Sugerencia contextual basada en la forma reciente.",
    requiresReview: true,
    sourceModule: "recent_form",
    source: "API-Football + análisis determinístico de forma reciente",
    supportingData: Number.isFinite(weightedRate) ? [`Cumplimiento ponderado: ${weightedRate}%`] : [],
    missingData: ["Cuota no disponible"]
  };
}

function addRecentFormRecommendationToParlay(dataset) {
  const leg = recentFormRecommendationLeg(dataset);
  if (leg) appendPickToParlay(leg, "Pick de forma reciente agregado a Mi parlay. Se guardará únicamente cuando nombres y guardes el parlay.");
}

function renderResearchModuleDetail(moduleKey, research) {
  const module = research?.[moduleKey];
  if (!module) return emptyDetail("No existe información normalizada para este módulo.");
  let content = "";
  if (moduleKey === "standings") {
    content = `<div class="team-stat-grid">${researchTeamStats(research.homeTeam.name, [["Posición", module.home?.rank], ["Puntos", module.home?.points], ["Partidos", module.home?.played], ["Diferencia de gol", module.home?.goalDifference], ["Forma", module.home?.form]])}${researchTeamStats(research.awayTeam.name, [["Posición", module.away?.rank], ["Puntos", module.away?.points], ["Partidos", module.away?.played], ["Diferencia de gol", module.away?.goalDifference], ["Forma", module.away?.form]])}</div>`;
  } else if (moduleKey === "h2h") {
    const rows = (module.matches || []).map((match) => [displayValue(match.date), displayValue(match.homeTeam), `<strong>${displayValue(match.homeGoals)} – ${displayValue(match.awayGoals)}</strong>`, displayValue(match.awayTeam)]);
    const analysis = evaluateH2HRecommendation({ matches: module.matches || [], currentHomeTeam: research.homeTeam, currentAwayTeam: research.awayTeam, currentFixtureDate: research.dateTime, neutralVenue: research.venue?.neutral, source: module.source });
    content = `<div class="research-kpis"><span>Victorias ${escapeHtml(research.homeTeam.name)} <strong>${displayValue(module.homeWins)}</strong></span><span>Empates <strong>${displayValue(module.draws)}</strong></span><span>Victorias ${escapeHtml(research.awayTeam.name)} <strong>${displayValue(module.awayWins)}</strong></span></div>${rows.length ? detailTable(["Fecha", "Local", "Marcador", "Visitante"], rows) : emptyDetail("No hay enfrentamientos disponibles.")}${renderH2HSuggestion(analysis, research.homeTeam.name, research.awayTeam.name)}`;
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
    const modeLabel = module.oddsMode === "live" ? "Cuotas en vivo" : ["pre_match_fallback", "pre_match_league_date_fallback"].includes(module.oddsMode) ? "Última cuota prepartido disponible" : "Cuotas prepartido";
    const freshness = `<div class="detail-note ${module.isFallbackSnapshot ? "detail-note--warning" : "detail-note--info"}"><strong>${escapeHtml(modeLabel)}</strong><span>${escapeHtml(module.refreshPolicy || "")}${module.isFallbackSnapshot ? " API-Football no publicó una cuota live para este fixture; no se presenta el respaldo como dato nuevo." : ""}</span></div>`;
    content = rows.length ? `${freshness}${renderOddsMonitor(selectedFixture()?.confirmedData?.odds || [])}${summary}${legend}${detailTable(["Nivel", "Mercado", "Selección", "Cuota", "Implícita", "Modelo", "EV", "Confianza", "Explicación"], rows, rowClasses)}` : `${freshness}${emptyDetail("No hay cuotas principales verificables.")}`;
  } else if (moduleKey === "contextCalendar") {
    content = `<div class="team-stat-grid">${researchTeamStats(research.homeTeam.name, [["Días de descanso", module.homeRestDays], ["Próximos partidos", module.homeUpcomingMatches?.length || 0]])}${researchTeamStats(research.awayTeam.name, [["Días de descanso", module.awayRestDays], ["Próximos partidos", module.awayUpcomingMatches?.length || 0]])}</div>${(module.notes || []).length ? `<ul class="detail-list">${module.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}`;
  } else if (moduleKey === "statsForm") {
    const matchRows = (team, matches) => (matches || []).map((match) => [escapeHtml(team), displayValue(match.date), displayValue(match.opponent), displayValue(match.venue), `<strong>${displayValue(match.goalsFor)}–${displayValue(match.goalsAgainst)}</strong>`, displayValue(match.result)]);
    const analysis = evaluateRecentFormRecommendation({ homeMatches: module.homeLastMatches, awayMatches: module.awayLastMatches,
      homeTeamName: research.homeTeam.name, awayTeamName: research.awayTeam.name, currentFixtureDate: research.dateTime });
    content = `<div class="team-stat-grid">${researchTeamStats(research.homeTeam.name, [["Goles a favor", module.homeGoalsFor], ["Goles en contra", module.homeGoalsAgainst], ["Tasa de victoria", module.homeWinRate === null ? null : `${module.homeWinRate}%`], ["Porterías a cero", module.homeCleanSheets]])}${researchTeamStats(research.awayTeam.name, [["Goles a favor", module.awayGoalsFor], ["Goles en contra", module.awayGoalsAgainst], ["Tasa de victoria", module.awayWinRate === null ? null : `${module.awayWinRate}%`], ["Porterías a cero", module.awayCleanSheets]])}</div>${detailTable(["Equipo", "Fecha", "Rival", "Sede", "Marcador", "Resultado"], [...matchRows(research.homeTeam.name, module.homeLastMatches), ...matchRows(research.awayTeam.name, module.awayLastMatches)])}${renderRecentFormSuggestion(analysis, research.homeTeam.name, research.awayTeam.name)}`;
  } else if (moduleKey === "injuriesSuspensions") {
    const absenceRows = (team, side) => ["injuries", "suspensions", "doubts"].flatMap((kind) => (side?.[kind] || []).map((player) => [escapeHtml(team), kind === "injuries" ? "Lesión" : kind === "suspensions" ? "Sanción" : "Duda", displayValue(player.name), displayValue(player.startDate ? formatUpdatedAt(player.startDate) : null), displayValue(player.reason || player.type)]));
    const rows = [...absenceRows(research.homeTeam.name, module.home), ...absenceRows(research.awayTeam.name, module.away)];
    content = rows.length ? `<div class="detail-note"><strong>Ventana reciente</strong><span>Bajas vigentes sin duplicados, contextualizadas con los últimos ${module.sampleWindow || 5} partidos. Una fecha vacía significa que la API no publicó el inicio.</span></div>${detailTable(["Equipo", "Tipo", "Jugador", "Inicio", "Motivo"], rows)}` : emptyDetail("No se recibieron registros recientes. Esto no confirma que no existan bajas.");
  } else if (moduleKey === "lineups") {
    const playerList = (team, formation, players) => `<section class="lineup-card"><h3>${escapeHtml(team)} · ${displayValue(formation)}</h3>${players?.length ? `<ol class="player-list">${players.map((player) => `<li><span>${displayValue(player.number)}</span>${displayValue(player.name)}<small>${displayValue(player.position)}</small></li>`).join("")}</ol>` : `<p class="muted-text">Sin once inicial disponible.</p>`}</section>`;
    const homePlayers = module.homeStartingXI?.length ? module.homeStartingXI : module.probableHomeXI;
    const awayPlayers = module.awayStartingXI?.length ? module.awayStartingXI : module.probableAwayXI;
    content = `<div class="detail-note"><strong>${module.confirmed ? "Alineaciones confirmadas" : "Alineaciones probables / sin confirmación"}</strong><span>La confirmación exige once inicial oficial para ambos equipos.</span></div><div class="lineups-grid">${playerList(research.homeTeam.name, module.homeFormation, homePlayers)}${playerList(research.awayTeam.name, module.awayFormation, awayPlayers)}</div>`;
  } else if (moduleKey === "xgXga") {
    const historicalEstimated = module.type === "historical_estimated" || module.dataSource === "historical_api_estimate";
    const historicalAttempted = historicalEstimated || module.historicalAttempted === true;
    const estimated = historicalEstimated || ["estimated", "fixture_estimated"].includes(module.type);
    const xgFieldLabels = {
      totalShots: "Tiros totales",
      shotsOnGoal: "Tiros a puerta",
      shotsOffGoal: "Tiros fuera",
      shotsInsideBox: "Tiros dentro del área",
      shotsOutsideBox: "Tiros fuera del área",
      blockedShots: "Tiros bloqueados",
      cornerKicks: "Tiros de esquina",
      ballPossession: "Posesión",
      goalkeeperSaves: "Atajadas del portero",
      dangerousAttacks: "Ataques peligrosos"
    };
    const xgFieldList = (fields = []) => fields.map((field) => xgFieldLabels[field] || field).join(", ");
    const confidenceLabel = (value) => ({
      high: historicalEstimated ? "Aceptable" : "Alta",
      medium: "Media",
      low: "Baja",
      not_available: "No disponible"
    }[value] || "No disponible");
    const modeLabel = historicalEstimated ? "Estimado con partidos anteriores" : historicalAttempted ? "Histórico sin muestra útil" : estimated ? "Fixture actual" : "Oficial";
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
        ${module.missingFields?.length ? `<div class="detail-note"><strong>Datos esenciales faltantes</strong><span>${escapeHtml(xgFieldList(module.missingFields))}. La ausencia de estos campos reduce la confianza del cálculo.</span></div>` : ""}
        ${module.optionalMissingFields?.length ? `<div class="detail-note detail-note--info"><strong>Datos complementarios no proporcionados</strong><span>${escapeHtml(xgFieldList(module.optionalMissingFields))}. No bloquean el cálculo ni reducen por sí solos la muestra.</span></div>` : ""}
        ${module.notes?.length ? `<div class="detail-note"><strong>Notas de revisión</strong><span>${escapeHtml(module.notes.join(" "))}</span></div>` : ""}`
      : historicalAttempted
        ? `<div class="detail-note"><strong>API-Football no entregó una muestra histórica utilizable</strong><span>${escapeHtml(module.notes?.join(" ") || "Revisa la trazabilidad para conocer qué partidos se omitieron. No se inventaron valores.")}</span></div>`
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
    const diagnostics = historicalAttempted && module.diagnostics
      ? `<section class="detail-section"><h3>Trazabilidad de la muestra</h3>${detailTable(
        ["Equipo", "Intentados", "Usados", "Eventos fallidos", "Omitidos"],
        ["home", "away"].map((side) => {
          const item = module.diagnostics?.[side] || {};
          const skipped = (item.skippedFixtures || []).map((fixture) =>
            `${fixture.fixtureId || "Sin ID"}: ${skippedReasonLabel[fixture.reason] || fixture.reason}${fixture.errorCode && fixture.errorCode !== "UNKNOWN" ? ` (${fixture.errorCode})` : ""}`
          ).join("; ");
          return [
            escapeHtml(side === "home" ? research.homeTeam.name : research.awayTeam.name),
            displayValue(item.attemptedFixtures, 0),
            displayValue(item.usedFixtures, 0),
            displayValue(item.eventsRequestFailures, 0),
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
    const precision = module.locationPrecision === "stadium_coordinates" ? "Coordenadas del estadio"
      : module.locationPrecision === "stadium_geocoding" ? "Estadio geocodificado"
        : module.locationPrecision === "city_geocoding" ? "Zona de la ciudad (aproximada)" : "No verificada";
    const advantage = module.weatherAdvantage || {};
    const teamWeatherCard = (side, name) => researchTeamStats(name, [["Impacto estimado", advantage.favoredSide === side ? "Posible ventaja climática" : "Sin ventaja identificada"]]);
    content = `${researchTeamStats("Clima y cancha", [["Temperatura (°C)", module.temperature], ["Probabilidad de lluvia (%)", module.rainProbability], ["Viento (km/h)", module.windSpeed], ["Humedad (%)", module.humidity], ["Condición", module.condition], ["Ubicación", module.matchedLocation], ["Precisión geográfica", precision], ["Atribución de ubicación", module.locationAttribution], ["Cancha estimada", module.pitchNotes]])}<div class="team-stat-grid">${teamWeatherCard("home", research.homeTeam.name)}${teamWeatherCard("away", research.awayTeam.name)}</div><div class="detail-note"><strong>${escapeHtml(advantage.label || "Sin ventaja verificable")}</strong><span>${escapeHtml(advantage.reason || "No hay evidencia suficiente para atribuir una ventaja climática.")}</span></div>`;
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

function renderTeamSeasonStatisticsDetail(module, research, seasonCard) {
  const sampleRows = [
    ["Fuente utilizada", module.sourceLabel || "No disponible"],
    ["Motivo", module.reason || module.message],
    ["Competicion", module.competition],
    ["Temporada", module.season],
    ["Partidos utilizados", module.matchesUsed],
    ["Nivel de confianza", module.confidence],
    ["Fecha de corte", module.cutoffDate],
    ["Fecha de actualizacion", formatUpdatedAt(module.updatedAt)]
  ];
  const sampleMatches = ["home", "away"].flatMap((side) => (module.sampleMatches?.[side] || []).map((match) => [
    side === "home" ? research.homeTeam.name : research.awayTeam.name,
    match.date,
    match.competition,
    match.opponent,
    match.venue,
    `${displayValue(match.goalsFor)}-${displayValue(match.goalsAgainst)}`,
    match.result
  ]));
  return `<div class="detail-note detail-note--info"><strong>Transparencia de muestra</strong><span>${detailTable(["Campo", "Valor"], sampleRows)}</span></div>${module.warning ? `<div class="detail-note"><strong>Advertencia</strong><span>${escapeHtml(module.warning)}</span></div>` : ""}<div class="team-stat-grid">${seasonCard(research.homeTeam.name, module.home)}${seasonCard(research.awayTeam.name, module.away)}</div>${sampleMatches.length ? `<section class="detail-section"><h3>Partidos utilizados</h3>${detailTable(["Equipo", "Fecha", "Competicion", "Rival", "Sede", "Marcador", "Resultado"], sampleMatches)}</section>` : ""}`;
}

function renderSupportingDetail(moduleKey, research) {
  const module = research?.supportingData?.[moduleKey];
  if (!module) return emptyDetail("No existe información complementaria para este módulo.");
  const caution = module.analysisUse === "post_match_audit_only"
    ? '<div class="detail-note"><strong>Solo auditoría posterior</strong><span>Estos datos no se usan como evidencia para justificar una predicción prepartido.</span></div>'
    : `<div class="detail-note detail-note--info"><strong>Corte temporal protegido</strong><span>Estadísticas consultadas hasta ${displayValue(module.cutoffDate)}, antes del fixture.</span></div>`;
  let content = "";
  if (moduleKey === "fixtureEvents") {
    const rows = (module.events || []).map((event) => [`${displayValue(event.elapsed)}${event.extra ? `+${displayValue(event.extra)}` : ""}'`, displayValue(event.team), displayValue(event.player), displayValue(event.type), displayValue(event.detail)]);
    content = `<div class="research-kpis"><span>Goles <strong>${displayValue(module.summary?.goals, 0)}</strong></span><span>Tarjetas <strong>${displayValue(module.summary?.cards, 0)}</strong></span><span>Cambios <strong>${displayValue(module.summary?.substitutions, 0)}</strong></span></div><div class="live-table live-table--events">${rows.length ? detailTable(["Minuto", "Equipo", "Jugador", "Tipo", "Detalle"], rows) : emptyDetail("No hay eventos publicados para este fixture.")}</div>`;
  } else if (moduleKey === "playerPerformance") {
    const rows = (module.teams || []).flatMap((team) => (team.players || []).map((player) => [displayValue(team.team), displayValue(player.name), displayValue(player.position), displayValue(player.minutes), displayValue(player.rating), displayValue(player.shotsOnTarget), displayValue(player.goals), displayValue(player.assists), displayValue(player.keyPasses), displayValue(player.tackles)])).sort((a, b) => Number(b[4] || 0) - Number(a[4] || 0)).slice(0, 30);
    content = `<div class="live-table live-table--players">${rows.length ? detailTable(["Equipo", "Jugador", "Pos.", "Min.", "Rating", "Tiros arco", "Goles", "Asist.", "Pases clave", "Entradas"], rows) : emptyDetail("No hay rendimiento individual publicado.")}</div>`;
  } else if (moduleKey === "teamSeasonStatistics") {
    const seasonCard = (teamName, data) => researchTeamStats(teamName, [["Forma", data?.form], ["Partidos", data?.played], ["G / E / P", data ? `${displayValue(data.wins)} / ${displayValue(data.draws)} / ${displayValue(data.losses)}` : null], ["Goles a favor", data?.goalsFor], ["Goles en contra", data?.goalsAgainst], ["Promedio GF / GC", data ? `${displayValue(data.averageGoalsFor)} / ${displayValue(data.averageGoalsAgainst)}` : null], ["Porterías a cero", data?.cleanSheets], ["Sin marcar", data?.failedToScore], ["Formación más usada", data?.commonLineups?.[0]?.formation]]);
    content = renderTeamSeasonStatisticsDetail(module, research, seasonCard);
  } else if (moduleKey === "offensiveSideProduction") {
    const rows = (module.zones || []).map((zone) => [displayValue(zone.zone), `${displayValue(zone.dangerousActionsPct)}%`, `${displayValue(zone.shotsPct)}%`, `${displayValue(zone.goalsOriginPct)}%`]);
    content = `<div class="research-kpis"><span>Tendencia <strong>${escapeHtml(module.tendency || "Sin tendencia clara")}</strong></span><span>Muestra <strong>${displayValue(module.sampleSize, 0)}</strong></span><span>Confianza <strong>${escapeHtml(module.confidence || "No disponible")}</strong></span></div>${rows.length ? detailTable(["Zona", "Acciones peligrosas", "Tiros", "Goles originados"], rows) : emptyDetail("No hay ubicación de jugadas para clasificar zonas.")}<div class="detail-note detail-note--info"><strong>Regla de seguridad</strong><span>${escapeHtml(module.sourceDetail || "No se deduce el lado ofensivo por posiciones nominales ni se inventan zonas.")}</span></div>`;
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
  elements.simulationTeamASearch.value = simulationTeamDisplay({
    id: fixture.homeTeamId, name: fixture.home, leagueName: fixture.leagueName, country: fixture.country
  });
  elements.simulationTeamAId.value = fixture.homeTeamId || "";
  elements.simulationTeamAName.value = fixture.home || "";
  elements.simulationTeamBSearch.value = simulationTeamDisplay({
    id: fixture.awayTeamId, name: fixture.away, leagueName: fixture.leagueName, country: fixture.country
  });
  elements.simulationTeamBId.value = fixture.awayTeamId || "";
  elements.simulationTeamBName.value = fixture.away || "";
  elements.simulationFixtureDate.value = localDatetimeValue(fixture.utcDateTime || fixture.date);
  elements.simulationCompare.dataset.fixtureId = fixture.id || "";
  showNotice("Simulación preparada con el encuentro seleccionado.");
}

function simulationTeamDisplay(team) {
  const details = [team.leagueName, team.country].filter(Boolean).join(" · ");
  const idText = team.id ? ` · ID ${team.id}` : "";
  return `${team.name || "Equipo"}${details ? ` · ${details}` : ""}${idText}`;
}

function uniqueSimulationOptions(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function refreshSimulationPickers() {
  if (!elements.simulationTeamOptions || !elements.simulationCompetitionOptions) return;
  const leagueOptions = uniqueSimulationOptions([
    ...ALLOWED_LEAGUES.map((league) => ({
      value: `${league.name} · ${league.country}`,
      competition: league.name,
      country: league.country
    })),
    ...state.fixtures.flatMap((fixture) => [
      { value: `${fixture.leagueName || "Competición"} · ${fixture.country || "País no informado"}`, competition: fixture.leagueName || "", country: fixture.country || "" },
      fixture.country ? { value: `${fixture.country} · país`, competition: fixture.country, country: fixture.country } : null
    ]).filter(Boolean)
  ], (item) => item.value.toLowerCase());
  state.simulationCompetitionOptionByValue = new Map(leagueOptions.map((item) => [item.value, item]));
  elements.simulationCompetitionOptions.innerHTML = leagueOptions
    .map((item) => `<option value="${escapeHtml(item.value)}" label="${escapeHtml(item.competition || item.country)}"></option>`)
    .join("");

  const teams = uniqueSimulationOptions(state.fixtures.flatMap((fixture) => [
    { id: fixture.homeTeamId, name: fixture.home, leagueName: fixture.leagueName, country: fixture.country },
    { id: fixture.awayTeamId, name: fixture.away, leagueName: fixture.leagueName, country: fixture.country }
  ]), (team) => `${team.id || ""}:${String(team.name || "").toLowerCase()}`);
  const teamOptions = teams.map((team) => ({ ...team, value: simulationTeamDisplay(team) }));
  state.simulationTeamOptionByValue = new Map(teamOptions.map((item) => [item.value, item]));
  elements.simulationTeamOptions.innerHTML = teamOptions
    .map((item) => `<option value="${escapeHtml(item.value)}" label="${escapeHtml(item.name)}"></option>`)
    .join("");
}

function applySimulationTeamSelection(side) {
  const isA = side === "A";
  const search = isA ? elements.simulationTeamASearch : elements.simulationTeamBSearch;
  const idInput = isA ? elements.simulationTeamAId : elements.simulationTeamBId;
  const nameInput = isA ? elements.simulationTeamAName : elements.simulationTeamBName;
  const selected = state.simulationTeamOptionByValue.get(search.value);
  elements.simulationCompare.dataset.fixtureId = "";
  if (!selected) return;
  idInput.value = selected.id || "";
  nameInput.value = selected.name || "";
  if (!elements.simulationCompetition.value && (selected.leagueName || selected.country)) {
    elements.simulationCompetition.value = selected.leagueName || selected.country;
  }
}

function applySimulationCompetitionSelection() {
  const selected = state.simulationCompetitionOptionByValue.get(elements.simulationCompetition.value);
  if (selected?.competition) elements.simulationCompetition.value = selected.competition;
  elements.simulationCompare.dataset.fixtureId = "";
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
  const validation = result.validation || {};
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
      <article><h4>Auditoría</h4><ul><li>ID: ${escapeHtml(result.audit?.recordId || "No disponible")}</li><li>Validación: ${escapeHtml(validation.status || "No disponible")} · 1X2 ${displayValue(validation.checks?.oneXTwoSumPct)}% · matriz ${displayValue(validation.checks?.matrixProbabilitySum)}</li><li>Versión Elo: ${escapeHtml(result.audit?.versions?.elo || "")}</li><li>Versión Dixon-Coles: ${escapeHtml(result.audit?.versions?.dixonColes || "")}</li><li>Cache: ${escapeHtml(cache.status || (result.cached ? "hit" : "miss"))} · ${escapeHtml(cache.reason || "Sin detalle")}</li><li>API real usada: ${displayValue(api.networkRequests, 0)} solicitudes · hits cache ${displayValue(api.cacheHits, 0)} · misses ${displayValue(api.cacheMisses, 0)}</li><li>${escapeHtml(result.audit?.cachePolicy || "")}</li></ul></article>
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
  const analysis = evaluateH2HRecommendation({
    matches: historical,
    currentHomeTeam: { id: fixture.homeTeamId, name: fixture.home },
    currentAwayTeam: { id: fixture.awayTeamId, name: fixture.away },
    currentFixtureDate: fixture.utcDateTime || fixture.date,
    neutralVenue: fixture.neutralVenue
  });
  return `${detailTable(["Fecha", "Local", "Marcador", "Visitante", "Competición"], rows)}${renderH2HSuggestion(analysis, fixture.home, fixture.away)}`;
}

function renderInjuriesDetail(data) {
  if (!data.length) return emptyDetail("API-Football no reporta lesiones o sanciones para este fixture. Esto no confirma que no existan; solo indica que no fueron proporcionadas.");
  const rows = data.map((item) => [displayValue(item.team?.name), displayValue(item.player?.name), displayValue(item.player?.type), displayValue(item.player?.startDate || item.startDate), displayValue(item.player?.reason)]);
  return detailTable(["Equipo", "Jugador", "Tipo", "Inicio", "Motivo"], rows);
}

function renderLineupsDetail(data) {
  if (!data.length) return emptyDetail("Las alineaciones todavía no están disponibles.");
  return `<div class="lineups-grid">${data.map((lineup) => `<section class="lineup-card"><div class="team-stat-card__heading">${lineup.team?.logo ? `<img src="${escapeHtml(lineup.team.logo)}" alt="" />` : ""}<div><h3>${displayValue(lineup.team?.name)}</h3><p>Formación: ${displayValue(lineup.formation)} · DT: ${displayValue(lineup.coach?.name)}</p></div></div><h4>Titulares</h4><ol class="player-list">${(lineup.startXI || []).map((item) => `<li><span>${displayValue(item.player?.number)}</span>${displayValue(item.player?.name)} <small>${displayValue(item.player?.pos)}</small></li>`).join("")}</ol><details><summary>Ver suplentes (${(lineup.substitutes || []).length})</summary><ul class="player-list">${(lineup.substitutes || []).map((item) => `<li><span>${displayValue(item.player?.number)}</span>${displayValue(item.player?.name)} <small>${displayValue(item.player?.pos)}</small></li>`).join("")}</ul></details></section>`).join("")}</div>`;
}

function renderOddsMonitor(data) {
  const lowest = findLowestOdds(data, 2);
  return lowest.length ? `<section class="odds-monitor" aria-label="Alertas de cuotas"><header><div><p class="eyebrow">Panel de monitoreo</p><h3>Alertas de cuotas ${infoTooltip("odds")}</h3></div><span>${lowest.length} detectadas</span></header><div class="odds-monitor__grid">${lowest.map((item) => `<article><span>${escapeHtml(item.market)}</span><strong>${escapeHtml(item.selection)} · ${displayValue(item.odd)}</strong><small>${escapeHtml(item.bookmaker)}</small><p>Cuota baja: menor pago y mayor probabilidad implícita según la casa.</p></article>`).join("")}</div><p class="odds-monitor__warning">Una cuota baja no significa automáticamente que sea una buena apuesta. Solo indica que el mercado paga menos y probablemente tiene mayor probabilidad implícita según la casa.</p></section>` : "";
}

function renderNormalizedOddsDetail(module) {
  const markets = module?.markets || [];
  if (!markets.length) return "";
  const rows = markets.map((market) => [
    labelWithTooltip(market.market),
    displayValue(market.selection),
    displayValue(market.decimalOdds),
    `${displayValue(market.impliedProbabilityPct)}%`,
    market.estimatedProbabilityPct === null || market.estimatedProbabilityPct === undefined ? "No disponible" : `${displayValue(market.estimatedProbabilityPct)}%`,
    market.expectedValuePct === null || market.expectedValuePct === undefined ? "No disponible" : `${displayValue(market.expectedValuePct)}%`,
    displayValue(market.bookmaker),
    displayValue(market.method || "Cuota normalizada desde API-Football.")
  ]);
  const modeLabel = module.oddsMode === "live" ? "Cuotas en vivo"
    : ["pre_match_fallback", "pre_match_league_date_fallback"].includes(module.oddsMode) ? "Última cuota prepartido disponible"
      : "Cuotas prepartido";
  const noteClass = module.isFallbackSnapshot ? "detail-note--warning" : "detail-note--info";
  return `<div class="detail-note ${noteClass}"><strong>${escapeHtml(modeLabel)}</strong><span>${escapeHtml(module.refreshPolicy || "Cuotas normalizadas desde API-Football.")}</span></div>${detailTable(["Mercado", "Selección", "Cuota", "Implícita", "Modelo", "EV", "Casa", "Método"], rows)}`;
}

function renderOddsDetail(data, normalizedModule = null) {
  const bookmaker = data[0]?.bookmakers?.[0];
  if (!bookmaker) return renderNormalizedOddsDetail(normalizedModule) || emptyDetail("No hay cuotas publicadas para este partido.");
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
  if (categoryKey === "odds") return renderOddsDetail(data, fixture.researchData?.odds);
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
let pendingDeleteConfirmation = null;

function finishDeleteConfirmation(confirmed) {
  if (!pendingDeleteConfirmation) return;
  const resolve = pendingDeleteConfirmation;
  pendingDeleteConfirmation = null;
  if (elements.deleteConfirmationDialog?.open) elements.deleteConfirmationDialog.close();
  resolve(confirmed);
}

function confirmDeletion(message, title = "¿Deseas eliminar este elemento?") {
  if (!elements.deleteConfirmationDialog?.showModal) return Promise.resolve(window.confirm(message));
  if (pendingDeleteConfirmation) finishDeleteConfirmation(false);
  elements.deleteConfirmationTitle.textContent = title;
  elements.deleteConfirmationMessage.textContent = message;
  elements.deleteConfirmationDialog.showModal();
  return new Promise((resolve) => { pendingDeleteConfirmation = resolve; });
}

elements.deleteConfirmationCancel?.addEventListener("click", () => finishDeleteConfirmation(false));
elements.deleteConfirmationConfirm?.addEventListener("click", () => finishDeleteConfirmation(true));
elements.deleteConfirmationDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishDeleteConfirmation(false);
});

function persistParlayDraft() {
  state.preferences.parlayDraftUpdatedAt = new Date().toISOString();
  writeLocalJson(PREFERENCES_KEY, state.preferences);
  saveParlayDraft(state.parlayDraft);
  queueCloudSync();
}

function persistSavedParlays() {
  saveSavedParlays(state.savedParlays);
  queueCloudSync();
}

function persistSavedPicks() {
  saveSavedPicks(state.savedPicks);
  queueCloudSync();
}

function refreshActivePickIndicators() {
  if (state.fixtures.length) renderMatches();
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

function savedLegScoreHtml(leg) {
  if (normalizedSavedStatus(leg.fixtureStatus) === "En vivo") {
    const home = Number(leg.liveScore?.home);
    const away = Number(leg.liveScore?.away);
    if (Number.isFinite(home) && Number.isFinite(away)) {
      const elapsed = Number(leg.liveElapsed);
      return ` · <span class="live-score">En vivo ${home}-${away}${Number.isFinite(elapsed) ? ` · ${elapsed}'` : ""}</span>`;
    }
  }
  return leg.finalScore ? ` · Final ${escapeHtml(leg.finalScore)}` : "";
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
  renderOriginPerformance();
  refreshActivePickIndicators();
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

function renderParlayDraft(open = false, minimized = true) {
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
    setParlayMinimized(minimized);
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
    source: analysis._source || "rule-engine",
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
    source: analysis._source || "rule-engine"
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
  refreshActivePickIndicators();
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

function activeSavedPicks() {
  return state.savedPicks.filter((pick) => !pick.trashed && !pick.deletedPermanently);
}

function activeSavedParlays() {
  return state.savedParlays.filter((parlay) => !parlay.trashed && !parlay.deletedPermanently);
}

function updateSavedDateFilterStatus() {
  if (!elements.savedDateFilterStatus) return;
  elements.savedDateFilterStatus.textContent = state.savedDateFilter
    ? `Mostrando partidos del ${formatDate(state.savedDateFilter)}.`
    : "Mostrando todas las fechas.";
  elements.clearSavedDateFilter.textContent = state.savedDateFilter ? "Mostrar todas" : "Ocultar";
}

function renderSavedPicks() {
  const activePicks = activeSavedPicks();
  const visiblePicks = filterPicksByFixtureDate(activePicks, state.savedDateFilter);
  elements.savedParlayCount.textContent = activeSavedParlays().length + activePicks.length;
  elements.updateIndividualResults.disabled = state.savedPicks.length === 0;
  updateSavedDateFilterStatus();
  if (!visiblePicks.length) {
    const filtered = Boolean(state.savedDateFilter && activePicks.length);
    elements.savedPicksList.innerHTML = filtered
      ? '<div class="saved-empty"><h3>Sin picks en esta fecha</h3><p>Prueba otra fecha o selecciona “Mostrar todas”.</p></div>'
      : '<div class="saved-empty"><h3>Aún no hay picks individuales</h3><p>Usa “Guardar pick” desde Cuotas o desde el análisis con datos.</p><button class="button button--primary" type="button" data-view="dashboard">Ir al dashboard</button></div>';
    return;
  }
  elements.savedPicksList.innerHTML = visiblePicks.map((storedPick) => { const pick = applyAnalysisTiming(storedPick); return `<article class="saved-pick saved-pick--${escapeHtml(pick.result || "pending")}" data-pick-id="${escapeHtml(pick.id)}">
    <div><span>${escapeHtml(pick.league || "Competición")}</span><strong>${escapeHtml(pick.home)} vs ${escapeHtml(pick.away)}</strong><small>${escapeHtml(pick.date || "Fecha no disponible")} · ${escapeHtml(normalizedSavedStatus(pick.fixtureStatus))}</small></div>
    <div><span>Selección</span><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)}</small></div>
    <div class="saved-market-metrics"><span>Cuota<strong>${displayValue(pick.originalOdds ?? pick.decimalOdds)}</strong></span><span>Actualizada${oddsUpdateHtml(pick)}</span><span>Implícita<strong>${displayValue(pick.impliedProbability)}%</strong></span><span>Modelo<strong>${displayValue(pick.modelProbability ?? pick.estimatedProbability)}%</strong></span><span>EV<strong>${displayValue(pick.expectedValue)}%</strong></span></div>
    <div><span>Resultado</span><strong class="result-badge result-badge--${escapeHtml(pick.result || "pending")}">${escapeHtml(resultLabels[pick.result] || "Pendiente")}</strong><label class="saved-pick__result-control">Modificar resultado<select data-pick-result><option value="pending" ${pick.result === "pending" ? "selected" : ""}>Pendiente</option><option value="won" ${pick.result === "won" ? "selected" : ""}>Ganado</option><option value="lost" ${pick.result === "lost" ? "selected" : ""}>Perdido</option><option value="void" ${pick.result === "void" ? "selected" : ""}>Anulado</option></select></label><small>Confianza: ${pick.effectiveConfidenceScore === null ? escapeHtml(pick.confidence || "No disponible") : `${escapeHtml(pick.effectiveConfidenceScore)}% efectiva`} · Origen: ${escapeHtml(pickOriginLabel(pick.sourceModule))} ${infoTooltip("pick_origin")}</small><small class="timing-label">${escapeHtml(pick.analysisTiming.label)}</small>${pick.finalScore ? `<small>Marcador final: ${escapeHtml(pick.finalScore)}</small>` : ""}${pick.analysisTiming.warning ? `<small class="timing-warning">${escapeHtml(pick.analysisTiming.warning)}</small>` : ""}${pick.oddsMovement.changed ? `<small class="timing-warning">${escapeHtml(pick.oddsMovement.warning)}</small>` : ""}</div>
    <button class="button button--danger button--compact" type="button" data-delete-pick>Eliminar</button>
  </article>`; }).join("");
}

function currentPerformanceRankings() {
  const rankings = {};
  const originRows = calculateOriginPerformance(state.savedPicks, state.savedParlays);
  for (const result of ["won", "lost"]) {
    const sorted = originRows.filter((row) => row[result] > 0).sort((a, b) => {
      const rateA = result === "won" ? a.winRate : a.lost / a.evaluated * 100;
      const rateB = result === "won" ? b.winRate : b.lost / b.evaluated * 100;
      return rateB - rateA || b.evaluated - a.evaluated;
    });
    sorted.forEach((row, index) => { rankings[`origin:${result}:${row.origin}`] = index + 1; });
  }
  calculateCompetitionPerformance(state.savedPicks, state.savedParlays)
    .forEach((row, index) => { rankings[`competition:${row.key}`] = index + 1; });
  return rankings;
}

function rankingMovementHtml(key, currentPosition) {
  const previous = Number(state.preferences.performancePreviousRanks?.[key]);
  if (!Number.isFinite(previous) || previous === currentPosition) return '<small class="rank-movement rank-movement--same">—</small>';
  const delta = previous - currentPosition;
  return `<small class="rank-movement rank-movement--${delta > 0 ? "up" : "down"}">${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}</small>`;
}

function showOriginPicksDialog(origin, result) {
  const row = calculateOriginPerformance(state.savedPicks, state.savedParlays).find((item) => item.origin === origin);
  if (!row || !elements.originPicksDialog) return;
  const isWon = result === "won";
  const picks = row[isWon ? "wonPicks" : "lostPicks"] || [];
  const categories = row[isWon ? "wonCategories" : "lostCategories"] || [];
  elements.originPicksTitle.textContent = pickOriginLabel(origin);
  elements.originPicksSubtitle.textContent = `${isWon ? "Picks ganados" : "Picks perdidos"} · ${picks.length} evaluados`;
  elements.originPicksContent.innerHTML = `<div class="origin-category-list">${categories.map((item) => `<span><strong>${escapeHtml(item.category)}</strong>${item.count} ${item.count === 1 ? "pick" : "picks"}</span>`).join("")}</div><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Clasificación</th><th>Pick</th><th>Partido</th><th>Liga</th><th>Cuota</th></tr></thead><tbody>${picks.map((pick) => `<tr><td>${escapeHtml(pick.category)}</td><td><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)}</small></td><td>${escapeHtml(pick.match || "No disponible")}</td><td>${escapeHtml(pick.league)}</td><td>${displayValue(pick.odds)}</td></tr>`).join("")}</tbody></table></div>`;
  if (!elements.originPicksDialog.open) elements.originPicksDialog.showModal();
}

function renderOriginPerformance() {
  if (!elements.originPerformance || !elements.originLostPerformance || !elements.originRecommendations || !elements.competitionPerformance) return;
  const rows = calculateOriginPerformance(state.savedPicks, state.savedParlays);
  const competitionRows = calculateCompetitionPerformance(state.savedPicks, state.savedParlays);
  const pickTypeRows = calculateParlayPickTypePerformance(state.savedParlays);
  const noStoredPicks = state.savedPicks.length === 0 && state.savedParlays.length === 0;
  [elements.updateOriginResults, elements.updateOriginLostResults, elements.updateOriginRecommendations, elements.updateCompetitionResults].forEach((button) => { button.disabled = noStoredPicks; });
  elements.competitionPerformance.innerHTML = competitionRows.length
    ? `<header><div><span>Balance por torneo</span><h3>Resultados por competición</h3></div><small>Ordenado de mayor a menor porcentaje de acierto.</small></header><div class="origin-performance__table-wrap"><table class="origin-performance__table"><thead><tr><th>Posición</th><th>Competición</th><th>Individuales</th><th>En parlays</th><th>Ganados</th><th>Perdidos</th><th>Evaluados</th><th>Acierto</th></tr></thead><tbody>${competitionRows.map((row, index) => `<tr><td data-label="Posición"><strong>#${index + 1}</strong>${rankingMovementHtml(`competition:${row.key}`, index + 1)}</td><td data-label="Competición"><div class="competition-result-name"><strong>${escapeHtml(row.competition)}</strong>${row.active ? '<span class="active-pick-badge">Pick Activo</span>' : ""}</div></td><td data-label="Individuales">${row.individual}</td><td data-label="En parlays">${row.parlayLegs}</td><td data-label="Ganados" class="value-positive">${row.won}</td><td data-label="Perdidos" class="value-negative">${row.lost}</td><td data-label="Evaluados">${row.evaluated}</td><td data-label="Acierto"><strong>${row.winRate === null ? "—" : `${displayValue(row.winRate)}%`}</strong></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="saved-empty"><h3>Sin resultados por competición</h3><p>El conteo aparecerá cuando existan picks concluidos como ganados o perdidos.</p></div>';
  const renderPickTypes = (result) => {
    const filtered = pickTypeRows.filter((row) => row[result] > 0)
      .sort((a, b) => b[result] - a[result] || a.type.localeCompare(b.type, "es"));
    if (!filtered.length) return `<div class="saved-empty"><h3>Sin tipos ${result === "won" ? "ganados" : "perdidos"}</h3><p>El conteo aparecerá cuando se liquiden selecciones dentro de parlays.</p></div>`;
    return filtered.map((row) => `<article class="pick-type-summary__item pick-type-summary__item--${result}"><span>${escapeHtml(row.type)}</span><strong>${row[result]}</strong></article>`).join("");
  };
  elements.pickTypesWon.innerHTML = renderPickTypes("won");
  elements.pickTypesLost.innerHTML = renderPickTypes("lost");
  if (!rows.length) {
    elements.originPerformance.innerHTML = '<div class="saved-empty"><h3>Resultados por origen Ganados</h3><p>El conteo aparecerá cuando existan picks concluidos como ganados.</p></div>';
    elements.originLostPerformance.innerHTML = '<div class="saved-empty"><h3>Resultados por origen Perdidos</h3><p>El conteo aparecerá cuando existan picks concluidos como perdidos.</p></div>';
    elements.originRecommendations.innerHTML = '<div class="saved-empty"><h3>Sin muestra evaluada</h3><p>Se necesitan picks ganados o perdidos para comparar resultados por selección y origen.</p></div>';
    return;
  }

  const renderResult = (result) => {
    const isWon = result === "won";
    const countKey = isWon ? "won" : "lost";
    const picksKey = isWon ? "wonPicks" : "lostPicks";
    const categoriesKey = isWon ? "wonCategories" : "lostCategories";
    const filteredRows = rows.filter((row) => row[countKey] > 0).sort((a, b) => {
      const rateA = isWon ? a.winRate : a.lost / a.evaluated * 100;
      const rateB = isWon ? b.winRate : b.lost / b.evaluated * 100;
      return rateB - rateA || b.evaluated - a.evaluated;
    });
    const title = isWon ? "Resultados por origen Ganados" : "Resultados por origen Perdidos";
    const rateLabel = isWon ? "Acierto" : "Tasa de pérdida";
    if (!filteredRows.length) return `<div class="saved-empty"><h3>${title}</h3><p>Todavía no hay picks ${isWon ? "ganados" : "perdidos"} para mostrar.</p></div>`;
    return `<header><div><span>Seguimiento automático</span><h3>${title}</h3></div><small>Ordenado de mayor a menor porcentaje.</small></header><div class="origin-performance__table-wrap"><table class="origin-performance__table"><thead><tr><th>Posición</th><th>Origen</th><th>Individuales</th><th>En parlays</th><th>${isWon ? "Ganados" : "Perdidos"}</th><th>Evaluados</th><th>${rateLabel}</th><th>Detalle</th></tr></thead><tbody>${filteredRows.map((row, index) => { const rate = isWon ? row.winRate : Number((row.lost / row.evaluated * 100).toFixed(1)); return `<tr><td data-label="Posición"><strong>#${index + 1}</strong>${rankingMovementHtml(`origin:${result}:${row.origin}`, index + 1)}</td><td data-label="Origen"><strong>${escapeHtml(pickOriginLabel(row.origin))}</strong></td><td data-label="Individuales">${row.individual}</td><td data-label="En parlays">${row.parlayLegs}</td><td data-label="${isWon ? "Ganados" : "Perdidos"}" class="${isWon ? "value-positive" : "value-negative"}">${row[countKey]}</td><td data-label="Evaluados">${row.evaluated}</td><td data-label="${rateLabel}"><strong>${displayValue(rate)}%</strong></td><td data-label="Detalle"><button class="button button--secondary button--compact" type="button" data-view-origin-picks="${escapeHtml(row.origin)}" data-origin-result="${result}">Ver picks ${isWon ? "ganados" : "perdidos"}</button></td></tr>`; }).join("")}</tbody></table></div>`;
  };

  elements.originPerformance.innerHTML = renderResult("won");
  elements.originLostPerformance.innerHTML = renderResult("lost");

  const recommendations = calculateOriginRecommendations(rows);
  const recommendationCards = (items, type) => items.map((item) => `<article class="origin-recommendation origin-recommendation--${type}"><span>${type === "recommended" ? "Mejor desempeño" : type === "avoid" ? "No recomendado" : "Muestra en observación"}</span><h4>${escapeHtml(item.category)}</h4><p><strong>Origen:</strong> ${escapeHtml(pickOriginLabel(item.origin))}</p><div><b>${item.won} ganados</b><b>${item.lost} perdidos</b><b>${displayValue(item.winRate)}% acierto</b></div><small>${type === "recommended" ? "Historial favorable con al menos 3 picks evaluados." : type === "avoid" ? "Balance desfavorable con al menos 3 picks evaluados." : "Aún no existe volumen o diferencia suficiente para recomendar o descartar."}</small></article>`).join("");
  elements.originRecommendations.innerHTML = `<div class="origin-recommendations__notice"><strong>Lectura responsable</strong><span>Esta clasificación resume resultados pasados; no modifica fórmulas ni garantiza el siguiente pick.</span></div><div class="origin-recommendations__columns"><section><header><h3>Mejores picks</h3><span>${recommendations.recommended.length}</span></header>${recommendationCards(recommendations.recommended, "recommended") || '<p class="muted-text">Todavía no hay picks con al menos 3 evaluados y 60% de acierto.</p>'}</section><section><header><h3>No recomendados</h3><span>${recommendations.notRecommended.length}</span></header>${recommendationCards(recommendations.notRecommended, "avoid") || '<p class="muted-text">No hay picks con balance claramente desfavorable.</p>'}</section></div>${recommendations.observing.length ? `<section class="origin-recommendations__observing"><header><h3>En observación</h3><span>${recommendations.observing.length}</span></header><div>${recommendationCards(recommendations.observing, "observing")}</div></section>` : ""}`;
}

function renderSavedParlays() {
  const allActiveParlays = activeSavedParlays();
  const activeParlays = filterParlaysByFixtureDate(allActiveParlays, state.savedDateFilter);
  const metrics = calculateHistoryMetrics(activeParlays);
  const legCounts = calculateParlayLegCounts(activeParlays);
  elements.savedParlayCount.textContent = allActiveParlays.length + activeSavedPicks().length;
  updateSavedDateFilterStatus();
  elements.historyMetrics.innerHTML = `
    <article><span>Parlays</span><strong>${metrics.total}</strong></article>
    <article><span>Evaluados</span><strong>${metrics.settled}</strong></article>
    <article><span>Ganados / perdidos</span><strong>${metrics.won} / ${metrics.lost}</strong></article>
    <article><span>Picks ganados</span><strong class="value-positive">${legCounts.won}</strong></article>
    <article><span>Picks perdidos</span><strong class="value-negative">${legCounts.lost}</strong></article>
    <article><span>Acierto</span><strong>${metrics.winRate === null ? "—" : `${metrics.winRate}%`}</strong></article>
    <article><span>Unidades teóricas</span><strong class="${metrics.theoreticalUnits >= 0 ? "value-positive" : "value-negative"}">${metrics.theoreticalUnits}</strong></article>`;
  renderOriginPerformance();
  elements.updateParlayResults.disabled = state.savedParlays.length === 0 && state.savedPicks.length === 0;
  if (!activeParlays.length) {
    elements.savedParlaysList.innerHTML = state.savedDateFilter && allActiveParlays.length
      ? '<div class="saved-empty"><h3>Sin parlays en esta fecha</h3><p>Prueba otra fecha o selecciona “Mostrar todas”.</p></div>'
      : '<div class="saved-empty"><h3>Aún no hay parlays guardados</h3><p>Agrega dos o más mercados desde un análisis con datos y guarda el cupón para comenzar el seguimiento.</p><button class="button button--primary" type="button" data-view="dashboard">Ir al dashboard</button></div>';
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
          <div class="saved-leg__content"><strong>${escapeHtml(leg.selection)}</strong><span>${escapeHtml(leg.market)}</span><small>${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)} · ${escapeHtml(leg.date)} · ${escapeHtml(normalizedSavedStatus(leg.fixtureStatus))}${savedLegScoreHtml(leg)}</small><small>Cuota ${displayValue(leg.originalOdds ?? leg.decimalOdds)} · Actualizada ${leg.updatedOdds ?? "Sin actualización"} · Implícita ${displayValue(leg.impliedProbability)}% · Modelo ${displayValue(leg.modelProbability ?? leg.estimatedProbability)}% · EV ${displayValue(leg.expectedValue)}%</small><small>Confianza efectiva: ${leg.effectiveConfidenceScore === null ? escapeHtml(leg.confidence) : `${escapeHtml(leg.effectiveConfidenceScore)}%`} · ${escapeHtml(leg.analysisTiming.label)} · Origen ${escapeHtml(pickOriginLabel(leg.sourceModule))} ${infoTooltip("pick_origin")}</small>${leg.analysisTiming.warning ? `<small class="timing-warning">${escapeHtml(leg.analysisTiming.warning)}</small>` : ""}${leg.oddsMovement.changed ? `<small class="timing-warning">${escapeHtml(leg.oddsMovement.warning)}</small>` : ""}</div>
          <div class="saved-leg__controls"><label>Resultado<select data-leg-result><option value="pending" ${leg.result === "pending" ? "selected" : ""}>Pendiente</option><option value="won" ${leg.result === "won" ? "selected" : ""}>Ganada</option><option value="lost" ${leg.result === "lost" ? "selected" : ""}>Perdida</option><option value="void" ${leg.result === "void" ? "selected" : ""}>Anulada</option></select></label><div><button class="button button--secondary button--compact" type="button" data-save-parlay-leg>Guardar</button><button class="button button--danger button--compact" type="button" data-remove-parlay-leg aria-label="Quitar ${escapeHtml(leg.selection)} del parlay">Quitar</button></div></div>
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
  const trashed = state.savedParlays.filter((parlay) => parlay.trashed && !parlay.deletedPermanently);
  const removedPicks = state.savedParlays.flatMap((parlay) => (parlay.removedLegs || [])
    .filter((leg) => !leg.deletedPermanently)
    .map((leg) => ({ parlay, leg })));
  if (!trashed.length && !removedPicks.length) {
    elements.trashParlaysList.innerHTML = '<div class="saved-empty"><h3>La Papelera está vacía.</h3><p>Los parlays y picks retirados podrán recuperarse desde aquí.</p></div>';
    return;
  }
  const parlayRows = trashed.map((parlay) => {
    const originalTotal = parlayTotalOdds(parlay.legs, "originalOdds");
    const updatedTotal = parlayTotalOdds(parlay.legs, "updatedOdds");
    return `<article class="trash-parlay" data-trash-parlay-id="${escapeHtml(parlay.id)}"><header><div><span>Papelera · ${parlay.legs.length} selecciones</span><h3>${escapeHtml(parlay.name)}</h3><small>Creado ${escapeHtml(formatUpdatedAt(parlay.createdAt))} · Eliminado ${escapeHtml(formatUpdatedAt(parlay.deletedAt))}</small></div><div><strong>Cuota ${displayValue(originalTotal)}</strong><small>Actualizada ${displayValue(updatedTotal)}</small></div></header><details><summary>Ver detalles</summary><div class="trash-parlay__legs">${parlay.legs.map((leg) => `<div><strong>${escapeHtml(leg.selection)}</strong><span>${escapeHtml(leg.market)} · ${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)}</span><small>${escapeHtml(normalizedSavedStatus(leg.fixtureStatus))} · ${escapeHtml(resultLabels[leg.result] || "Pendiente")}</small></div>`).join("")}</div></details><footer><button class="button button--primary button--compact" type="button" data-restore-parlay>Recuperar</button><button class="button button--danger button--compact" type="button" data-delete-parlay-forever>Eliminar definitivamente</button></footer></article>`;
  }).join("");
  const removedRows = removedPicks.map(({ parlay, leg }) => `<article class="trash-parlay trash-pick" data-removed-parlay-id="${escapeHtml(parlay.id)}" data-removed-leg-id="${escapeHtml(leg.id)}"><header><div><span>Pick retirado · ${escapeHtml(parlay.name)}</span><h3>${escapeHtml(leg.selection)}</h3><small>${escapeHtml(leg.market)} · ${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)}</small></div><div><strong>${escapeHtml(resultLabels[leg.result] || "Pendiente")}</strong><small>Retirado ${escapeHtml(formatUpdatedAt(leg.removedFromParlayAt))}</small></div></header><footer><button class="button button--primary button--compact" type="button" data-restore-removed-leg>Recuperar pick</button><button class="button button--danger button--compact" type="button" data-delete-removed-leg-forever>Eliminar definitivamente</button></footer></article>`).join("");
  elements.trashParlaysList.innerHTML = `${removedRows ? `<div class="trash-section-heading"><h3>Picks retirados</h3><span>${removedPicks.length}</span></div>${removedRows}` : ""}${parlayRows ? `<div class="trash-section-heading"><h3>Parlays eliminados</h3><span>${trashed.length}</span></div>${parlayRows}` : ""}`;
}

async function updateSavedParlayResults() {
  const allSavedLegs = [...state.savedPicks, ...state.savedParlays.flatMap((parlay) => parlay.legs || [])];
  const legsToUpdate = allSavedLegs.filter((leg) => needsSettlementRefresh(leg));
  const fixtureIds = [...new Set(legsToUpdate.map((leg) => leg.fixtureId))];
  if (!fixtureIds.length) {
    showNotice("No hay picks pendientes. Los resultados resueltos compatibles ya fueron verificados con el marcador reglamentario.");
    return;
  }
  state.preferences.performancePreviousRanks = currentPerformanceRankings();
  writeLocalJson(PREFERENCES_KEY, state.preferences);
  const updateButtons = [elements.updateIndividualResults, elements.updateOriginResults, elements.updateOriginLostResults, elements.updateOriginRecommendations, elements.updateCompetitionResults, elements.updateParlayResults];
  updateButtons.forEach((button) => { button.disabled = true; button.textContent = "Consultando resultados…"; });
  try {
    const fixtureIdsNeedingDetails = new Set(legsToUpdate
      .filter((leg) => leg.result === "pending" || /corners/.test(resolveSelectionCode(leg) || ""))
      .map((leg) => String(leg.fixtureId)));
    const updates = await Promise.all(fixtureIds.map(async (fixtureId) => {
      const fixture = { id: fixtureId };
      const [result, details] = await Promise.all([
        footballDataService.getFixtureResult(fixtureId).catch(() => null),
        fixtureIdsNeedingDetails.has(String(fixtureId))
          ? footballDataService.getFixtureData(fixture, true).catch(() => null)
          : Promise.resolve(null)
      ]);
      return { fixtureId: String(fixtureId), result, details };
    }));
    const byFixture = new Map(updates.map((item) => [item.fixtureId, item]));
    let updated = 0;
    let verified = 0;
    let unverifiable = 0;
    const fixtureCorners = (details, fixtureResult) => {
      const rows = details?.confirmedData?.statistics || [];
      const read = (row) => {
        const raw = row?.statistics?.find((stat) => String(stat.type || "").toLowerCase() === "corner kicks")?.value;
        if (raw === null || raw === undefined || raw === "") return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      };
      const homeRow = rows.find((row) => row.team?.name === fixtureResult?.home) || rows[0];
      const awayRow = rows.find((row) => row.team?.name === fixtureResult?.away) || rows[1];
      return { home: read(homeRow), away: read(awayRow) };
    };
    const updateLeg = (leg) => {
      if (!needsSettlementRefresh(leg)) return;
      const update = byFixture.get(String(leg.fixtureId));
      if (!update) return;
      const fixtureResult = update.result;
      const selectionCode = resolveSelectionCode(leg);
      if (selectionCode && !leg.selectionCode) leg.selectionCode = selectionCode;
      leg.originalOdds ??= leg.decimalOdds ?? null;
      leg.fixtureStatus = fixtureResult?.statusLabel || update.details?.statusLabel || fixtureResult?.appStatus || leg.fixtureStatus;
      if (normalizedSavedStatus(leg.fixtureStatus) === "En vivo") {
        const home = Number(fixtureResult?.goals?.home);
        const away = Number(fixtureResult?.goals?.away);
        if (Number.isFinite(home) && Number.isFinite(away)) leg.liveScore = { home, away };
        if (Number.isFinite(Number(fixtureResult?.elapsed))) leg.liveElapsed = Number(fixtureResult.elapsed);
      }
      const currentMarket = [...(update.details?.marketAnalysis || []), ...(update.details?.researchData?.odds?.markets || [])]
        .find((market) => market.selectionKey === selectionCode && (!leg.marketCode || market.marketKey === leg.marketCode));
      const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
      if (hasNumber(currentMarket?.decimalOdds)) leg.updatedOdds = Number(currentMarket.decimalOdds);
      if (hasNumber(currentMarket?.impliedProbabilityPct)) leg.impliedProbability = Number(currentMarket.impliedProbabilityPct);
      if (hasNumber(currentMarket?.estimatedProbabilityPct)) leg.modelProbability = Number(currentMarket.estimatedProbabilityPct);
      if (hasNumber(currentMarket?.expectedValuePct)) leg.expectedValue = Number(currentMarket.expectedValuePct);
      leg.lastUpdatedAt = new Date().toISOString();
      leg.updatedAt = leg.lastUpdatedAt;
      Object.assign(leg, applyAnalysisTiming(leg));
      const detailCorners = fixtureCorners(update.details, fixtureResult);
      const resultCorners = fixtureResult?.corners || {};
      const corners = {
        home: resultCorners.home ?? detailCorners.home,
        away: resultCorners.away ?? detailCorners.away
      };
      const nextResult = settlePickResult(leg, { ...fixtureResult, corners });
      if (nextResult !== "pending") {
        const regulation = fixtureResult?.regulationGoals || fixtureResult?.fulltimeScore || fixtureResult?.goals;
        const changed = leg.result !== nextResult;
        leg.result = nextResult;
        leg.resultSource = "api-football";
        leg.settlementVerificationVersion = SETTLEMENT_VERIFICATION_VERSION;
        leg.settlementVerificationStatus = "verified";
        leg.settlementVerifiedAt = new Date().toISOString();
        if (regulation?.home !== null && regulation?.home !== undefined && regulation?.away !== null && regulation?.away !== undefined) {
          leg.finalScore = `${regulation.home}-${regulation.away}`;
        }
        leg.resolvedAt = new Date().toISOString();
        delete leg.liveScore;
        delete leg.liveElapsed;
        if (changed) updated += 1;
        verified += 1;
      } else if (leg.result !== "pending") {
        // Mantiene el resultado histórico cuando la API no permite comprobarlo y evita consultas repetidas.
        leg.settlementVerificationVersion = SETTLEMENT_VERIFICATION_VERSION;
        leg.settlementVerificationStatus = fixtureResult
          ? (fixtureResult.finished ? "missing_settlement_data" : "fixture_not_final")
          : "api_unavailable";
        leg.settlementVerifiedAt = new Date().toISOString();
        unverifiable += 1;
      }
    };
    state.savedPicks.forEach(updateLeg);
    state.savedParlays.forEach((parlay) => {
      parlay.legs.forEach(updateLeg);
      parlay.result = calculateParlayResult(parlay.legs);
      parlay.lastCheckedAt = new Date().toISOString();
      parlay.updatedAt = parlay.lastCheckedAt;
    });
    persistSavedParlays();
    persistSavedPicks();
    renderSavedPicks();
    renderSavedParlays();
    refreshActivePickIndicators();
    const summary = [];
    if (updated) summary.push(`${updated} resultado(s) corregidos`);
    if (verified) summary.push(`${verified} verificados a 90 minutos`);
    if (unverifiable) summary.push(`${unverifiable} conservados sin datos suficientes para verificarlos`);
    showNotice(summary.length ? `${summary.join(" · ")}.` : "Los picks pendientes todavía no tienen un resultado final evaluable.");
  } finally {
    elements.updateIndividualResults.disabled = state.savedPicks.length === 0;
    elements.updateOriginResults.disabled = state.savedParlays.length === 0 && state.savedPicks.length === 0;
    elements.updateOriginLostResults.disabled = state.savedParlays.length === 0 && state.savedPicks.length === 0;
    elements.updateOriginRecommendations.disabled = state.savedParlays.length === 0 && state.savedPicks.length === 0;
    elements.updateCompetitionResults.disabled = state.savedParlays.length === 0 && state.savedPicks.length === 0;
    elements.updateParlayResults.disabled = state.savedParlays.length === 0;
    updateButtons.forEach((button) => { button.textContent = "Actualizar datos"; });
  }
}

const sidebar = document.querySelector("#app-sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarClose = document.querySelector("#sidebar-close");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");

function setSidebarOpen(open, { restoreFocus = false } = {}) {
  sidebar.classList.toggle("sidebar-open", open);
  sidebarBackdrop.hidden = !open;
  sidebarToggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("sidebar-open", open);
  if (open) sidebar.querySelector(".main-nav__item--active")?.focus();
  else if (restoreFocus) sidebarToggle.focus();
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
  if (view === "favorite-teams") renderFavoriteTeams();
  if (view === "audit") { renderAuditFixtureOptions(); void loadEvidenceLibrary(); }
  if (view === "simulation") refreshSimulationPickers();
  if (view === "markets") {
    const fixture = selectedFixture();
    elements.showSpecificMarkets.disabled = !fixture || state.isLoadingSpecificMarkets;
    if (fixture && state.specificMarketsByFixture.has(fixture.id)) renderSpecificMarkets(state.specificMarketsByFixture.get(fixture.id));
  }
  if (view === "pick-collection") {
    elements.collectPickInfo.disabled = !selectedFixture() || state.isCollectingPickInfo;
    renderPickCollection(state.pickCollectionByFixture.get(selectedFixture()?.id));
  }
  if (window.matchMedia("(max-width: 980px)").matches) setSidebarOpen(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const PICK_COLLECTION_MODEL_VERSION = "pick-analysis-snapshot-v1";

function persistPickCollectionCache() {
  writeLocalJson(PICK_COLLECTION_CACHE_KEY, Object.fromEntries(state.pickCollectionByFixture.entries()));
}

function collectionStatusClass(status) {
  if (status === "valid") return "available";
  if (status === "contradictory" || status === "insufficient") return "partial";
  return "unavailable";
}

function collectionModule({ name, result = "No disponible", probability = null, sampleSize = null, source = "Sistema", quality = "not_available", confidence = "No disponible", warnings = [], status = "not_available", updatedAt = new Date().toISOString() }) {
  return { name, result, probability, sampleSize, source, quality, confidence, warnings: warnings.filter(Boolean), status, updatedAt };
}

function collectionPickFromMarket(fixture, pick, sourceModule, sourceLabel, backingModels = []) {
  if (!pick?.selection || !pick?.market) return null;
  const decimalOdds = Number(pick.decimalOdds ?? pick.odds);
  const modelProbability = Number(pick.modelProbabilityPct ?? pick.probabilityPct ?? pick.confidenceScore ?? pick.goalThreatScore);
  const fairOdds = modelProbability > 0 ? Number((100 / modelProbability).toFixed(2)) : null;
  const expectedValue = Number.isFinite(Number(pick.expectedValuePct)) ? Number(pick.expectedValuePct) : (Number.isFinite(decimalOdds) && modelProbability > 0 ? Number(((decimalOdds * modelProbability) - 100).toFixed(1)) : null);
  const confidenceScore = Number(pick.confidenceScore ?? pick.goalThreatScore ?? modelProbability ?? 0);
  const hasValue = expectedValue === null || expectedValue >= 0;
  const isActionable = confidenceScore >= 45 && hasValue && !String(pick.decision || pick.level || "").toLowerCase().includes("evitar");
  if (!isActionable) return null;
  return {
    id: `${fixture.id}:collection:${sourceModule}:${pick.selectionKey || pick.playerId || pick.selection}`,
    fixtureId: fixture.id,
    league: fixture.leagueName,
    home: fixture.home,
    away: fixture.away,
    date: fixture.date,
    market: pick.market,
    selection: pick.selection,
    marketCode: pick.marketKey || sourceModule,
    selectionCode: pick.selectionKey || pick.playerId || pick.selection,
    decimalOdds: Number.isFinite(decimalOdds) ? decimalOdds : null,
    originalOdds: Number.isFinite(decimalOdds) ? decimalOdds : null,
    updatedOdds: null,
    impliedProbability: Number.isFinite(decimalOdds) && decimalOdds > 0 ? Number((100 / decimalOdds).toFixed(1)) : null,
    modelProbability: Number.isFinite(modelProbability) ? Number(modelProbability.toFixed(1)) : null,
    estimatedProbability: Number.isFinite(modelProbability) ? Number(modelProbability.toFixed(1)) : null,
    fairOdds,
    expectedValue,
    fixtureStatus: fixture.statusLabel || fixture.status,
    kickoffAt: fixture.utcDateTime || null,
    lastUpdatedAt: new Date().toISOString(),
    confidence: pick.confidence || `${confidenceScore}/100`,
    confidenceScore,
    risk: pick.risk || pick.level || pick.decision || (confidenceScore >= 70 ? "Medio" : "Revisión"),
    reasoning: pick.explanation || pick.reasoning || (pick.supportingData || []).join("; ") || "Incluido por consenso mínimo entre módulos existentes.",
    requiresReview: confidenceScore < 70,
    sourceModule: "pick_analysis_snapshot",
    source: sourceLabel,
    sourceLabel: "Recopilación para Picks",
    backingModels,
    supportingData: pick.supportingData || backingModels,
    contradictingData: pick.contradictingData || []
  };
}

function collectCandidateMarkets(fixture, results) {
  const candidates = [];
  const push = (pick, module, label, backingModels) => {
    const candidate = collectionPickFromMarket(fixture, pick, module, label, backingModels);
    if (candidate && !candidates.some((item) => item.market === candidate.market && item.selection === candidate.selection)) candidates.push(candidate);
  };
  (results.dataPicks?.picks || []).forEach((pick) => pick.canAdd && push(pick, "data_picks", "Picks basados en datos", ["Motor de Decisión"]));
  (results.poisson?.suggestedMarkets || []).forEach((pick) => push(pick, "poisson", "Modelo Poisson", ["Poisson"]));
  (results.teamGoals?.picks || []).forEach((pick) => push(pick, "team_goals", "Probabilidad de gol por equipo", ["Ataque vs Defensa"]));
  (results.corners?.picks || []).forEach((pick) => push(pick, "corners", "Corners", ["Corners"]));
  (results.specificMarkets?.groups || []).forEach((group) => (group.picks || []).forEach((pick) => push(pick, "specific_markets", "Catálogo de mercados", [group.label || "Mercado específico"])));
  ["home", "away"].forEach((side) => (results.teamPerformance?.picks?.[side] || []).forEach((pick) => pick.canAdd && push(pick, "team_average_performance", "Rendimiento promedio por equipo", ["Tiros + pases + disciplina"])));
  (results.playerGoals?.candidates || []).forEach((candidate) => push({
    ...candidate,
    market: candidate.market || "Jugador anota en cualquier momento",
    selection: candidate.selection || `${candidate.playerName} anota`,
    decimalOdds: candidate.odds,
    confidenceScore: candidate.goalThreatScore
  }, "player_goal_candidate", "Jugador con posible gol", ["Amenaza ofensiva individual"]));
  return candidates
    .filter((candidate) => (candidate.expectedValue === null || candidate.expectedValue >= 0) && Number(candidate.confidenceScore || 0) >= 45)
    .sort((a, b) => Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
    .slice(0, 8);
}

function buildConsensus(candidateMarkets) {
  const bySelection = new Map();
  for (const pick of candidateMarkets) {
    const key = `${pick.market}:${pick.selection}`;
    const current = bySelection.get(key) || { market: pick.market, selection: pick.selection, models: new Set(), confidence: 0 };
    (pick.backingModels || [pick.source]).forEach((model) => current.models.add(model));
    current.confidence = Math.max(current.confidence, Number(pick.confidenceScore || 0));
    bySelection.set(key, current);
  }
  return [...bySelection.values()].map((item) => ({
    market: item.market,
    selection: item.selection,
    models: [...item.models],
    confidence: item.confidence,
    status: item.models.size >= 2 ? "valid" : "insufficient"
  }));
}

function buildPickAnalysisSnapshot(fixture, results, errors = []) {
  const modules = [
    collectionModule({ name: "Fixture", result: `${fixture.home} vs ${fixture.away}`, source: fixture.dataSource || "api-football", quality: fixture.dataQuality?.level || "partial", confidence: `${fixture.dataQuality?.score ?? 0}/100`, status: fixture.id ? "valid" : "insufficient", updatedAt: fixture.fetchedAt || new Date().toISOString() }),
    collectionModule({ name: "Rendimiento reciente", result: results.teamPerformance?.status || "No disponible", sampleSize: results.teamPerformance?.k || null, source: results.teamPerformance?.source || "API-Football", quality: results.teamPerformance?.status === "available" ? "available" : "partial", confidence: results.teamPerformance?.status === "available" ? "Media" : "Baja", warnings: [results.teamPerformance?.message], status: results.teamPerformance?.status === "available" ? "valid" : "insufficient", updatedAt: results.teamPerformance?.updatedAt }),
    collectionModule({ name: "Selector 1X2", result: results.outcome?.decisionLabel || "No disponible", probability: results.outcome?.scenarios?.[0]?.probabilityPct || null, source: results.outcome?.source || "Modelo interno", quality: results.outcome?.status || "not_available", confidence: results.outcome?.confidenceLabel || "No disponible", warnings: [results.outcome?.warning], status: results.outcome?.status === "available" ? "valid" : "insufficient" }),
    collectionModule({ name: "Poisson", result: results.poisson?.status || "No disponible", source: results.poisson?.source || "Modelo interno", quality: results.poisson?.status || "not_available", confidence: results.poisson?.status === "available" ? "Media" : "Baja", warnings: [results.poisson?.warning], status: results.poisson?.status === "available" ? "valid" : "insufficient" }),
    collectionModule({ name: "Ataque vs Defensa", result: results.teamGoals?.status || "No disponible", source: results.teamGoals?.source || "Modelo interno", quality: results.teamGoals?.status || "not_available", confidence: results.teamGoals?.status === "available" ? "Media" : "Baja", warnings: [results.teamGoals?.warning], status: results.teamGoals?.status === "available" ? "valid" : "insufficient" }),
    collectionModule({ name: "Corners", result: results.corners?.status || "No disponible", source: results.corners?.source || "Modelo interno", quality: results.corners?.status || "not_available", confidence: results.corners?.confidenceScore ? `${results.corners.confidenceScore}/100` : "No disponible", warnings: results.corners?.warnings || [results.corners?.warning], status: results.corners?.status === "available" ? "valid" : "insufficient" }),
    collectionModule({ name: "Jugadores", result: results.playerGoals?.status || "No disponible", sampleSize: results.playerGoals?.playersEvaluated || null, source: results.playerGoals?.source || "API-Football", quality: results.playerGoals?.status || "not_available", confidence: results.playerGoals?.status === "available" ? "Media" : "No disponible", warnings: [results.playerGoals?.message], status: results.playerGoals?.status === "available" ? "valid" : "insufficient" }),
    collectionModule({ name: "Mercado y cuotas", result: `${fixture.marketAnalysis?.length || 0} mercados normalizados`, source: "API-Football", quality: fixture.marketAnalysis?.length ? "available" : "not_available", confidence: fixture.marketAnalysis?.length ? "Media" : "No disponible", status: fixture.marketAnalysis?.length ? "valid" : "insufficient" })
  ];
  const candidates = collectCandidateMarkets(fixture, results);
  const consensus = buildConsensus(candidates);
  const contradictions = modules.filter((module) => module.status === "contradictory").map((module) => `${module.name}: ${module.result}`);
  const missingData = modules.filter((module) => module.status === "insufficient" || module.status === "not_available").map((module) => module.name);
  const validModules = modules.filter((module) => module.status === "valid").length;
  const availablePct = modules.length ? Math.round((validModules / modules.length) * 100) : 0;
  const warnings = [
    ...errors.map((error) => `${error.module}: ${error.message}`),
    candidates.length ? "" : "No se encontró un pick recomendado: los datos disponibles no alcanzan los criterios mínimos de calidad, consenso y valor esperado."
  ].filter(Boolean);
  return {
    type: "pickAnalysisSnapshot",
    modelVersion: PICK_COLLECTION_MODEL_VERSION,
    fixtureId: fixture.id,
    generatedAt: new Date().toISOString(),
    source: "existing-modules-cache-and-api",
    match: {
      competition: fixture.leagueName,
      season: fixture.season || "",
      date: fixture.date,
      time: fixture.time,
      home: fixture.home,
      away: fixture.away,
      venue: fixture.stadium || "",
      status: fixture.statusLabel || fixture.status,
      restDays: fixture.preMatch?.context?.restDays || null
    },
    summary: {
      globalQuality: availablePct >= 70 ? "Disponible" : availablePct >= 40 ? "Parcial" : "Datos insuficientes",
      availablePct,
      modulesEvaluated: modules.length,
      validModules,
      contradictions: contradictions.length,
      apiRequests: 0,
      cacheUsed: true
    },
    modules,
    consensus,
    contradictions,
    missingData,
    candidateMarkets: candidates,
    warnings,
    audit: {
      user: state.preferences.name || "Usuario local",
      formulas: ["Poisson", "Outcome 1X2", "Team goals", "Corners", "Team performance", "Player goal candidates"].filter(Boolean),
      errors,
      note: "No se modificaron fórmulas; se reutilizaron resultados de módulos existentes."
    }
  };
}

function setPickCollectionStatus(label, status = "processing") {
  elements.pickCollectionStatus.className = `status-badge status-badge--${status}`;
  elements.pickCollectionStatus.textContent = label;
}

async function collectStep(label, moduleName, task, errors) {
  setPickCollectionStatus(label, "processing");
  try {
    return await task();
  } catch (error) {
    errors.push({ module: moduleName, message: error.message || "Error parcial" });
    return null;
  }
}

async function collectPickInformation() {
  const fixture = selectedFixture();
  if (!fixture || state.isCollectingPickInfo) return showNotice("Selecciona primero un encuentro en Dashboard.");
  state.isCollectingPickInfo = true;
  elements.collectPickInfo.disabled = true;
  elements.collectPickInfo.textContent = "Evaluando picks...";
  elements.pickCollectionContent.innerHTML = '<div class="research-empty"><div class="loading-spinner" aria-hidden="true"></div><p>Validando y ordenando las mejores selecciones del partido...</p></div>';
  try {
    setPickCollectionStatus("Recopilando y validando", "processing");
    const snapshot = await footballDataService.getPickCollection(fixture, true);
    if (!snapshot?.fixtureId) throw new Error("No se pudo construir el expediente del encuentro.");
    state.pickCollectionByFixture.set(fixture.id, snapshot);
    persistPickCollectionCache();
    renderPickCollection(snapshot);
    setPickCollectionStatus(snapshot.candidateMarkets?.length ? "Completado" : "Datos insuficientes", snapshot.candidateMarkets?.length ? "available" : "partial");
  } catch (error) {
    setPickCollectionStatus("Error parcial", "unavailable");
    elements.pickCollectionContent.innerHTML = `<div class="research-empty"><strong>Error de fuente</strong><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    state.isCollectingPickInfo = false;
    elements.collectPickInfo.disabled = !selectedFixture();
    elements.collectPickInfo.textContent = "Actualizar picks";
  }
}

function renderPickCollection(snapshot) {
  if (!snapshot) {
    elements.pickCollectionContent.innerHTML = '<div class="research-empty">Selecciona un encuentro y presiona “Actualizar picks”.</div>';
    return;
  }
  const recommended = (snapshot.candidateMarkets || []).filter((pick) => pick.canAdd);
  const candidates = recommended.map((pick) => {
    const index = (snapshot.candidateMarkets || []).indexOf(pick);
    return `<article class="collection-pick collection-pick--recommended">
      <div><span>${escapeHtml(pick.market)}</span><strong>${escapeHtml(pick.selection)}</strong><small>Confianza ${displayValue(pick.confidenceScore, 0)}/100 · Cuota ${displayValue(pick.decimalOdds, "No disponible")} · EV ${pick.expectedValue === null ? "No disponible" : `${displayValue(pick.expectedValue)}%`}</small><small>Origen: ${escapeHtml((pick.backingModels || []).join(" + ") || pick.source)}</small><p>${escapeHtml(pick.reasoning)}</p></div>
      <button class="button button--primary button--compact" type="button" data-add-collection-pick="${index}">Agregar pick</button>
    </article>`;
  }).join("");
  elements.pickCollectionContent.innerHTML = `<section class="collection-block collection-recommended-list"><div class="collection-list-heading"><div><h3>Picks recomendados</h3><p>Ordenados de mejor a menor, sin selecciones repetidas. Incluye corners cuando supera las validaciones del módulo.</p></div><small>Actualizado: ${escapeHtml(formatUpdatedAt(snapshot.generatedAt))}</small></div>${candidates || '<div class="research-empty">No se encontró un pick recomendado: los datos disponibles no alcanzan los criterios mínimos de calidad, coherencia o valor.</div>'}</section>`;
}

function collectionPickLeg(index) {
  const snapshot = state.pickCollectionByFixture.get(selectedFixture()?.id);
  const pick = snapshot?.candidateMarkets?.[Number(index)] || null;
  return pick?.canAdd ? pick : null;
}

function addCollectionPick(index) {
  const leg = collectionPickLeg(index);
  if (leg) appendPickToParlay(leg, "Pick recomendado agregado a Mi parlay.");
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
      <div class="analysis-hero__title"><h3>${escapeHtml(analysis.partido.local)} vs ${escapeHtml(analysis.partido.visitante)}</h3><div class="analysis-mode-badges"><span class="source-chip source-chip--model">Solo datos · Motor de Reglas</span>${quality ? `<span class="quality-badge quality-badge--${quality.level.toLowerCase()}">Cobertura ${escapeHtml(quality.level)} · ${quality.score}/100</span>` : ""}</div></div>
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
    ${context ? `<section class="analysis-context"><div class="form-summary">${formCard(context.preMatch?.home)}${formCard(context.preMatch?.away)}</div>${calculationRows ? `<div class="calculation-table"><h3>Cálculos verificados del motor de reglas</h3><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Selección</th><th>Cuota</th><th>Prob. estimada</th><th>EV</th></tr></thead><tbody>${calculationRows}</tbody></table></div></div>` : '<p class="analysis-context__empty">No hubo cuotas suficientes para calcular valor esperado.</p>'}</section>` : ""}
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
  elements.analysisContent.innerHTML = '<div class="empty-state"><span class="empty-state__icon" aria-hidden="true">✦</span><h3>Partido seleccionado</h3><p>Analiza con el Motor de Reglas. El sistema usa datos normalizados y modelos internos.</p></div>';
}

function allEvidenceSnapshots() {
  const rows = new Map();
  const removedIds = new Set((state.preferences.removedEvidenceIds || []).map(String));
  for (const snapshot of [...state.evidenceLibrary, ...state.evidenceSnapshots]) {
    if (snapshot?.id && !removedIds.has(String(snapshot.id))) rows.set(String(snapshot.id), snapshot);
  }
  return [...rows.values()].map((snapshot) => {
    const audit = state.preferences.evidenceAudits?.[snapshot.id];
    if (!audit) return snapshot;
    return {
      ...snapshot,
      auditMetadata: {
        ...(snapshot.auditMetadata || {}),
        ...(audit.auditedAt ? { auditedAt: audit.auditedAt } : {}),
        ...(audit.lastCheckedAt ? { lastCheckedAt: audit.lastCheckedAt } : {}),
        ...(audit.nextEvaluationAt ? { nextEvaluationAt: audit.nextEvaluationAt } : {}),
        ...(audit.pendingCode ? { pendingCode: audit.pendingCode } : {})
      },
      auditSummary: audit.auditSummary || snapshot.auditSummary
    };
  });
}

function purgeInvalidEvidenceSnapshots({ sync = false, render = true, evidenceIds = [] } = {}) {
  const fixtureStatuses = new Map(state.fixtures.map((fixture) => [String(fixture.id), fixture.statusShort || fixture.status]));
  const requestedIds = new Set([
    ...(Array.isArray(state.preferences.removedEvidenceIds) ? state.preferences.removedEvidenceIds : []),
    ...(Array.isArray(evidenceIds) ? evidenceIds : [])
  ].map(String));
  const localBefore = Array.isArray(state.evidenceSnapshots) ? state.evidenceSnapshots : [];
  const libraryBefore = Array.isArray(state.evidenceLibrary) ? state.evidenceLibrary : [];
  const shouldKeep = (snapshot) => !requestedIds.has(String(snapshot?.id || ""))
    && isValidEvidenceSnapshot(snapshot, fixtureStatuses.get(String(snapshot?.fixture?.id || "")) || "");
  const localAfter = localBefore.filter(shouldKeep);
  const libraryAfter = libraryBefore.filter(shouldKeep);
  const removed = [...localBefore, ...libraryBefore].filter((snapshot) => !shouldKeep(snapshot));
  if (!removed.length) return 0;
  const removedIds = new Set([
    ...(Array.isArray(state.preferences.removedEvidenceIds) ? state.preferences.removedEvidenceIds : []),
    ...removed.map((snapshot) => String(snapshot.id)).filter(Boolean)
  ]);
  state.evidenceSnapshots = localAfter;
  state.evidenceLibrary = libraryAfter;
  state.preferences.removedEvidenceIds = [...removedIds].slice(-500);
  if (state.preferences.evidenceAudits) {
    state.preferences.evidenceAudits = Object.fromEntries(Object.entries(state.preferences.evidenceAudits)
      .filter(([id]) => !removedIds.has(String(id))));
  }
  try {
    localStorage.setItem(EVIDENCE_SNAPSHOTS_KEY, JSON.stringify(localAfter));
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences));
  } catch { /* La limpieza sigue aplicada durante la sesion. */ }
  if (sync) queueCloudSync();
  if (render) renderAuditFixtureOptions();
  return removed.length;
}

function renderEvidenceReadiness() {
  if (!elements.evidenceReadinessList) return;
  const groups = summarizeEvidenceByCompetition(allEvidenceSnapshots());
  const collected = groups.reduce((sum, group) => sum + group.collected, 0);
  const evaluated = groups.reduce((sum, group) => sum + group.evaluated, 0);
  elements.evidenceReadinessTotal.textContent = `${collected} recolectada${collected === 1 ? "" : "s"} · ${evaluated} evaluada${evaluated === 1 ? "" : "s"}`;
  elements.evidenceReadinessTotal.className = `status-badge status-badge--${evaluated >= 100 ? "available" : evaluated >= 30 ? "partial" : "unavailable"}`;
  if (!groups.length) {
    elements.evidenceReadinessList.innerHTML = '<div class="research-empty"><strong>Sin evidencias prepartido</strong><p>Las evidencias aparecerán aquí al guardarlas manual o automáticamente.</p></div>';
    return;
  }
  elements.evidenceReadinessList.innerHTML = groups.map((group) => {
    const progress = state.evidenceEvaluationByCompetition.get(group.competitionKey);
    const running = Boolean(progress?.running);
    const buttonLabel = running
      ? `Evaluando ${progress.processed}/${progress.total}…`
      : group.readyToEvaluate > 0 ? `Evaluar pendientes (${group.readyToEvaluate})` : "Sin resultados por evaluar";
    const progressMessage = progress?.message || (group.pendingEvaluation > group.readyToEvaluate
      ? `${group.pendingEvaluation - group.readyToEvaluate} evidencia(s) esperan que finalice el partido.`
      : "Evalúa los resultados disponibles sin modificar las fórmulas.");
    return `<article class="evidence-readiness-card evidence-readiness-card--${escapeHtml(group.color)}">
    <header><span class="evidence-light evidence-light--${escapeHtml(group.color)}" aria-hidden="true"></span><div><h3>${escapeHtml(group.competition)}</h3><p>${group.leagueId ? `Liga API-Football ${escapeHtml(group.leagueId)}` : "Competición identificada por nombre"}</p></div><strong>${escapeHtml(group.label)}</strong></header>
    <div class="evidence-readiness-counts"><div><span>Recolectadas</span><strong>${escapeHtml(group.collected)}</strong></div><div><span>Evaluadas</span><strong>${escapeHtml(group.evaluated)}</strong></div><div><span>Pendientes</span><strong>${escapeHtml(group.pendingEvaluation)}</strong></div><div><span>Picks decisivos</span><strong>${escapeHtml(group.decisivePicks)}</strong></div><div><span>Descartados prepartido</span><strong>${escapeHtml(group.discardedPicks)}</strong></div><div><span>Descartes con resultado comprobable</span><strong>${escapeHtml(group.counterfactualAssessable)}</strong></div><div><span>Calidad guardada promedio</span><strong>${group.averageQualityScore === null ? "—" : `${escapeHtml(group.averageQualityScore)}/100`}</strong></div></div>
    <small>Versiones de captura: ${escapeHtml(group.schemaVersionSummary || "Sin versión registrada")}</small>
    <div class="evidence-readiness-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(group.progressPct)}" aria-label="Progreso hacia cien evidencias evaluadas"><i style="width:${group.progressPct}%"></i></div>
    <p>${escapeHtml(group.recommendation)}</p>
    <small>${group.nextTarget === null ? "Ya alcanzó el umbral orientativo de 100 evidencias evaluadas." : `Faltan ${escapeHtml(group.remaining)} auditorías para el siguiente nivel.`}</small>
    <div class="evidence-readiness-actions"><button class="button button--primary button--compact" type="button" data-evaluate-evidence="${escapeHtml(group.competitionKey)}" ${running || group.readyToEvaluate === 0 ? "disabled" : ""}>${escapeHtml(buttonLabel)}</button><span role="status">${escapeHtml(progressMessage)}</span></div>
  </article>`;
  }).join("");
}

function compactAuditMetric(metric = {}) {
  return {
    total: Number(metric.totalPicks || 0),
    decisive: Number(metric.decisivePicks || 0),
    hits: Number(metric.hits || 0),
    misses: Number(metric.misses || 0),
    voids: Number(metric.voids || 0),
    noBets: Number(metric.noBets || 0),
    eligible: Number(metric.eligiblePicks || 0),
    hitRate: metric.hitRate ?? null,
    ROI: metric.ROI ?? null,
    calibrationSample: Number(metric.calibrationSampleSize || 0),
    brier: metric.brierScore ?? null,
    logLoss: metric.logLoss ?? null,
    ECE: metric.expectedCalibrationError ?? null
  };
}

function compactAuditGroups(groups = {}) {
  return Object.fromEntries(Object.entries(groups).map(([key, metric]) => [key, compactAuditMetric(metric)]));
}

function markEvidenceAudited(evidence, audit, { render = true, sync = true } = {}) {
  if (!evidence?.id || !audit) return;
  const records = Array.isArray(audit.records) ? audit.records : [];
  const evaluablePicks = records.filter((row) => ["HIT", "MISS", "VOID"].includes(row?.outcome)).length;
  const decisivePicks = records.filter((row) => ["HIT", "MISS"].includes(row?.outcome)).length;
  const discardedPicks = records.filter((row) => row?.outcome === "NO_BET").length;
  const counterfactualRows = records.filter((row) => row?.outcome === "NO_BET" && ["HIT", "MISS", "VOID"].includes(row?.counterfactualOutcome));
  const finalScore = records.find((row) => row?.finalScore && row.finalScore !== "Pendiente")?.finalScore || null;
  const auditedAt = new Date().toISOString();
  state.preferences.evidenceAudits = {
    ...(state.preferences.evidenceAudits || {}),
    [evidence.id]: {
      auditedAt,
      auditSummary: {
        evaluablePicks,
        decisivePicks,
        discardedPicks,
        counterfactualAssessable: counterfactualRows.length,
        counterfactualHits: counterfactualRows.filter((row) => row.counterfactualOutcome === "HIT").length,
        counterfactualMisses: counterfactualRows.filter((row) => row.counterfactualOutcome === "MISS").length,
        completed: Boolean(finalScore),
        hits: Number(audit.metrics?.hits || 0),
        misses: Number(audit.metrics?.misses || 0),
        voids: Number(audit.metrics?.voids || 0),
        finalScore,
        auditSchemaVersion: 2,
        metrics: compactAuditMetric(audit.metrics),
        dimensions: {
          market: compactAuditGroups(audit.metrics?.byMarket),
          origin: compactAuditGroups(audit.metrics?.byOrigin),
          confidence: compactAuditGroups(audit.metrics?.byConfidence),
          color: compactAuditGroups(audit.metrics?.byColor),
          modelVersion: compactAuditGroups(audit.metrics?.byModelVersion)
        }
      }
    }
  };
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences)); }
  catch { /* La auditoría sigue visible aunque el navegador bloquee el almacenamiento. */ }
  if (sync) queueCloudSync();
  if (render) renderEvidenceReadiness();
  return Boolean(finalScore);
}

function deferEvidenceEvaluation(evidence, error) {
  if (!evidence?.id) return null;
  const checkedAt = new Date();
  const live = error?.code === "FIXTURE_LIVE";
  const retryDelayMs = live ? 15 * 60 * 1000 : 60 * 60 * 1000;
  const nextEvaluationAt = new Date(checkedAt.getTime() + retryDelayMs).toISOString();
  state.preferences.evidenceAudits = {
    ...(state.preferences.evidenceAudits || {}),
    [evidence.id]: {
      ...(state.preferences.evidenceAudits?.[evidence.id] || {}),
      lastCheckedAt: checkedAt.toISOString(),
      nextEvaluationAt,
      pendingCode: error?.code || "FIXTURE_NOT_FINISHED"
    }
  };
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences)); }
  catch { /* El aplazamiento sigue activo durante la sesión. */ }
  return nextEvaluationAt;
}

async function evaluateCompetitionEvidence(competitionKey) {
  const pending = pendingEvidenceForCompetition(allEvidenceSnapshots(), competitionKey);
  if (state.evidenceEvaluationByCompetition.get(competitionKey)?.running) return;
  if (!pending.ready.length) {
    showNotice("No hay evidencias finalizadas pendientes en esta competición.");
    return;
  }
  const progress = { running: true, processed: 0, total: pending.ready.length, completed: 0, waiting: pending.waiting.length, errors: 0, issues: [], deferred: [], message: "Consultando resultados finales…" };
  state.evidenceEvaluationByCompetition.set(competitionKey, progress);
  renderEvidenceReadiness();
  for (const evidence of pending.ready) {
    try {
      const audit = await footballDataService.auditFixture(evidence.fixture.id, evidence);
      const completed = markEvidenceAudited(evidence, audit, { render: false, sync: false });
      if (completed) progress.completed += 1;
      else progress.errors += 1;
    } catch (error) {
      const fixtureLabel = `${evidence.fixture?.home || "Local"} vs ${evidence.fixture?.away || "Visitante"}`;
      if (error.code === "FIXTURE_POSTPONED") {
        purgeInvalidEvidenceSnapshots({ sync: false, render: false, evidenceIds: [evidence.id] });
        error.message = "Evidencia eliminada: el partido fue pospuesto.";
        progress.issues.push({ fixtureLabel, message: error.message });
      } else if (["FIXTURE_NOT_FINISHED", "FIXTURE_LIVE"].includes(error.code)) {
        progress.waiting += 1;
        const nextEvaluationAt = deferEvidenceEvaluation(evidence, error);
        progress.deferred.push({ fixtureLabel, nextEvaluationAt });
      } else {
        progress.errors += 1;
        progress.issues.push({ fixtureLabel, message: error.message || "No se pudo completar la evaluación." });
      }
    }
    progress.processed += 1;
    progress.message = `${progress.completed} completada(s) · ${progress.waiting} pendiente(s) · ${progress.errors} error(es)`;
    renderEvidenceReadiness();
  }
  progress.running = false;
  if (progress.completed > 0 || progress.deferred.length > 0 || progress.issues.some((issue) => issue.message.includes("Evidencia eliminada"))) queueCloudSync();
  renderAuditFixtureOptions();
  const issues = progress.issues.length ? `<div class="audit-pending-details"><h3>Evaluaciones que siguen pendientes</h3><ul>${progress.issues.map((issue) => `<li><strong>${escapeHtml(issue.fixtureLabel)}</strong><span>${escapeHtml(issue.message)}</span></li>`).join("")}</ul></div>` : "";
  const deferred = progress.deferred.length ? `<div class="detail-note detail-note--info"><strong>Resultados oficiales todavía pendientes</strong><span>${escapeHtml(progress.deferred.map((row) => row.fixtureLabel).join(", "))}. La evidencia se conserva y el sistema aplaza un nuevo intento para evitar consultas repetidas.</span></div>` : "";
  elements.auditResults.innerHTML = `<div class="detail-note detail-note--info"><strong>Evaluación por competición finalizada</strong><span>${escapeHtml(progress.message)}. Los encuentros futuros o todavía no finalizados conservan su estado pendiente.</span></div>${deferred}${issues}`;
  showNotice(progress.completed ? `${progress.completed} evidencia(s) evaluadas correctamente.` : "No había resultados finalizados disponibles para completar.");
}

function selectedAuditEvidence() {
  return latestEvidenceForFixture(allEvidenceSnapshots(), elements.auditFixture.value);
}

async function loadEvidenceLibrary() {
  if (state.evidenceLibrary.length || state.isLoadingEvidenceLibrary) return;
  state.isLoadingEvidenceLibrary = true;
  try {
    state.evidenceLibrary = await footballDataService.getEvidenceLibrary();
    purgeInvalidEvidenceSnapshots({ sync: true, render: false });
  }
  catch (error) { showNotice(error.message || "No se pudo cargar la biblioteca de evidencias."); }
  finally { state.isLoadingEvidenceLibrary = false; renderAuditFixtureOptions(); }
}

function renderAuditFixtureOptions() {
  const available = new Map();
  const snapshots = allEvidenceSnapshots();
  const evidenceFixtureIds = new Set(snapshots.map((snapshot) => String(snapshot?.fixture?.id || "")).filter(Boolean));
  for (const id of evidenceFixtureIds) {
    const snapshot = latestEvidenceForFixture(snapshots, id);
    const fixture = snapshot?.fixture;
    if (!fixture?.id) continue;
    const evaluated = Boolean(snapshot.auditMetadata?.auditedAt && snapshot.auditSummary?.completed === true);
    available.set(String(fixture.id), { ...fixture, hasEvidence: true, evaluated, evidenceStatus: evaluated ? "evaluated" : "pending" });
  }
  for (const fixture of state.fixtures.filter((item) => item.status === "finished")) {
    const id = String(fixture.id);
    const evidence = latestEvidenceForFixture(snapshots, id);
    const evaluated = Boolean(evidence?.auditMetadata?.auditedAt && evidence?.auditSummary?.completed === true);
    available.set(id, { ...available.get(id), ...fixture, hasEvidence: Boolean(evidence), evaluated, evidenceStatus: evidence ? (evaluated ? "evaluated" : "pending") : "missing" });
  }
  const fixtures = [...available.values()].sort((a, b) => String(b.utcDateTime || b.date || "").localeCompare(String(a.utcDateTime || a.date || "")));
  elements.auditFixture.innerHTML = fixtures.length
    ? `<option value="">Selecciona una evidencia</option>${fixtures.map((fixture) => `<option value="${escapeHtml(fixture.id)}" class="${fixture.evidenceStatus === "evaluated" ? "audit-option--evaluated" : fixture.evidenceStatus === "pending" ? "audit-option--pending" : ""}">${fixture.evidenceStatus === "evaluated" ? "● Evaluada · " : fixture.evidenceStatus === "pending" ? "● Pendiente · " : ""}${escapeHtml(fixture.leagueName || "Liga no disponible")} · ${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)} · ${fixture.hasEvidence ? "Evidencia prepartido" : "Sin snapshot"}</option>`).join("")}`
    : '<option value="">No hay evidencias prepartido guardadas</option>';
  elements.runAudit.disabled = true;
  elements.viewAuditEvidence.disabled = true;
  renderEvidenceReadiness();
}

function showAuditEvidencePreview() {
  const evidence = selectedAuditEvidence();
  if (!evidence) return showNotice("No existe evidencia prepartido para visualizar.");
  elements.auditEvidenceTitle.textContent = `${evidence.fixture?.leagueName || "Liga no disponible"} · ${evidence.fixture?.home} vs ${evidence.fixture?.away}`;
  elements.auditEvidenceText.textContent = evidenceSnapshotToText(evidence);
  elements.auditEvidencePreview.hidden = false;
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
    <td data-label="Estado"><strong>${escapeHtml(row.outcome)}</strong>${row.outcome === "NO_BET" ? `<small class="audit-counterfactual">Descarte: ${escapeHtml(row.counterfactualOutcome || "No evaluable")}</small>` : ""}</td><td data-label="Error">${escapeHtml(row.errorDetected || "Sin error crítico")}</td><td data-label="Recomendación">${escapeHtml(row.recommendation)}</td></tr>`).join("");
  elements.auditResults.innerHTML = `<div class="history-metrics"><article><span>Candidatos evaluados</span><strong>${displayValue(metrics.totalPicks, 0)}</strong></article><article><span>Picks decisivos</span><strong>${displayValue(metrics.decisivePicks, 0)}</strong><small>Solo HIT + MISS</small></article><article><span>Picks con cuota elegibles</span><strong>${displayValue(metrics.eligiblePicks, 0)}</strong></article><article><span>Hit rate descriptivo</span><strong>${displayValue(metrics.hitRate)}%</strong><small>IC 95% ${displayValue(metrics.hitRateInterval95?.lowPct)}-${displayValue(metrics.hitRateInterval95?.highPct)}%</small></article><article><span>ROI elegible</span><strong>${displayValue(metrics.ROI)}%</strong></article><article><span>ECE</span><strong>${displayValue(metrics.expectedCalibrationError)} pp</strong></article><article><span>Brier Score</span><strong>${displayValue(metrics.brierScore, 4)}</strong><small>Muestra ${displayValue(metrics.calibrationSampleSize, 0)}</small></article><article><span>Log Loss</span><strong>${displayValue(metrics.logLoss, 4)}</strong></article><article><span>NO BET</span><strong>${displayValue(metrics.noBets, 0)}</strong></article><article><span>Descartes auditables</span><strong>${displayValue(metrics.discardAudit?.assessable, 0)}</strong><small>${displayValue(metrics.discardAudit?.hits, 0)} habrían acertado · ${displayValue(metrics.discardAudit?.misses, 0)} habrían fallado</small></article></div><div class="detail-note ${readiness.canRecalibrate ? "detail-note--info" : ""}"><strong>${escapeHtml(readiness.label || "Calibración no evaluada")}</strong><span>${readiness.canRecalibrate ? "La muestra permite estudiar una recalibración por versión y mercado." : `No recalibrar automáticamente: se requieren al menos ${displayValue(readiness.minimumRequired, 0)} resultados válidos en la misma versión y mercado.`}</span></div><p class="market-disclaimer">El ROI usa únicamente picks elegibles con cuota válida. Brier Score, Log Loss y ECE solo usan resultados HIT/MISS con probabilidad válida; menor es mejor. La evaluación de descartes es contrafactual e informativa: nunca aumenta ni reduce el hit rate o ROI oficial.</p>${calibrationRows ? `<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Banda modelo</th><th>Muestra</th><th>Prob. media</th><th>Acierto real</th><th>Brecha</th></tr></thead><tbody>${calibrationRows}</tbody></table></div>` : ""}<div class="detail-table-wrap audit-table-wrap"><table class="detail-table"><thead><tr><th>Decisión</th><th>Fecha</th><th>Partido</th><th>Liga</th><th>Mercado</th><th>Pick</th><th>Cuota</th><th>Prob. implícita</th><th>Prob. modelo</th><th>EV</th><th>EV conservador</th><th>Confianza</th><th>Data Quality</th><th>Resultado final</th><th>Estado</th><th>Error detectado</th><th>Recomendación</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
    const evidence = selectedAuditEvidence();
    const audit = await footballDataService.auditFixture(elements.auditFixture.value, evidence);
    renderAuditResults(audit);
    markEvidenceAudited(evidence, audit);
  }
  catch (error) {
    const evidence = selectedAuditEvidence();
    if (error.code === "FIXTURE_POSTPONED" && evidence) {
      purgeInvalidEvidenceSnapshots({ sync: true, evidenceIds: [evidence.id] });
      elements.auditResults.innerHTML = '<div class="saved-empty"><h3>Evidencia eliminada</h3><p>El partido fue pospuesto y ya no forma parte de la auditoría.</p></div>';
    } else elements.auditResults.innerHTML = `<div class="saved-empty"><h3>No se pudo ejecutar la auditoría</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
  finally { elements.runAudit.disabled = false; elements.runAudit.textContent = "Ejecutar auditoría"; }
}

async function capturePreMatchEvidence() {
  const fixture = selectedFixture();
  if (!fixture || state.isCapturingEvidence) return;
  if (fixture.status !== "scheduled") return showNotice("La evidencia debe guardarse antes de que inicie el partido.");
  state.isCapturingEvidence = true;
  elements.savePreMatchEvidence.disabled = true;
  elements.savePreMatchEvidence.textContent = "Guardando…";
  elements.evidenceStatus.textContent = "Recopilando módulos con datos normalizados…";
  try {
    const snapshot = await footballDataService.captureEvidence(fixture.id);
    state.dataPicksByFixture.set(fixture.id, snapshot.modules?.dataPicks);
    state.poissonByFixture.set(fixture.id, snapshot.modules?.poisson);
    state.teamGoalsByFixture.set(fixture.id, snapshot.modules?.teamGoals);
    state.cornersByFixture.set(fixture.id, snapshot.modules?.corners);
    state.evidenceSnapshots = saveEvidenceSnapshot(snapshot);
    queueCloudSync();
    renderEvidenceReadiness();
    showNotice("Evidencia fresca guardada desde el mismo snapshot del servidor usado por la automatización.");
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
      <header><span>${escapeHtml(item.label)}</span><div class="outcome-card__actions"><strong>${displayValue(item.probabilityPct)}%</strong><button class="pick-add-icon" type="button" data-add-outcome="${escapeHtml(item.key)}" aria-label="Agregar ${escapeHtml(item.label)} al cupón" title="Agregar pick">+</button></div></header>
      <div class="outcome-bar"><i style="width:${Math.min(100, Number(item.probabilityPct || 0))}%"></i></div>
      <dl><div><dt>Confianza futbolistica</dt><dd>${displayValue(item.footballConfidenceScore, 0)}/100</dd></div><div><dt>Cuota</dt><dd>${item.decimalOdds ? `${displayValue(item.decimalOdds)} (${escapeHtml(item.bookmaker)})` : "No disponible"}</dd></div><div><dt>EV</dt><dd>${item.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(item.expectedValuePct)}%`}</dd></div><div><dt>Decision</dt><dd>${escapeHtml(item.decisionLabel)}</dd></div></dl>
      <p><b>Apoya:</b> ${escapeHtml(support)}</p><p><b>Contradice:</b> ${escapeHtml(contradictions)}</p><p><b>Lectura final:</b> ${escapeHtml(item.notSelectedReason || "Sin explicación adicional.")}</p>
    </article>`;
  }).join("");
  const tournament = result.tournamentContext || {};
  const tournamentSummary = tournament.isShortTournament ? `<div class="data-picks-warnings"><span><strong>Mundial / torneo corto:</strong> Fase ${escapeHtml(tournament.phase || "No disponible")} · muestra ${displayValue(tournament.sampleSize, 0)} · alcance 90 minutos. ${escapeHtml((tournament.warnings || []).join(" ") || "Confianza ajustada por muestra y contexto competitivo.")}</span></div>` : "";
  elements.outcomeContent.innerHTML = `${tournamentSummary}<div class="outcome-summary">
    <article><span>Resultado mas probable</span><strong>${escapeHtml(result.resultMostLikely || "No disponible")}</strong><small>${escapeHtml(result.decisionLabel || "No bet")}</small></article>
    <article><span>Confianza</span><strong>${displayValue(result.confidenceScore, 0)}/100</strong><small>${escapeHtml(result.confidenceLabel || "No disponible")} · Riesgo ${escapeHtml(result.risk || "medium")}</small></article>
    <article><span>Fuentes</span><strong>${escapeHtml((result.supportingData || []).join(" + ") || "Modelo interno")}</strong><small>${escapeHtml((result.missingData || []).slice(0, 2).join(" | "))}</small></article>
  </div><div class="outcome-grid">${scenarioCards}</div><p class="market-disclaimer">${escapeHtml(warningText)}</p>`;
}

function outcomeScenarioLeg(key) {
  const fixture = selectedFixture();
  const result = state.outcomeByFixture.get(fixture?.id);
  const scenario = result?.scenarios?.find((item) => item.key === key);
  if (!fixture || !scenario) return null;
  const selectionCodes = { home: "home_win", draw: "draw", away: "away_win" };
  return {
    id: `${fixture.id}:outcome:${key}`, fixtureId: fixture.id, league: fixture.leagueName,
    home: fixture.home, away: fixture.away, date: fixture.date, market: "Resultado 1X2",
    selection: scenario.label, marketCode: "match_winner", selectionCode: selectionCodes[key],
    decimalOdds: scenario.decimalOdds, originalOdds: scenario.decimalOdds, updatedOdds: null,
    impliedProbability: scenario.marketProbabilityPct, modelProbability: scenario.probabilityPct,
    expectedValue: scenario.expectedValuePct, fixtureStatus: fixture.statusLabel || fixture.status,
    kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt,
    confidence: `${scenario.footballConfidenceScore}%`, confidenceScore: scenario.footballConfidenceScore,
    risk: scenario.risk, reasoning: scenario.notSelectedReason, requiresReview: scenario.decision !== "apuesta_recomendada",
    sourceModule: "outcome_1x2", source: result.source,
    supportingData: scenario.supportingData, contradictingData: scenario.contradictingData
  };
}

async function loadOutcomeScenarios(forceRefresh = false) {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingOutcome) return;
  if (!forceRefresh && state.outcomeByFixture.has(fixture.id)) return showModuleReady(elements.showOutcome, elements.outcomeContent);
  const wasHidden = elements.outcomeContent.hidden;
  state.isLoadingOutcome = true;
  elements.showOutcome.disabled = true;
  elements.refreshOutcome.disabled = true;
  elements.showOutcome.textContent = forceRefresh ? "Actualizando..." : "Calculando...";
  elements.outcomeStatus.className = "status-badge status-badge--processing";
  elements.outcomeStatus.textContent = forceRefresh ? "Actualizando" : "Calculando";
  try {
    const result = await footballDataService.getOutcomeScenarios(fixture, forceRefresh);
    state.outcomeByFixture.set(fixture.id, result);
    renderOutcomeScenarios(result);
    if (forceRefresh) elements.outcomeContent.hidden = wasHidden;
    else showModuleReady(elements.showOutcome, elements.outcomeContent);
    if (forceRefresh) showNotice("Selector 1X2 actualizado.");
  } catch (error) {
    renderOutcomeScenarios({ status: "error", scenarios: [], warning: error.message, decisionLabel: "Error" });
  } finally {
    state.isLoadingOutcome = false;
    elements.showOutcome.disabled = !selectedFixture();
    elements.refreshOutcome.disabled = !selectedFixture();
    elements.showOutcome.textContent = elements.outcomeContent.hidden ? "Mostrar" : "Ocultar";
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
  const expectedPick = buildExpectedCornersPick(result);
  const additionalPicks = (result.picks || []).filter((pick) => pick.selectionKey !== expectedPick?.selectionKey);
  const expectedPickHtml = expectedPick ? `<section class="expected-corners-pick expected-corners-pick--${escapeHtml(expectedPick.highlightColor)}"><div class="expected-corners-pick__projection"><small>Corners esperados</small><strong>${displayValue(expectedPick.projectedTotal)}</strong><span>Proyección del modelo interno</span></div><div class="expected-corners-pick__selection"><small>Pick sugerido</small><strong>${escapeHtml(expectedPick.selection)}</strong><span>Confianza ${displayValue(expectedPick.confidenceScore, 0)}/100 · ${escapeHtml(expectedPick.level)}</span><span>${expectedPick.hasOdds ? `Cuota ${displayValue(expectedPick.decimalOdds)} · EV ${displayValue(expectedPick.expectedValuePct)}%` : "Cuota no disponible · se guardará pendiente de cuota"}</span></div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-expected-corners>Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-expected-corners>Agregar al parlay</button></div></section>` : "";
  elements.cornersContent.innerHTML = `<div class="corner-summary"><strong>${escapeHtml(result.preMatchSignal)}</strong><span>Total esperado ${escapeHtml(result.totalExpectedCorners)} · Disparidad ${escapeHtml(result.disparity)} · Confianza ${escapeHtml(result.confidenceScore)}/100</span></div>${result.live?.alert ? `<div class="live-corner-alert">${escapeHtml(result.live.alert)}</div>` : ""}${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}<div class="corner-grid">${team(result.teams.home, selectedFixture()?.home || "Local")}${team(result.teams.away, selectedFixture()?.away || "Visitante")}</div><div class="detail-note detail-note--info"><strong>Game State</strong><span>${escapeHtml(result.live?.competitiveNeed || "Necesidad competitiva no disponible")}</span></div>${expectedPickHtml}${additionalPicks.length ? `<section class="poisson-markets"><h3>Otros mercados con cuota disponible</h3>${additionalPicks.map((pick) => `<article class="poisson-market poisson-market--${escapeHtml(pick.highlightColor)}"><div><strong>${escapeHtml(pick.selection)}</strong><small>Cuota ${displayValue(pick.decimalOdds)} · Modelo ${displayValue(pick.modelProbabilityPct)}% · EV ${displayValue(pick.expectedValuePct)}%</small></div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-corners="${escapeHtml(pick.selectionKey)}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-corners="${escapeHtml(pick.selectionKey)}">Agregar al parlay</button></div></article>`).join("")}</section>` : ""}`;
  decoratePickSignals(elements.cornersContent, ".poisson-market", additionalPicks);
}

async function loadCorners(forceRefresh = false) {
  const fixture = selectedFixture(); if (!fixture || state.isLoadingCorners) return;
  if (!forceRefresh && state.cornersByFixture.has(fixture.id)) return showModuleReady(elements.showCorners, elements.cornersContent);
  const wasHidden = elements.cornersContent.hidden;
  state.isLoadingCorners = true; elements.showCorners.disabled = true; elements.refreshCorners.disabled = true; elements.showCorners.textContent = forceRefresh ? "Actualizando…" : "Calculando…";
  try { const result = await footballDataService.getCornersModel(fixture, forceRefresh); state.cornersByFixture.set(fixture.id, result); renderCorners(result); if (forceRefresh) elements.cornersContent.hidden = wasHidden; else showModuleReady(elements.showCorners, elements.cornersContent); if (forceRefresh) showNotice("Corners actualizados."); }
  catch (error) { renderCorners({ status: "not_available", warning: error.message, picks: [] }); elements.cornersContent.hidden = forceRefresh ? wasHidden : false; }
  finally { state.isLoadingCorners = false; elements.showCorners.disabled = !selectedFixture(); elements.refreshCorners.disabled = !selectedFixture(); elements.showCorners.textContent = elements.cornersContent.hidden ? "Mostrar" : "Ocultar"; }
}

function cornerLeg(selectionKey) { const fixture = selectedFixture(); const result = state.cornersByFixture.get(fixture?.id); const pick = result?.picks?.find((item) => item.selectionKey === selectionKey); if (!fixture || !pick) return null; return { id: `${fixture.id}:corners:${selectionKey}`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date, market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey, decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null, impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct, expectedValue: pick.expectedValuePct, fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.level, reasoning: result.preMatchSignal, requiresReview: result.status !== "available", sourceModule: "corners", source: result.source, supportingData: pick.supportingData, contradictingData: pick.contradictingData }; }
function expectedCornersLeg() { const fixture = selectedFixture(); const result = state.cornersByFixture.get(fixture?.id); const pick = buildExpectedCornersPick(result); if (!fixture || !pick) return null; return { id: `${fixture.id}:corners:expected-over`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date, market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey, decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null, impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct, expectedValue: pick.expectedValuePct, fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.level, reasoning: `${result.preMatchSignal} Proyección total: ${pick.projectedTotal} corners.`, requiresReview: result.status !== "available" || !pick.hasOdds, sourceModule: "corners", source: result.source, supportingData: pick.supportingData, contradictingData: pick.contradictingData }; }
function addCornerPick(key) { const leg = cornerLeg(key); if (leg) appendPickToParlay(leg, "Pick de corners agregado a Mi parlay."); }
function saveCornerPick(key) { const leg = cornerLeg(key); if (leg) saveIndividualLeg({ ...leg, result: "pending" }); }
function addExpectedCornersPick() { const leg = expectedCornersLeg(); if (leg) appendPickToParlay(leg, "Pick de corners esperados agregado a Mi parlay."); }
function saveExpectedCornersPick() { const leg = expectedCornersLeg(); if (leg) saveIndividualLeg({ ...leg, result: "pending" }); }

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

async function loadSpecificMarkets(forceRefresh = false) {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingSpecificMarkets) return;
  if (!forceRefresh && state.specificMarketsByFixture.has(fixture.id)) {
    renderSpecificMarkets(state.specificMarketsByFixture.get(fixture.id));
    elements.specificMarketsContent.hidden = false;
    return;
  }
  state.isLoadingSpecificMarkets = true;
  elements.showSpecificMarkets.disabled = true;
  elements.showSpecificMarkets.textContent = forceRefresh ? "Actualizando…" : "Evaluando…";
  try {
    const result = await footballDataService.getSpecificMarkets(fixture, forceRefresh);
    state.specificMarketsByFixture.set(fixture.id, result);
    renderSpecificMarkets(result);
    elements.specificMarketsContent.hidden = false;
    if (forceRefresh) showNotice("Catálogo de mercados actualizado.");
  } catch (error) {
    renderSpecificMarkets({ status: "not_available", groups: [], warnings: [error.message] });
    elements.specificMarketsContent.hidden = false;
  } finally {
    state.isLoadingSpecificMarkets = false;
    elements.showSpecificMarkets.disabled = !selectedFixture();
    elements.showSpecificMarkets.textContent = "Actualizar mercados";
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
  const individualForm = result?.individualForm || [];
  const statusLabels = {
    available: ["Disponible", "available"], insufficient_data: ["Datos insuficientes", "partial"],
    no_player_coverage: ["Sin cobertura", "unavailable"], not_available: ["No disponible", "unavailable"], error: ["Error", "unavailable"]
  };
  const [label, status] = statusLabels[result?.status] || statusLabels.not_available;
  elements.playerGoalStatus.className = `status-badge status-badge--${status}`;
  elements.playerGoalStatus.textContent = label;
  const formRows = individualForm.map((player) => `<tr><td>${escapeHtml(player.playerName)}</td><td>${escapeHtml(player.teamName)}</td><td>${displayValue(player.score, 0)}/100</td><td>${displayValue(player.threatScore, 0)}/100</td><td>${displayValue(player.appearances, 0)}/${displayValue(player.matchesEvaluated, 0)}</td><td>${displayValue(player.minutes, 0)}</td><td>${displayValue(player.goals, 0)} + ${displayValue(player.assists, 0)}</td><td>${displayValue(player.shots, 0)} / ${displayValue(player.shotsOnTarget, 0)}</td><td>${player.xg === null ? "No disp." : displayValue(player.xg)}</td><td>${escapeHtml(player.trend || "estable")}</td><td>${player.isProbableStarter === null ? "No confirmado" : player.isProbableStarter ? "Sí" : "No confirmado"}</td></tr>`).join("");
  const formTable = formRows ? `<section class="collection-block"><h3>Forma individual agregada</h3><p class="muted-text">Combina participación, minutos, producción ofensiva, tiros, regularidad y calidad de muestra.</p><div class="table-scroll"><table class="compact-table"><thead><tr><th>Jugador</th><th>Equipo</th><th>Forma</th><th>Amenaza</th><th>Partidos</th><th>Min.</th><th>G+A</th><th>Tiros/Arco</th><th>xG</th><th>Tendencia</th><th>Titular probable</th></tr></thead><tbody>${formRows}</tbody></table></div></section>` : "";
  if (!candidates.length) {
    const coverage = result?.coverage ? ` Jugadores evaluados: ${displayValue(result.playersEvaluated, 0)}. Fixtures con jugadores: local ${displayValue(result.coverage.homePlayerFixtures, 0)}, visitante ${displayValue(result.coverage.awayPlayerFixtures, 0)}.` : "";
    elements.playerGoalContent.innerHTML = `<div class="research-empty"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(result?.message || "Datos insuficientes para sugerir jugador con posible gol.")}${escapeHtml(coverage)}</p></div>${formTable}`;
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
  </article>`).join("")}</div><div class="table-scroll player-goal-table-wrap"><table class="compact-table player-goal-table"><thead><tr><th>Jugador</th><th>Equipo</th><th>Partidos</th><th>Min.</th><th>Goles</th><th>Tiros</th><th>Arco</th><th>xG</th><th>Prob.</th><th>Conf.</th><th>Advertencias</th></tr></thead><tbody>${candidateRows}</tbody></table></div>${formTable}`;
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

async function loadPlayerGoalCandidates(fixture, forceRefresh = false, reveal = false) {
  if (!fixture || state.playerGoalLoadingFixtures.has(fixture.id)) return;
  const saved = state.playerGoalByFixture.get(fixture.id);
  if (!forceRefresh && saved) return renderPlayerGoalCandidates(saved);
  state.playerGoalLoadingFixtures.add(fixture.id);
  elements.togglePlayerGoal.disabled = true;
  elements.refreshPlayerGoal.disabled = true;
  elements.playerGoalStatus.className = "status-badge status-badge--processing";
  elements.playerGoalStatus.textContent = forceRefresh ? "Actualizando" : "Analizando";
  elements.playerGoalContent.innerHTML = '<div class="research-empty"><div class="loading-spinner" aria-hidden="true"></div><p>Analizando jugadores con mayor amenaza de gol…</p></div>';
  try {
    const result = await footballDataService.getPlayerGoalCandidates(fixture, forceRefresh);
    state.playerGoalByFixture.set(fixture.id, result);
    if (String(state.selectedFixtureId) === String(fixture.id)) renderPlayerGoalCandidates(result);
    if (reveal) showModuleReady(elements.togglePlayerGoal, elements.playerGoalContent);
    else elements.playerGoalContent.hidden = true;
    if (forceRefresh) showNotice("Amenaza ofensiva individual actualizada.");
  } catch (error) {
    if (String(state.selectedFixtureId) === String(fixture.id)) renderPlayerGoalCandidates({ status: "error", candidates: [], message: error.message });
  } finally {
    state.playerGoalLoadingFixtures.delete(fixture.id);
    if (String(state.selectedFixtureId) === String(fixture.id)) elements.togglePlayerGoal.disabled = false;
    if (String(state.selectedFixtureId) === String(fixture.id)) elements.refreshPlayerGoal.disabled = false;
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

async function loadTeamPerformance(fixture, forceRefresh = false, reveal = false) {
  if (!fixture || state.teamPerformanceLoadingFixtures.has(fixture.id)) return;
  const saved = state.teamPerformanceByFixture.get(fixture.id);
  if (!forceRefresh && saved) return renderTeamPerformance(saved, fixture);
  state.teamPerformanceLoadingFixtures.add(fixture.id);
  elements.refreshTeamPerformance.disabled = true;
  elements.teamPerformanceTitle.textContent = "Rendimiento promedio por equipo";
  elements.teamPerformanceStatus.className = "status-badge status-badge--processing";
  elements.teamPerformanceStatus.textContent = forceRefresh ? "Actualizando" : "Calculando";
  elements.teamPerformanceContent.innerHTML = '<div class="research-empty"><div class="loading-spinner" aria-hidden="true"></div><p>Comparando la misma ventana histórica para ambos equipos…</p></div>';
  applyTeamPerformanceVisibility(reveal);
  try {
    const result = await footballDataService.getTeamPerformance(fixture, forceRefresh);
    state.teamPerformanceByFixture.set(fixture.id, result);
    if (String(state.selectedFixtureId) === String(fixture.id)) renderTeamPerformance(result, fixture);
    if (!reveal) {
      elements.teamPerformanceContent.hidden = true;
      resetModuleButton(elements.toggleTeamPerformance);
    }
    if (forceRefresh) showNotice("Forma individual agregada actualizada.");
  } catch (error) {
    if (String(state.selectedFixtureId) === String(fixture.id)) renderTeamPerformance({ status: "not_available", k: 0, message: error.message }, fixture);
  } finally {
    state.teamPerformanceLoadingFixtures.delete(fixture.id);
    if (String(state.selectedFixtureId) === String(fixture.id)) elements.refreshTeamPerformance.disabled = false;
  }
}

async function selectFixture(fixtureId, analysisMode = null) {
  if (state.isAnalyzing) return;
  resetAnalysisGuide();
  state.selectedFixtureId = fixtureId;
  renderMatches();
  const fixtureIndex = state.fixtures.findIndex((fixture) => fixture.id === fixtureId);

  try {
    const detailedFixture = hydrateFixtureFromEvidence(await footballDataService.getFixtureData(selectedFixture()));
    if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = detailedFixture;
    renderMatches();
    renderFixtureData();
    if (!analysisMode) showFixtureReadyDialog();
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
    purgeInvalidEvidenceSnapshots({ sync: true, render: false });
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
    const detailedFixture = hydrateFixtureFromEvidence(await footballDataService.getFixtureData(fixture, true));
    const previousSignature = JSON.stringify((fixture.researchData?.sourceCoverage || []).map((item) => [item.moduleKey, item.status]));
    const nextSignature = JSON.stringify((detailedFixture.researchData?.sourceCoverage || []).map((item) => [item.moduleKey, item.status]));
    const fixtureIndex = state.fixtures.findIndex((item) => item.id === fixture.id);
    if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = detailedFixture;
    if (state.preferences.alertData && previousSignature !== nextSignature) {
      addAlert("data", "Cobertura actualizada", "Cambió la disponibilidad de uno o más módulos del partido.", detailedFixture);
    }
    renderMatches();
    renderFixtureData();
    showNotice("Cobertura y fuentes actualizadas desde API-Football.");
  } catch (error) {
    try {
      const researchData = await footballDataService.getResearchData(fixture.id, true);
      const fixtureIndex = state.fixtures.findIndex((item) => item.id === fixture.id);
      if (fixtureIndex >= 0 && researchData) {
        state.fixtures[fixtureIndex] = { ...state.fixtures[fixtureIndex], researchData };
      }
      renderMatches();
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

function weatherCanChange(fixture = selectedFixture(), now = Date.now()) {
  if (!fixture || fixture.status === "finished") return false;
  const kickoff = Date.parse(fixture.utcDateTime || `${fixture.date || ""}T${fixture.time || "00:00"}`);
  if (!Number.isFinite(kickoff)) return fixture.status === "live";
  return fixture.status === "live" || (kickoff - now <= 16 * 24 * 60 * 60 * 1000 && now - kickoff <= 3 * 60 * 60 * 1000);
}

async function refreshWeatherData({ silent = false } = {}) {
  const fixture = selectedFixture();
  if (!fixture || state.isRefreshingWeather || !weatherCanChange(fixture)) return;
  state.isRefreshingWeather = true;
  try {
    const payload = await footballDataService.getWeatherData(fixture.id, true);
    if (!payload?.researchData || String(state.selectedFixtureId) !== String(fixture.id)) return;
    const fixtureIndex = state.fixtures.findIndex((item) => String(item.id) === String(fixture.id));
    if (fixtureIndex < 0) return;
    const updatedFixture = {
      ...state.fixtures[fixtureIndex],
      researchData: payload.researchData,
      dataAvailability: {
        ...(state.fixtures[fixtureIndex].dataAvailability || {}),
        weather: payload.weatherPitch?.status === "partial" ? "Necesita revisiÃ³n" : "No disponible"
      }
    };
    state.fixtures[fixtureIndex] = updatedFixture;
    renderResearchData(updatedFixture.researchData);
    renderCoverageTable(updatedFixture);
    renderGuideCoverageSummary(updatedFixture);
    if (elements.dataDialog.open && elements.dataDialogTitle.textContent === "Clima / cancha") {
      elements.dataDialogContent.innerHTML = `${fixtureProgressBanner(updatedFixture)}${renderResearchModuleDetail("weatherPitch", updatedFixture.researchData)}`;
    }
    if (!silent) showNotice("Clima del estadio actualizado desde Open-Meteo.");
  } catch (error) {
    if (!silent) showNotice(error.message || "No fue posible actualizar el clima del estadio.");
  } finally {
    state.isRefreshingWeather = false;
  }
}

async function refreshLiveDataNow() {
  const fixture = selectedFixture();
  if (!fixture || state.isRefreshingLive) return;
  if (fixture.status !== "live") {
    state.lastLiveRefreshAt = new Date().toISOString();
    renderLiveData(fixture.researchData, fixture);
    showNotice(`El encuentro está ${fixture.statusLabel || fixture.status}; En vivo solo consulta partidos activos.`);
    return;
  }
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
  state.expandedMatchGroups.clear();
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
    purgeInvalidEvidenceSnapshots({ sync: true, render: false });
    const source = state.fixtures.some((fixture) => fixture.dataSource === "api-football") ? "API-Football" : "simulación";
    const validCount = state.fixtures.length;
    elements.searchFeedback.textContent = `${validCount} ${validCount === 1 ? "encuentro válido" : "encuentros válidos"} desde ${source} · ${new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    elements.filterError.hidden = true;
    elements.filterError.textContent = "";
    renderMatches();
    void registerAutomaticEvidence(state.fixtures);
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
  if ([elements.competitionCountry, elements.competitionConfederation, elements.competitionType].includes(input)) applyCompetitionMetadataFilters();
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
elements.refreshOutcome.addEventListener("click", () => loadOutcomeScenarios(true));
elements.refreshPlayerGoal.addEventListener("click", () => loadPlayerGoalCandidates(selectedFixture(), true, true));
elements.refreshTeamPerformance.addEventListener("click", () => loadTeamPerformance(selectedFixture(), true, true));
elements.refreshCorners.addEventListener("click", () => loadCorners(true));
elements.refreshFixtureStatuses.addEventListener("click", refreshFixtureStatuses);
elements.refreshLiveNow.addEventListener("click", refreshLiveDataNow);
elements.collectPickInfo.addEventListener("click", collectPickInformation);
elements.pickCollectionContent.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-collection-pick]");
  if (add) addCollectionPick(add.dataset.addCollectionPick);
});
elements.simulationUseSelected.addEventListener("click", useSelectedFixtureForSimulation);
elements.simulationCompare.addEventListener("click", runSimulationComparison);
elements.simulationAdvanced.addEventListener("click", runAdvancedSimulation);
elements.simulationCompetition.addEventListener("change", applySimulationCompetitionSelection);
elements.simulationCompetition.addEventListener("input", () => { elements.simulationCompare.dataset.fixtureId = ""; });
elements.simulationTeamASearch.addEventListener("input", () => applySimulationTeamSelection("A"));
elements.simulationTeamASearch.addEventListener("change", () => applySimulationTeamSelection("A"));
elements.simulationTeamBSearch.addEventListener("input", () => applySimulationTeamSelection("B"));
elements.simulationTeamBSearch.addEventListener("change", () => applySimulationTeamSelection("B"));
[elements.simulationTeamAId, elements.simulationTeamBId, elements.simulationTeamAName, elements.simulationTeamBName].forEach((input) => input.addEventListener("input", () => { elements.simulationCompare.dataset.fixtureId = ""; }));
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
elements.showOutcome.addEventListener("click", () => toggleReadyModule(elements.showOutcome, elements.outcomeContent));
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
elements.showCorners.addEventListener("click", () => toggleReadyModule(elements.showCorners, elements.cornersContent));
elements.cornersContent.addEventListener("click", (event) => { const add = event.target.closest("[data-add-corners]"); const save = event.target.closest("[data-save-corners]"); const addExpected = event.target.closest("[data-add-expected-corners]"); const saveExpected = event.target.closest("[data-save-expected-corners]"); if (add) addCornerPick(add.dataset.addCorners); if (save) saveCornerPick(save.dataset.saveCorners); if (addExpected) addExpectedCornersPick(); if (saveExpected) saveExpectedCornersPick(); });
elements.showSpecificMarkets.addEventListener("click", () => loadSpecificMarkets(true));
elements.specificMarketsContent.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-specific]");
  const save = event.target.closest("[data-save-specific]");
  if (add) addSpecificMarketPick(add.dataset.addSpecific);
  if (save) saveSpecificMarketPick(save.dataset.saveSpecific);
});
elements.dataDialogClose.addEventListener("click", closeDataDialog);
elements.fixtureReadyAccept.addEventListener("click", () => elements.fixtureReadyDialog.close());
elements.dataDialogContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-odds-pick]");
  const saveButton = event.target.closest("[data-save-odds-pick]");
  const addH2HButton = event.target.closest("[data-add-h2h-pick]");
  const addRecentFormButton = event.target.closest("[data-add-recent-form-pick]");
  if (addButton) addOddsPickToParlay(addButton.dataset.addOddsPick);
  if (saveButton) saveOddsPick(saveButton.dataset.saveOddsPick);
  if (addH2HButton) addH2HRecommendationToParlay(addH2HButton.dataset);
  if (addRecentFormButton) addRecentFormRecommendationToParlay(addRecentFormButton.dataset);
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
elements.parlayDraftList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-draft]");
  if (!button) return;
  const leg = state.parlayDraft.find((item) => item.id === button.dataset.removeDraft);
  if (!await confirmDeletion(`El pick "${leg?.selection || "seleccionado"}" se quitará del cupón en preparación.`, "¿Quitar pick del cupón?")) return;
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
elements.parlayFab.addEventListener("click", () => renderParlayDraft(true, false));
elements.saveParlay.addEventListener("click", saveCurrentParlay);
[elements.updateIndividualResults, elements.updateOriginResults, elements.updateOriginLostResults, elements.updateOriginRecommendations, elements.updateCompetitionResults, elements.updateParlayResults]
  .forEach((button) => button.addEventListener("click", updateSavedParlayResults));
elements.applySavedDateFilter.addEventListener("click", () => {
  state.savedDateFilter = elements.savedDateFilter.value;
  renderSavedPicks();
  renderSavedParlays();
});
elements.clearSavedDateFilter.addEventListener("click", () => {
  state.savedDateFilter = state.savedDateFilter ? "" : pacificToday();
  elements.savedDateFilter.value = state.savedDateFilter;
  renderSavedPicks();
  renderSavedParlays();
});
const handleOriginDetailClick = (event) => {
  const open = event.target.closest("[data-view-origin-picks]");
  if (open) showOriginPicksDialog(open.dataset.viewOriginPicks, open.dataset.originResult || "won");
};
elements.originPerformance.addEventListener("click", handleOriginDetailClick);
elements.originLostPerformance.addEventListener("click", handleOriginDetailClick);
elements.originPicksClose.addEventListener("click", () => elements.originPicksDialog.close());
elements.originPicksDialog.addEventListener("click", (event) => {
  if (event.target === elements.originPicksDialog) elements.originPicksDialog.close();
});
elements.savedParlaysList.addEventListener("change", (event) => {
  const select = event.target.closest("[data-leg-result]");
  const card = event.target.closest("[data-parlay-id]");
  const legRow = event.target.closest("[data-leg-id]");
  if (!select || !card || !legRow) return;
  const parlay = state.savedParlays.find((item) => item.id === card.dataset.parlayId);
  const leg = parlay?.legs.find((item) => item.id === legRow.dataset.legId);
  if (!leg) return;
  leg.result = select.value;
  if (select.value === "pending") {
    delete leg.resultSource;
    delete leg.settlementVerificationVersion;
    delete leg.settlementVerificationStatus;
    delete leg.settlementVerifiedAt;
  } else {
    leg.resultSource = "manual";
    leg.settlementVerificationVersion = SETTLEMENT_VERIFICATION_VERSION;
    leg.settlementVerificationStatus = "manual";
    leg.settlementVerifiedAt = new Date().toISOString();
  }
  leg.updatedAt = new Date().toISOString();
  parlay.result = calculateParlayResult(parlay.legs);
  parlay.updatedAt = leg.updatedAt;
  persistSavedParlays();
  renderSavedParlays();
  refreshActivePickIndicators();
});
elements.savedPicksList.addEventListener("change", (event) => {
  const select = event.target.closest("[data-pick-result]");
  const card = event.target.closest("[data-pick-id]");
  if (!select || !card) return;
  const pick = state.savedPicks.find((item) => item.id === card.dataset.pickId);
  if (!pick) return;
  pick.result = select.value;
  if (select.value === "pending") {
    delete pick.resultSource;
    delete pick.settlementVerificationVersion;
    delete pick.settlementVerificationStatus;
    delete pick.settlementVerifiedAt;
  } else {
    pick.resultSource = "manual";
    pick.settlementVerificationVersion = SETTLEMENT_VERIFICATION_VERSION;
    pick.settlementVerificationStatus = "manual";
    pick.settlementVerifiedAt = new Date().toISOString();
  }
  pick.updatedAt = new Date().toISOString();
  persistSavedPicks();
  renderSavedPicks();
  renderOriginPerformance();
  refreshActivePickIndicators();
  showNotice(`Resultado manual guardado como ${resultLabels[pick.result].toLowerCase()}.`);
});
elements.savedParlaysList.addEventListener("input", (event) => {
  const notes = event.target.closest("[data-parlay-notes]");
  const card = event.target.closest("[data-parlay-id]");
  if (!notes || !card) return;
  const parlay = state.savedParlays.find((item) => item.id === card.dataset.parlayId);
  if (parlay) {
    parlay.notes = notes.value;
    parlay.updatedAt = new Date().toISOString();
    persistSavedParlays();
  }
});
elements.savedParlaysList.addEventListener("click", async (event) => {
  const toggleButton = event.target.closest("[data-toggle-parlay]");
  const deleteButton = event.target.closest("[data-delete-parlay]");
  const removeLegButton = event.target.closest("[data-remove-parlay-leg]");
  const saveLegButton = event.target.closest("[data-save-parlay-leg]");
  const card = event.target.closest("[data-parlay-id]");
  if (toggleButton && card) {
    if (state.expandedParlays.has(card.dataset.parlayId)) state.expandedParlays.delete(card.dataset.parlayId);
    else state.expandedParlays.add(card.dataset.parlayId);
    renderSavedParlays();
    return;
  }
  if (saveLegButton && card) {
    const legRow = saveLegButton.closest("[data-leg-id]");
    const parlay = state.savedParlays.find((item) => item.id === card.dataset.parlayId);
    const leg = parlay?.legs?.find((item) => String(item.id) === String(legRow?.dataset.legId));
    if (!leg) return;
    leg.updatedAt = new Date().toISOString();
    parlay.updatedAt = leg.updatedAt;
    persistSavedParlays();
    renderOriginPerformance();
    showNotice(`Pick "${leg.selection}" guardado.`);
    return;
  }
  if (removeLegButton && card) {
    const legRow = removeLegButton.closest("[data-leg-id]");
    const parlay = state.savedParlays.find((item) => item.id === card.dataset.parlayId);
    if (!parlay || !legRow) return;
    if ((parlay.legs || []).length <= 1) {
      showNotice("El parlay debe conservar al menos una selección. Puedes mover el cupón completo a Papelera.");
      return;
    }
    const leg = parlay.legs.find((item) => String(item.id) === String(legRow.dataset.legId));
    if (!await confirmDeletion(`El pick "${leg?.selection || "seleccionado"}" se moverá a Papelera y dejará de contar en resultados por origen, competición, tipos y mejores picks.`, "¿Quitar pick del parlay?")) return;
    state.savedParlays = state.savedParlays.map((item) => item.id === parlay.id ? removeParlayLeg(item, legRow.dataset.legId) : item);
    persistSavedParlays();
    renderSavedParlays();
    refreshActivePickIndicators();
    showNotice("Pick enviado a Papelera y excluido de todos los resúmenes de rendimiento.");
    return;
  }
  if (!deleteButton || !card) return;
  if (!await confirmDeletion("El parlay se moverá a Papelera y podrá recuperarse después.", "¿Mover parlay a Papelera?")) return;
  state.savedParlays = state.savedParlays.map((item) => item.id === card.dataset.parlayId ? moveParlayToTrash(item) : item);
  state.expandedParlays.delete(card.dataset.parlayId);
  persistSavedParlays();
  renderSavedParlays();
  refreshActivePickIndicators();
  showNotice("Parlay enviado a Papelera. Puedes recuperarlo desde Mis apuestas.");
});
elements.trashParlaysList.addEventListener("click", async (event) => {
  const removedCard = event.target.closest("[data-removed-parlay-id][data-removed-leg-id]");
  if (removedCard) {
    const parlayId = removedCard.dataset.removedParlayId;
    const legId = removedCard.dataset.removedLegId;
    if (event.target.closest("[data-restore-removed-leg]")) {
      state.savedParlays = state.savedParlays.map((parlay) => parlay.id === parlayId ? restoreRemovedParlayLeg(parlay, legId) : parlay);
      persistSavedParlays();
      renderSavedParlays();
      refreshActivePickIndicators();
      showNotice("Pick recuperado en su parlay y reincorporado a los resúmenes.");
      return;
    }
    if (!event.target.closest("[data-delete-removed-leg-forever]")) return;
    if (!await confirmDeletion("El pick se eliminará definitivamente de la Papelera. No podrá recuperarse.", "¿Eliminar pick definitivamente?")) return;
    state.savedParlays = state.savedParlays.map((parlay) => parlay.id === parlayId ? permanentlyDeleteRemovedParlayLeg(parlay, legId) : parlay);
    persistSavedParlays();
    renderSavedParlays();
    showNotice("Pick eliminado definitivamente.");
    return;
  }
  const card = event.target.closest("[data-trash-parlay-id]");
  if (!card) return;
  const id = card.dataset.trashParlayId;
  if (event.target.closest("[data-restore-parlay]")) {
    state.savedParlays = state.savedParlays.map((parlay) => parlay.id === id ? restoreParlayFromTrash(parlay) : parlay);
    persistSavedParlays(); renderSavedParlays(); refreshActivePickIndicators(); showNotice("Parlay recuperado y devuelto a Parlays guardados."); return;
  }
  if (!event.target.closest("[data-delete-parlay-forever]")) return;
  if (!await confirmDeletion("El parlay se eliminará definitivamente. Esta acción no se puede deshacer.", "¿Eliminar parlay definitivamente?")) return;
  state.savedParlays = state.savedParlays.map((parlay) => parlay.id === id
    ? { ...parlay, trashed: true, deletedPermanently: true, purgedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    : parlay);
  persistSavedParlays(); renderSavedParlays(); refreshActivePickIndicators(); showNotice("Parlay retirado de la vista. Sus resultados concluidos se conservan en el conteo por origen.");
});
elements.savedPicksList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-pick-id]");
  if (!card || !event.target.closest("[data-delete-pick]")) return;
  if (!await confirmDeletion("El pick individual se retirará de la vista y se conservará su resultado histórico cuando corresponda.", "¿Eliminar pick individual?")) return;
  state.savedPicks = state.savedPicks.map((pick) => pick.id === card.dataset.pickId
    ? { ...pick, trashed: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    : pick);
  persistSavedPicks();
  renderSavedPicks();
  renderOriginPerformance();
  refreshActivePickIndicators();
  showNotice("Pick retirado de la vista. Si está concluido, permanece en el conteo por origen.");
});
document.addEventListener("click", (event) => {
  const savedTab = event.target.closest("[data-saved-tab]");
  if (savedTab) {
    state.savedTab = savedTab.dataset.savedTab;
    document.querySelectorAll("[data-saved-tab]").forEach((button) => button.classList.toggle("saved-tab--active", button === savedTab));
    elements.savedIndividualSection.hidden = state.savedTab !== "individual";
    elements.originResultsSection.hidden = state.savedTab !== "origins-won";
    elements.originLostResultsSection.hidden = state.savedTab !== "origins-lost";
    elements.competitionResultsSection.hidden = state.savedTab !== "competitions";
    elements.pickTypesWonSection.hidden = state.savedTab !== "types-won";
    elements.pickTypesLostSection.hidden = state.savedTab !== "types-lost";
    elements.originRecommendationsSection.hidden = state.savedTab !== "origin-recommendations";
    elements.savedParlaysSection.hidden = state.savedTab !== "parlays";
    elements.trashResultsSection.hidden = state.savedTab !== "trash";
    elements.savedDateFilterPanel.hidden = !["individual", "parlays"].includes(state.savedTab);
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) switchView(viewButton.dataset.view);
});
sidebarToggle.addEventListener("click", () => setSidebarOpen(sidebarToggle.getAttribute("aria-expanded") !== "true"));
sidebarClose.addEventListener("click", () => setSidebarOpen(false, { restoreFocus: true }));
sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false, { restoreFocus: true }));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebarToggle.getAttribute("aria-expanded") === "true") {
    setSidebarOpen(false, { restoreFocus: true });
  }
});
window.addEventListener("resize", () => {
  if (!window.matchMedia("(max-width: 980px)").matches && sidebarToggle.getAttribute("aria-expanded") === "true") {
    setSidebarOpen(false);
  }
});
elements.matchesList.addEventListener("click", async (event) => {
  const groupToggle = event.target.closest("[data-toggle-league]");
  if (groupToggle) {
    const leagueSlug = groupToggle.dataset.toggleLeague;
    const shouldExpand = !state.expandedMatchGroups.has(leagueSlug);
    if (shouldExpand) state.expandedMatchGroups.add(leagueSlug);
    else state.expandedMatchGroups.delete(leagueSlug);
    renderMatches();
    elements.matchesList.querySelector(`[data-toggle-league="${CSS.escape(leagueSlug)}"]`)?.focus();
    return;
  }
  const favoriteButton = event.target.closest("[data-favorite-side]");
  if (favoriteButton) {
    const card = favoriteButton.closest("[data-fixture-id]");
    const fixture = state.fixtures.find((item) => String(item.id) === String(card?.dataset.fixtureId));
    if (fixture) await toggleTeamFavorite(favoriteTeamFromFixture(fixture, favoriteButton.dataset.favoriteSide));
    return;
  }
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-fixture-id]");
  if (!card) return;
  await selectFixture(card.dataset.fixtureId, button?.dataset.action === "data" ? "data" : null);
  if (button?.dataset.action === "season") {
    openSupportingDetail("teamSeasonStatistics");
    return;
  }
  if (button?.dataset.action === "data") {
    showFixtureReadyDialog();
    return;
  }
});
elements.favoriteTeamsList.addEventListener("click", (event) => {
  const refresh = event.target.closest("[data-refresh-favorite-team]");
  const remove = event.target.closest("[data-remove-favorite-team]");
  const id = refresh?.dataset.refreshFavoriteTeam || remove?.dataset.removeFavoriteTeam;
  const team = favoriteTeams().find((item) => String(item.id) === String(id));
  if (!team) return;
  if (refresh) void loadFavoriteTeamStats(team, true);
  if (remove) void toggleTeamFavorite(team);
});
elements.refreshFavoriteTeams.addEventListener("click", refreshAllFavoriteTeams);
elements.matchesList.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-fixture-id]");
  if (!card || event.target.closest("button")) return;
  event.preventDefault();
  await selectFixture(card.dataset.fixtureId, false);
});

elements.themeToggle.addEventListener("click", () => applyTheme(state.preferences.theme === "dark" ? "light" : "dark", { userInitiated: true }));
elements.toggleTeamPerformance.addEventListener("click", () => {
  const fixture = selectedFixture();
  if (!fixture) return;
  if (!state.teamPerformanceByFixture.has(fixture.id)) {
    void loadTeamPerformance(fixture, false, true);
    return;
  }
  applyTeamPerformanceVisibility(elements.teamPerformanceContent.hidden);
});
elements.togglePlayerGoal.addEventListener("click", () => {
  const fixture = selectedFixture();
  if (!fixture) return;
  if (!state.playerGoalByFixture.has(fixture.id)) {
    void loadPlayerGoalCandidates(fixture, false, true);
    return;
  }
  toggleReadyModule(elements.togglePlayerGoal, elements.playerGoalContent);
});
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
elements.outcomeContent.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-outcome]");
  if (!add) return;
  const leg = outcomeScenarioLeg(add.dataset.addOutcome);
  if (leg) appendPickToParlay(leg, "Pick 1X2 agregado a Mi parlay.");
});
elements.savePreMatchEvidence.addEventListener("click", capturePreMatchEvidence);
elements.auditFixture.addEventListener("change", () => {
  const hasEvidence = Boolean(selectedAuditEvidence());
  elements.runAudit.disabled = !elements.auditFixture.value || !hasEvidence;
  elements.viewAuditEvidence.disabled = !hasEvidence;
  elements.auditEvidencePreview.hidden = true;
});
elements.runAudit.addEventListener("click", runSelectedAudit);
elements.evidenceReadinessList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-evaluate-evidence]");
  if (button) void evaluateCompetitionEvidence(button.dataset.evaluateEvidence);
});
elements.viewAuditEvidence.addEventListener("click", showAuditEvidencePreview);
elements.closeAuditEvidence.addEventListener("click", () => { elements.auditEvidencePreview.hidden = true; });
elements.accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.preferences.name = elements.accountName.value.trim();
  state.preferences.dailyLimit = elements.accountDailyLimit.value;
  applyTheme(elements.accountDarkMode.checked ? "dark" : "light", { userInitiated: true });
  writeLocalJson(PREFERENCES_KEY, state.preferences);
  showNotice(cloudSyncClient.session?.accessToken ? "Preferencias guardadas y preparadas para sincronizar." : "Preferencias guardadas en este navegador.");
});

async function handleCloudCredentials(mode) {
  const email = elements.cloudEmailInput.value.trim();
  const password = elements.cloudPasswordInput.value;
  if (!email || password.length < 8) return showNotice("Escribe tu correo y una contraseña de al menos 8 caracteres.");
  state.cloud.syncing = true;
  state.cloud.error = "";
  state.cloud.notice = "";
  renderCloudAccount();
  try {
    if (mode === "sign-up") {
      const result = await cloudSyncClient.signUp(email, password);
      if (!result.session) {
        state.cloud.notice = "Cuenta creada. Revisa tu correo para confirmarla y después inicia sesión.";
        showNotice("Cuenta creada. Revisa el correo de confirmación enviado por Supabase.");
        return;
      }
    } else {
      await cloudSyncClient.signIn(email, password);
    }
    elements.cloudPasswordInput.value = "";
    state.cloud.syncing = false;
    await connectCloudAccount();
    showNotice("Cuenta conectada. Tus datos locales fueron sincronizados.");
  } catch (error) {
    state.cloud.error = error.message;
    showNotice(error.message);
  } finally {
    state.cloud.syncing = false;
    renderCloudAccount();
  }
}

elements.cloudSignIn.addEventListener("click", () => void handleCloudCredentials("sign-in"));
elements.cloudSignUp.addEventListener("click", () => void handleCloudCredentials("sign-up"));
elements.cloudPasswordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); void handleCloudCredentials("sign-in"); }
});
elements.cloudSyncNow.addEventListener("click", () => void syncCloudState({ announce: true, refreshFirst: true }));
elements.cloudSignOut.addEventListener("click", async () => {
  await syncCloudState();
  await cloudSyncClient.signOut();
  clearLocalAccountData();
  state.cloud.lastSyncedAt = null;
  state.cloud.error = "";
  state.cloud.notice = "";
  state.cloud.ready = true;
  elements.cloudEmailInput.value = "";
  elements.cloudPasswordInput.value = "";
  renderCloudAccount();
  showNotice("Sesión cerrada. La copia personal se retiró de este navegador.");
});

document.querySelectorAll("[data-nav-label]").forEach((button) => {
  button.addEventListener("click", () => {
    showNotice(`${button.dataset.navLabel} es un módulo preparado, pero todavía no está habilitado.`);
  });
});

initializeInfoTooltips();

async function initializeApp() {
  renderLeagueOptions();
  renderCompetitionFilters();
  const today = pacificToday();
  elements.dateFrom.value ||= today;
  elements.dateTo.value ||= today;
  elements.savedDateFilter.value = state.savedDateFilter;
  elements.competition.value = "all";
  elements.season.value = "auto";
  syncCompetitionCheckboxes();
  elements.accountName.value = state.preferences.name || "";
  elements.accountDailyLimit.value = state.preferences.dailyLimit || "none";
  applyTheme(state.preferences.theme || "dark");
  renderParlayDraft();
  renderSavedPicks();
  renderSavedParlays();
  applyTeamPerformanceVisibility(teamPerformanceVisible());
  await initializeCloudAccount();
  const runtime = await footballDataService.getRuntime();
  if (runtime.mode === "live") await loadEvidenceLibrary();
  const releaseElement = document.querySelector("#site-last-update");
  const releaseDate = runtime.release?.deployedAt || document.lastModified;
  const releaseCommit = runtime.release?.commit ? ` · versión ${runtime.release.commit}` : "";
  releaseElement.textContent = `Última actualización: ${formatSiteRelease(releaseDate)} PT${releaseCommit}`;
  document.querySelector("#runtime-api").textContent = `API · ${runtime.providers?.apiFootball?.configured ? "activa" : "no disponible"}`;
  document.querySelector("#runtime-ai").textContent = "Reglas · activo";
  document.querySelector("#runtime-version").textContent = `Versión · ${runtime.release?.commit || "local"}`;
  if (runtime.mode === "live") {
    document.querySelector("#runtime-mode").textContent = runtime.liveReady ? "Datos reales" : "Configuración pendiente";
    document.querySelector("#runtime-description").textContent = runtime.liveReady
      ? "API-Football y el motor de reglas están configurados en el backend."
      : `Faltan variables del servidor: ${(runtime.missing || []).join(", ")}.`;
    document.querySelector("#data-mode-note").textContent = "Los partidos y la cobertura se consultan desde API-Football. El análisis se ejecuta con modelos internos y reglas deterministas.";
  } else if (window.location.hostname.endsWith("github.io")) {
    document.querySelector("#runtime-mode").textContent = "Demo pública sin APIs";
    document.querySelector("#runtime-description").textContent = "GitHub Pages no ejecuta el backend; los partidos y análisis mostrados son sintéticos.";
  }
  renderMatches();
}

initializeApp();
