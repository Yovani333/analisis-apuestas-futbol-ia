export function resolveModuleQuality({ score = 0, status = "not_available", notes = [] } = {}) {
  const normalizedScore = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  let label = "Baja";
  if (status === "not_available" || normalizedScore === 0) label = "No disponible";
  else if (status === "partial") label = normalizedScore < 40 ? "Baja" : "Parcial";
  else if (normalizedScore >= 80) label = "Alta";
  else if (normalizedScore >= 60) label = "Media";
  return { score: normalizedScore, label, status, notes: [...new Set(notes.filter(Boolean))] };
}
