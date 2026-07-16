import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

export async function getWhoScoredAbsenceData() {
  return createSourceResult({
    source: "whoScored",
    status: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["WhoScored queda desactivado en esta versión; no se realizan búsquedas web."],
    data: null
  });
}
