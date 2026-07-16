import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

export async function getOddspediaMarketData() {
  return createSourceResult({
    source: "oddspedia",
    status: SOURCE_STATUS.BLOCKED,
    notes: ["Oddspedia queda desactivado en esta versión; no se realizan búsquedas web."],
    data: null
  });
}
