export function requirePermission(requiredRole, scope) {
  if (requiredRole === "superAdmin" && scope.role !== "superAdmin") {
    const e = new Error("FORBIDDEN: SuperAdmin access required for this tool");
    e.code = 403;
    e.expose = true;
    throw e;
  }

  if (requiredRole === "admin" && scope.role !== "admin" && scope.role !== "superAdmin") {
    const e = new Error("FORBIDDEN: Admin or SuperAdmin access required");
    e.code = 403;
    e.expose = true;
    throw e;
  }
}
