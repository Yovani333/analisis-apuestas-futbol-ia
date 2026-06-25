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

El EV se conserva como métrica matemática, pero ya no decide por sí solo el pick principal. Una capa determinista separa `highestEvPick` de `recommendedPick`, identifica al favorito real desde API-Football y clasifica la fuerza del favorito, la brecha de calidad, el valor y la confianza. Las categorías posibles son `pick_fuerte`, `pick_logico`, `value_sospechoso`, `agresivo_stake_bajo`, `evitar` y `sin_pick`.

Una doble oportunidad a favor del underdog contra un favorito fuerte queda como `value_sospechoso` aunque tenga EV alto. Con dos confirmaciones deportivas puede avanzar únicamente a `agresivo_stake_bajo`; necesita al menos tres confirmaciones y confianza suficiente para ser `pick_logico`. Las confirmaciones disponibles incluyen bajas del favorito, mejor forma del underdog, xG/xGA competitivo, sede neutral, brecha reducida de clasificación y posible rotación. Si no existe un pick lateral coherente, el sistema puede mostrar como alternativa un mercado de goles o ambos anotan con valor verificado.

Después de generar el análisis IA, **Evaluación responsable** muestra una tabla vertical con hasta cinco opciones ordenadas por confianza evaluada. El porcentaje combina cobertura, confianza normalizada, muestra y coherencia de la categoría; no sustituye la probabilidad estimada del mercado. Verde identifica opciones lógicas con respaldo suficiente, naranja indica riesgo o validación parcial y rojo marca opciones a evitar o sin valor confirmado. La tabla siempre conserva probabilidad del modelo y EV para transparencia.

### Investigación normalizada — etapas 1 y 2

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

### xG/xGA oficial y estimado

El **xG** representa una estimación de la calidad y el volumen de las ocasiones creadas; el **xGA** es el xG concedido, por lo que en el modelo interno equivale al xG estimado del rival. Los valores obtenidos directamente de una fuente estadística especializada se identifican como `official`. Los cálculos internos nunca se presentan como oficiales.

Para partidos programados, `historical-estimated-xg-v1` consulta hasta cinco partidos anteriores terminados de cada equipo, obtiene sus estadísticas y eventos desde API-Football, calcula el xG estimado de ambos participantes de cada fixture y promedia el xG/xGA del equipo observado. No requiere enfrentamiento directo: los rivales históricos pueden ser distintos. Una muestra de cinco partidos suficientemente completos puede alcanzar confianza alta; tres o cuatro producen como máximo confianza media; una o dos se mantienen en confianza baja.

Para partidos en vivo o finalizados, `fixture-estimated-xg-v1` usa las estadísticas y eventos del fixture actual. El tipo normalizado es `fixture_estimated`, el alcance es `current_fixture` y el xGA de cada equipo equivale al xG estimado de su rival. Cada penal anotado o fallado detectado en eventos suma `0.76`; si no se detectan penales, el módulo lo indica expresamente. Los goles se muestran como contexto, pero no forman parte de la fórmula.

El modelo interno usa tiros totales, tiros a puerta, tiros dentro y fuera del área, tiros bloqueados, corners, penales y Dangerous Attacks cuando existen. La fórmula es: `Total Shots × 0.025 + Shots on Goal × 0.12 + Shots inside box × 0.09 + Shots outside box × 0.025 + Blocked Shots × 0.015 + Corners × 0.02 + Penalties × 0.76 + Dangerous Attacks × 0.003`. Los goles no forman parte del cálculo. Los porcentajes como `"55%"` se normalizan y los valores vacíos, inválidos o negativos se consideran faltantes.

La confianza depende principalmente de la cobertura de tiros totales, tiros a puerta, tiros dentro/fuera del área, corners y eventos. Puede ser alta, media, baja o no disponible. Un resultado superior a 6.00 se marca para revisión. Este cálculo no es un modelo entrenado con coordenadas de cada disparo y **nunca debe tratarse como xG oficial**.

El tipo `historical_estimated` es contexto prepartido y muestra los fixtures usados, datos faltantes, confianza y advertencias. En competiciones de selecciones tipo Mundial se añade una advertencia de muestra limitada; una o dos observaciones útiles conservan confianza baja y el H2H no bloquea el cálculo. No debe interpretarse como apuesta segura ni utilizarse por sí solo para generar una selección fuerte.

Por seguridad temporal, las estadísticas del mismo fixture no sustituyen el histórico prepartido: en vivo se etiquetan `live_match_context_only` y tras finalizar se consideran `post_match_audit_only`. La interfaz muestra los datos base usados, campos faltantes y notas de revisión. OpenAI recibe el tipo, confianza, versión y advertencia, y no puede presentarlas como información oficial ni como base fuerte cuando la confianza es baja.

La respuesta de OpenAI pasa por guardas deterministas antes de mostrarse. El servidor corrige menciones incorrectas de “xG oficial”, añade una descripción canónica según `official`, `historical_estimated`, `fixture_estimated` o `not_available`, reemplaza cualquier inferencia cuando no existen datos y limita el histórico o fixture estimado de confianza baja a referencia secundaria. En modo Mundial también conserva la advertencia de muestra limitada.

El servicio registra observabilidad sanitizada de API-Football: solicitudes de red, aciertos y fallos de caché, porcentaje de reutilización, fallos, último endpoint consultado y límites diario/minuto cuando el proveedor envía esas cabeceras. Este resumen aparece en `GET /api/health` y nunca incluye la clave, parámetros completos ni respuestas deportivas crudas. Un HTTP 429 se devuelve como `API_FOOTBALL_RATE_LIMIT`.

El detalle xG/xGA conserva trazabilidad de cálculo. En histórico muestra fixtures intentados, usados y omitidos con un motivo estructurado; en vivo o postpartido muestra disponibilidad de estadísticas, eventos y penales detectados. Estas métricas explican la cobertura y no modifican la fórmula ni rellenan datos faltantes.

`buildOpenAIPromptFromMatchData()` alimenta el flujo activo de OpenAI exclusivamente con `researchData`. OpenAI no recibe respuestas crudas del proveedor. Después de validar la respuesta estructurada, el servidor vuelve a imponer el estado de confianza, los datos faltantes y los cálculos deterministas, por lo que el modelo no puede convertir un estudio parcial en completo ni sustituir probabilidades, cuotas justas o valor esperado.

También existe una ruta específica para consultar la investigación sin generar análisis ni consumir créditos de OpenAI: `GET /api/fixtures/:fixtureId/research`. Puede añadirse `?refresh=true` para invalidar la caché del fixture y solicitar datos actualizados a API-Football; esta operación está limitada para proteger el cupo del proveedor.

La sección **Análisis de fuentes** muestra el nivel de confianza de 0 a 100, el estado general, los datos críticos faltantes y los nueve módulos evaluados. Cada tarjeta identifica estado, fuente, última actualización, puntos aportados y explicación del faltante. **Ver detalle** abre los datos normalizados y **Actualizar datos** renueva la investigación desde API-Football sin ejecutar OpenAI ni consumir sus créditos.

La interfaz incluye una matriz de fuentes por módulo. API-Football es la única fuente activa por defecto; SofaScore, FotMob, WhoScored, FBref y clima aparecen como `not_configured`. Oddspedia aparece como `blocked` porque su sitio rechazó el acceso automatizado directo con HTTP 403. El proyecto no intenta evadir esa restricción ni hace scraping.

SofaScore es el primer adaptador externo formal. Está conectado al orquestador de fuentes, pero opera en modo `disabled`: devuelve un resultado normalizado `not_configured` y no realiza solicitudes de red. Un modo distinto se bloquea mientras no exista un conector aprobado. Esto permite probar la arquitectura sin asumir que un endpoint no oficial está autorizado.

Oddspedia es el segundo adaptador. En modo predeterminado `disabled` no realiza solicitudes. Opcionalmente puede usar `openai_web_search`: solo se ejecuta cuando API-Football no proporciona mercados, restringe la búsqueda a `oddspedia.com`, exige coincidencia exacta y una URL verificable del dominio, marca toda cuota como `partial` y `requiresReview`, y conserva una caché de 30 minutos. Esta opción consume créditos de OpenAI y posibles cargos de la herramienta de búsqueda web; nunca genera picks ni valor esperado a partir de esas cuotas por sí sola.

FotMob es el tercer adaptador. Su modo opcional `openai_web_search` se limita a `fotmob.com`, solo consulta partidos que todavía están programados y busca faltantes de lesiones/sanciones, alineaciones y xG/xGA prepartido. Rechaza datos del mismo fixture generados después del inicio, acepta xG únicamente como agregado prepartido o promedio de temporada y mantiene todos los resultados como `partial` y `requiresReview`. No convierte una alineación recuperada por búsqueda web en confirmada.

WhoScored es el cuarto adaptador y funciona como respaldo condicionado. Solo consulta `whoscored.com` para lesiones, sanciones, dudas y alineaciones probables cuando API-Football y FotMob no cubrieron esos módulos. No se ejecuta en partidos iniciados o finalizados, no duplica búsquedas ya resueltas por FotMob y nunca marca como confirmada una alineación obtenida mediante búsqueda web.

FBref es el quinto adaptador y funciona como respaldo exclusivo para xG/xGA. Solo consulta `fbref.com` cuando FotMob no aportó métricas prepartido utilizables, acepta promedios de temporada con URL verificable para cada equipo y conserva el módulo como `partial`. No usa estadísticas producidas por el mismo encuentro ni aumenta la confianza como si fueran datos confirmados del partido.

Clima es el sexto adaptador. No añade una API meteorológica: usa opcionalmente `openai_web_search` restringido a Weather.com, AccuWeather y Meteored para partidos programados dentro de los próximos 14 días. Exige ubicación, hora y URL verificables, normaliza temperatura, lluvia, viento y humedad, y mantiene el módulo como `partial` porque el estado del césped no se deduce del pronóstico.

Soccerway es el séptimo adaptador y actúa únicamente como respaldo de clasificación y H2H. Solo consulta `soccerway.com` cuando API-Football no entregó esos módulos, exige coincidencia de equipos y competición, descarta encuentros con fecha igual o posterior al partido estudiado y mantiene todos los datos como `partial` y sujetos a revisión.

El orquestador ejecuta en paralelo las fuentes independientes y espera a FotMob antes de decidir si necesita WhoScored o FBref. Cada fallo queda aislado como `failed`; una fuente caída no detiene la investigación. Las consultas conservan caché de 30 minutos, pero el botón **Actualizar datos** omite esa caché y solicita información nueva conscientemente.

Estados de fuente: `available`, `partial`, `not_available`, `not_configured`, `failed` y `blocked`. Estos estados describen la integración; el score continúa calculándose con el estado real de los nueve módulos y sus pesos documentados. Agregar una fuente al catálogo no aumenta la confianza si todavía no aporta datos normalizados.

La misma sección incluye tres módulos complementarios: estadísticas agregadas de temporada, eventos del fixture y rendimiento individual de jugadores. Las estadísticas de temporada se consultan con corte al día anterior del partido. Eventos y rendimiento del mismo fixture se etiquetan `post_match_audit_only`, se muestran para evaluación retrospectiva y su detalle se elimina del paquete enviado a OpenAI para evitar fuga de información posterior al inicio.

Todos los horarios visibles se convierten a la zona del Pacífico (`America/Los_Angeles`) y se identifican con `PT`. Los partidos finalizados muestran su marcador y deshabilitan las acciones de datos y análisis; los encuentros en vivo muestran marcador y minuto con una caché reducida de 60 segundos. En Copa Mundial se usa sede neutral y nombres de equipos en lugar de asumir localía.

Cuando API-Football ofrece una predicción, el equipo favorito aparece en verde con el porcentaje del modelo. Esta señal es estadística y no representa una votación pública de usuarios. Si el proveedor no identifica un favorito, la interfaz no marca ninguno.

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
OPENAI_MODEL_DEFAULT=gpt-5.4-mini
OPENAI_MODEL_PREMIUM=gpt-5.4
AI_DEBUG=false
DATA_MODE=mock
PORT=3000
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
SOFASCORE_ACCESS_MODE=disabled
ODDSPEDIA_ACCESS_MODE=disabled
ODDSPEDIA_SEARCH_MODEL=gpt-5.4-mini
FOTMOB_ACCESS_MODE=disabled
FOTMOB_SEARCH_MODEL=gpt-5.4-mini
WHOSCORED_ACCESS_MODE=disabled
WHOSCORED_SEARCH_MODEL=gpt-5.4-mini
FBREF_ACCESS_MODE=disabled
FBREF_SEARCH_MODEL=gpt-5.4-mini
WEATHER_ACCESS_MODE=disabled
WEATHER_SEARCH_MODEL=gpt-5.4-mini
SOCCERWAY_ACCESS_MODE=disabled
SOCCERWAY_SEARCH_MODEL=gpt-5.4-mini
```

Para activar conscientemente la búsqueda complementaria en Render, cambia únicamente `ODDSPEDIA_ACCESS_MODE=openai_web_search`. Si falla, no encuentra coincidencia exacta o no obtiene una fuente de `oddspedia.com`, el resto del análisis continúa y el módulo queda como no disponible o fallido.

FotMob se activa por separado con `FOTMOB_ACCESS_MODE=openai_web_search`. Cada adaptador puede generar una búsqueda web de OpenAI cuando corresponda; habilitar ambos incrementa el consumo. Los resultados se guardan en caché durante 30 minutos por fixture.

WhoScored se activa con `WHOSCORED_ACCESS_MODE=openai_web_search`. Al actuar como respaldo, normalmente no consume una búsqueda cuando FotMob ya devolvió bajas y alineaciones utilizables.

FBref se activa con `FBREF_ACCESS_MODE=openai_web_search`. Solo consume una búsqueda cuando FotMob no devolvió xG/xGA prepartido y el partido aún no ha comenzado. Su cobertura depende de la competición y puede devolver `not_available` sin afectar los demás módulos.

Clima se activa con `WEATHER_ACCESS_MODE=openai_web_search`. Solo consulta encuentros programados con ciudad o estadio y dentro de una ventana de 14 días. Un pronóstico diario, una hora distinta o una ubicación dudosa se descartan.

Soccerway se activa con `SOCCERWAY_ACCESS_MODE=openai_web_search`. No consume una búsqueda cuando API-Football ya proporcionó clasificación y H2H. Sus resultados nunca sustituyen datos confirmados del proveedor principal.

Para activar datos reales, completa un `.env` local y cambia `DATA_MODE=live`. `OPENAI_MODEL_DEFAULT` atiende los análisis normales y `OPENAI_MODEL_PREMIUM` se reserva para partidos complejos, premium, contradictorios o de alta importancia. Si el modelo económico falla, el backend realiza un único intento con el modelo premium.

El selector central evalúa confianza, valor, jerarquía del favorito, contradicciones, importancia de la competición, parlays y datos críticos. `AI_DEBUG=true` agrega metadatos técnicos del modelo a la respuesta; mantenlo desactivado en producción si no necesitas depuración.

La interfaz incluye temporadas históricas y la temporada 2026 para la Copa Mundial FIFA. La cobertura real de cada competición depende del plan vigente de API-Football; cuando corresponda puede usarse la opción automática.

Nunca publiques `.env`, claves, respuestas internas del proveedor ni registros con secretos.

## Rutas principales

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
GET  /api/head-to-head?fixtureId=123
POST /api/fixtures/:fixtureId/analysis
```

`sidelined` responde como no verificado hasta confirmar que el plan contratado ofrece cobertura adecuada. No se inventa ni se sustituye esa información.

API-Football está integrado para fixtures, estadísticas del fixture, clasificación, H2H, lesiones, alineaciones, cuotas, eventos, rendimiento de jugadores y estadísticas agregadas de equipos. Los tres últimos se normalizan como datos complementarios y no alteran los pesos principales. Clima y xG/xGA pueden complementarse mediante adaptadores opcionales; el estado de cancha permanece `not_available` mientras no exista un reporte verificable. No hay APIs meteorológicas ni scrapers adicionales configurados.

## Flujo de datos

1. El frontend consulta rutas propias bajo `/api`.
2. El backend valida liga, fechas, temporada, estado e ID de fixture.
3. API-Football entrega los datos deportivos.
4. El backend normaliza cada módulo, registra su estado y detecta datos críticos faltantes.
5. El evaluador calcula un nivel de confianza de 0 a 100 con pesos documentados.
6. Un módulo determinista calcula probabilidad implícita, margen, cuota justa y valor esperado.
7. El backend excluye del prompt los eventos y rendimientos posteriores al inicio, conservando únicamente contexto temporalmente válido.
8. Solo el objeto normalizado y verificado se envía a OpenAI; las respuestas numéricas y el estado final quedan sometidos a las reglas del servidor.
9. Zod valida el JSON antes de responder al navegador.
10. Los resultados finales pueden actualizarse desde API-Football sin volver a ejecutar OpenAI.

En esta fase se muestran como máximo cinco fixtures por liga y búsqueda para proteger el rendimiento y el cupo del proveedor.

Si falta información importante, el análisis debe indicar `Necesita revisión`. Una calidad baja bloquea la incorporación al parlay. Las probabilidades 1X2 permanecen en `null` cuando no pueden estimarse responsablemente.

## Pruebas

```powershell
npm test
```

Las pruebas verifican ligas permitidas, rangos de fechas, identificadores de fixture, normalización, puntuación de confianza, detección de datos críticos y las barreras posteriores a OpenAI.

## Seguridad y uso responsable

- El frontend no recibe claves API.
- Las consultas se limitan por frecuencia y tamaño.
- Solo se permiten las seis competiciones configuradas.
- Las llamadas externas tienen timeout y caché temporal.
- El sistema no debe prometer resultados ni ganancias.

Este análisis es únicamente informativo. No garantiza resultados ni beneficios. Las apuestas implican riesgo y deben hacerse con responsabilidad.
