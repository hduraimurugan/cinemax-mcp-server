import axios from "axios";
import { env } from "../config/index.js";

function baseHeaders(scope) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.MCP_SERVICE_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MCP_SERVICE_TOKEN}`;
  }
  if (scope?.org_id) {
    // Not enforced by the API yet (requireActiveOrg isn't wired to any route
    // as of this writing), but harmless to send and correct once it is.
    headers["X-Org-Id"] = scope.org_id;
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
// send a hall the caller's scope doesn't actually authorize — previously
// callers built `{ hall_ids: [args.cinema_hall_id] }` themselves, which
// discarded the caller's real scope and would happily forward any hall id
// the model passed in, superAdmin-only or not.
export function apiClientForHall(scope, hallId, { timeout } = {}) {
  if (!hallId) {
    const e = new Error("cinema_hall_id is required for this tool");
    e.code = 400;
    e.expose = true;
    throw e;
  }
  if (scope?.role !== "superAdmin" && scope?.hall_ids?.length > 0 && !scope.hall_ids.includes(hallId)) {
    const e = new Error("FORBIDDEN: cinema_hall_id is outside this API key's authorized halls");
    e.code = 403;
    e.expose = true;
    throw e;
  }
  return makeClient({ ...baseHeaders(scope), "X-Hall-Id": hallId }, timeout);
}
