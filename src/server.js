

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./registry/index.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";
import { resolveScope } from "./auth/scopeResolver.js";
import { hasPermission } from "./auth/permissions.js";
import logger from "./logging/logger.js";
import { env } from "./config/index.js";

logger.info("cinemax-mcp-server booting");

const transport = env.MCP_TRANSPORT === "http" ? "http" : "stdio";

if (transport === "http") {
  // Each request carries its own caller (x-api-key), resolved and validated
  // per-call in transports/http.js — there is no single credential to
  // preflight here.
  await startHttp();
} else {
  // stdio has exactly one caller for the life of the process — the local
  // CINEMAX_MCP_API_KEY (see Settings > API Keys in the admin panel) — so
  // scope is resolved once at boot, both to fail loudly and clearly if the
  // key is missing/invalid, and to filter which tools even get registered
  // (mirrors how the HTTP transport filters per-request).
  let scope;
  try {
    scope = await resolveScope({});
  } catch (err) {
    logger.error({ err: err.message }, "Failed to resolve CINEMAX_MCP_API_KEY — is it set and valid?");
    process.exit(1);
  }

  if (scope.role !== "superAdmin" && !scope.org_id) {
    logger.warn(
      { adminId: scope.admin_id },
      "This API key's admin has no active organization membership — every " +
        "permission-gated and hall-scoped tool will be empty or forbidden until this is fixed",
    );
  }

  const server = new McpServer({
    name: "cinemax-mcp",
    version: "1.0.0",
    capabilities: { tools: {} },
  });
  registerTools(server, { toolFilter: (def) => hasPermission(scope, def.permission ?? "superAdmin") });
  await startStdio(server);
}

logger.info({ transport, node: process.version }, "cinemax-mcp-server ready");
