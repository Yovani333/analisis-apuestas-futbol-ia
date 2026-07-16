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

## Pruebas locales

Ultimo resultado verificado:

- `npm test`
- `339/339` pruebas correctas.

## Limitaciones actuales

- API-Football puede tardar en actualizar cuotas prepartido segun competicion y casa.
- La hora `providerUpdatedAt` representa la ultima actualizacion del proveedor, no la hora de consulta del sistema.
- Si API-Football no publica alineaciones, lesiones, venue, jugadores o cuotas, el sistema debe degradar cobertura sin inventar datos.
- La calidad puede ser menor en competiciones con cobertura parcial.
- La prueba real fue controlada y pequena; no representa una auditoria estadistica completa.

## Pendientes recomendados

1. Revisar Simulacion con un fixture real para confirmar reutilizacion de expediente y consumo incremental.
2. Monitorear 2 o 3 partidos programados adicionales en ligas distintas.
3. Documentar cualquier caso donde API-Football muestre venue o cuotas faltantes para determinar si es cobertura del proveedor o mapeo local.

## Confirmaciones

- No se modificaron formulas estadisticas.
- No se recalibraron pesos.
- No se cambio la logica de picks.
- No se tocaron los modulos protegidos de rendimiento promedio ni jugador con posible gol.
- No se agrego consumo de OpenAI.
