# Análisis de Apuestas de Fútbol con IA

Dashboard web responsive para explorar partidos, revisar la cobertura de datos y preparar análisis deportivos asistidos por IA con criterios de calidad explícitos.

> **Estado:** prototipo frontend profesional con datos completamente sintéticos. No consulta API-Football, no llama a OpenAI y no representa partidos reales.

## Funcionalidad actual

- Selector limitado a La Liga, Superliga China, Bundesliga, Primeira Liga y Ligue 1.
- Navegación superior con Dashboard y accesos preparados para análisis guardados, alertas y cuenta.
- Búsqueda simulada por liga, rango de fechas y estado.
- Selección visual de partido y revisión de nueve categorías de cobertura.
- Estados `Disponible`, `Necesita revisión`, `No disponible`, `Completo` y `Procesando`.
- Generación asíncrona de un análisis JSON simulado por partido.
- Separación entre datos mock, presentación y capa de servicios.
- Diseño accesible y responsive para escritorio, tablet y móvil.
- Valores faltantes conservados como ausentes; las probabilidades se mantienen en `null`.

## Tecnologías

HTML5 semántico, CSS moderno y JavaScript ES Modules, sin dependencias ni proceso de compilación.

## Ejecutar localmente

Los módulos JavaScript requieren servir la carpeta mediante HTTP. Por ejemplo:

```bash
python -m http.server 8000
```

Después abre `http://localhost:8000`. Abrir `index.html` directamente con `file://` puede bloquear los módulos según el navegador.

## Estructura

```text
/
├── index.html       # Estructura semántica del dashboard
├── styles.css       # Sistema visual y breakpoints responsive
├── app.js           # Estado, eventos y renderizado seguro
├── mock-data.js     # Ligas permitidas y escenarios sintéticos
├── services.js      # Adaptador mock y contrato del backend futuro
├── .env.example     # Nombres de variables del futuro servidor
└── README.md
```

## Cómo funciona la simulación

Los fixtures usan clubes ficticios y se etiquetan como escenarios sintéticos. `services.js` aplica una latencia artificial, filtra esos fixtures y genera la misma forma de respuesta que consumirá el frontend en producción. La simulación no calcula cuotas, probabilidades ni resultados. Si falta cualquier categoría, el estado es `Necesita revisión`.

## Integración futura con API-Football

El navegador debe comunicarse únicamente con rutas propias bajo `/api`. El backend será responsable de:

1. Validar liga, temporada, fechas, estado e identificadores.
2. Consultar fixtures, detalle, standings, estadísticas, head to head, lesiones, sidelined/sanciones, alineaciones y cuotas.
3. Normalizar respuestas, conservar valores ausentes y registrar frescura/procedencia.
4. Aplicar caché, límites de uso, timeouts y manejo de errores.
5. Entregar al frontend solo datos necesarios; nunca `API_FOOTBALL_KEY`.

Los IDs de liga están intencionalmente en `null`. Deben verificarse contra API-Football al implementar el backend; no se deben asumir IDs definitivos ni aceptar ligas fuera de la lista permitida.

## Integración futura con OpenAI

El backend construirá el input exclusivamente con el objeto normalizado de API-Football. Debe usar salida estructurada con el contrato documentado en [docs/analysis-contract.json](docs/analysis-contract.json), validar el JSON antes de devolverlo y rechazar cualquier afirmación que no tenga un dato fuente.

Prioridad del análisis: cuotas y valor esperado; xG/xGA; localía; ausencias y alineaciones; forma ajustada; motivación; fatiga; matchup; árbitro/clima; y head to head solo como señal secundaria.

Reglas de calidad:

- No completar lesiones, sanciones, alineaciones, cuotas, estadísticas, noticias, H2H ni jugadores ausentes.
- Usar `null` cuando no haya base responsable para una probabilidad.
- Separar datos confirmados, faltantes, inferencias y riesgos.
- Marcar `Necesita revisión` ante faltantes importantes.
- No enviar secretos, respuestas internas del proveedor ni trazas al navegador.

## Variables de entorno futuras

Copia los nombres desde `.env.example` solo cuando exista un backend:

```dotenv
API_FOOTBALL_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
```

No crees ni publiques un `.env` con secretos. El `.gitignore` bloquea archivos de entorno excepto el ejemplo.

## Próximos pasos

1. Crear el backend y sus validaciones.
2. Verificar los IDs y disponibilidad real de endpoints según el plan de API-Football.
3. Añadir caché y observabilidad de calidad/frescura.
4. Implementar salida estructurada y validación de esquema para OpenAI.
5. Incorporar pruebas unitarias, integración y end-to-end.

## Apuesta responsable

Este proyecto es únicamente informativo. Ningún análisis garantiza resultados ni ganancias. No apuestes dinero que no puedas permitirte perder y utiliza límites de tiempo y gasto.
