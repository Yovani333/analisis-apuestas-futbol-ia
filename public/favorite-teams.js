function timestamp(value) {
  return Date.parse(value || "") || 0;
}

function validTeam(team) {
  return Boolean(team && String(team.id || "").trim() && String(team.name || "").trim());
}

export function mergeFavoriteTeams(localRows = [], remoteRows = []) {
  const teams = new Map();
  for (const team of [...(Array.isArray(localRows) ? localRows : []), ...(Array.isArray(remoteRows) ? remoteRows : [])]) {
    if (!validTeam(team)) continue;
    const id = String(team.id);
    const current = teams.get(id);
    if (!current || timestamp(team.updatedAt) >= timestamp(current.updatedAt)) teams.set(id, { ...team, id });
  }
  return [...teams.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
}

export function activeFavoriteTeams(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((team) => validTeam(team) && team.active !== false);
}

export function isFavoriteTeam(rows, teamId) {
  return activeFavoriteTeams(rows).some((team) => String(team.id) === String(teamId));
}

export function toggleFavoriteTeam(rows, team, now = new Date()) {
  if (!validTeam(team)) return Array.isArray(rows) ? rows : [];
  const id = String(team.id);
  const existing = (Array.isArray(rows) ? rows : []).find((item) => String(item?.id) === id);
  const updated = {
    ...(existing || {}),
    ...team,
    id,
    active: existing ? existing.active === false : true,
    updatedAt: now.toISOString()
  };
  return mergeFavoriteTeams((Array.isArray(rows) ? rows : []).filter((item) => String(item?.id) !== id), [updated]);
}
