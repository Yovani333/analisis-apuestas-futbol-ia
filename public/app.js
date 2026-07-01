import { ALLOWED_LEAGUES, DATA_CATEGORIES, MOCK_FIXTURES } from "./mock-data.js?v=20260624-premium-dashboard-2";
import { footballDataService } from "./services.js?v=20260701-corners";
import { applyAnalysisTiming, resolveAnalysisTiming } from "./analysis-timing.js?v=20260630-timing";
import {
  calculateHistoryMetrics, calculateParlayResult, createSavedParlay, createSavedPick, loadParlayDraft, loadSavedParlays,
  loadSavedPicks, normalizePickLeg, saveParlayDraft, saveSavedParlays, saveSavedPicks, settleLegResult
} from "./parlay-store.js?v=20260630-common-picks";

const ALERTS_KEY = "football-ai.alerts.v1";
const PREFERENCES_KEY = "football-ai.preferences.v1";
const ANALYSIS_USAGE_KEY = "football-ai.analysis-usage.v1";
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
  poissonByFixture: new Map(),
  teamGoalsByFixture: new Map(),
  cornersByFixture: new Map(),
  parlayDraft: loadParlayDraft(),
  savedParlays: loadSavedParlays(),
  savedPicks: loadSavedPicks(),
  savedTab: "individual",
  expandedParlays: new Set(),
  alerts: readLocalJson(ALERTS_KEY, []),
  preferences: readLocalJson(PREFERENCES_KEY, { theme: "light", autoRefresh: false, dailyLimit: "none", name: "", alertLive: true, alertScore: true, alertData: true }),
  currentView: "dashboard",
  hasSearched: false,
  isSearching: false,
  isAnalyzing: false,
  isLoadingDataPicks: false,
  isLoadingPoisson: false,
  isLoadingTeamGoals: false,
  isLoadingCorners: false,
  isRefreshingResearch: false,
  isRefreshingStatuses: false,
  autoRefreshTimer: null
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
  autoRefresh: document.querySelector("#auto-refresh"),
  matchesList: document.querySelector("#matches-list"),
  selectedSummary: document.querySelector("#selected-match-summary"),
  dataStatus: document.querySelector("#data-overall-status"),
  dataGrid: document.querySelector("#data-grid"),
  refreshCoverage: document.querySelector("#refresh-coverage"),
  researchContent: document.querySelector("#research-content"),
  toggleResearch: document.querySelector("#toggle-research"),
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
  explainSelectedAnalysis: document.querySelector("#explain-selected-analysis"),
  showDataPicks: document.querySelector("#show-data-picks"),
  dataPicksStatus: document.querySelector("#data-picks-status"),
  dataPicksContent: document.querySelector("#data-picks-content"),
  showPoisson: document.querySelector("#show-poisson"),
  poissonStatus: document.querySelector("#poisson-status"),
  poissonContent: document.querySelector("#poisson-content"),
  showTeamGoals: document.querySelector("#show-team-goals"),
  teamGoalsStatus: document.querySelector("#team-goals-status"),
  teamGoalsContent: document.querySelector("#team-goals-content"),
  showCorners: document.querySelector("#show-corners"), cornersStatus: document.querySelector("#corners-status"), cornersContent: document.querySelector("#corners-content"),
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
  historyMetrics: document.querySelector("#history-metrics"),
  updateParlayResults: document.querySelector("#update-parlay-results")
};

Object.assign(elements, {
  themeToggle: document.querySelector("#theme-toggle"), alertCount: document.querySelector("#alert-count"),
  notificationToggle: document.querySelector("#notification-toggle"), notificationCount: document.querySelector("#notification-count"),
  notificationPopover: document.querySelector("#notification-popover"), notificationList: document.querySelector("#notification-list"),
  markNotificationsRead: document.querySelector("#mark-notifications-read"), alertsList: document.querySelector("#alerts-list"),
  markAllAlertsRead: document.querySelector("#mark-all-alerts-read"), clearAlerts: document.querySelector("#clear-alerts"),
  alertLive: document.querySelector("#alert-live"), alertScore: document.querySelector("#alert-score"), alertData: document.querySelector("#alert-data"),
  accountForm: document.querySelector("#account-form"), accountName: document.querySelector("#account-name"),
  accountDarkMode: document.querySelector("#account-dark-mode"), accountAutoRefresh: document.querySelector("#account-auto-refresh"),
  accountDailyLimit: document.querySelector("#account-daily-limit")
});

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

function showModuleReady(button, content) {
  content.hidden = false;
  button.textContent = "Listo";
  button.classList.add("button--ready");
  button.setAttribute("aria-expanded", "true");
}

function toggleReadyModule(button, content) {
  content.hidden = !content.hidden;
  button.textContent = content.hidden ? "Mostrar" : "Listo";
  button.classList.toggle("button--ready", !content.hidden);
  button.setAttribute("aria-expanded", String(!content.hidden));
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

function fixtureProgressBanner(fixture) {
  if (!fixture) return "";
  const hasScore = fixture.score?.home !== null && fixture.score?.away !== null;
  const score = hasScore ? `${fixture.score.home} - ${fixture.score.away}` : "VS";
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
              <span class="match-card__versus">${showScore ? `<strong class="match-score">${escapeHtml(fixture.score.home)} – ${escapeHtml(fixture.score.away)}</strong>` : "<strong>VS</strong>"}</span>
              ${teamName(fixture.away, fixture.awayLogo, awayFavorite)}
            </div>
            <div class="match-card__meta">
              <time datetime="${escapeHtml(fixture.utcDateTime || `${fixture.date}T${fixture.time}`)}">${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)} PT</time>
              <span>${escapeHtml(fixture.stadium || "Sede por confirmar")}</span>
              ${quality ? `<span class="data-quality data-quality--${escapeHtml(String(quality.level || "").toLowerCase())}">Calidad ${escapeHtml(quality.level)} · ${escapeHtml(quality.score)}/100</span>` : ""}
              ${fixture.status === "live" && fixture.elapsed !== null ? `<small>${escapeHtml(fixture.elapsed)} minutos</small>` : ""}
            </div>
            <div class="match-card__actions">
              <button class="button button--secondary" type="button" data-action="view">Ver datos</button>
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
  const probabilities = fixture.favorite?.probabilities;
  const probabilityLine = probabilities && [probabilities.home, probabilities.draw, probabilities.away].every((value) => value !== null)
    ? `<small>1X2: ${escapeHtml(fixture.home)} ${escapeHtml(probabilities.home)}% · Empate ${escapeHtml(probabilities.draw)}% · ${escapeHtml(fixture.away)} ${escapeHtml(probabilities.away)}%</small>`
    : "";
  const score = ["finished", "live"].includes(fixture.status) && fixture.score?.home !== null && fixture.score?.away !== null
    ? `${escapeHtml(fixture.score.home)} <i>–</i> ${escapeHtml(fixture.score.away)}`
    : `<span>VS</span>`;
  elements.selectedSummary.innerHTML = `
    <div class="selected-match__meta">
      <span>${escapeHtml(fixture.leagueName)}</span>
      ${statusBadge(fixture.statusLabel)}
    </div>
    <div class="selected-match__scoreboard">
      <div class="selected-match__team">${teamCrest(fixture.home, fixture.homeLogo, "large")}<strong>${escapeHtml(fixture.home)}</strong></div>
      <div class="selected-match__score"><b>${score}</b><time>${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)} PT</time></div>
      <div class="selected-match__team">${teamCrest(fixture.away, fixture.awayLogo, "large")}<strong>${escapeHtml(fixture.away)}</strong></div>
    </div>
    <div class="selected-match__details">
      <span>${escapeHtml(fixture.stadium || "Sede por confirmar")}${escapeHtml(venueLabel)}</span>
      <span class="source-chip source-chip--api">${escapeHtml(sourceLabel)}</span>
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
    elements.dataPicksContent.innerHTML = '<div class="research-empty">Pulsa “Ver Picks” para evaluar este partido con los datos disponibles.</div>';
  }
  elements.dataPicksContent.hidden = true;
  if (savedDataPicks) { elements.showDataPicks.textContent = "Mostrar"; elements.showDataPicks.classList.remove("button--ready"); }
  elements.showPoisson.disabled = state.isLoadingPoisson;
  const savedPoisson = state.poissonByFixture.get(fixture.id);
  if (savedPoisson) renderPoisson(savedPoisson);
  else {
    elements.poissonStatus.className = "status-badge status-badge--unavailable";
    elements.poissonStatus.textContent = "No disponible";
    elements.poissonContent.innerHTML = '<div class="research-empty">Pulsa “Ver datos” para calcular el modelo Poisson.</div>';
  }
  elements.poissonContent.hidden = true;
  if (savedPoisson) { elements.showPoisson.textContent = "Mostrar"; elements.showPoisson.classList.remove("button--ready"); }
  elements.showTeamGoals.disabled = state.isLoadingTeamGoals;
  const savedTeamGoals = state.teamGoalsByFixture.get(fixture.id);
  if (savedTeamGoals) renderTeamGoals(savedTeamGoals);
  else {
    elements.teamGoalsStatus.className = "status-badge status-badge--unavailable";
    elements.teamGoalsStatus.textContent = "No disponible";
    elements.teamGoalsContent.innerHTML = '<div class="research-empty">Pulsa “Ver datos” para evaluar ataque y defensa.</div>';
  }
  elements.teamGoalsContent.hidden = true;
  if (savedTeamGoals) { elements.showTeamGoals.textContent = "Mostrar"; elements.showTeamGoals.classList.remove("button--ready"); }
  elements.showCorners.disabled = state.isLoadingCorners;
  const savedCorners = state.cornersByFixture.get(fixture.id);
  if (savedCorners) renderCorners(savedCorners);
  else { elements.cornersStatus.className = "status-badge status-badge--unavailable"; elements.cornersStatus.textContent = "No disponible"; elements.cornersContent.innerHTML = '<div class="research-empty">Pulsa “Ver datos” para analizar corners oficiales.</div>'; }
  elements.cornersContent.hidden = true;
  if (savedCorners) { elements.showCorners.textContent = "Mostrar"; elements.showCorners.classList.remove("button--ready"); }
  elements.refreshCoverage.disabled = state.isRefreshingResearch;
  renderCoverageTable(fixture);
  renderResearchData(fixture.researchData);
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
              <td data-label="Dato"><strong>${escapeHtml(category.label)}</strong></td>
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
      <div><strong>Nivel de confianza del análisis</strong>${statusBadge(analysisLabel)}</div>
      <div class="confidence-track" role="progressbar" aria-label="Nivel de confianza" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><span style="width:${score}%"></span></div>
      <p>${critical.length ? `<strong>Datos críticos faltantes:</strong> ${escapeHtml(critical.join(", "))}` : "No se detectaron tres o más faltantes críticos."}</p>
      <p><strong>Fuentes consultadas:</strong> ${escapeHtml(consultedSources.join(", ") || "Ninguna fuente activa")}</p>
      <small>Última actualización: ${escapeHtml(formatUpdatedAt(research.lastUpdated))}</small>
    </div>`;
  renderSourceCoverage(research);

  const supportingCards = SUPPORTING_MODULES.map(({ key, label, use }) => {
    const module = research.supportingData?.[key] || { status: "not_available", source: "api-football" };
    return `<article class="supporting-card">
      <div><h4>${escapeHtml(label)}</h4><span>${escapeHtml(use)}</span></div>
      ${statusBadge(researchStatusLabel(module.status))}
      <button class="button button--secondary button--compact" type="button" data-supporting-module="${escapeHtml(key)}">Ver detalle</button>
    </article>`;
  }).join("");
  elements.researchGrid.innerHTML = `<section class="research-supporting"><div class="research-supporting__heading"><div><h3>Datos complementarios</h3><p>Los módulos principales se consultan desde la tabla de cobertura para evitar información duplicada.</p></div></div><div class="supporting-grid">${supportingCards}</div></section>`;
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
      <div class="detail-table-wrap"><table class="detail-table source-table"><thead><tr><th>Módulo</th><th>Fuente principal</th><th>Respaldo</th><th>Fuente activa</th><th>Estado</th><th>Actualización</th><th>Observación</th></tr></thead><tbody>${rows.map((row) => `<tr><td data-label="Módulo"><strong>${escapeHtml(row.label)}</strong></td><td data-label="Fuente principal">${escapeHtml(row.primarySources.join(" / ") || "—")}</td><td data-label="Respaldo">${escapeHtml(row.secondarySources.join(" / ") || "—")}</td><td data-label="Fuente activa">${escapeHtml(row.activeSources.join(" / ") || "Ninguna")}</td><td data-label="Estado">${statusBadge(researchStatusLabel(row.status))}</td><td data-label="Actualización">${escapeHtml(formatUpdatedAt(row.updatedAt))}</td><td data-label="Observación">${escapeHtml(row.observation)}</td></tr>`).join("")}</tbody></table></div>
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
      displayValue(market.market),
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
    content = rows.length ? `${summary}${legend}${detailTable(["Nivel", "Mercado", "Selección", "Cuota", "Implícita", "Modelo", "EV", "Confianza", "Explicación"], rows)}` : emptyDetail("No hay cuotas principales verificables.");
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

function detailTable(headers, rows) {
  if (!rows.length) return "";
  return `<div class="detail-table-wrap"><table class="detail-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index] || "Dato")}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
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

function renderOddsDetail(data) {
  const bookmaker = data[0]?.bookmakers?.[0];
  if (!bookmaker) return emptyDetail("No hay cuotas publicadas para este partido.");
  const preferred = /match winner|double chance|goals over\/under|both teams score/i;
  const bets = bookmaker.bets || [];
  const markets = bets.filter((bet) => preferred.test(bet.name)).slice(0, 6);
  const visibleMarkets = markets.length ? markets : bets.slice(0, 4);
  return `<div class="detail-note"><strong>Casa mostrada: ${displayValue(bookmaker.name)}</strong><span>Cuotas informativas; pueden cambiar y no garantizan resultados.</span></div><div class="odds-grid">${visibleMarkets.map((bet) => `<section class="odds-market"><h3>${displayValue(bet.name)}</h3>${(bet.values || []).slice(0, 12).map((value) => `<div class="odd-row"><span>${displayValue(value.value)}</span><strong>${displayValue(value.odd)}</strong></div>`).join("")}</section>`).join("")}</div>`;
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
  const duplicate = state.savedPicks.some((pick) => String(pick.fixtureId) === String(leg.fixtureId)
    && pick.marketCode === leg.marketCode && pick.selectionCode === leg.selectionCode);
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
  const duplicate = state.parlayDraft.some((item) => String(item.fixtureId) === String(normalized.fixtureId)
    && item.marketCode === normalized.marketCode && item.selectionCode === normalized.selectionCode);
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
  elements.savedParlayCount.textContent = state.savedParlays.length + state.savedPicks.length;
  if (!state.savedPicks.length) {
    elements.savedPicksList.innerHTML = '<div class="saved-empty"><h3>Aún no hay picks individuales</h3><p>Usa “Guardar pick” desde Cuotas o desde el análisis IA.</p><button class="button button--primary" type="button" data-view="dashboard">Ir al dashboard</button></div>';
    return;
  }
  elements.savedPicksList.innerHTML = state.savedPicks.map((storedPick) => { const pick = applyAnalysisTiming(storedPick); return `<article class="saved-pick" data-pick-id="${escapeHtml(pick.id)}">
    <div><span>${escapeHtml(pick.league || "Competición")}</span><strong>${escapeHtml(pick.home)} vs ${escapeHtml(pick.away)}</strong><small>${escapeHtml(pick.date || "Fecha no disponible")} · ${escapeHtml(normalizedSavedStatus(pick.fixtureStatus))}</small></div>
    <div><span>Selección</span><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)}</small></div>
    <div class="saved-market-metrics"><span>Cuota<strong>${displayValue(pick.originalOdds ?? pick.decimalOdds)}</strong></span><span>Actualizada${oddsUpdateHtml(pick)}</span><span>Implícita<strong>${displayValue(pick.impliedProbability)}%</strong></span><span>Modelo<strong>${displayValue(pick.modelProbability ?? pick.estimatedProbability)}%</strong></span><span>EV<strong>${displayValue(pick.expectedValue)}%</strong></span></div>
    <div><span>Confianza / resultado</span><strong>${pick.effectiveConfidenceScore === null ? escapeHtml(pick.confidence || "No disponible") : `${escapeHtml(pick.effectiveConfidenceScore)}% efectiva`}</strong><small>${escapeHtml(resultLabels[pick.result] || "Pendiente")} · Origen: ${escapeHtml(pick.sourceModule || "odds")}</small><small class="timing-label">${escapeHtml(pick.analysisTiming.label)}</small>${pick.analysisTiming.warning ? `<small class="timing-warning">${escapeHtml(pick.analysisTiming.warning)}</small>` : ""}${pick.oddsMovement.changed ? `<small class="timing-warning">${escapeHtml(pick.oddsMovement.warning)}</small>` : ""}</div>
    <button class="button button--danger button--compact" type="button" data-delete-pick>Eliminar</button>
  </article>`; }).join("");
}

function renderSavedParlays() {
  elements.savedParlayCount.textContent = state.savedParlays.length + state.savedPicks.length;
  const metrics = calculateHistoryMetrics(state.savedParlays);
  elements.historyMetrics.innerHTML = `
    <article><span>Parlays</span><strong>${metrics.total}</strong></article>
    <article><span>Evaluados</span><strong>${metrics.settled}</strong></article>
    <article><span>Ganados / perdidos</span><strong>${metrics.won} / ${metrics.lost}</strong></article>
    <article><span>Acierto</span><strong>${metrics.winRate === null ? "—" : `${metrics.winRate}%`}</strong></article>
    <article><span>Unidades teóricas</span><strong class="${metrics.theoreticalUnits >= 0 ? "value-positive" : "value-negative"}">${metrics.theoreticalUnits}</strong></article>`;
  elements.updateParlayResults.disabled = state.savedParlays.length === 0 && state.savedPicks.length === 0;
  if (!state.savedParlays.length) {
    elements.savedParlaysList.innerHTML = '<div class="saved-empty"><h3>Aún no hay parlays guardados</h3><p>Agrega dos o más mercados desde un análisis IA y guarda el cupón para comenzar el seguimiento.</p><button class="button button--primary" type="button" data-view="dashboard">Ir al dashboard</button></div>';
    return;
  }

  elements.savedParlaysList.innerHTML = state.savedParlays.map((parlay) => {
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
          <div class="saved-leg__content"><strong>${escapeHtml(leg.selection)}</strong><span>${escapeHtml(leg.market)}</span><small>${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)} · ${escapeHtml(leg.date)} · ${escapeHtml(normalizedSavedStatus(leg.fixtureStatus))}${leg.finalScore ? ` · Final ${escapeHtml(leg.finalScore)}` : ""}</small><small>Cuota ${displayValue(leg.originalOdds ?? leg.decimalOdds)} · Actualizada ${leg.updatedOdds ?? "Sin actualización"} · Implícita ${displayValue(leg.impliedProbability)}% · Modelo ${displayValue(leg.modelProbability ?? leg.estimatedProbability)}% · EV ${displayValue(leg.expectedValue)}%</small><small>Confianza efectiva: ${leg.effectiveConfidenceScore === null ? escapeHtml(leg.confidence) : `${escapeHtml(leg.effectiveConfidenceScore)}%`} · ${escapeHtml(leg.analysisTiming.label)}</small>${leg.analysisTiming.warning ? `<small class="timing-warning">${escapeHtml(leg.analysisTiming.warning)}</small>` : ""}${leg.oddsMovement.changed ? `<small class="timing-warning">${escapeHtml(leg.oddsMovement.warning)}</small>` : ""}</div>
          <label>Resultado<select data-leg-result><option value="pending" ${leg.result === "pending" ? "selected" : ""}>Pendiente</option><option value="won" ${leg.result === "won" ? "selected" : ""}>Ganada</option><option value="lost" ${leg.result === "lost" ? "selected" : ""}>Perdida</option><option value="void" ${leg.result === "void" ? "selected" : ""}>Anulada</option></select></label>
        </section>`; }).join("")}</div>
      <div class="saved-parlay__notes" ${expanded ? "" : "hidden"}><label for="notes-${escapeHtml(parlay.id)}">Notas del resultado</label><textarea id="notes-${escapeHtml(parlay.id)}" data-parlay-notes maxlength="500">${escapeHtml(parlay.notes || "")}</textarea></div>
      <footer class="saved-parlay__footer" ${expanded ? "" : "hidden"}><span>El resultado general se calcula con los estados de las selecciones.</span><button class="button button--danger" type="button" data-delete-parlay>Eliminar registro</button></footer>
    </article>`;
  }).join("");
  persistSavedParlays();
}

async function updateSavedParlayResults() {
  const allSavedLegs = [...state.savedPicks, ...state.savedParlays.flatMap((parlay) => parlay.legs)];
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
    state.savedParlays.forEach((parlay) => {
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
    elements.updateParlayResults.disabled = state.savedParlays.length === 0 && state.savedPicks.length === 0;
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
  const pickReviewHtml = pickReview ? `
    <section class="pick-review">
      <div><span>Favorito real</span><strong>${escapeHtml(pickReview.favoriteTeam || "No identificado")}</strong><small>${escapeHtml(strengthLabels[pickReview.favoriteStrength] || pickReview.favoriteStrength)}</small></div>
      <div><span>Brecha de calidad</span><strong>${escapeHtml(gapLabels[pickReview.qualityGap] || pickReview.qualityGap)}</strong></div>
      <div><span>Mayor EV</span><strong>${escapeHtml(pickReview.highestEvPick?.selection || "Sin cálculo")}</strong><small>${displayValue(pickReview.highestEvPick?.expectedValuePct)}% · ${escapeHtml(categoryLabels[pickReview.highestEvPick?.pickCategory] || "Sin categoría")}</small></div>
      <div><span>Pick lógico recomendado</span><strong>${escapeHtml(pickReview.recommendedPick?.selection || "Sin pick principal")}</strong><small>${escapeHtml(categoryLabels[pickReview.recommendedPick?.pickCategory] || "Sin pick")} · Confianza ${displayValue(pickReview.recommendedPick?.confidenceScore, 0)}/100</small></div>
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
      <div class="confidence-picks__heading"><h3>Posibles picks por confianza</h3><small>Ordenados por confianza evaluada, no únicamente por EV.</small></div>
      <div class="confidence-picks__table" role="table" aria-label="Posibles picks ordenados por confianza">
        ${pickReview.confidencePicks.map((pick) => `<div class="confidence-pick confidence-pick--${confidenceColor(pick)}" role="row">
          <span role="cell">${pick.rank}</span>
          <div role="cell"><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)} · ${escapeHtml(categoryLabels[pick.pickCategory] || pick.pickCategory)}</small>${pick.warning ? `<small>${escapeHtml(pick.warning)}</small>` : ""}</div>
          <div role="cell"><strong>${displayValue(pick.confidencePct)}%</strong><small>Prob. modelo ${displayValue(pick.estimatedProbabilityPct)}% · EV ${displayValue(pick.expectedValuePct)}%</small></div>
        </div>`).join("")}
      </div>
      <p>Verde: opción lógica con respaldo suficiente. Naranja: riesgo o validación parcial. Rojo: evitar o sin valor confirmado.</p>
    </section>` : "";

  elements.analysisContent.innerHTML = `
    <div class="analysis-hero">
      <div class="analysis-hero__title"><h3>${escapeHtml(analysis.partido.local)} vs ${escapeHtml(analysis.partido.visitante)}</h3><div class="analysis-mode-badges">${analysis.analysisMode === "rule_engine" ? '<span class="source-chip source-chip--model">Solo datos · Motor de Reglas</span>' : '<span class="source-chip source-chip--external">Explicación IA</span>'}${quality ? `<span class="quality-badge quality-badge--${quality.level.toLowerCase()}">Cobertura ${escapeHtml(quality.level)} · ${quality.score}/100</span>` : ""}</div></div>
      <p>${escapeHtml(analysis.resumen_partido)}</p>
    </div>
    ${pickReviewHtml}
    ${confidencePicksHtml}
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
      <section class="analysis-card">
        <h3>Mercados sugeridos</h3>
        ${analysis.mercados_sugeridos.length ? analysis.mercados_sugeridos.map((market, index) => `<div class="market-row market-row--actionable"><div><span>${escapeHtml(market.seleccion)}</span><small>${escapeHtml(market.mercado)} · Cuota ${displayValue(market.cuota_decimal)} · Prob. ${displayValue(market.probabilidad_modelo)}% · EV ${displayValue(market.valor_esperado)}%</small><small>${escapeHtml(categoryLabels[market.pickCategory] || "Sin categoría")} · Confianza lógica ${displayValue(market.confidenceScore, 0)}/100${market.requiere_revision ? " · Requiere revisión" : ""}</small>${market.warning ? `<small>${escapeHtml(market.warning)}</small>` : ""}</div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-market="${index}" ${analysis._source === "mock" ? "disabled" : ""}>Guardar pick</button><button class="button button--add" type="button" data-add-market="${index}" ${analysis._source === "mock" || market.requiere_revision || !quality?.canSuggest ? "disabled" : ""}>Agregar al parlay</button></div></div>`).join("") : '<p>No se identificó un mercado con cobertura y valor suficiente.</p>'}
        <p class="market-disclaimer">Agregar conserva la sugerencia para seguimiento; no realiza una apuesta.</p>
      </section>
      <section class="analysis-card analysis-card--wide">
        <h3>Predicción prudente · ${escapeHtml(analysis.prediccion_prudente.confianza)}</h3>
        <p><strong>${escapeHtml(analysis.prediccion_prudente.seleccion)}</strong></p>
        <p>${escapeHtml(analysis.prediccion_prudente.razonamiento)}</p>
        <p><strong>Parlay:</strong> ${escapeHtml(analysis.apto_para_parlay.respuesta)}. ${escapeHtml(analysis.apto_para_parlay.razonamiento)}</p>
      </section>
    </div>
    <p class="analysis-warning">${escapeHtml(analysis.advertencia)}${analysis._source === "mock" ? " Esta salida usa datos sintéticos y no debe utilizarse para apostar." : ""}</p>
  `;
}

function showAnalysisEmpty() {
  elements.analysisStatus.className = "status-badge status-badge--unavailable";
  elements.analysisStatus.textContent = "No disponible";
  elements.analysisContent.innerHTML = '<div class="empty-state"><span class="empty-state__icon" aria-hidden="true">✦</span><h3>Partido seleccionado</h3><p>Analiza primero con el Motor de Reglas. OpenAI queda como explicación opcional.</p></div>';
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
  elements.dataPicksContent.innerHTML = `
    <div class="data-picks-summary"><strong>${result.picks.length} selecciones evaluadas</strong><span>Calidad de datos ${displayValue(result.dataQualityScore)}/100 · ${escapeHtml(result.source)}</span></div>
    <div class="analysis-timing analysis-timing--${escapeHtml(timing.window)}"><strong>${escapeHtml(timing.label)}</strong><span>${timing.minutesToKickoff === null ? "Hora del partido no disponible" : `${escapeHtml(timing.minutesToKickoff)} minutos para el inicio`}${timing.isConfirmed ? " · Confirmado por frescura" : ""}</span>${timing.warning ? `<small>${escapeHtml(timing.warning)}</small>` : ""}</div>
    ${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}
    <div class="data-picks-grid">${result.picks.map((pick) => `
      <article class="data-pick data-pick--${escapeHtml(pick.highlightColor)}">
        <div class="data-pick__heading"><div><small>${escapeHtml(pick.market)}</small><strong>${escapeHtml(pick.selection)}</strong></div><span>${escapeHtml(pick.level)}</span></div>
        <div class="data-pick__metrics"><span>Modelo <b>${displayValue(pick.modelProbabilityPct)}%</b></span><span>Cuota <b>${displayValue(pick.decimalOdds)}</b></span><span>EV <b>${pick.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(pick.expectedValuePct)}%`}</b></span><span>Confianza <b>${escapeHtml(pick.confidenceScore)}%</b></span></div>
        <p>${escapeHtml(pick.explanation)}</p>
        <small>Fuentes: ${escapeHtml(pick.sourcesUsed?.join(" · ") || "modelo interno")}</small>
        <div class="pick-actions">
          <button class="button button--secondary button--compact" type="button" data-save-data-pick="${escapeHtml(pick.selectionKey)}" ${pick.highlightColor === "red" ? "disabled" : ""}>Guardar individual</button>
          <button class="button button--primary button--compact" type="button" data-add-data-pick="${escapeHtml(pick.selectionKey)}" ${pick.highlightColor === "red" ? "disabled" : ""}>Agregar al parlay</button>
        </div>
      </article>`).join("")}</div>`;
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
    if (!state.dataPicksByFixture.has(fixture.id)) elements.showDataPicks.textContent = "Ver Picks";
  }
}

function addDataPickToParlay(selectionKey) {
  const fixture = selectedFixture();
  const result = state.dataPicksByFixture.get(fixture?.id);
  const pick = result?.picks?.find((item) => item.selectionKey === selectionKey);
  if (!fixture || !pick || pick.highlightColor === "red") return showNotice("Este pick no tiene respaldo suficiente para agregarlo.");
  appendPickToParlay({
    id: `${fixture.id}:${pick.marketKey}:${pick.selectionKey}`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey,
    decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null,
    impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
    estimatedProbability: pick.estimatedProbabilityPct, expectedValue: pick.expectedValuePct,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.level,
    reasoning: pick.explanation, requiresReview: pick.highlightColor !== "green" && pick.highlightColor !== "blue",
    analysisStatus: pick.status, sourceModule: "data_picks", source: "API-Football + modelo interno",
    supportingData: pick.supportingData, contradictingData: pick.contradictingData
  }, "Pick agregado a Mi parlay. Se guardará únicamente cuando nombres y guardes el parlay.");
}

function saveDataPick(selectionKey) {
  const fixture = selectedFixture();
  const result = state.dataPicksByFixture.get(fixture?.id);
  const pick = result?.picks?.find((item) => item.selectionKey === selectionKey);
  if (!fixture || !pick || pick.highlightColor === "red") return showNotice("Este pick no tiene respaldo suficiente para guardarlo.");
  saveIndividualLeg({
    id: `${fixture.id}:${pick.marketKey}:${pick.selectionKey}`, fixtureId: fixture.id,
    league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date,
    market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey,
    decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null,
    impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
    estimatedProbability: pick.estimatedProbabilityPct, expectedValue: pick.expectedValuePct,
    fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.level,
    reasoning: pick.explanation, requiresReview: pick.highlightColor !== "green" && pick.highlightColor !== "blue",
    result: "pending", sourceModule: "data_picks", source: "API-Football + modelo interno",
    supportingData: pick.supportingData, contradictingData: pick.contradictingData
  });
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
  const probabilityRows = [
    ["Local gana", result.probabilities.homeWin], ["Empate", result.probabilities.draw], ["Visitante gana", result.probabilities.awayWin],
    ["Doble oportunidad 1X", result.probabilities.doubleChance1X], ["Doble oportunidad X2", result.probabilities.doubleChanceX2],
    ["Over 0.5", result.probabilities.over05], ["Over 1.5", result.probabilities.over15], ["Over 2.5", result.probabilities.over25],
    ["Under 2.5", result.probabilities.under25], ["Under 3.5", result.probabilities.under35],
    ["BTTS Sí", result.probabilities.bttsYes], ["BTTS No", result.probabilities.bttsNo]
  ];
  elements.poissonContent.innerHTML = `
    <div class="poisson-summary"><article><span>λ ${escapeHtml(fixture?.home || "Local")}</span><strong>${displayValue(result.lambdaHome)}</strong></article><article><span>λ ${escapeHtml(fixture?.away || "Visitante")}</span><strong>${displayValue(result.lambdaAway)}</strong></article><article><span>Calidad</span><strong>${displayValue(result.dataQualityScore)}/100</strong></article><article><span>Modelo</span><strong>${escapeHtml(result.modelVersion)}</strong></article></div>
    ${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}
    <div class="poisson-layout">
      <section><h3>Probabilidades</h3><div class="poisson-probabilities">${probabilityRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${displayValue(value)}%</strong></div>`).join("")}</div></section>
      <section><h3>Marcadores más probables</h3><div class="likely-scores">${result.likelyScores.map((row) => `<div><strong>${escapeHtml(row.score)}</strong><span>${escapeHtml(row.probabilityPct)}%</span></div>`).join("")}</div></section>
    </div>
    <section class="poisson-markets"><h3>Mercados derivados</h3>${result.suggestedMarkets.length ? result.suggestedMarkets.map((pick) => `<article class="poisson-market poisson-market--${escapeHtml(pick.highlightColor)}"><div><strong>${escapeHtml(pick.selection)}</strong><small>${escapeHtml(pick.market)} · Modelo ${escapeHtml(pick.probabilityPct)}% · Cuota ${displayValue(pick.decimalOdds)} · EV ${pick.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(pick.expectedValuePct)}%`}</small><small>Confianza ${escapeHtml(pick.confidenceScore)}/100 · ${escapeHtml(pick.level)}</small></div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-poisson="${escapeHtml(pick.selectionKey)}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-poisson="${escapeHtml(pick.selectionKey)}">Agregar al parlay</button></div></article>`).join("") : '<p class="muted-text">No hay mercados con respaldo mínimo suficiente.</p>'}</section>
    <p class="market-disclaimer">Poisson es una referencia matemática parcial y no decide por sí solo el pick final.</p>`;
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
    if (!state.poissonByFixture.has(fixture.id)) elements.showPoisson.textContent = "Ver datos";
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
  const teamCard = (team) => `<article class="team-goal-card"><div class="team-goal-card__heading"><div><small>${escapeHtml(team.side === "home" ? "Equipo 1 / local" : "Equipo 2 / visitante")}</small><h3>${escapeHtml(team.team)}</h3></div>${statusBadge(team.status === "available" ? "Disponible" : "Parcial")}</div><div class="team-goal-kpis"><span>Marca 0.5+<strong>${escapeHtml(team.over05Pct)}%</strong></span><span>No marca<strong>${escapeHtml(team.noGoalPct)}%</strong></span><span>Marca 1.5+<strong>${escapeHtml(team.over15Pct)}%</strong></span><span>Confianza<strong>${escapeHtml(team.confidenceScore)}/100</strong></span></div><div class="team-goal-evidence"><div><strong>Apoya</strong>${team.supportingData.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div><div><strong>Contradice</strong>${team.contradictingData.length ? team.contradictingData.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : "<span>Sin contradicción fuerte detectada.</span>"}</div></div></article>`;
  elements.teamGoalsContent.innerHTML = `<div class="team-goal-summary"><strong>BTTS: ${escapeHtml(result.btts.support)}</strong><span>Sí ${escapeHtml(result.btts.yesProbabilityPct)}% · No ${escapeHtml(result.btts.noProbabilityPct)}% · Confianza ${escapeHtml(result.confidenceScore)}/100</span></div>${result.warnings?.length ? `<div class="data-picks-warnings">${result.warnings.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}<div class="team-goal-grid">${teamCard(result.teams.home)}${teamCard(result.teams.away)}</div><section class="poisson-markets"><h3>Mercados derivados</h3>${result.picks.length ? result.picks.map((pick) => `<article class="poisson-market poisson-market--${escapeHtml(pick.highlightColor)}"><div><strong>${escapeHtml(pick.selection)}</strong><small>Modelo ${escapeHtml(pick.modelProbabilityPct)}% · Cuota ${displayValue(pick.decimalOdds)} · EV ${pick.expectedValuePct === null ? "Sin cuota" : `${escapeHtml(pick.expectedValuePct)}%`}</small><small>Confianza ${escapeHtml(pick.confidenceScore)}/100 · ${escapeHtml(pick.level)}</small></div><div class="pick-actions"><button class="button button--secondary button--compact" type="button" data-save-team-goal="${escapeHtml(pick.selectionKey)}">Guardar individual</button><button class="button button--primary button--compact" type="button" data-add-team-goal="${escapeHtml(pick.selectionKey)}">Agregar al parlay</button></div></article>`).join("") : '<p class="muted-text">No hay mercado con respaldo mínimo.</p>'}</section><p class="market-disclaimer">La probabilidad combina varias señales. Posesión aislada no implica peligro real ni alta confianza.</p>`;
}

async function loadTeamGoals() {
  const fixture = selectedFixture();
  if (!fixture || state.isLoadingTeamGoals) return;
  if (state.teamGoalsByFixture.has(fixture.id)) return toggleReadyModule(elements.showTeamGoals, elements.teamGoalsContent);
  state.isLoadingTeamGoals = true; elements.showTeamGoals.disabled = true; elements.showTeamGoals.textContent = "Calculando…";
  elements.teamGoalsStatus.className = "status-badge status-badge--processing"; elements.teamGoalsStatus.textContent = "Procesando";
  try { const result = await footballDataService.getTeamGoalProbability(fixture); state.teamGoalsByFixture.set(fixture.id, result); renderTeamGoals(result); showModuleReady(elements.showTeamGoals, elements.teamGoalsContent); }
  catch (error) { renderTeamGoals({ status: "not_available", warning: error.message, picks: [] }); elements.teamGoalsContent.hidden = false; }
  finally { state.isLoadingTeamGoals = false; elements.showTeamGoals.disabled = !selectedFixture(); if (!state.teamGoalsByFixture.has(fixture.id)) elements.showTeamGoals.textContent = "Ver datos"; }
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
}

async function loadCorners() {
  const fixture = selectedFixture(); if (!fixture || state.isLoadingCorners) return;
  if (state.cornersByFixture.has(fixture.id)) return toggleReadyModule(elements.showCorners, elements.cornersContent);
  state.isLoadingCorners = true; elements.showCorners.disabled = true; elements.showCorners.textContent = "Calculando…";
  try { const result = await footballDataService.getCornersModel(fixture); state.cornersByFixture.set(fixture.id, result); renderCorners(result); showModuleReady(elements.showCorners, elements.cornersContent); }
  catch (error) { renderCorners({ status: "not_available", warning: error.message, picks: [] }); elements.cornersContent.hidden = false; }
  finally { state.isLoadingCorners = false; elements.showCorners.disabled = !selectedFixture(); if (!state.cornersByFixture.has(fixture.id)) elements.showCorners.textContent = "Ver datos"; }
}

function cornerLeg(selectionKey) { const fixture = selectedFixture(); const result = state.cornersByFixture.get(fixture?.id); const pick = result?.picks?.find((item) => item.selectionKey === selectionKey); if (!fixture || !pick) return null; return { id: `${fixture.id}:corners:${selectionKey}`, fixtureId: fixture.id, league: fixture.leagueName, home: fixture.home, away: fixture.away, date: fixture.date, market: pick.market, selection: pick.selection, marketCode: pick.marketKey, selectionCode: pick.selectionKey, decimalOdds: pick.decimalOdds, originalOdds: pick.decimalOdds, updatedOdds: null, impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct, expectedValue: pick.expectedValuePct, fixtureStatus: fixture.statusLabel || fixture.status, kickoffAt: fixture.utcDateTime || null, lastUpdatedAt: result.generatedAt, confidence: `${pick.confidenceScore}%`, confidenceScore: pick.confidenceScore, risk: pick.level, reasoning: result.preMatchSignal, requiresReview: result.status !== "available", sourceModule: "corners", source: result.source, supportingData: pick.supportingData, contradictingData: pick.contradictingData }; }
function addCornerPick(key) { const leg = cornerLeg(key); if (leg) appendPickToParlay(leg, "Pick de corners agregado a Mi parlay."); }
function saveCornerPick(key) { const leg = cornerLeg(key); if (leg) saveIndividualLeg({ ...leg, result: "pending" }); }

async function selectFixture(fixtureId, analysisMode = null) {
  if (state.isAnalyzing) return;
  state.selectedFixtureId = fixtureId;
  renderMatches();
  const fixtureIndex = state.fixtures.findIndex((fixture) => fixture.id === fixtureId);

  try {
    const detailedFixture = await footballDataService.getFixtureData(selectedFixture());
    if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = detailedFixture;
    renderMatches();
    renderFixtureData();
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
        score: nextScore
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

async function runAutomaticRefresh() {
  if (!elements.autoRefresh.checked || document.visibilityState !== "visible" || !state.fixtures.length) return;
  await refreshFixtureStatuses();
  if (selectedFixture()) await refreshResearchData();
}

function configureAutomaticRefresh() {
  if (state.autoRefreshTimer) window.clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  state.preferences.autoRefresh = elements.autoRefresh.checked;
  elements.accountAutoRefresh.checked = elements.autoRefresh.checked;
  writeLocalJson(PREFERENCES_KEY, state.preferences);
  if (!elements.autoRefresh.checked) return;
  state.autoRefreshTimer = window.setInterval(runAutomaticRefresh, 5 * 60 * 1000);
  showNotice("Actualización automática activada cada cinco minutos mientras la página esté visible.");
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
    if (!state.fixtures.some((fixture) => fixture.id === state.selectedFixtureId)) {
      state.selectedFixtureId = state.fixtures[0]?.id || null;
    }
    const source = state.fixtures.some((fixture) => fixture.dataSource === "api-football") ? "API-Football" : "simulación";
    elements.searchFeedback.textContent = `Búsqueda ${source} completada · ${new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    renderMatches();
    if (state.selectedFixtureId) {
      renderFixtureData();
      const saved = state.analysisByFixture.get(state.selectedFixtureId);
      saved ? renderAnalysis(saved) : showAnalysisEmpty();
    }
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
elements.autoRefresh.addEventListener("change", configureAutomaticRefresh);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && elements.autoRefresh.checked && state.fixtures.length) runAutomaticRefresh();
});
elements.dataGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-category]");
  if (card) openDataDetail(card.dataset.category);
});
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
elements.toggleResearch.addEventListener("click", () => {
  const expanded = elements.toggleResearch.getAttribute("aria-expanded") === "true";
  elements.toggleResearch.setAttribute("aria-expanded", String(!expanded));
  elements.toggleResearch.textContent = expanded ? "Mostrar" : "Ocultar";
  elements.researchContent.hidden = expanded;
});
elements.refreshFixtureStatuses.addEventListener("click", refreshFixtureStatuses);
elements.generateSelectedAnalysis.addEventListener("click", analyzeSelectedFixture);
elements.explainSelectedAnalysis.addEventListener("click", explainSelectedFixture);
elements.showDataPicks.addEventListener("click", loadDataPicks);
elements.dataPicksContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-data-pick]");
  const saveButton = event.target.closest("[data-save-data-pick]");
  if (addButton) addDataPickToParlay(addButton.dataset.addDataPick);
  if (saveButton) saveDataPick(saveButton.dataset.saveDataPick);
});
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
  if (!window.confirm("¿Eliminar este registro de parlay? Esta acción no se puede deshacer.")) return;
  state.savedParlays = state.savedParlays.filter((item) => item.id !== card.dataset.parlayId);
  persistSavedParlays();
  renderSavedParlays();
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
  document.querySelector("#data-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.matchesList.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-fixture-id]");
  if (!card || event.target.closest("button")) return;
  event.preventDefault();
  await selectFixture(card.dataset.fixtureId, false);
  document.querySelector("#data-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.themeToggle.addEventListener("click", () => applyTheme(state.preferences.theme === "dark" ? "light" : "dark"));
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
  elements.autoRefresh.checked = elements.accountAutoRefresh.checked;
  applyTheme(elements.accountDarkMode.checked ? "dark" : "light");
  configureAutomaticRefresh();
  writeLocalJson(PREFERENCES_KEY, state.preferences);
  showNotice("Preferencias guardadas en este navegador.");
});

document.querySelectorAll("[data-nav-label]").forEach((button) => {
  button.addEventListener("click", () => {
    showNotice(`${button.dataset.navLabel} es un módulo preparado, pero todavía no está habilitado.`);
  });
});

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
  elements.autoRefresh.checked = Boolean(state.preferences.autoRefresh);
  elements.accountAutoRefresh.checked = Boolean(state.preferences.autoRefresh);
  applyTheme(state.preferences.theme || "light");
  configureAutomaticRefresh();
  renderAlerts();
  renderParlayDraft();
  renderSavedPicks();
  renderSavedParlays();
  const runtime = await footballDataService.getRuntime();
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
