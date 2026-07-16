# Auditoria de estabilidad de datos - Julio 2026

## Alcance

Esta auditoria cubre la regresion detectada en Dashboard, Transparencia de datos, Cuotas, calidad de informacion y actualizaciones manuales. No se modificaron formulas estadisticas, ponderaciones, reglas de picks ni modelos predictivos.

## Causa raiz detectada

1. **Cuotas crudas vs cuotas normalizadas**
   - Transparencia de datos mostraba `confirmedData.odds`.
   - El sistema podia tener cuotas normalizadas en `researchData.odds`, pero si la respuesta cruda de API-Football venia vacia, la vista quedaba vacia.
   - Se corrigio para que Transparencia use cuotas crudas cuando existan y, si no existen, use las cuotas normalizadas disponibles.

2. **Cuotas sin EV**
   - Algunas cuotas existian en API-Football, pero no aparecian si `marketAnalysis` estaba vacio por falta de contexto suficiente para calcular Modelo/EV.
   - Se corrigio para mostrar la cuota disponible aunque Modelo/EV esten como no disponibles.

3. **Cache de cuotas por liga y fecha**
   - La actualizacion manual limpiaba cache por fixture, pero no necesariamente por `league + season + date`.
   - Se corrigio para que el refresh manual tambien invalide ese respaldo cuando existe contexto suficiente.

4. **Respuestas parciales**
   - Se reforzo la preservacion de datos validos para evitar reemplazar informacion existente por arreglos vacios o respuestas parciales.

5. **Actualizaciones automaticas ocultas**
   - Se verifico que Catalogo, Guia, Transparencia y En vivo no tengan intervalos ocultos en frontend.
   - Se agregaron pruebas para que estos modulos sigan dependiendo de botones manuales.

6. **OpenAI**
   - No hay dependencia activa, cliente, ruta ni variables obligatorias de OpenAI.
   - Se agrego una prueba de regresion para impedir que una integracion activa vuelva sin detectarse.

## Cambios protegidos por pruebas

- `Transparencia -> Cuotas` muestra cuotas normalizadas si la respuesta cruda viene vacia.
- API-Football puede mostrar cuotas aunque no haya calculo de EV.
- No se reemplazan datos validos con respuestas vacias.
- Catalogo, Guia y En vivo no tienen refrescos automaticos ocultos.
- El sistema funciona sin credenciales OpenAI.
- Seleccionar un encuentro no dispara modulos pesados automaticamente.

## Prueba real controlada con API-Football

Fecha de ejecucion local: 2026-07-15 PT.

Busqueda:

- Rango: `2026-07-15` a `2026-07-17`.
- Ligas: `world-cup`, `mls`, `liga-mx`, `conmebol-libertadores`.
- Fixtures encontrados: 12.
- Fixtures validados: 2.

Resultados:

| Fixture | Partido | Liga | Estado | Calidad | Cuotas crudas | Cuotas normalizadas | xG/xGA | Forma |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `1490325` | CF Montreal vs Toronto FC | MLS | Programado | 75/100 | 1 | 12 | Parcial | Disponible |
| `1586077` | England vs Argentina | Copa Mundial FIFA | Finalizado | 65/100 | 1 | 12 | Disponible | Disponible |

Conclusion de la prueba:

- API-Football devolvio cuotas para ambos fixtures.
- Las cuotas normalizadas quedaron disponibles para la UI.
- El xG/xGA historico se activo correctamente en partido programado.
- El xG/xGA de fixture se activo correctamente en partido finalizado.
- No se observaron calidades extremadamente bajas en esta muestra.

## Validacion real de Simulacion

Fecha de ejecucion local: 2026-07-15 PT.

Fixture usado:

- `1490325` - CF Montreal vs Toronto FC, MLS 2026.

Resultado:

- Comparador de equipos: `available`.
- Partidos con estadisticas por equipo: 3 y 3.
- Metricas completas: 10.
- Simulacion avanzada: `available`.
- Decision generada: `apuesta_con_valor_pero_riesgo_alto`.
- Suma 1X2 final: 100.
- Errores de validacion: 0.
- Segunda ejecucion de simulacion: `cache hit`.
- Delta de la segunda ejecucion: 0 requests, 0 cache hits adicionales, 0 failures.

Conclusion:

- Simulacion reutilizo el expediente y la cache interna.
- La segunda ejecucion no volvio a consultar API-Football.
- El motor avanzado no produjo NaN, infinitos ni probabilidades fuera de rango.

## Monitoreo de partidos programados en ligas distintas

Fecha de ejecucion local: 2026-07-15 PT.

Filtro usado:

- Rango: `2026-07-16` a `2026-07-20`.
- Ligas revisadas: `mls`, `liga-mx`, `brasileirao-serie-a`, `conmebol-libertadores`.
- Fixtures encontrados: 20.
- Fixtures monitoreados: 3.

Resultados:

| Fixture | Partido | Liga | Calidad | Venue | Cuotas | xG/xGA | Estadisticas de temporada |
| --- | --- | --- | ---: | --- | ---: | --- | --- |
| `1492291` | Botafogo vs Santos | Brasileirao Serie A | 80/100 | Estadio Olimpico Nilton Santos | 12 | Parcial | Disponible, ultimos oficiales |
| `1490325` | CF Montreal vs Toronto FC | MLS | 70/100 | Saputo Stadium | 12 | Parcial | Disponible, ultimos oficiales |
| `1550894` | Necaxa vs Atlante FC | Liga MX Apertura | 60/100 | Estadio Victoria | 12 | No disponible | Disponible, ultimos oficiales |

Observaciones:

- Los tres fixtures programados devolvieron venue desde API-Football.
- Los tres fixtures devolvieron cuotas normalizadas.
- `Estadisticas de temporada` uso correctamente la fuente de fallback: ultimos partidos oficiales anteriores al encuentro.
- `xG/xGA` quedo parcial o no disponible segun la cobertura historica real de tiros/eventos por equipo.
- La calidad fue media o alta; no se reprodujo una calidad deficiente extrema en esta muestra.

Consumo observado:

- Network requests: 152.
- Cache misses: 116.
- Failures degradados: 46.
- Rate limit informado al final: 4129 solicitudes diarias restantes de 7500.

Endpoints con mas degradaciones:

- `/fixtures/statistics`: 24 fallos degradados.
- `/fixtures/events`: 9 fallos degradados.
- `/teams/statistics`: 5 fallos degradados.

Conclusion:

- La informacion principal de programados se recupero correctamente.
- Los fallos observados corresponden principalmente a cobertura historica incompleta de API-Football para algunos fixtures anteriores.
- El sistema no debe interpretar esos fallos como perdida total de datos; debe conservar la informacion disponible y mostrar estado parcial cuando aplique.

## Pruebas locales

Ultimo resultado verificado:

- `npm test`
- `341/341` pruebas correctas.

## Limitaciones actuales

- API-Football puede tardar en actualizar cuotas prepartido segun competicion y casa.
- La hora `providerUpdatedAt` representa la ultima actualizacion del proveedor, no la hora de consulta del sistema.
- Si API-Football no publica alineaciones, lesiones, venue, jugadores o cuotas, el sistema debe degradar cobertura sin inventar datos.
- La calidad puede ser menor en competiciones con cobertura parcial.
- La prueba real fue controlada y pequena; no representa una auditoria estadistica completa.

## Pendientes recomendados

1. Documentar cualquier caso donde API-Football muestre venue o cuotas faltantes para determinar si es cobertura del proveedor o mapeo local.

## Confirmaciones

- No se modificaron formulas estadisticas.
- No se recalibraron pesos.
- No se cambio la logica de picks.
- No se tocaron los modulos protegidos de rendimiento promedio ni jugador con posible gol.
- No se agrego consumo de OpenAI.
