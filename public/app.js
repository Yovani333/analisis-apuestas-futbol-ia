import { ALLOWED_LEAGUES, DATA_CATEGORIES, MOCK_FIXTURES } from "./mock-data.js";
import { footballDataService } from "./services.js";

const state = {
  fixtures: [],
  selectedFixtureId: null,
  analysisByFixture: new Map(),
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
  analysisStatus: document.querySelector("#analysis-status"),
  analysisContent: document.querySelector("#analysis-content")
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

function renderLeagueOptions() {
  elements.leagueOptions.innerHTML = ALLOWED_LEAGUES.map((league) => `
    <label class="checkbox-row">
      <input type="checkbox" name="league" value="${escapeHtml(league.slug)}" checked />
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
    elements.matchesList.innerHTML = '<div class="empty-results">No hay escenarios de demostración para estos filtros.</div>';
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
  elements.selectedSummary.innerHTML = `<strong>${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)}</strong><span>${escapeHtml(fixture.leagueName)} · ${escapeHtml(formatDate(fixture.date))} · ${sourceLabel}</span>`;
  elements.dataGrid.innerHTML = DATA_CATEGORIES.map((category) => `
    <article class="data-card">
      <h3>${escapeHtml(category.label)}</h3>
      ${statusBadge(fixture.dataAvailability[category.key] || "No disponible")}
    </article>
  `).join("");
}

function renderAnalysis(analysis) {
  elements.analysisStatus.className = `status-badge status-badge--${statusClass(analysis.estado_analisis)}`;
  elements.analysisStatus.textContent = analysis.estado_analisis;
  const list = (items, fallback) => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(fallback)}</p>`;

  elements.analysisContent.innerHTML = `
    <div class="analysis-hero">
      <h3>${escapeHtml(analysis.partido.local)} vs ${escapeHtml(analysis.partido.visitante)}</h3>
      <p>${escapeHtml(analysis.resumen_partido)}</p>
    </div>
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
        ${analysis.mercados_sugeridos.map((market) => `<div class="market-row"><span>${escapeHtml(market.seleccion)}</span><strong>${escapeHtml(market.confianza)}</strong></div>`).join("")}
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
  if (elements.dateFrom.value && elements.dateTo.value && elements.dateFrom.value > elements.dateTo.value) return "La fecha inicial no puede ser posterior a la fecha final.";
  return "";
}

async function searchFixtures(event) {
  event.preventDefault();
  const error = validateFilters();
  elements.filterError.hidden = !error;
  elements.filterError.textContent = error;
  if (error || state.isSearching) return;

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

elements.form.addEventListener("change", updateLeagueCount);
elements.form.addEventListener("submit", searchFixtures);
elements.matchesList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-fixture-id]");
  if (!button || !card) return;
  selectFixture(card.dataset.fixtureId, button.dataset.action === "analyze");
});

document.querySelectorAll("[data-nav-label]").forEach((button) => {
  button.addEventListener("click", () => {
    const notice = document.querySelector("#app-notice");
    notice.textContent = `${button.dataset.navLabel} es un módulo preparado, pero todavía no está habilitado.`;
    notice.hidden = false;
    window.clearTimeout(Number(notice.dataset.timeoutId || 0));
    const timeoutId = window.setTimeout(() => { notice.hidden = true; }, 3500);
    notice.dataset.timeoutId = String(timeoutId);
  });
});

async function initializeApp() {
  renderLeagueOptions();
  updateLeagueCount();
  const runtime = await footballDataService.getRuntime();
  if (runtime.mode === "live") {
    document.querySelector("#runtime-mode").textContent = runtime.liveReady ? "Datos reales" : "Configuración pendiente";
    document.querySelector("#runtime-description").textContent = runtime.liveReady
      ? "API-Football y OpenAI están configurados en el backend."
      : `Faltan variables del servidor: ${(runtime.missing || []).join(", ")}.`;
  } else if (window.location.hostname.endsWith("github.io")) {
    document.querySelector("#runtime-mode").textContent = "Demo pública sin APIs";
    document.querySelector("#runtime-description").textContent = "GitHub Pages no ejecuta el backend; los partidos y análisis mostrados son sintéticos.";
  }
  elements.form.requestSubmit();
}

initializeApp();
