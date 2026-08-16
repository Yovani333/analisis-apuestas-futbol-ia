const normalizedCompetition = (value = "") => String(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function competitionIdentity(value = {}) {
  return {
    id: value?.league?.id ?? value?.leagueId ?? value?.league_id ?? null,
    name: value?.league?.name ?? value?.leagueName ?? value?.competition ?? ""
  };
}

export function isSameCompetition(row = {}, target = {}) {
  const rowCompetition = competitionIdentity(row);
  const targetCompetition = competitionIdentity(target);
  if (rowCompetition.id !== null && rowCompetition.id !== undefined && rowCompetition.id !== ""
    && targetCompetition.id !== null && targetCompetition.id !== undefined && targetCompetition.id !== "") {
    return String(rowCompetition.id) === String(targetCompetition.id);
  }
  const rowName = normalizedCompetition(rowCompetition.name);
  const targetName = normalizedCompetition(targetCompetition.name);
  return Boolean(rowName && targetName && rowName === targetName);
}

export function filterSameCompetitionRows(rows = [], target = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => isSameCompetition(row, target));
}

export function competitionLabel(target = {}) {
  const identity = competitionIdentity(target);
  return identity.name || (identity.id !== null && identity.id !== undefined ? `Liga ${identity.id}` : "Competicion no identificada");
}
