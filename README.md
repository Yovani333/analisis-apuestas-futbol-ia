# Análisis de Apuestas de Fútbol con IA

Dashboard full-stack para consultar partidos de cinco ligas permitidas, revisar calidad de datos y generar análisis prudentes con API-Football y OpenAI.

## Estado actual

El proyecto incluye un backend seguro y dos modos:

- `mock`: funciona sin claves con escenarios completamente sintéticos.
- `live`: consulta API-Football desde el servidor y utiliza OpenAI para análisis JSON estructurado.

Las claves nunca se envían al navegador. El modo inicial es `mock`.

## Ligas permitidas

- La Liga — España
- Superliga China — China
- Bundesliga — Alemania
- Primeira Liga — Portugal
- Ligue 1 — Francia

Los IDs fueron verificados contra API-Football el 19 de junio de 2026 y están documentados en la configuración para ahorrar solicitudes del plan gratuito. Deben revalidarse si el proveedor cambia su catálogo. Las temporadas automáticas sí consultan metadatos actuales.

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
OPENAI_MODEL=gpt-5.5
DATA_MODE=mock
PORT=3000
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
```

Para activar datos reales, completa un `.env` local y cambia `DATA_MODE=live`. Confirma que `OPENAI_MODEL` sea un identificador disponible en tu proyecto de OpenAI.

La interfaz incluye temporadas 2022–2024 porque son las habilitadas por el plan gratuito detectado durante la integración. Planes con cobertura actual pueden usar la opción automática.

Nunca publiques `.env`, claves, respuestas internas del proveedor ni registros con secretos.

## Rutas principales

```text
GET  /api/health
GET  /api/leagues
GET  /api/fixtures
GET  /api/fixtures/:fixtureId
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

## Flujo de datos

1. El frontend consulta rutas propias bajo `/api`.
2. El backend valida liga, fechas, temporada, estado e ID de fixture.
3. API-Football entrega los datos deportivos.
4. El backend conserva vacíos como `No disponible` y agrega procedencia y fecha de consulta.
5. Solo ese dataset se envía a OpenAI.
6. Zod valida el JSON antes de responder al navegador.

En esta fase se muestran como máximo cinco fixtures por liga y búsqueda para proteger el rendimiento y el cupo del proveedor.

Si falta información importante, el análisis debe indicar `Necesita revisión`. Las probabilidades permanecen en `null` cuando no pueden estimarse responsablemente.

## Pruebas

```powershell
npm test
```

Las pruebas verifican ligas permitidas, rangos de fechas e identificadores de fixture.

## Seguridad y uso responsable

- El frontend no recibe claves API.
- Las consultas se limitan por frecuencia y tamaño.
- Solo se permiten las cinco ligas configuradas.
- Las llamadas externas tienen timeout y caché temporal.
- El sistema no debe prometer resultados ni ganancias.

Este proyecto es únicamente informativo. Ningún análisis garantiza resultados ni ganancias. Apuesta con responsabilidad.
