function normalizeKeys(required) {
  return Array.isArray(required) ? required : [required];
}

/**
 * Pure predicate version of the permission check — used both to gate a tool
 * call (via requirePermission) and to decide whether a caller should even
 * see a tool in tools/list (registry/index.js's per-scope registration).
 *
 * `required` is a real permission key (or array of keys, all required) from
 * cinema-hall-api's permission catalog — e.g. "movies.read", "analytics.view"
 * — or the literal "superAdmin" for platform-only tools, or "any"/falsy for
 * public tools. superAdmin bypasses everything, mirroring
 * cinema-hall-api's own requirePermission.js:131.
 */
export function hasPermission(scope, required) {
  if (!required || required === "any") return true;
  if (scope.role === "superAdmin") return true;
  if (required === "superAdmin") return false;
  return normalizeKeys(required).every((key) => scope.permissions?.has(key));
}

export function requirePermission(required, scope) {
  if (hasPermission(scope, required)) return;

  const message =
    required === "superAdmin"
      ? "SuperAdmin access required for this tool"
      : `Missing permission: ${normalizeKeys(required).join(", ")}`;

  const e = new Error(`FORBIDDEN: ${message}`);
  e.code = 403;
  e.expose = true;
  throw e;
}
