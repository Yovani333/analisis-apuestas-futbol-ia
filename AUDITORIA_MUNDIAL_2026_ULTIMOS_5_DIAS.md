# Auditoría descriptiva Mundial 2026: 27 de junio al 1 de julio

Fuente: API-Football. Muestra: 16 partidos finalizados. Esta tabla evalúa resultados observados; no sustituye snapshots prepartido que no fueron guardados históricamente.

| Fecha | Partido | Resultado | Over 2.5 | BTTS |
| --- | --- | ---: | --- | --- |
| 27 jun | Croatia - Ghana | 2-1 | Sí | Sí |
| 27 jun | Panama - England | 0-2 | No | No |
| 27 jun | Colombia - Portugal | 0-0 | No | No |
| 27 jun | Congo DR - Uzbekistan | 3-1 | Sí | Sí |
| 27 jun | Algeria - Austria | 3-3 | Sí | Sí |
| 27 jun | Jordan - Argentina | 1-3 | Sí | Sí |
| 28 jun | South Africa - Canada | 0-1 | No | No |
| 29 jun | Brazil - Japan | 2-1 | Sí | Sí |
| 29 jun | Germany - Paraguay | 1-1 | No | Sí |
| 29 jun | Netherlands - Morocco | 1-1 | No | Sí |
| 30 jun | Ivory Coast - Norway | 1-2 | Sí | Sí |
| 30 jun | France - Sweden | 3-0 | Sí | No |
| 30 jun | Mexico - Ecuador | 2-0 | No | No |
| 1 jul | England - Congo DR | 2-1 | Sí | Sí |
| 1 jul | Belgium - Senegal | 3-2 | Sí | Sí |
| 1 jul | USA - Bosnia & Herzegovina | 2-0 | No | No |

## Resumen observado

- Over 2.5: 9/16 (56.25%).
- Under 2.5: 7/16 (43.75%).
- BTTS Sí: 10/16 (62.5%).
- BTTS No: 6/16 (37.5%).
- Over 2.5 y BTTS Sí simultáneos: 8/16 (50%).
- BTTS Sí con Under 2.5: 2/16 (Germany-Paraguay y Netherlands-Morocco).
- Over 2.5 con BTTS No: 1/16 (France-Sweden).
- Local/empate/visitante: 8/4/4.

## Hallazgos

1. Over 2.5 y BTTS están correlacionados, pero no son equivalentes. Deben puntuarse y validarse por separado.
2. Poisson, Probabilidad de Gol por Equipo y Picks basados en datos reutilizan xG/forma. Su acuerdo no cuenta como tres fuentes independientes.
3. Para BTTS importa especialmente la probabilidad del equipo ofensivamente más débil. Un favorito con expectativa alta no compensa automáticamente un rival por debajo de 0.8-1.0 xG.
4. Para Over 2.5 debe distinguirse entre partido abierto bilateral y posible goleada unilateral.
5. Un resultado acertado no demuestra value. Se necesita la cuota registrada antes del inicio.

## Límite científico

El sistema no guardó snapshots históricos inmutables para estos 16 partidos. Por eso no es válido afirmar exactamente qué pick habría recomendado con la información disponible en cada momento. La reconstrucción actual sirve para detectar reglas problemáticas, pero la medición definitiva comienza cuando se guardan pick, cuota, probabilidad, datos y timestamp antes del partido.
