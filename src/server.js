import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./registry/index.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";
import logger from "./logging/logger.js";
import { env } from "./config/index.js";

logger.info("cinemax-mcp-server booting");

const server = new McpServer({
  name: "cinemax-mcp",
  version: "1.0.0",
  capabilities: { tools: {} },
});

registerTools(server);

const transport = env.MCP_TRANSPORT === "http" ? "http" : "stdio";

if (transport === "http") {
  await startHttp(server);
} else {
  await startStdio(server);
}

logger.info({ transport, node: process.version }, "cinemax-mcp-server ready");
