import { ALLOWED_LEAGUES, DATA_CATEGORIES, MOCK_FIXTURES } from "./mock-data.js?v=20260623-pick-logic";
import { footballDataService } from "./services.js?v=20260623-pick-logic";
import {
  calculateHistoryMetrics, calculateParlayResult, createSavedParlay, loadParlayDraft, loadSavedParlays,
  saveParlayDraft, saveSavedParlays, settleLegResult
} from "./parlay-store.js?v=20260620-efficient-analysis";

const state = {
  fixtures: [],
  selectedFixtureId: null,
  analysisByFixture: new Map(),
  parlayDraft: loadParlayDraft(),
  savedParlays: loadSavedParlays(),
  hasSearched: false,
  isSearching: false,
  isAnalyzing: false,
  isRefreshingResearch: false,
  isRefreshingStatuses: false
};

const elements = {
  form: document.querySelector("#filters-form"),
  leagueOptions: document.querySelector("#league-options"),
  leagueCount: document.querySelector("#league-count"),
  dateFrom: document.querySelector("#date-from"),
  dateTo: document.querySelector("#date-to"),
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
  historyMetrics: document.querySelector("#history-metrics"),
  updateParlayResults: document.querySelector("#update-parlay-results")
};

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

function updateLeagueCount() {
  elements.leagueCount.textContent = `${selectedLeagueSlugs().length} de ${ALLOWED_LEAGUES.length}`;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
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
        const homeFavorite = fixture.favorite?.teamId === fixture.homeTeamId;
        const awayFavorite = fixture.favorite?.teamId === fixture.awayTeamId;
        const favoriteTitle = fixture.favorite ? `${fixture.favorite.note}${fixture.favorite.percent !== null ? ` Confianza del modelo: ${fixture.favorite.percent}%.` : ""}` : "";
        const teamName = (name, favorite) => `<strong class="match-card__team${favorite ? " match-card__team--favorite" : ""}">${escapeHtml(name)}${favorite ? `<span class="favorite-badge" title="${escapeHtml(favoriteTitle)}">Favorito${fixture.favorite.percent !== null ? ` ${escapeHtml(fixture.favorite.percent)}%` : ""}</span>` : ""}</strong>`;
        return `
          <article class="match-card${selected ? " match-card--selected" : ""}" data-fixture-id="${escapeHtml(fixture.id)}" ${selected ? 'aria-current="true"' : ""}>
            <span class="match-card__favorite" aria-hidden="true">☆</span>
            <div class="match-card__teams">
              ${teamName(fixture.home, homeFavorite)}
              <span class="match-card__versus">${showScore ? `<strong class="match-score">${escapeHtml(fixture.score.home)} – ${escapeHtml(fixture.score.away)}</strong>` : "vs"}</span>
              ${teamName(fixture.away, awayFavorite)}
            </div>
            <div class="match-card__meta">
              <time datetime="${escapeHtml(fixture.utcDateTime || `${fixture.date}T${fixture.time}`)}">${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)} PT</time>
              ${statusBadge(fixture.statusLabel)}
              ${fixture.status === "live" && fixture.elapsed !== null ? `<small>${escapeHtml(fixture.elapsed)} minutos</small>` : ""}
            </div>
            <div class="match-card__actions">
              <button class="button button--secondary" type="button" data-action="view">Ver datos</button>
              <button class="button button--primary" type="button" data-action="analyze" ${isFinished ? 'disabled title="Partido finalizado"' : ""}>Generar análisis IA</button>
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
  elements.selectedSummary.innerHTML = `<strong>${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)}</strong><span>${escapeHtml(fixture.leagueName)} · ${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)} PT · ${sourceLabel}${escapeHtml(venueLabel)}${escapeHtml(qualityLabel)}</span>`;
  updateAnalysisActionState();
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
            return `<tr>
              <td><strong>${escapeHtml(category.label)}</strong></td>
              <td>${statusBadge(status)}</td>
              <td>${escapeHtml(primary)}</td>
              <td>${escapeHtml(backup)}</td>
              <td>${escapeHtml(active)}</td>
              <td>${escapeHtml(formatUpdatedAt(researchModule?.updatedAt || coverage?.updatedAt))}</td>
              <td><button class="button button--secondary button--compact" type="button" data-category="${escapeHtml(category.key)}">Ver datos</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function updateAnalysisActionState() {
  const fixture = selectedFixture();
  const disabled = !fixture || fixture.status === "finished" || state.isAnalyzing;
  elements.generateSelectedAnalysis.disabled = disabled;
  elements.generateSelectedAnalysis.textContent = state.isAnalyzing ? "Procesando…" : "Generar análisis IA";
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
  if (module?.source === "weather") return "Clima · búsqueda web";
  if (module?.source === "soccerway") return "Soccerway · búsqueda web";
  if (module?.source === "api-football-internal-model") return "API-Football + modelo interno";
  if (module?.source) return module.source;
  if (["xgXga", "weatherPitch"].includes(moduleKey)) return "Sin fuente configurada";
  return "API-Football consultada sin datos";
}

function renderResearchData(research) {
  elements.refreshResearch.disabled = !research || state.isRefreshingResearch;
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
      <div class="detail-table-wrap"><table class="detail-table source-table"><thead><tr><th>Módulo</th><th>Fuente principal</th><th>Respaldo</th><th>Fuente activa</th><th>Estado</th><th>Actualización</th><th>Observación</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${escapeHtml(row.primarySources.join(" / ") || "—")}</td><td>${escapeHtml(row.secondarySources.join(" / ") || "—")}</td><td>${escapeHtml(row.activeSources.join(" / ") || "Ninguna")}</td><td>${statusBadge(researchStatusLabel(row.status))}</td><td>${escapeHtml(formatUpdatedAt(row.updatedAt))}</td><td>${escapeHtml(row.observation)}</td></tr>`).join("")}</tbody></table></div>
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
    const rows = (module.markets || []).map((market) => [displayValue(market.market), displayValue(market.selection), displayValue(market.decimalOdds), `${displayValue(market.impliedProbabilityPct)}%`, `${displayValue(market.estimatedProbabilityPct)}%`, `${displayValue(market.expectedValuePct)}%`, market.requiresReview ? "Revisar" : "Verificado"]);
    content = rows.length ? detailTable(["Mercado", "Selección", "Cuota", "Implícita", "Modelo", "EV", "Control"], rows) : emptyDetail("No hay cuotas principales verificables.");
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
    const historicalEstimated = module.type === "historical_estimated";
    const estimated = historicalEstimated || ["estimated", "fixture_estimated"].includes(module.type);
    const confidenceLabel = (value) => ({ high: "Alta", medium: "Media", low: "Baja", not_available: "No disponible" }[value] || "No disponible");
    const modeLabel = historicalEstimated ? "Histórico" : estimated ? "Fixture actual" : "Oficial";
    const teamRows = [
      [escapeHtml(research.homeTeam.name), displayValue(module.homeXG), displayValue(module.homeXGA), modeLabel, displayValue(module.homeSampleSize ?? module.sampleSize), confidenceLabel(module.homeConfidence?.label || module.confidenceLabel)],
      [escapeHtml(research.awayTeam.name), displayValue(module.awayXG), displayValue(module.awayXGA), modeLabel, displayValue(module.awaySampleSize ?? module.sampleSize), confidenceLabel(module.awayConfidence?.label || module.confidenceLabel)]
    ];
    const teams = detailTable(["Equipo", estimated ? "xG estimado" : "xG", estimated ? "xGA estimado" : "xGA", "Modo", "Muestra", "Confianza"], teamRows);
    const mandatoryText = historicalEstimated
      ? "xG/xGA histórico estimado calculado con partidos anteriores de cada equipo. No requiere enfrentamiento directo entre ambos equipos. No corresponde a xG oficial ni al xG del partido actual."
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
      goalkeeperSaves: "Atajadas", penalties: "Penales detectados", dangerousAttacks: "Ataques peligrosos"
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
    content = `${researchTeamStats("Clima y cancha", [["Temperatura (°C)", module.temperature], ["Probabilidad de lluvia (%)", module.rainProbability], ["Viento (km/h)", module.windSpeed], ["Humedad (%)", module.humidity], ["Condición", module.condition], ["Ubicación verificada", module.matchedLocation], ["Cancha", module.pitchNotes]])}`;
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
  elements.dataDialogContent.innerHTML = renderResearchModuleDetail(moduleKey, research);
  elements.dataDialog.showModal();
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
  elements.dataDialogContent.innerHTML = renderSupportingDetail(moduleKey, research);
  elements.dataDialog.showModal();
}

function displayValue(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : escapeHtml(value);
}

function emptyDetail(message) {
  return `<div class="detail-empty"><strong>No hay datos para mostrar</strong><p>${escapeHtml(message)}</p></div>`;
}

function detailTable(headers, rows) {
  if (!rows.length) return "";
  return `<div class="detail-table-wrap"><table class="detail-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
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

function renderH2HDetail(data) {
  if (!data.length) return emptyDetail("No hay enfrentamientos directos disponibles.");
  const rows = data.slice(0, 10).map((match) => [
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
  if (categoryKey === "h2h") return renderH2HDetail(data);
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
  if (fixture.dataSource !== "api-football") {
    elements.dataDialogContent.insertAdjacentHTML("afterbegin", '<div class="detail-note"><strong>Modo demostración</strong><span>No existen datos reales detallados para este escenario sintético.</span></div>');
  }
  elements.dataDialog.showModal();
}

const resultLabels = Object.freeze({ pending: "Pendiente", won: "Ganado", lost: "Perdido", void: "Anulado" });

function persistParlayDraft() {
  saveParlayDraft(state.parlayDraft);
}

function persistSavedParlays() {
  saveSavedParlays(state.savedParlays);
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

  elements.parlayDraftList.innerHTML = state.parlayDraft.map((leg, index) => `
    <article class="parlay-draft-leg">
      <div class="parlay-draft-leg__number">${index + 1}</div>
      <div>
        <strong>${escapeHtml(leg.selection)}</strong>
        <span>${escapeHtml(leg.market)}</span>
        <small>${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)} · ${escapeHtml(leg.date)}</small>
        <small>Confianza: ${escapeHtml(leg.confidence)} · Riesgo: ${escapeHtml(leg.risk)}</small>
        <small>Cuota ${displayValue(leg.decimalOdds)} · EV ${displayValue(leg.expectedValue)}%</small>
        ${leg.requiresReview ? '<em>Requiere revisión antes de considerar una apuesta</em>' : ""}
      </div>
      <button type="button" data-remove-draft="${escapeHtml(leg.id)}" aria-label="Quitar selección">×</button>
    </article>
  `).join("");

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

  const id = `${fixture.id}:${market.mercado}:${market.seleccion}`;
  if (state.parlayDraft.some((leg) => leg.id === id)) {
    showNotice("Esta selección ya está incluida en el parlay.");
    renderParlayDraft(true);
    return;
  }
  if (state.parlayDraft.length >= 12) {
    showNotice("El cupón admite hasta 12 selecciones para mantenerlo fácil de revisar.");
    return;
  }

  state.parlayDraft.push({
    id,
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
    estimatedProbability: market.probabilidad_modelo,
    expectedValue: market.valor_esperado,
    reasoning: market.razonamiento,
    confidence: market.confianza,
    risk: market.nivel_riesgo,
    requiresReview: Boolean(market.requiere_revision),
    analysisStatus: analysis.estado_analisis,
    source: analysis._source || "openai"
  });
  persistParlayDraft();
  renderParlayDraft(true);
  showNotice("Selección agregada a Mi parlay.");
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

function renderSavedParlays() {
  elements.savedParlayCount.textContent = state.savedParlays.length;
  const metrics = calculateHistoryMetrics(state.savedParlays);
  elements.historyMetrics.innerHTML = `
    <article><span>Parlays</span><strong>${metrics.total}</strong></article>
    <article><span>Evaluados</span><strong>${metrics.settled}</strong></article>
    <article><span>Ganados / perdidos</span><strong>${metrics.won} / ${metrics.lost}</strong></article>
    <article><span>Acierto</span><strong>${metrics.winRate === null ? "—" : `${metrics.winRate}%`}</strong></article>
    <article><span>Unidades teóricas</span><strong class="${metrics.theoreticalUnits >= 0 ? "value-positive" : "value-negative"}">${metrics.theoreticalUnits}</strong></article>`;
  elements.updateParlayResults.disabled = state.savedParlays.length === 0;
  if (!state.savedParlays.length) {
    elements.savedParlaysList.innerHTML = '<div class="saved-empty"><h3>Aún no hay parlays guardados</h3><p>Agrega dos o más mercados desde un análisis IA y guarda el cupón para comenzar el seguimiento.</p><button class="button button--primary" type="button" data-view="dashboard">Ir al dashboard</button></div>';
    return;
  }

  elements.savedParlaysList.innerHTML = state.savedParlays.map((parlay) => {
    const result = calculateParlayResult(parlay.legs);
    parlay.result = result;
    return `<article class="saved-parlay saved-parlay--${result}" data-parlay-id="${escapeHtml(parlay.id)}">
      <header class="saved-parlay__header">
        <div><span>Parlay · ${parlay.legs.length} selecciones</span><h3>${escapeHtml(parlay.name)}</h3><time datetime="${escapeHtml(parlay.createdAt)}">Guardado ${escapeHtml(new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(parlay.createdAt)))}</time></div>
        <strong class="result-badge result-badge--${result}">${resultLabels[result]}</strong>
      </header>
      <div class="saved-parlay__legs">${parlay.legs.map((leg, index) => `
        <section class="saved-leg saved-leg--${escapeHtml(leg.result)}" data-leg-id="${escapeHtml(leg.id)}">
          <div class="saved-leg__index">${index + 1}</div>
          <div class="saved-leg__content"><strong>${escapeHtml(leg.selection)}</strong><span>${escapeHtml(leg.market)}</span><small>${escapeHtml(leg.home)} vs ${escapeHtml(leg.away)} · ${escapeHtml(leg.date)}${leg.finalScore ? ` · Final ${escapeHtml(leg.finalScore)}` : ""}</small><small>Cuota ${displayValue(leg.decimalOdds)} · Prob. ${displayValue(leg.estimatedProbability)}% · EV ${displayValue(leg.expectedValue)}%</small><small>Confianza: ${escapeHtml(leg.confidence)} · Riesgo: ${escapeHtml(leg.risk)}</small></div>
          <label>Resultado<select data-leg-result><option value="pending" ${leg.result === "pending" ? "selected" : ""}>Pendiente</option><option value="won" ${leg.result === "won" ? "selected" : ""}>Ganada</option><option value="lost" ${leg.result === "lost" ? "selected" : ""}>Perdida</option><option value="void" ${leg.result === "void" ? "selected" : ""}>Anulada</option></select></label>
        </section>`).join("")}</div>
      <div class="saved-parlay__notes"><label for="notes-${escapeHtml(parlay.id)}">Notas del resultado</label><textarea id="notes-${escapeHtml(parlay.id)}" data-parlay-notes maxlength="500" placeholder="Qué ocurrió, datos que faltaron o qué revisarías después…">${escapeHtml(parlay.notes || "")}</textarea></div>
      <footer class="saved-parlay__footer"><span>El resultado general se calcula con los estados de las selecciones.</span><button class="button button--danger" type="button" data-delete-parlay>Eliminar registro</button></footer>
    </article>`;
  }).join("");
  persistSavedParlays();
}

async function updateSavedParlayResults() {
  const fixtureIds = [...new Set(state.savedParlays.flatMap((parlay) => parlay.legs)
    .filter((leg) => leg.result === "pending" && leg.selectionCode)
    .map((leg) => leg.fixtureId))];
  if (!fixtureIds.length) {
    showNotice("No hay selecciones compatibles pendientes de actualización automática.");
    return;
  }
  elements.updateParlayResults.disabled = true;
  elements.updateParlayResults.textContent = "Consultando resultados…";
  try {
    const results = await Promise.all(fixtureIds.map(async (fixtureId) => {
      try { return await footballDataService.getFixtureResult(fixtureId); } catch { return null; }
    }));
    const byFixture = new Map(results.filter(Boolean).map((result) => [String(result.fixtureId), result]));
    let updated = 0;
    state.savedParlays.forEach((parlay) => {
      parlay.legs.forEach((leg) => {
        if (leg.result !== "pending") return;
        const fixtureResult = byFixture.get(String(leg.fixtureId));
        const nextResult = settleLegResult(leg.selectionCode, fixtureResult);
        if (nextResult !== "pending") {
          leg.result = nextResult;
          leg.finalScore = `${fixtureResult.goals.home}-${fixtureResult.goals.away}`;
          leg.resolvedAt = new Date().toISOString();
          updated += 1;
        }
      });
      parlay.result = calculateParlayResult(parlay.legs);
      parlay.lastCheckedAt = new Date().toISOString();
    });
    persistSavedParlays();
    renderSavedParlays();
    showNotice(updated ? `${updated} selección(es) actualizadas con API-Football.` : "Los partidos pendientes todavía no tienen resultado final.");
  } finally {
    elements.updateParlayResults.disabled = state.savedParlays.length === 0;
    elements.updateParlayResults.textContent = "Actualizar resultados";
  }
}

function switchView(view) {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll(".main-nav [data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("main-nav__item--active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (view === "saved") renderSavedParlays();
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
    value_sospechoso: "Value sospechoso", agresivo_stake_bajo: "Agresivo · exposición baja",
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

  elements.analysisContent.innerHTML = `
    <div class="analysis-hero">
      <div class="analysis-hero__title"><h3>${escapeHtml(analysis.partido.local)} vs ${escapeHtml(analysis.partido.visitante)}</h3>${quality ? `<span class="quality-badge quality-badge--${quality.level.toLowerCase()}">Cobertura ${escapeHtml(quality.level)} · ${quality.score}/100</span>` : ""}</div>
      <p>${escapeHtml(analysis.resumen_partido)}</p>
    </div>
    ${pickReviewHtml}
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
        ${analysis.mercados_sugeridos.length ? analysis.mercados_sugeridos.map((market, index) => `<div class="market-row market-row--actionable"><div><span>${escapeHtml(market.seleccion)}</span><small>${escapeHtml(market.mercado)} · Cuota ${displayValue(market.cuota_decimal)} · Prob. ${displayValue(market.probabilidad_modelo)}% · EV ${displayValue(market.valor_esperado)}%</small><small>${escapeHtml(categoryLabels[market.pickCategory] || "Sin categoría")} · Confianza lógica ${displayValue(market.confidenceScore, 0)}/100${market.requiere_revision ? " · Requiere revisión" : ""}</small>${market.warning ? `<small>${escapeHtml(market.warning)}</small>` : ""}</div><button class="button button--add" type="button" data-add-market="${index}" ${analysis._source === "mock" || market.requiere_revision || !quality?.canSuggest ? "disabled" : ""}>Agregar al parlay</button></div>`).join("") : '<p>No se identificó un mercado con cobertura y valor suficiente.</p>'}
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
  elements.analysisContent.innerHTML = '<div class="empty-state"><span class="empty-state__icon" aria-hidden="true">✦</span><h3>Partido seleccionado</h3><p>Pulsa “Generar análisis IA” para ejecutar la simulación.</p></div>';
}

async function selectFixture(fixtureId, generateAnalysis = false) {
  if (state.isAnalyzing) return;
  state.selectedFixtureId = fixtureId;
  renderMatches();
  const fixtureIndex = state.fixtures.findIndex((fixture) => fixture.id === fixtureId);

  try {
    const detailedFixture = await footballDataService.getFixtureData(selectedFixture());
    if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = detailedFixture;
    renderFixtureData();
  } catch (error) {
    elements.filterError.hidden = false;
    elements.filterError.textContent = error.message;
    return;
  }

  if (!generateAnalysis) {
    const saved = state.analysisByFixture.get(fixtureId);
    saved ? renderAnalysis(saved) : showAnalysisEmpty();
    return;
  }

  state.isAnalyzing = true;
  elements.analysisStatus.className = "status-badge status-badge--processing";
  elements.analysisStatus.textContent = "Procesando";
  elements.analysisContent.innerHTML = '<div class="empty-state"><div class="loading-spinner" aria-hidden="true"></div><h3>Evaluando cobertura</h3><p>Generando una respuesta JSON simulada sin completar datos ausentes…</p></div>';

  try {
    const analysis = await footballDataService.generateAnalysis(selectedFixture());
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
  if (!fixture || fixture.status === "finished" || state.isAnalyzing) return;
  await selectFixture(fixture.id, true);
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
      return {
        ...fixture,
        status: result.appStatus || fixture.status,
        statusLabel: result.statusLabel || fixture.statusLabel,
        statusShort: result.status || fixture.statusShort,
        elapsed: result.elapsed ?? fixture.elapsed,
        score: result.goals || fixture.score
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
  elements.refreshResearch.textContent = "Actualizando…";
  try {
    const detailedFixture = await footballDataService.getFixtureData(fixture, true);
    const fixtureIndex = state.fixtures.findIndex((item) => item.id === fixture.id);
    if (fixtureIndex >= 0) state.fixtures[fixtureIndex] = detailedFixture;
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
    elements.refreshResearch.disabled = !selectedFixture()?.researchData;
    elements.refreshResearch.textContent = "Actualizar datos";
  }
}

function validateFilters() {
  if (!selectedLeagueSlugs().length) return "Selecciona al menos una liga.";
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
      leagues: selectedLeagueSlugs(),
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
  if (input.matches('input[name="league"]')) {
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
elements.refreshFixtureStatuses.addEventListener("click", refreshFixtureStatuses);
elements.generateSelectedAnalysis.addEventListener("click", analyzeSelectedFixture);
elements.dataDialogClose.addEventListener("click", () => elements.dataDialog.close());
elements.dataDialog.addEventListener("click", (event) => {
  if (event.target === elements.dataDialog) elements.dataDialog.close();
});
elements.analysisContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-market]");
  if (!button) return;
  const analysis = state.analysisByFixture.get(state.selectedFixtureId);
  addMarketToParlay(analysis, Number(button.dataset.addMarket));
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
  const deleteButton = event.target.closest("[data-delete-parlay]");
  const card = event.target.closest("[data-parlay-id]");
  if (!deleteButton || !card) return;
  if (!window.confirm("¿Eliminar este registro de parlay? Esta acción no se puede deshacer.")) return;
  state.savedParlays = state.savedParlays.filter((item) => item.id !== card.dataset.parlayId);
  persistSavedParlays();
  renderSavedParlays();
});
document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) switchView(viewButton.dataset.view);
});
elements.matchesList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-fixture-id]");
  if (!button || !card) return;
  selectFixture(card.dataset.fixtureId, button.dataset.action === "analyze");
});

document.querySelectorAll("[data-nav-label]").forEach((button) => {
  button.addEventListener("click", () => {
    showNotice(`${button.dataset.navLabel} es un módulo preparado, pero todavía no está habilitado.`);
  });
});

async function initializeApp() {
  renderLeagueOptions();
  updateLeagueCount();
  renderParlayDraft();
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
