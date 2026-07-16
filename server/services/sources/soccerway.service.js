import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

export async function getSoccerwayFallbackData() {
  return createSourceResult({
    source: "soccerway",
    status: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["Soccerway queda desactivado en esta versión; no se realizan búsquedas web."],
    data: null
  });
}
