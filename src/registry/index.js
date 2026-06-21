import { cinemaTools } from "../tools/cinema.tools.js";
import { movieTools } from "../tools/movie.tools.js";
import { showTools } from "../tools/show.tools.js";
import { bookingTools } from "../tools/booking.tools.js";
import { userTools } from "../tools/user.tools.js";
import { analyticsTools } from "../tools/analytics.tools.js";
import { platformTools } from "../tools/platform.tools.js";
import { requirePermission } from "../auth/permissions.js";
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
];

export function registerTools(server) {
  for (const def of allToolDefs) {
    server.tool(
      def.name,
      def.description,
      def.inputSchema,
      async (rawArgs, extra) => {
        const start = Date.now();
        const scope = extra?.scope || { role: "admin", hall_ids: [], scope_id: "unknown" };

        try {
          requirePermission(def.permission ?? "admin", scope);
          checkRateLimit(def.name, scope, def.rateLimit);

          const result = await def.handler(rawArgs, scope);

          logger.info({
            tool: def.name,
            scope_id: scope.scope_id,
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

  logger.info({ toolCount: allToolDefs.length }, "tools registered");
}
