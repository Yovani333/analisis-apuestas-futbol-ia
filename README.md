# Análisis de Apuestas de Fútbol con IA

Dashboard full-stack para consultar partidos de seis competiciones permitidas, revisar calidad de datos y generar análisis prudentes con API-Football y OpenAI.

## Enlaces

- [Demo visual en GitHub Pages](https://yovani333.github.io/analisis-apuestas-futbol-ia/) — funciona en modo mock porque GitHub Pages es hosting estático.
- Aplicación full-stack local: `http://127.0.0.1:3000` después de ejecutar `npm start`.

> GitHub Pages no ejecuta Node.js ni puede leer `.env`. Para usar API-Football y OpenAI en internet debe desplegarse la aplicación full-stack en un hosting compatible con Node y configurar allí sus variables secretas.

## Estado actual

El proyecto incluye un backend seguro y dos modos:

- `mock`: funciona sin claves con escenarios completamente sintéticos.
- `live`: consulta API-Football desde el servidor y utiliza OpenAI para análisis JSON estructurado.

Las claves nunca se envían al navegador. El modo inicial es `mock`.

Las tarjetas de cobertura del partido son interactivas. Al pulsarlas se abre una ventana dentro del dashboard con clasificación, estadísticas, enfrentamientos, alineaciones o cuotas cuando API-Football proporciona esos datos. La información ausente se identifica claramente y no se completa por inferencia.

Los mercados sugeridos por un análisis real pueden agregarse a un cupón de parlay. Los cupones guardados conservan partido, mercado, selección, confianza, riesgo y estado de revisión. En **Parlays guardados** cada selección puede marcarse como pendiente, ganada, perdida o anulada; el resultado general se calcula automáticamente. En esta fase el historial se almacena solo en `localStorage` del navegador y no se sincroniza entre dispositivos.

Antes de llamar a OpenAI, el backend construye una ficha prepartido con los últimos cinco encuentros por equipo, forma, goles, rendimiento local/visitante, descanso y cuotas principales. Calcula probabilidad implícita, margen de la casa, cuota justa y valor esperado con un método descriptivo y transparente. La primera versión cuantitativa se limita a doble oportunidad, Over/Under 2.5 y ambos equipos anotan. OpenAI explica esos cálculos, pero no puede reemplazarlos ni crear cifras nuevas.

### Investigación normalizada — etapa 1

El backend incorpora `normalizeMatchResearchData()` y agrega `researchData` a la respuesta de `GET /api/fixtures/:fixtureId`. El contrato completo está documentado en `docs/match-research-contract.json`.

Módulos normalizados de forma independiente:

- `getStandingsData()`
- `getH2HData()`
- `getOddsData()`
- `getContextCalendarData()`
- `getStatsFormData()`
- `getInjuriesSuspensionsData()`
- `getLineupsData()`
- `getXgXgaData()`
- `getWeatherPitchData()`

Cada módulo usa `available`, `partial`, `not_available` o `failed`, conserva fuente y timestamp y explica los faltantes. Una respuesta vacía de lesiones no se interpreta como confirmación de que no existen bajas.

Pesos de confianza: lesiones/sanciones 18, alineaciones 18, forma 17, xG/xGA 17, contexto 10, clasificación 8, cuotas 7, H2H 3 y clima/cancha 2. Un módulo parcial aporta la mitad. Si faltan al menos tres de los cuatro módulos críticos —lesiones, alineaciones, forma y xG/xGA— el estado siempre será `needs_review`.

`buildOpenAIPromptFromMatchData()` ya prepara instrucciones estrictas y elimina códigos internos, pero todavía no sustituye el flujo activo de OpenAI; esa conexión corresponde a la etapa siguiente para mantener el cambio aislado y verificable.

GitHub Pages publica exclusivamente `public/` mediante `.github/workflows/deploy-pages.yml`. Las APIs reales requieren ejecutar el servidor Node localmente o desplegarlo en un proveedor compatible con backend.

## Ligas permitidas

- La Liga — España
- Superliga China — China
- Bundesliga — Alemania
- Primeira Liga — Portugal
- Ligue 1 — Francia
- Copa Mundial FIFA — Mundial (API-Football ID 1, temporada 2026)

Los IDs fueron verificados contra API-Football el 19 y 20 de junio de 2026 y están documentados en la configuración para ahorrar solicitudes. Deben revalidarse si el proveedor cambia su catálogo. Las temporadas automáticas sí consultan metadatos actuales.

## Tecnologías

- HTML, CSS y JavaScript ES Modules.
- Node.js y Express.
- API-Football mediante llamadas exclusivas desde el backend.
- SDK oficial de OpenAI y Responses API con salida estructurada mediante Zod.
- Helmet, límites de solicitudes, validación de parámetros, timeouts y caché en memoria.

## Estructura

```text
public/                  Frontend
server/
├── config/              Entorno y ligas permitidas
├── middleware/          Validación y errores
├── routes/              Rutas /api
├── schemas/             Contrato estructurado del análisis
├── services/            API-Football y OpenAI
├── app.js               Configuración de Express
└── server.js            Inicio del servidor
test/                    Pruebas automáticas
docs/                    Contrato JSON de referencia
```

## Instalación

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000).

Para desarrollo con reinicio automático:

```powershell
npm run dev
```

## Configuración

`.env.example` contiene solamente nombres y valores seguros:

```dotenv
API_FOOTBALL_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
DATA_MODE=mock
PORT=3000
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
```

Para activar datos reales, completa un `.env` local y cambia `DATA_MODE=live`. Confirma que `OPENAI_MODEL` sea un identificador disponible en tu proyecto de OpenAI.

La interfaz incluye temporadas históricas y la temporada 2026 para la Copa Mundial FIFA. La cobertura real de cada competición depende del plan vigente de API-Football; cuando corresponda puede usarse la opción automática.

Nunca publiques `.env`, claves, respuestas internas del proveedor ni registros con secretos.

## Rutas principales

```text
GET  /api/health
GET  /api/leagues
GET  /api/fixtures
GET  /api/fixtures/:fixtureId
GET  /api/fixtures/:fixtureId/result
GET  /api/fixtures/:fixtureId/statistics
GET  /api/fixtures/:fixtureId/standings
GET  /api/fixtures/:fixtureId/head-to-head
GET  /api/fixtures/:fixtureId/injuries
GET  /api/fixtures/:fixtureId/lineups
GET  /api/fixtures/:fixtureId/odds
GET  /api/head-to-head?fixtureId=123
POST /api/fixtures/:fixtureId/analysis
```

`sidelined` responde como no verificado hasta confirmar que el plan contratado ofrece cobertura adecuada. No se inventa ni se sustituye esa información.

API-Football está integrado actualmente para fixtures, estadísticas del fixture, clasificación, H2H, lesiones, alineaciones y cuotas. La cobertura real comprobada también incluye eventos y jugadores, pero esos endpoints aún no alimentan el análisis normalizado. `teams/statistics` requiere tratamiento específico porque responde con un objeto agregado. Clima/cancha y xG/xGA acumulado permanecen `not_available` cuando API-Football no los entrega en un formato prepartido verificable. No hay APIs meteorológicas ni scrapers adicionales configurados.

## Flujo de datos

1. El frontend consulta rutas propias bajo `/api`.
2. El backend valida liga, fechas, temporada, estado e ID de fixture.
3. API-Football entrega los datos deportivos.
4. El backend resume forma reciente, localía/visita, descanso y cuotas principales.
5. Un módulo determinista calcula probabilidad implícita, margen, cuota justa y valor esperado.
6. El paquete reducido y verificado se envía a OpenAI; las respuestas numéricas se sustituyen por los cálculos del servidor.
7. Zod valida el JSON antes de responder al navegador.
8. Los resultados finales pueden actualizarse desde API-Football sin volver a ejecutar OpenAI.

En esta fase se muestran como máximo cinco fixtures por liga y búsqueda para proteger el rendimiento y el cupo del proveedor.

Si falta información importante, el análisis debe indicar `Necesita revisión`. Una calidad baja bloquea la incorporación al parlay. Las probabilidades 1X2 permanecen en `null` cuando no pueden estimarse responsablemente.

## Pruebas

```powershell
npm test
```

Las pruebas verifican ligas permitidas, rangos de fechas e identificadores de fixture.

## Seguridad y uso responsable

- El frontend no recibe claves API.
- Las consultas se limitan por frecuencia y tamaño.
- Solo se permiten las seis competiciones configuradas.
- Las llamadas externas tienen timeout y caché temporal.
- El sistema no debe prometer resultados ni ganancias.

Este proyecto es únicamente informativo. Ningún análisis garantiza resultados ni ganancias. Apuesta con responsabilidad.
