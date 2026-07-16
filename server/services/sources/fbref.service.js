import { SOURCE_STATUS } from "../../constants/source-catalog.js";
import { createSourceResult } from "./source-adapter.js";

export async function getFbrefXgData() {
  return createSourceResult({
    source: "fbref",
    status: SOURCE_STATUS.NOT_CONFIGURED,
    notes: ["FBref queda desactivado en esta versión; no se realizan búsquedas web."],
    data: null
  });
}
