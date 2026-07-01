const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function resolveAnalysisTiming({ kickoffAt, lastUpdatedAt } = {}, now = new Date()) {
  const kickoff = validDate(kickoffAt);
  const updated = validDate(lastUpdatedAt);
  if (!kickoff) return {
    window: "unknown", label: "Horario no disponible", minutesToKickoff: null,
    lastUpdatedAt: updated?.toISOString() || "", isFresh: false, isConfirmed: false,
    confidenceCap: 59, warning: "Requiere actualización: falta la hora verificable del partido."
  };
  const minutesToKickoff = Math.round((kickoff - now) / MINUTE);
  const ageHours = updated ? Math.max(0, (now - updated) / HOUR) : Infinity;
  let window = "started";
  let label = "Partido iniciado";
  let confidenceCap = 79;
  if (minutesToKickoff > 72 * 60) { window = "too_early"; label = "Análisis muy anticipado"; confidenceCap = 59; }
  else if (minutesToKickoff > 48 * 60) { window = "early_value"; label = "Valor temprano / Exploratorio"; confidenceCap = 59; }
  else if (minutesToKickoff > 12 * 60) { window = "prevalidated"; label = "Prevalidado"; confidenceCap = 79; }
  else if (minutesToKickoff > 2 * 60) { window = "ideal"; label = "Ventana ideal"; confidenceCap = 100; }
  else if (minutesToKickoff > 30) { window = "final_confirmation"; label = "Confirmación final"; confidenceCap = 100; }
  else if (minutesToKickoff > 0) { window = "last_review"; label = "Última revisión"; confidenceCap = 100; }
  const isFresh = ageHours <= 12;
  const isConfirmed = minutesToKickoff > 0 && minutesToKickoff <= 120 && ageHours <= 2;
  if (!isFresh) confidenceCap = Math.min(confidenceCap, 79);
  const warnings = [];
  if (window === "too_early" || window === "early_value") warnings.push("Lectura exploratoria; debe actualizarse más cerca del inicio.");
  if (!updated || !isFresh) warnings.push("Requiere actualización: los datos no fueron revisados en las últimas 12 horas.");
  if (["final_confirmation", "last_review"].includes(window) && !isConfirmed) warnings.push("Falta una revisión dentro de las últimas 2 horas para marcarlo como confirmado.");
  return {
    window, label, minutesToKickoff, lastUpdatedAt: updated?.toISOString() || "",
    isFresh, isConfirmed, confidenceCap, warning: warnings.join(" ")
  };
}

export function detectOddsMovement(originalOdds, updatedOdds) {
  const original = Number(originalOdds);
  const updated = Number(updatedOdds);
  if (!(original > 1) || !(updated > 1)) return { changed: false, percent: null, direction: "none", warning: "" };
  const percent = Number(((updated - original) / original * 100).toFixed(1));
  const changed = Math.abs(percent) >= 8 || Math.abs(updated - original) >= 0.15;
  return {
    changed, percent, direction: percent > 0 ? "up" : percent < 0 ? "down" : "same",
    warning: changed ? `Movimiento de cuota relevante: ${original.toFixed(2)} → ${updated.toFixed(2)} (${percent > 0 ? "+" : ""}${percent}%). Revisar el pick.` : ""
  };
}

export function applyAnalysisTiming(leg, now = new Date()) {
  const timing = resolveAnalysisTiming({
    kickoffAt: leg.kickoffAt,
    lastUpdatedAt: leg.lastUpdatedAt || leg.addedAt || leg.savedAt
  }, now);
  const confidenceText = String(leg.confidence || "").toLowerCase();
  const textualConfidence = confidenceText.includes("alta") && !confidenceText.includes("media") ? 90
    : confidenceText.includes("media-alta") || confidenceText.includes("media alta") ? 75
      : confidenceText.includes("media") ? 60 : confidenceText.includes("baja") ? 35 : null;
  const parsedConfidence = Number.parseFloat(String(leg.confidenceScore ?? leg.confidence ?? ""));
  const numeric = Number.isFinite(parsedConfidence) ? parsedConfidence : textualConfidence;
  const effectiveConfidenceScore = Number.isFinite(numeric) ? Math.min(numeric, timing.confidenceCap) : null;
  return {
    ...leg,
    analysisTiming: timing,
    effectiveConfidenceScore,
    oddsMovement: detectOddsMovement(leg.originalOdds ?? leg.decimalOdds, leg.updatedOdds)
  };
}
