# Analisis de Apuestas de Futbol

Dashboard full-stack para consultar partidos, revisar cobertura de datos y preparar analisis deportivos con API-Football, Open-Meteo y modelos internos deterministas.

## Estado Actual

El proyecto funciona en dos modos:

- `mock`: escenarios sinteticos sin claves.
- `live`: datos reales desde API-Football en el backend.

El sistema no requiere OpenAI para iniciar, consultar datos, calcular picks, generar simulaciones ni auditar resultados. Los analisis se construyen con reglas internas, Poisson, xG/xGA estimado, Elo/Dixon-Coles cuando aplica, EV, calidad de datos y controles de riesgo.

Las claves nunca se envian al navegador. El frontend consulta rutas propias bajo `/api`.

## Fuentes

- API-Football: fixtures, calendario, estado, marcador, venue, estadisticas, eventos, jugadores, alineaciones, lesiones, cuotas, H2H, standings y datos agregados cuando la cobertura exista.
- Open-Meteo: clima/cancha sin API key.
- Modelos internos: xG/xGA estimado, Poisson, corners, selector 1X2, rendimiento, candidatos de gol, picks y simulacion.
- Fuentes secundarias opcionales: permanecen desactivadas o como respaldo controlado; no sustituyen datos confirmados.

## Reglas De Datos

- No se inventan datos faltantes.
- No se reemplazan datos validos con respuestas vacias.
- No se usan estadisticas del fixture actual para analisis prepartido.
- Los partidos programados usan historico previo.
- Los partidos en vivo/finalizados pueden usar datos reales del fixture para auditoria.
- Los calculos internos de xG/xGA nunca se presentan como xG oficial.
- OpenAI no participa en la toma de decisiones ni en la busqueda de datos deportivos.

## Modulos Principales

- Dashboard de partidos.
- Transparencia de datos.
- Selector obligatorio 1X2.
- xG/xGA estimado.
- Modelo Poisson.
- Probabilidad de gol por equipo.
- Rendimiento promedio por equipo.
- Jugador con posible gol.
- Corners.
- Catalogo de mercados.
- Picks recomendados.
- Simulacion.
- En vivo.
- Mis apuestas y parlays.
- Auditoria de evidencias.

## Calidad Y Cobertura

La calidad se calcula con modulos normalizados:

- Lesiones / sanciones.
- Alineaciones.
- Estadisticas / forma.
- xG / xGA.
- Contexto / calendario.
- Clasificacion.
- Cuotas.
- Head to head.
- Clima / cancha.

Los datos complementarios incluyen estadisticas de temporada, eventos del partido, rendimiento de jugadores y lado ofensivo cuando la fuente proporciona ubicacion estructurada de jugadas. Si no existe ubicacion suficiente, se muestra como no disponible sin inferir por posicion nominal.

## Configuracion

`.env.example` contiene valores seguros:

```dotenv
API_FOOTBALL_KEY=
DATA_MODE=mock
PORT=3000
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
SOFASCORE_ACCESS_MODE=disabled
ODDSPEDIA_ACCESS_MODE=disabled
FOTMOB_ACCESS_MODE=disabled
WHOSCORED_ACCESS_MODE=disabled
FBREF_ACCESS_MODE=disabled
WEATHER_ACCESS_MODE=open_meteo
SOCCERWAY_ACCESS_MODE=disabled
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
EVIDENCE_AUTOMATION_SECRET=
EVIDENCE_AUTOMATION_INTERVAL_MS=300000
```

Para usar datos reales:

```powershell
Copy-Item .env.example .env
# Completa API_FOOTBALL_KEY y cambia DATA_MODE=live
npm start
```

## Instalacion

```powershell
npm install
npm start
```

Aplicacion local: [http://127.0.0.1:3000](http://127.0.0.1:3000)

Para desarrollo:

```powershell
npm run dev
```

## Rutas Principales

```text
GET  /api/health
GET  /api/leagues
GET  /api/fixtures
GET  /api/fixtures/:fixtureId
GET  /api/fixtures/:fixtureId/research
GET  /api/fixtures/:fixtureId/result
GET  /api/fixtures/:fixtureId/statistics
GET  /api/fixtures/:fixtureId/standings
GET  /api/fixtures/:fixtureId/head-to-head
GET  /api/fixtures/:fixtureId/injuries
GET  /api/fixtures/:fixtureId/lineups
GET  /api/fixtures/:fixtureId/odds
GET  /api/fixtures/:fixtureId/events
GET  /api/fixtures/:fixtureId/players
GET  /api/fixtures/:fixtureId/team-statistics
POST /api/fixtures/:fixtureId/analysis
```

## Pruebas

```powershell
npm test
```

## Seguridad Y Uso Responsable

- El frontend no recibe claves API.
- Las consultas tienen validacion, cache, limites y observabilidad.
- Las cuotas y picks son informacion de apoyo, no garantia.
- EV positivo no decide por si solo.
- El sistema puede devolver `no_bet` cuando no hay valor o confianza suficiente.
- Las apuestas implican riesgo y deben hacerse con responsabilidad.
