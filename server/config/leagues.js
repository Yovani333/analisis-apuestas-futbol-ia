export const ALLOWED_LEAGUES = Object.freeze([
  // IDs verificados contra API-Football el 2026-06-19. Revalidar si el proveedor cambia su catálogo.
  { slug: "la-liga", name: "La Liga", country: "Spain", countryLabel: "España", code: "ESP", apiId: 140, apiNames: ["La Liga"] },
  { slug: "chinese-super-league", name: "Superliga China", country: "China", countryLabel: "China", code: "CHN", apiId: 169, apiNames: ["Super League", "Chinese Super League"] },
  { slug: "bundesliga", name: "Bundesliga", country: "Germany", countryLabel: "Alemania", code: "DEU", apiId: 78, apiNames: ["Bundesliga"] },
  { slug: "primeira-liga", name: "Primeira Liga", country: "Portugal", countryLabel: "Portugal", code: "PRT", apiId: 94, apiNames: ["Primeira Liga"] },
  { slug: "ligue-1", name: "Ligue 1", country: "France", countryLabel: "Francia", code: "FRA", apiId: 61, apiNames: ["Ligue 1"] },
  // ID y temporada verificados contra API-Football el 2026-06-20.
  { slug: "world-cup", name: "Copa Mundial FIFA", country: "World", countryLabel: "Mundial", code: "FIFA", apiId: 1, apiNames: ["World Cup"] }
]);

export function getAllowedLeague(slug) {
  return ALLOWED_LEAGUES.find((league) => league.slug === slug);
}
