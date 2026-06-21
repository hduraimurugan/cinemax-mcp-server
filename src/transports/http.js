import express from "express";
import {
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../registry/index.js";
import { resolveScope } from "../auth/scopeResolver.js";
import { env } from "../config/index.js";
import logger from "../logging/logger.js";

function createServer() {
  const srv = new McpServer({
    name: "cinemax-mcp",
    version: "1.0.0",
    capabilities: { tools: {} },
  });
  registerTools(srv);
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
    const server = createServer();
    try {
      req.auth = resolveScope({ apiKey: req.headers["x-api-key"] });
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
