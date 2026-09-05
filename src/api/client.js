import axios from "axios";
import { env } from "../config/index.js";

function baseHeaders(scope) {
  const headers = { "Content-Type": "application/json" };
  if (scope?.api_key) {
    // The caller's own personal key — the API resolves it back to their real
    // identity and enforces their real Roles & Permissions natively. This
    // replaces the old single shared MCP_SERVICE_TOKEN, which made every MCP
    // caller indistinguishable from one fixed superAdmin.
    headers["X-API-Key"] = scope.api_key;
  } else if (process.env.MCP_SERVICE_TOKEN) {
    // Only reached for calls made before a caller scope exists (e.g. the
    // boot-time preflight in server.js). No tool handler should hit this path.
    headers.Authorization = `Bearer ${process.env.MCP_SERVICE_TOKEN}`;
  }
  return headers;
}

function makeClient(headers, timeout = 10000) {
  return axios.create({
    baseURL: env.API_BASE_URL,
    headers,
    timeout,
    validateStatus: (status) => status < 500,
  });
}

// Client with no hall context — for endpoints that aren't behind
// requireActiveHall (movies, offers, settings, superAdmin routes, ...).
// `timeout` lets write tools opt into a longer budget than the 10s default —
// some downstream operations (e.g. broadcast sends) do real, sequential,
// per-recipient work server-side (DB writes + live FCM/SMTP calls) that can
// legitimately take longer than a typical read.
export function apiClient(scope, { timeout } = {}) {
  return makeClient(baseHeaders(scope), timeout);
}

// Client scoped to a specific hall, for endpoints behind requireActiveHall
// (bookings, shows, dashboard, refunds, payment orders, ...). Refuses to
// send a hall the caller's scope doesn't actually authorize.
//
// This check is now unconditional — it used to skip entirely for
// role === "superAdmin" or an empty hall_ids list, which was exactly the
// shape of the old default/fallback scope, so in practice any cinema_hall_id
// the model invented was forwarded unchecked. scope.hall_ids now comes from
// the caller's own API key introspection (their real hall assignments), so a
// genuine superAdmin's hall_ids legitimately covers every hall in their org
// — there is no scope for which "unconditional" is too strict.
export function apiClientForHall(scope, hallId, { timeout } = {}) {
  if (!hallId) {
    const e = new Error("cinema_hall_id is required for this tool");
    e.code = 400;
    e.expose = true;
    throw e;
  }
  if (!scope?.hall_ids?.includes(hallId)) {
    const e = new Error("FORBIDDEN: cinema_hall_id is outside this API key's authorized halls");
    e.code = 403;
    e.expose = true;
    throw e;
  }
  return makeClient({ ...baseHeaders(scope), "X-Hall-Id": hallId }, timeout);
}
