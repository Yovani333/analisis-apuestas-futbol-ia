# Jugador con posible gol

El módulo usa exclusivamente datos históricos de API-Football y un modelo interno determinista. No usa OpenAI para crear jugadores, estadísticas o candidatos.

## Ventana y elegibilidad

- Últimos cinco fixtures finalizados (`FT`, `AET`, `PEN`) anteriores al encuentro analizado.
- Se consultan estadísticas individuales, alineaciones y eventos de cada fixture útil.
- Un jugador necesita tres apariciones, 180 minutos o dos titularidades con tiros; además debe acumular al menos 90 minutos.
- Se excluyen porteros, bajas identificadas, jugadores sin tiros y defensas sin evidencia ofensiva.
- Los candidatos rojos no se muestran como recomendación principal.

## GoalThreatScore

| Componente | Peso |
| --- | ---: |
| Probabilidad de jugar, minutos y titularidad | 25% |
| Tiros por 90 | 25% |
| Tiros a puerta por 90 | 20% |
| Goles recientes | 15% |
| Participación en penales | 10% |
| Expectativa ofensiva del equipo | 5% |

El resultado se limita a 0–100. La posición se usa para elegibilidad y desempate, sin alterar estos pesos. Si no existe expectativa ofensiva verificable, se aplica un valor conservador y no se inventa xG.

## Estados

- `available`: existen entre uno y tres candidatos elegibles.
- `insufficient_data`: hay datos de jugadores, pero nadie supera los filtros mínimos.
- `no_player_coverage`: API-Football no devolvió estadísticas individuales útiles.
- `not_available`: no fue posible identificar el fixture o los equipos.
- `error`: error controlado mostrado por la interfaz.

## Pruebas reales del 5 de julio de 2026

| Fixture | Cobertura útil | Candidatos |
| --- | --- | --- |
| France vs Sweden (`1565177`) | France 3 fixtures con jugadores; Sweden 4 | Kylian Mbappé 80, Ousmane Dembélé 70, Alexander Isak 60 |
| England vs Congo DR (`1567307`) | England 4 fixtures con jugadores; Congo DR 2 | Harry Kane 90, Marcus Rashford 55, Jude Bellingham 53 |

Se usaron `/fixtures`, `/fixtures/players`, `/fixtures/lineups`, `/fixtures/events`, `/injuries` y `/odds`. La segunda ejecución midió 35 solicitudes de red; reabrir el mismo fixture produjo cero solicitudes adicionales gracias al caché de una hora. API-Football no devolvió cuotas de goleador para estos casos, por lo que los picks quedaron pendientes de cuota sin alterar el cálculo del parlay.
