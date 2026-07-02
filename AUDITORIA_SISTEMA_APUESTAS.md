# Auditoría científica y técnica del sistema de apuestas

## 1. Resumen ejecutivo

El sistema tiene una separación correcta entre datos deportivos, cálculos deterministas y redacción opcional con IA. API-Football alimenta los datos; EV, Poisson, xG/xGA estimado, probabilidad de gol y selección de picks se calculan en código. OpenAI no es necesario para decidir picks.

El riesgo principal detectado era tratar una selección de cuota baja como confiable aun cuando su EV fuera negativo. Esa condición podía producir mensajes positivos porque la jerarquía futbolística compensaba una cuota matemáticamente mala. Se corrigió: todo EV negativo queda advertido y un EV menor o igual a -2% se clasifica como Evitar/NO BET.

El backtesting debe reconstruir el estado prepartido. Nunca puede usar estadísticas, eventos, jugadores, marcador o xG estimado del fixture ya finalizado. El nuevo motor crea un snapshot prepartido y usa xG histórico de partidos anteriores.

## 2. Módulos importantes

| Módulo | Clasificación | Motivo |
| --- | --- | --- |
| Motor de reglas | Mantener y fortalecer | Decide sin IA y permite auditoría reproducible. |
| EV e implícita vs modelo | Mantener y fortalecer | Detecta cuotas malas aunque parezcan conservadoras. |
| Poisson | Mantener como señal secundaria | Aporta distribución, no debe decidir solo. |
| xG/xGA histórico estimado | Mantener con advertencias | Útil prepartido si la muestra y campos son suficientes. |
| Forma reciente | Mejorar | Debe ajustarse por fuerza del rival y localía. |
| Calidad de datos y warnings | Mantener | Debe bloquear picks fuertes con cobertura baja. |
| Guardado y liquidación | Mantener | Permite seguimiento real de picks y parlays. |
| Backtesting | Prioridad máxima | Mide calibración, ROI teórico y falsa confianza. |

## 3. Módulos innecesarios o redundantes

- OpenAI como calculador: eliminar ese uso; conservar solo explicación opcional.
- H2H como señal fuerte: usar solo como contexto informativo, especialmente en selecciones y torneos cortos.
- Posesión aislada: no aporta suficiente valor predictivo sin tiros y tiros a puerta.
- Datos externos duplicados: fusionar en la matriz de fuentes; API-Football conserva prioridad.
- Métricas sin efecto en una regla: ocultar por defecto y mostrar en detalle, no usarlas para aumentar confianza.

## 4. Módulos peligrosos

- Doble oportunidad de cuota muy baja: puede confundirse con seguridad aunque exija una probabilidad superior a la estimada.
- Corners con menos de cinco partidos oficiales: alta varianza y falsa precisión.
- xG del fixture finalizado dentro de una simulación prepartido: fuga de información grave.
- Favorito 1X2 con 40-45%: es la mayor probabilidad entre tres resultados, no una selección segura.
- Picks de módulos distintos sin reconciliación: pueden presentar Over y Under simultáneamente.

## 5. Errores encontrados y corregidos

1. EV negativo podía conservar color verde si el pick favorecía al favorito.
2. Existía una explicación que afirmaba seguridad superior con EV negativo.
3. La carga normal de un fixture finalizado prioriza estadísticas actuales; para backtesting ahora se solicita y fuerza historia anterior.
4. No existía un contrato común HIT/MISS/VOID/NO BET/DATA INSUFFICIENT/LIVE_PENDING.
5. No existían métricas de calibración ni falsa confianza por auditoría.

## 6. Riesgos estadísticos

- Muestras de cinco partidos tienen varianza alta y dependencia del calendario.
- El promedio simple no representa la distribución completa de goles.
- ROI observado en pocos picks no demuestra ventaja persistente.
- Cuotas actuales pueden no ser las cuotas disponibles al momento original del pick.
- La calibración necesita cientos de observaciones segmentadas por mercado.
- Comparar selecciones de fuerza desigual sin ajuste por rival sesga forma, goles y tiros.

## 7. Datos faltantes

- Cuota histórica exacta y closing line para todos los fixtures.
- Ranking/ELO histórico consistente.
- Alineaciones y bajas capturadas con timestamp prepartido.
- Fuerza de los rivales de cada partido de forma.
- Big chances y corners históricos con cobertura uniforme.

## 8. Recomendaciones priorizadas

1. Guardar snapshots prepartido inmutables con timestamp.
2. Acumular al menos 200-500 picks antes de evaluar ventaja por mercado.
3. Medir calibración por intervalos de probabilidad, no solo hit rate.
4. Registrar picks omitidos y su motivo.
5. Incorporar closing odds cuando la API las permita.
6. Ajustar forma por fuerza del rival.
7. Reconciliar contradicciones entre módulos antes de mostrar un pick principal.

## 9. Qué no se debe tocar todavía

- La interfaz actual de Cuotas y su flujo Agregar pick.
- Persistencia local de picks/parlays.
- Fórmula de xG ya validada.
- Proveedores externos como fuente principal.
- Automatización masiva con OpenAI.

## 10. Qué mejorar primero

Primero se debe capturar el snapshot prepartido real al generar cada pick. Sin ese registro, un backtest reconstruido es útil para detectar errores lógicos, pero no prueba qué información estaba realmente disponible en ese instante. Después debe acumularse una muestra suficiente y evaluar calibración, ROI y falsa confianza por mercado, calidad y color.

## Interpretación

- **HIT/MISS**: resultado del mercado, no prueba por sí solo que la decisión fuera buena o mala.
- **NO BET**: el mercado pudo acertar, pero no cumplía las reglas de valor/calidad antes del partido.
- **DATA INSUFFICIENT**: no debe incluirse en hit rate ni ROI.
- **ROI**: usa una unidad plana por pick y la cuota registrada.
- **Calibration error**: distancia media entre probabilidad estimada y resultado binario; menor es mejor.
- **False confidence rate**: proporción de picks fallidos con confianza de 70 o más.
