import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult, notConfiguredSource } from "./source-adapter.js";

export async function getSofaScoreSportsData(matchData, { accessMode = "disabled" } = {}) {
  if (accessMode === "disabled") {
    return notConfiguredSource("sofaScore", [
      "Adaptador preparado, pero sin un método de acceso permitido configurado.",
      "No se realizaron solicitudes de red ni scraping."
    ]);
  }

  return createSourceResult({
    source: "sofaScore",
    status: SOURCE_STATUS.BLOCKED,
    notes: [
      `El modo de acceso '${accessMode}' no tiene un conector aprobado.`,
      "La fuente permanece bloqueada para evitar consultas no autorizadas."
    ],
    data: {
      matchIdentity: {
        fixtureId: String(matchData?.fixture?.id || ""),
        homeTeam: matchData?.fixture?.home || "",
        awayTeam: matchData?.fixture?.away || ""
      }
    }
  });
}
