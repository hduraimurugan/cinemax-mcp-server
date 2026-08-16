

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./registry/index.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";
import { hasActiveMembership } from "./db/readonly.js";
import logger from "./logging/logger.js";
import { env } from "./config/index.js";

logger.info("cinemax-mcp-server booting");

// requireActiveHall (cinema-hall-api/middleware/verifyCinemaAdmin.js) now
// INNER JOINs organization_members unconditionally — org membership is
// required even for superAdmin, which wasn't true before. Every HTTP-backed
// tool call that needs X-Hall-Id goes through MCP_SERVICE_TOKEN, so if that
// token's admin has no active membership, every one of those tools 403s.
// This check turns that into one clear line at boot instead of a confusing
// wall of per-call 403s discovered one tool at a time.
function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function preflightServiceToken() {
  const token = process.env.MCP_SERVICE_TOKEN;
  if (!token) {
    logger.warn("MCP_SERVICE_TOKEN not set — HTTP-backed tools will call the API unauthenticated");
    return;
  }

  const payload = decodeJwtPayload(token);
  if (!payload?.id) {
    logger.warn("MCP_SERVICE_TOKEN could not be decoded (not a JWT?) — skipping org membership preflight");
    return;
  }

  try {
    const ok = await hasActiveMembership(payload.id);
    if (ok) {
      logger.info({ adminId: payload.id }, "MCP_SERVICE_TOKEN org membership verified");
    } else {
      logger.warn(
        { adminId: payload.id },
        "MCP_SERVICE_TOKEN's admin has no active organization membership — " +
          "every hall-scoped tool (bookings, shows, dashboard, refunds, payment orders, team, settings) will 403 until this is fixed",
      );
    }
  } catch (err) {
    logger.warn({ err: err.message }, "Could not verify MCP_SERVICE_TOKEN org membership (DB check failed)");
  }
}

await preflightServiceToken();

const transport = env.MCP_TRANSPORT === "http" ? "http" : "stdio";

if (transport === "http") {
  await startHttp();
} else {
  const server = new McpServer({
    name: "cinemax-mcp",
    version: "1.0.0",
    capabilities: { tools: {} },
  });
  registerTools(server);
  await startStdio(server);
}

logger.info({ transport, node: process.version }, "cinemax-mcp-server ready");
