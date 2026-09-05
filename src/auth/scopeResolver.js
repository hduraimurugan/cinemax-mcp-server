import axios from "axios";
import { env } from "../config/index.js";
import logger from "../logging/logger.js";

// Per-key scope cache. Introspection is a real network round-trip to
// cinema-hall-api, so caching avoids doing it on every single tool call —
// but short enough that a revoked key or an edited role takes effect within
// a minute, not "until the process restarts" (the old static MCP_API_KEYS
// map's failure mode).
const CACHE_TTL_MS = 60_000;
const cache = new Map(); // apiKey -> { scope, ts }

function unauthorized(message) {
  const e = new Error(`UNAUTHORIZED: ${message}`);
  e.code = 401;
  e.expose = true;
  return e;
}

async function fetchContext(apiKey) {
  const { data } = await axios.get(`${env.API_BASE_URL}/api/api-keys/context`, {
    headers: { "X-API-Key": apiKey },
    timeout: 10000,
    validateStatus: () => true,
  });
  return data;
}

/**
 * Resolve a caller's API key into a scope by asking cinema-hall-api who they
 * are and what they can do (GET /api/api-keys/context) — the same identity,
 * permissions and hall assignments that back their admin-panel session.
 *
 * Replaces the old static MCP_API_KEYS map (deleted along with
 * config/scope-map.js): there is no local role/hall_ids table to maintain
 * anymore, and a role edit or hall reassignment is reflected within
 * CACHE_TTL_MS instead of requiring a redeploy.
 *
 * `apiKey` is the caller's own personal key on the HTTP transport (forwarded
 * as extra.authInfo.token by the SDK — see registry/index.js), or omitted on
 * stdio, where CINEMAX_MCP_API_KEY from the local .env is the only caller.
 */
export async function resolveScope({ apiKey } = {}) {
  const key = apiKey || process.env.CINEMAX_MCP_API_KEY;
  if (!key) throw unauthorized("Missing API key");

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.scope;
  }

  let context;
  try {
    context = await fetchContext(key);
  } catch (err) {
    logger.error({ err: err.message }, "Failed to reach cinema-hall-api to resolve API key");
    throw unauthorized("Could not verify API key");
  }

  if (!context?.admin?.id) {
    throw unauthorized("Invalid, expired, or revoked API key");
  }

  const halls = context.halls || [];
  const scope = {
    scope_id: `key-${key.slice(0, 12)}`,
    api_key: key,
    admin_id: context.admin.id,
    org_id: context.admin.orgId ?? null,
    role: context.admin.role,
    role_key: context.admin.roleKey ?? null,
    permissions: new Set(context.permissions || []),
    hall_ids: halls.map((h) => h.id),
    hall_scopes: Object.fromEntries(halls.map((h) => [h.id, h.scope])),
  };

  cache.set(key, { scope, ts: Date.now() });
  return scope;
}

/** Drop a cached scope — e.g. after a key is known to be revoked. */
export function clearScopeCache(apiKey) {
  if (apiKey) cache.delete(apiKey);
  else cache.clear();
}
