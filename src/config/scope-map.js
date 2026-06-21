export function loadScopeMap(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const entry of raw.split(";")) {
    const [key, spec] = entry.split("=");
    if (!key || !spec) continue;
    const [role, ...hallParts] = spec.split(":");
    const hall_ids = hallParts.length ? hallParts.join(":").split(",").filter(Boolean) : [];
    map.set(key.trim(), { scope_id: `key-${key.slice(0, 8)}`, role, hall_ids });
  }
  return map;
}
