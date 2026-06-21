import { AppError } from "../errors.js";
import { getAllowedLeague } from "../config/leagues.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_STATUSES = new Set(["all", "scheduled", "finished"]);

export function parseFixtureQuery(query) {
  const leagues = String(query.leagues || "").split(",").filter(Boolean);
  if (!leagues.length) throw new AppError("Selecciona al menos una liga.", 400, "INVALID_LEAGUES");
  if (leagues.length > 6 || leagues.some((slug) => !getAllowedLeague(slug))) {
    throw new AppError("La consulta contiene una liga no permitida.", 400, "INVALID_LEAGUES");
  }

  const dateFrom = String(query.dateFrom || "");
  const dateTo = String(query.dateTo || "");
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo) || dateFrom > dateTo) {
    throw new AppError("El rango de fechas no es válido.", 400, "INVALID_DATE_RANGE");
  }

  const days = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000;
  if (days > 62) throw new AppError("El rango máximo es de 62 días.", 400, "DATE_RANGE_TOO_LARGE");

  const status = String(query.status || "all");
  if (!ALLOWED_STATUSES.has(status)) throw new AppError("Estado de partido no permitido.", 400, "INVALID_STATUS");

  const season = query.season && query.season !== "auto" ? Number(query.season) : "auto";
  if (season !== "auto" && (!Number.isInteger(season) || season < 2000 || season > 2100)) {
    throw new AppError("Temporada no válida.", 400, "INVALID_SEASON");
  }
  return { leagues: [...new Set(leagues)], dateFrom, dateTo, status, season };
}

export function parseFixtureId(value) {
  const fixtureId = Number(value);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) throw new AppError("Fixture inválido.", 400, "INVALID_FIXTURE_ID");
  return fixtureId;
}
