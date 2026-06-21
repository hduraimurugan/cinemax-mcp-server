import { env } from "../config/index.js";
import { loadScopeMap } from "../config/scope-map.js";
import logger from "../logging/logger.js";

const scopeMap = loadScopeMap(env.MCP_API_KEYS);

export function resolveScope(credentials = {}) {
  const key = credentials.apiKey || process.env.CINEMAX_MCP_API_KEY;
  if (!key) {
    logger.warn("resolveScope called with no API key");
    const e = new Error("UNAUTHORIZED: Invalid or missing API key");
    e.code = 401;
    e.expose = true;
    throw e;
  }

  if (scopeMap.size > 0) {
    const scope = scopeMap.get(key);
    if (!scope) {
      logger.warn({ keyPrefix: key.slice(0, 8) }, "unknown API key");
      const e = new Error("UNAUTHORIZED: Invalid API key");
      e.code = 401;
      e.expose = true;
      throw e;
    }
    return scope;
  }

  logger.warn("Using default superAdmin scope (single-key mode)");
  return { scope_id: "default", role: "superAdmin", hall_ids: [] };
}
