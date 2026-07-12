export const ALLOWED_LEAGUES = Object.freeze([
  // IDs verificados contra API-Football el 2026-06-19. Revalidar si el proveedor cambia su catálogo.
  { slug: "la-liga", name: "La Liga", country: "Spain", countryLabel: "España", code: "ESP", apiId: 140, apiNames: ["La Liga"], region: "Europe", confederation: "UEFA", competitionType: "league" },
  { slug: "chinese-super-league", name: "Superliga China", country: "China", countryLabel: "China", code: "CHN", apiId: 169, apiNames: ["Super League", "Chinese Super League"], region: "Asia", confederation: "AFC", competitionType: "league" },
  { slug: "bundesliga", name: "Bundesliga", country: "Germany", countryLabel: "Alemania", code: "DEU", apiId: 78, apiNames: ["Bundesliga"], region: "Europe", confederation: "UEFA", competitionType: "league" },
  { slug: "primeira-liga", name: "Primeira Liga", country: "Portugal", countryLabel: "Portugal", code: "PRT", apiId: 94, apiNames: ["Primeira Liga"], region: "Europe", confederation: "UEFA", competitionType: "league" },
  { slug: "ligue-1", name: "Ligue 1", country: "France", countryLabel: "Francia", code: "FRA", apiId: 61, apiNames: ["Ligue 1"], region: "Europe", confederation: "UEFA", competitionType: "league" },
  // Liga MX usa el ID principal de API-Football; seleccionar temporada 2026 para Apertura 2026 si el proveedor la publica bajo esa temporada.
  { slug: "liga-mx", name: "Liga MX Apertura", country: "Mexico", countryLabel: "México", code: "MEX", apiId: 262, apiNames: ["Liga MX"], region: "Americas", confederation: "CONCACAF", competitionType: "league" },
  // ID y temporada verificados contra API-Football el 2026-06-20.
  { slug: "world-cup", name: "Copa Mundial FIFA", country: "World", countryLabel: "Mundial", code: "FIFA", apiId: 1, apiNames: ["World Cup"], region: "International", confederation: "FIFA", competitionType: "cup", neutralVenue: true },
  // IDs y nombres oficiales confirmados directamente con API-Football el 2026-07-12.
  { slug: "mls", name: "MLS", officialName: "Major League Soccer", country: "USA", countryLabel: "Estados Unidos", code: "USA", apiId: 253, apiNames: ["Major League Soccer"], region: "Americas", confederation: "CONCACAF", competitionType: "league" },
  { slug: "brasileirao-serie-a", name: "Brasileirão Serie A", officialName: "Serie A", country: "Brazil", countryLabel: "Brasil", code: "BRA", apiId: 71, apiNames: ["Serie A"], region: "Americas", confederation: "CONMEBOL", competitionType: "league" },
  { slug: "liga-profesional-argentina", name: "Liga Profesional Argentina", country: "Argentina", countryLabel: "Argentina", code: "ARG", apiId: 128, apiNames: ["Liga Profesional Argentina"], region: "Americas", confederation: "CONMEBOL", competitionType: "league" },
  { slug: "liga-mx-femenil", name: "Liga MX Femenil", country: "Mexico", countryLabel: "México", code: "MEX-W", apiId: 673, apiNames: ["Liga MX Femenil"], region: "Americas", confederation: "CONCACAF", competitionType: "league", coverageLevel: "partial" },
  { slug: "liga-expansion-mx", name: "Liga de Expansión MX", country: "Mexico", countryLabel: "México", code: "MEX-EXP", apiId: 263, apiNames: ["Liga de Expansión MX"], region: "Americas", confederation: "CONCACAF", competitionType: "league", coverageLevel: "limited" },
  { slug: "eredivisie", name: "Eredivisie", country: "Netherlands", countryLabel: "Países Bajos", code: "NLD", apiId: 88, apiNames: ["Eredivisie"], region: "Europe", confederation: "UEFA", competitionType: "league" },
  { slug: "allsvenskan", name: "Allsvenskan", country: "Sweden", countryLabel: "Suecia", code: "SWE", apiId: 113, apiNames: ["Allsvenskan"], region: "Europe", confederation: "UEFA", competitionType: "league" },
  { slug: "eliteserien", name: "Eliteserien", country: "Norway", countryLabel: "Noruega", code: "NOR", apiId: 103, apiNames: ["Eliteserien"], region: "Europe", confederation: "UEFA", competitionType: "league" },
  { slug: "conmebol-libertadores", name: "Copa Libertadores", officialName: "CONMEBOL Libertadores", country: "World", countryLabel: "CONMEBOL", code: "LIB", apiId: 13, apiNames: ["CONMEBOL Libertadores"], region: "International Clubs", confederation: "CONMEBOL", competitionType: "cup" },
  { slug: "conmebol-sudamericana", name: "Copa Sudamericana", officialName: "CONMEBOL Sudamericana", country: "World", countryLabel: "CONMEBOL", code: "SUD", apiId: 11, apiNames: ["CONMEBOL Sudamericana"], region: "International Clubs", confederation: "CONMEBOL", competitionType: "cup" },
  { slug: "uefa-champions-qualifying", name: "Clasificación Champions League", officialName: "UEFA Champions League", country: "World", countryLabel: "UEFA", code: "UCL-Q", apiId: 2, apiNames: ["UEFA Champions League"], region: "International Clubs", confederation: "UEFA", competitionType: "qualifying", roundIncludes: ["Qualifying Round"] },
  { slug: "uefa-europa-qualifying", name: "Clasificación Europa League", officialName: "UEFA Europa League", country: "World", countryLabel: "UEFA", code: "UEL-Q", apiId: 3, apiNames: ["UEFA Europa League"], region: "International Clubs", confederation: "UEFA", competitionType: "qualifying", roundIncludes: ["Qualifying Round"] },
  { slug: "uefa-conference-qualifying", name: "Clasificación Conference League", officialName: "UEFA Europa Conference League", country: "World", countryLabel: "UEFA", code: "UECL-Q", apiId: 848, apiNames: ["UEFA Europa Conference League"], region: "International Clubs", confederation: "UEFA", competitionType: "qualifying", roundIncludes: ["Qualifying Round"] }
]);

export function getAllowedLeague(slug) {
  return ALLOWED_LEAGUES.find((league) => league.slug === slug);
}
