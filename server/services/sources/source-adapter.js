import { SOURCE_STATUS } from "../../constants/source-catalog.js";

const VALID_STATUSES = new Set(Object.values(SOURCE_STATUS));

export function createSourceResult({ source, status, updatedAt = "", notes = [], data = null }) {
  if (!source) throw new TypeError("El adaptador debe identificar su fuente.");
  if (!VALID_STATUSES.has(status)) throw new TypeError(`Estado de fuente no válido: ${status}`);
  return {
    source,
    status,
    updatedAt,
    notes: Array.isArray(notes) ? notes.filter(Boolean).map(String) : [String(notes)],
    data
  };
}

export function notConfiguredSource(source, notes) {
  return createSourceResult({ source, status: SOURCE_STATUS.NOT_CONFIGURED, notes, data: null });
}
