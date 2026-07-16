import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

export async function getFotMobContextData() {
  return createSourceResult({
    source: "fotmob",
    status: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["FotMob queda desactivado en esta versión; no se realizan búsquedas web."],
    data: null
  });
}
