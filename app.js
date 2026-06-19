const mockMatches = [
  {
    id: 1,
    league: "La Liga (España)",
    home: "Real Madrid",
    away: "Sevilla",
    date: "18/05/2025",
    time: "21:00",
    status: "Programado",
    dataStatus: {
      form: "Disponible",
      injuries: "Necesita revisión",
      lineups: "Disponible",
      odds: "Disponible",
      standings: "Disponible",
      h2h: "Disponible"
    },
    analysis: {
      summary:
        "Real Madrid llega con mejor contexto jugando como local. Sevilla muestra irregularidad fuera de casa, por lo que el análisis favorece una lectura prudente hacia el local.",
      suggestedMarkets: [
        { market: "Doble oportunidad local (1X)", confidence: "Media" },
        { market: "Under 3.5 goles", confidence: "Media" },
        { market: "Ambos anotan: No", confidence: "Media-baja" }
      ],
      risks: [
        "Posible rotación de jugadores por calendario.",
        "Sevilla puede cerrarse y buscar el empate."
      ],
      prediction: "Victoria o empate del local con menos de 3.5 goles.",
      parlay: "Sí"
    }
  },
  {
    id: 2,
    league: "Bundesliga (Alemania)",
    home: "Bayern München",
    away: "Leverkusen",
    date: "17/05/2025",
    time: "15:30",
    status: "Programado",
    dataStatus: {
      form: "Disponible",
      injuries: "Disponible",
      lineups: "Necesita revisión",
      odds: "Disponible",
      standings: "Disponible",
      h2h: "Disponible"
    },
    analysis: {
      summary:
        "Partido de alta exigencia entre dos equipos fuertes. El riesgo principal está en la igualdad competitiva y en posibles cambios de alineación.",
      suggestedMarkets: [
        { market: "Over 1.5 goles", confidence: "Media" },
        { market: "Ambos anotan: Sí", confidence: "Media" },
        { market: "Evitar 1X2 directo", confidence: "Media-baja" }
      ],
      risks: [
        "Partido parejo con alta varianza.",
        "La alineación debe confirmarse antes de tomar decisión."
      ],
      prediction: "Partido con goles, pero sin favorito claro con los datos actuales.",
      parlay: "Solo con baja exposición"
    }
  },
  {
    id: 3,
    league: "Ligue 1 (Francia)",
    home: "PSG",
    away: "Marseille",
    date: "18/05/2025",
    time: "20:45",
    status: "Programado",
    dataStatus: {
      form: "Disponible",
      injuries: "Necesita revisión",
      lineups: "Necesita revisión",
      odds: "Disponible",
      standings: "Disponible",
      h2h: "Disponible"
    },
    analysis: {
      summary:
        "Clásico francés con alta carga emocional. Aunque PSG puede partir con ventaja, el mercado puede estar afectado por narrativa y popularidad.",
      suggestedMarkets: [
        { market: "PSG empate no acción", confidence: "Media" },
        { market: "Más de 3.5 tarjetas", confidence: "Media" },
        { market: "Evitar cuota baja del favorito", confidence: "Media-baja" }
      ],
      risks: [
        "Partido de rivalidad con alta posibilidad de tarjetas.",
        "Faltan alineaciones y reporte completo de ausencias."
      ],
      prediction: "Ligera ventaja local, pero con cautela por contexto de clásico.",
      parlay: "No"
    }
  },
  {
    id: 4,
    league: "Primeira Liga (Portugal)",
    home: "Porto",
    away: "Braga",
    date: "18/05/2025",
    time: "18:00",
    status: "Programado",
    dataStatus: {
      form: "Disponible",
      injuries: "Disponible",
      lineups: "Disponible",
      odds: "Disponible",
      standings: "Disponible",
      h2h: "Disponible"
    },
    analysis: {
      summary:
        "Porto tiene ventaja contextual como local, pero Braga suele competir bien ante equipos grandes. El análisis sugiere evitar exceso de confianza.",
      suggestedMarkets: [
        { market: "Doble oportunidad Porto o empate", confidence: "Media" },
        { market: "Under 3.5 goles", confidence: "Media" },
        { market: "Porto empate no acción", confidence: "Media-baja" }
      ],
      risks: [
        "Braga puede competir tácticamente.",
        "El partido puede cerrarse si el marcador tarda en abrirse."
      ],
      prediction: "Porto con ligera ventaja, pero partido potencialmente cerrado.",
      parlay: "Solo con baja exposición"
    }
  },
  {
    id: 5,
    league: "Superliga China",
    home: "Shanghai Port",
    away: "Beijing Guoan",
    date: "19/05/2025",
    time: "13:35",
    status: "Programado",
    dataStatus: {
      form: "Disponible",
      injuries: "No disponible",
      lineups: "No disponible",
      odds: "Disponible",
      standings: "Disponible",
      h2h: "Disponible"
    },
    analysis: {
      summary:
        "Shanghai Port puede tener ventaja como local, pero faltan datos importantes de lesiones y alineaciones. El análisis requiere revisión antes de apostar.",
      suggestedMarkets: [
        { market: "Over 1.5 goles", confidence: "Media-baja" },
        { market: "Shanghai Port empate no acción", confidence: "Media-baja" },
        { market: "Evitar parlay fuerte", confidence: "Baja" }
      ],
      risks: [
        "Faltan lesiones y alineaciones.",
        "Cobertura de datos limitada para análisis profundo."
      ],
      prediction: "Ventaja local moderada, pero con baja confianza por falta de datos.",
      parlay: "No"
    }
  }
];

const matchButtons = document.querySelectorAll(".match-card .primary-btn");
const viewButtons = document.querySelectorAll(".match-card .outline-btn");

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function getStatusClass(status) {
  if (status === "Disponible") return "green";
  if (status === "Necesita revisión") return "orange";
  return "orange";
}

function updateDataCards(match) {
  const dataCards = document.querySelectorAll(".data-card");

  const items = [
    {
      title: "📈 Forma reciente",
      value: match.dataStatus.form
    },
    {
      title: "🏥 Lesiones / sanciones",
      value: match.dataStatus.injuries
    },
    {
      title: "👥 Alineaciones",
      value: match.dataStatus.lineups
    },
    {
      title: "💰 Cuotas",
      value: match.dataStatus.odds
    },
    {
      title: "🏆 Standings",
      value: match.dataStatus.standings
    },
    {
      title: "🤝 Head to Head",
      value: match.dataStatus.h2h
    }
  ];

  dataCards.forEach((card, index) => {
    const item = items[index];
    if (!item) return;

    card.innerHTML = `
      <strong>${item.title}</strong>
      <span class="${getStatusClass(item.value)}">${item.value}</span>
    `;
  });
}

function updateAnalysis(match) {
  const analysisPanel = document.querySelector(".analysis");

  if (!analysisPanel) return;

  const missingCount = Object.values(match.dataStatus).filter(
    (value) => value !== "Disponible"
  ).length;

  const confirmedCount = Object.values(match.dataStatus).filter(
    (value) => value === "Disponible"
  ).length;

  const analysisStatus = missingCount >= 2 ? "Necesita revisión" : "Completo";
  const statusClass = analysisStatus === "Completo" ? "success" : "warning-badge";

  analysisPanel.innerHTML = `
    <div class="panel-title-row">
      <h2>✨ Análisis IA</h2>
      <span class="badge ${statusClass}">${analysisStatus}</span>
    </div>

    <div class="selected-match">
      <strong>${match.home} vs ${match.away}</strong>
      <span>${match.league} · ${match.date} · ${match.time}</span>
    </div>

    <div class="analysis-grid">
      <div class="analysis-box">
        <h4>Estado del análisis</h4>
        <p class="${analysisStatus === "Completo" ? "green" : "orange"}">${analysisStatus}</p>

        <h4>Resumen del partido</h4>
        <p>${match.analysis.summary}</p>

        <div class="stats-row">
          <span>Datos confirmados</span>
          <strong class="green">${confirmedCount} / 6</strong>
        </div>

        <div class="stats-row">
          <span>Datos faltantes</span>
          <strong class="${missingCount > 0 ? "orange" : "green"}">${missingCount} / 6</strong>
        </div>
      </div>

      <div class="analysis-box">
        <h4>Mercados sugeridos</h4>

        ${match.analysis.suggestedMarkets
          .map(
            (item) => `
              <div class="market">
                <span>${item.market}</span>
                <strong>${item.confidence}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    </div>

    <div class="bottom-analysis">
      <div class="mini-box">
        <h4>⚠️ Riesgos principales</h4>
        ${match.analysis.risks.map((risk) => `<p>${risk}</p>`).join("")}
      </div>

      <div class="mini-box">
        <h4>🛡️ Predicción prudente</h4>
        <p>${match.analysis.prediction}</p>
      </div>

      <div class="mini-box center">
        <h4>Apto para parlay</h4>
        <p class="big-check">${match.analysis.parlay}</p>
      </div>
    </div>

    <div class="warning">
      ⚠️ Advertencia: Este análisis es únicamente informativo. No garantiza resultados ni ganancias. Apuesta con responsabilidad.
    </div>
  `;
}

function selectMatch(matchId, shouldGenerateAnalysis = false) {
  const match = mockMatches.find((item) => item.id === matchId);

  if (!match) return;

  updateDataCards(match);

  if (shouldGenerateAnalysis) {
    const analysisPanel = document.querySelector(".analysis");

    if (analysisPanel) {
      analysisPanel.innerHTML = `
        <div class="panel-title-row">
          <h2>✨ Análisis IA</h2>
          <span class="badge warning-badge">Procesando</span>
        </div>

        <div class="loading-box">
          <div class="loader"></div>
          <p>Generando análisis con IA para ${match.home} vs ${match.away}...</p>
        </div>
      `;
    }

    setTimeout(() => {
      updateAnalysis(match);
    }, 900);
  }
}

matchButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    selectMatch(mockMatches[index].id, true);
  });
});

viewButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    selectMatch(mockMatches[index].id, false);
  });
});

selectMatch(1, false);
