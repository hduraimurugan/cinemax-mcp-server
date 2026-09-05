import { cinemaTools } from "../tools/cinema.tools.js";
import { movieTools } from "../tools/movie.tools.js";
import { showTools } from "../tools/show.tools.js";
import { bookingTools } from "../tools/booking.tools.js";
import { userTools } from "../tools/user.tools.js";
import { analyticsTools } from "../tools/analytics.tools.js";
import { platformTools } from "../tools/platform.tools.js";
import { teamTools } from "../tools/team.tools.js";
import { notificationsTools } from "../tools/notifications.tools.js";
import { requirePermission } from "../auth/permissions.js";
import { resolveScope } from "../auth/scopeResolver.js";
import { checkRateLimit } from "../ratelimit/tokenBucket.js";
import { toMcpError } from "../errors/index.js";
import logger from "../logging/logger.js";

const allToolDefs = [
  ...cinemaTools,
  ...movieTools,
  ...showTools,
  ...bookingTools,
  ...userTools,
  ...analyticsTools,
  ...platformTools,
  ...teamTools,
  ...notificationsTools,
];

export { allToolDefs };

/**
 * `toolFilter(def)` restricts which tools this particular McpServer instance
 * registers — used so a caller's own `tools/list` only ever shows tools
 * their real permissions actually allow (the SDK's ListTools handler takes
 * no per-request context, so this is the only place filtering is possible;
 * see transports/http.js, which builds one McpServer per request specifically
 * so this filter can be scope-aware).
 */
export function registerTools(server, { toolFilter } = {}) {
  const defs = toolFilter ? allToolDefs.filter(toolFilter) : allToolDefs;

  for (const def of defs) {
    server.tool(
      def.name,
      def.description,
      def.inputSchema,
      async (rawArgs, extra) => {
        const start = Date.now();
        let scope;
        try {
          // extra.authInfo is the SDK's own auth contract (populated from
          // req.auth by the HTTP transport, see streamableHttp.js) — the
          // caller's own API key rides in .token. Undefined on stdio, where
          // resolveScope falls back to the local CINEMAX_MCP_API_KEY.
          scope = await resolveScope({ apiKey: extra?.authInfo?.token });
        } catch (err) {
          logger.warn({ tool: def.name, err: err.message }, "auth failed");
          return toMcpError(err);
        }

        try {
          requirePermission(def.permission ?? "superAdmin", scope);
          checkRateLimit(def.name, scope, def.rateLimit);

          const result = await def.handler(rawArgs, scope);

          logger.info({
            tool: def.name,
            scope_id: scope.scope_id,
            admin_id: scope.admin_id,
            role: scope.role,
            hall_ids: scope.hall_ids,
            duration_ms: Date.now() - start,
            status: "ok",
          });

          return result;
        } catch (err) {
          logger.error({
            tool: def.name,
            scope_id: scope.scope_id,
            role: scope.role,
            duration_ms: Date.now() - start,
            status: "error",
            err: err.expose ? err.message : "INTERNAL",
          });

          return toMcpError(err);
        }
      },
    );
  }

  logger.info({ toolCount: defs.length }, "tools registered");
}
