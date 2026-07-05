# Orígenes de picks

El valor `sourceModule` se conserva como identificador técnico dentro de picks y parlays. La interfaz debe convertirlo con `pickOriginLabel()` desde `public/pick-origins.js`; nunca debe mostrar el identificador crudo al usuario.

| Origen técnico | Nombre visible | Módulo que lo genera | Tipo de pick | Estado | Flujo que lo guarda |
| --- | --- | --- | --- | --- | --- |
| `data_picks` | Picks basados en datos | `server/services/data-picks.service.js` | Mercados evaluados cruzando datos, cuotas, Poisson y probabilidad de gol | Activo | `addDataPickToParlay()` / `saveDataPick()` |
| `odds` | Cuotas | Datos de mercado / Cuotas | Selecciones normalizadas desde cuotas | Activo | `addOddsPickToParlay()` / `saveOddsPick()` |
| `odds_rule_engine` | Análisis con datos | `server/services/rule-analysis.service.js` | Selecciones finales del Motor de Reglas | Activo | `addMarketToParlay()` / `saveAnalysisMarket()` |
| `poisson` | Modelo Poisson | `server/services/poisson-model.service.js` | Goles, BTTS y resultados derivados de Poisson | Activo | `addPoissonPick()` / `savePoissonPick()` |
| `corners` | Corners | `server/services/corners-model.service.js` | Mercados de tiros de esquina | Activo | `addCornerPick()` / `saveCornerPick()` |
| `team_goal_probability` | Probabilidad de gol | `server/services/team-goal-probability.service.js` | Goles por equipo y BTTS | Activo | `addTeamGoalPick()` / `saveTeamGoalPick()` |
| `team_average_performance` | Rendimiento promedio por equipo | `server/services/team-performance-picks.service.js` | DNB, doble oportunidad, gol de equipo y resultado derivados de tiros, pases, disciplina y muestra | Activo | `addTeamPerformancePick()` / `saveTeamPerformancePick()` |
| `player_goal_candidate` | Jugador con posible gol | `server/services/player-goal-candidates.service.js` | Candidato a anotar basado en minutos, titularidad, tiros, tiros a puerta, goles, penales y expectativa ofensiva | Activo | `addPlayerGoalPick()` / `savePlayerGoalPick()` |
| `manual` | Manual | Captura manual | Reservado para una futura captura manual | Reservado; no existe UI activa | Ninguno actualmente |
| `manual_picks` | Manual | Alias histórico previsto | Picks manuales | Alias legado; no generado actualmente | Ninguno actualmente |
| `Picks basados en datos` | Picks basados en datos | Versiones anteriores del frontend | Mismo contenido que `data_picks` | Alias legado; se lee, pero ya no se genera | Registros locales anteriores |

## Hallazgos

- `data_picks` proviene de **Picks basados en datos**. No proviene de Cuotas, Poisson, Corners ni Probabilidad de Gol por Equipo.
- El texto `Picks basados en datos` llegó a guardarse directamente como `sourceModule` en una versión anterior. Se mantiene como alias de lectura para no romper registros locales existentes.
- `Ver Picks` es el nombre histórico de la acción visual; el módulo técnico vigente es `data_picks` y el nombre visible es **Picks basados en datos**.
- `odds` y `odds_rule_engine` son diferentes: el primero nace directamente de Cuotas y el segundo de la decisión del Motor de Reglas.
- Los orígenes se conservan al normalizar una selección en `public/parlay-store.js` y se muestran mediante `pickOriginLabel()` en `public/app.js`.
