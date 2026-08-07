# Exportador seguro de dataset neuronal

El exportador prepara ejemplos supervisados sin entrenar modelos ni cambiar decisiones historicas.

## Politica

- Fuente: snapshots prepartido congelados y su auditoria guardada.
- Objetivo: `HIT = 1`, `MISS = 0`.
- Excluye `VOID`, `NO_BET`, `DATA_INSUFFICIENT` y `LIVE_PENDING`.
- Nunca usa marcador, eventos o estadisticas del fixture actual como features.
- Nunca recalcula picks, probabilidades, cuotas o explicaciones historicas.
- Conserva por separado mercado, competicion y version del modelo.
- Elimina duplicados del mismo fixture y version conservando la captura prepartido mas reciente.

## Niveles de suficiencia

- Menos de 100 filas decisivas por mercado y version: insuficiente.
- 100 a 299: exploratorio.
- 300 a 999: solo prototipo y validacion temporal.
- 1,000 o mas: apto para evaluar formalmente un modelo, no para publicarlo automaticamente.

La salida contiene un `fingerprint` SHA-256 determinista sobre las filas. Esto permite demostrar que dos ejecuciones con las mismas entradas producen el mismo conjunto de entrenamiento.

## Limite actual

Las evidencias en Supabase y las evaluaciones deben reunirse antes de llamar al exportador. Esta etapa no agrega consultas masivas, tablas nuevas ni persistencia. La siguiente fase debera definir un proceso administrativo autenticado que lea las evidencias por paginas y conserve las etiquetas completas de auditoria.
