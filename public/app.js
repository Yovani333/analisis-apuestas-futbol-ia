import { ALLOWED_LEAGUES, DATA_CATEGORIES, MOCK_FIXTURES } from "./mock-data.js?v=20260620-clean-start";
import { footballDataService } from "./services.js?v=20260620-efficient-analysis";
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
  isAnalyzing: false
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
  matchesList: document.querySelector("#matches-list"),
  selectedSummary: document.querySelector("#selected-match-summary"),
  dataStatus: document.querySelector("#data-overall-status"),
  dataGrid: document.querySelector("#data-grid"),
  dataDialog: document.querySelector("#data-detail-dialog"),
  dataDialogTitle: document.querySelector("#data-detail-title"),
  dataDialogSubtitle: document.querySelector("#data-detail-subtitle"),
  dataDialogContent: document.querySelector("#data-detail-content"),
  dataDialogClose: document.querySelector("#data-detail-close"),
  analysisStatus: document.querySelector("#analysis-status"),
  analysisContent: document.querySelector("#analysis-content"),
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
    "Necesita revisión": "review",
    "Procesando": "processing",
    "No disponible": "unavailable"
  }[status] || "unavailable";
}

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
        return `
          <article class="match-card${selected ? " match-card--selected" : ""}" data-fixture-id="${escapeHtml(fixture.id)}" ${selected ? 'aria-current="true"' : ""}>
            <span class="match-card__favorite" aria-hidden="true">☆</span>
            <div class="match-card__teams">
              <strong>${escapeHtml(fixture.home)}</strong>
              <span class="match-card__versus">vs</span>
              <strong>${escapeHtml(fixture.away)}</strong>
            </div>
            <div class="match-card__meta">
              <time datetime="${escapeHtml(fixture.date)}T${escapeHtml(fixture.time)}">${escapeHtml(formatDate(fixture.date))} · ${escapeHtml(fixture.time)}</time>
              ${statusBadge(fixture.statusLabel)}
            </div>
            <div class="match-card__actions">
              <button class="button button--secondary" type="button" data-action="view">Ver datos</button>
              <button class="button button--primary" type="button" data-action="analyze">Generar análisis IA</button>
            </div>
          </article>`;
      }).join("")}
    </section>
  `).join("") + `
    <div class="matches-footer">
      <span>Mostrando ${state.fixtures.length} de ${state.fixtures.length} partidos</span>
      <span>Fuente: ${state.fixtures.some((fixture) => fixture.dataSource === "api-football") ? "API-Football" : "demostración sintética"}</span>
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
  elements.selectedSummary.innerHTML = `<strong>${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)}</strong><span>${escapeHtml(fixture.leagueName)} · ${escapeHtml(formatDate(fixture.date))} · ${sourceLabel}${escapeHtml(qualityLabel)}</span>`;
  elements.dataGrid.innerHTML = DATA_CATEGORIES.map((category) => `
    <button class="data-card" type="button" data-category="${escapeHtml(category.key)}" aria-label="Ver detalle de ${escapeHtml(category.label)}">
      <h3>${escapeHtml(category.label)}</h3>
      ${statusBadge(fixture.dataAvailability[category.key] || "No disponible")}
      <span class="data-card__action">Ver detalle <span aria-hidden="true">→</span></span>
    </button>
  `).join("");
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
  const teamCard = (team, venue) => `<section class="team-stat-card"><h3>${escapeHtml(team.team)}</h3><div class="stat-row"><span>Forma reciente</span><strong>${displayValue(team.form)}</strong></div><div class="stat-row"><span>Partidos analizados</span><strong>${displayValue(team.played)}</strong></div><div class="stat-row"><span>Goles a favor / contra</span><strong>${displayValue(team.avgGoalsFor)} / ${displayValue(team.avgGoalsAgainst)}</strong></div><div class="stat-row"><span>Over 2.5</span><strong>${displayValue(team.over25Rate)}%</strong></div><div class="stat-row"><span>Ambos anotan</span><strong>${displayValue(team.bttsRate)}%</strong></div><div class="stat-row"><span>Rendimiento ${venue === "home" ? "local sin perder" : "visitante sin perder"}</span><strong>${displayValue(venue === "home" ? team.homeNonLossRate : team.awayNonLossRate)}%</strong></div><div class="stat-row"><span>Días de descanso</span><strong>${displayValue(team.restDays)}</strong></div></section>`;
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
  const status = fixture.dataAvailability?.[categoryKey] || "No disponible";
  elements.dataDialogTitle.textContent = category.label;
  elements.dataDialogSubtitle.textContent = `${fixture.home} vs ${fixture.away} · ${status}`;
  elements.dataDialogContent.innerHTML = categoryDetail(categoryKey, fixture);
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
  if (market.requiere_revision || !analysis._context?.quality?.canSuggest) {
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

  elements.analysisContent.innerHTML = `
    <div class="analysis-hero">
      <div class="analysis-hero__title"><h3>${escapeHtml(analysis.partido.local)} vs ${escapeHtml(analysis.partido.visitante)}</h3>${quality ? `<span class="quality-badge quality-badge--${quality.level.toLowerCase()}">Cobertura ${escapeHtml(quality.level)} · ${quality.score}/100</span>` : ""}</div>
      <p>${escapeHtml(analysis.resumen_partido)}</p>
    </div>
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
        ${analysis.mercados_sugeridos.length ? analysis.mercados_sugeridos.map((market, index) => `<div class="market-row market-row--actionable"><div><span>${escapeHtml(market.seleccion)}</span><small>${escapeHtml(market.mercado)} · Cuota ${displayValue(market.cuota_decimal)} · Prob. ${displayValue(market.probabilidad_modelo)}% · EV ${displayValue(market.valor_esperado)}%</small><small>Confianza ${escapeHtml(market.confianza)}${market.requiere_revision ? " · Requiere revisión" : ""}</small></div><button class="button button--add" type="button" data-add-market="${index}" ${analysis._source === "mock" || market.requiere_revision || !quality?.canSuggest ? "disabled" : ""}>Agregar al parlay</button></div>`).join("") : '<p>No se identificó un mercado con cobertura y valor suficiente.</p>'}
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
      elements.dateFrom.value = "2026-06-11";
      elements.dateTo.value = "2026-06-28";
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
