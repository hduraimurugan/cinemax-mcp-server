import express from "express";
import {
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../registry/index.js";
import { resolveScope } from "../auth/scopeResolver.js";
import { hasPermission } from "../auth/permissions.js";
import { env } from "../config/index.js";
import logger from "../logging/logger.js";

function createServer(scope) {
  const srv = new McpServer({
    name: "cinemax-mcp",
    version: "1.0.0",
    capabilities: { tools: {} },
  });
  // A fresh server per request is what makes per-caller tool filtering
  // possible at all: the SDK's tools/list handler takes no per-request
  // context, so the only way a finance-role key's tools/list can differ
  // from a superAdmin's is to never have registered the other tools on
  // *this* server instance in the first place.
  registerTools(srv, { toolFilter: (def) => hasPermission(scope, def.permission ?? "superAdmin") });
  return srv;
}

export async function startHttp() {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), ts: new Date().toISOString() });
  });

  app.get("/readyz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/mcp", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) {
      // Deliberately not delegated to resolveScope's own fallback: that
      // fallback exists for stdio, where CINEMAX_MCP_API_KEY IS the one
      // caller. Applying it here too would mean an HTTP request with no
      // x-api-key header silently borrows this process's own local
      // credential instead of being rejected.
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Missing x-api-key header" },
        id: null,
      });
    }

    let scope;
    try {
      scope = await resolveScope({ apiKey });
    } catch (err) {
      const status = err.code === 401 ? 401 : 500;
      return res.status(status).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: err.expose ? err.message : "Internal server error" },
        id: null,
      });
    }

    // The SDK's own AuthInfo contract — streamableHttp.js reads req.auth and
    // forwards it into every tool handler as extra.authInfo. Carrying the
    // caller's raw key in .token (rather than a bespoke extra.scope field
    // the SDK never actually populates) is what let registry/index.js
    // resolve the real per-request caller instead of silently falling back
    // to the process-wide env scope.
    req.auth = { token: apiKey, clientId: scope.scope_id, scopes: [] };

    const server = createServer(scope);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (err) {
      if (!res.headersSent) {
        const status = err.code === 401 ? 401 : 500;
        logger.error({ err: err.message, status }, "HTTP transport error");
        res.status(status).json({
          jsonrpc: "2.0",
          error: { code: status === 401 ? -32001 : -32603, message: err.expose ? err.message : "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
    });
  });

  app.listen(env.HTTP_PORT, () => {
    logger.info({ port: env.HTTP_PORT }, "cinemax-mcp HTTP transport listening");
  });
}
