import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveScope } from "../auth/scopeResolver.js";

export async function startStdio(server) {
  const transport = new StdioServerTransport();
  transport.requestContext = () => ({
    scope: resolveScope({ apiKey: process.env.CINEMAX_MCP_API_KEY }),
  });
  await server.connect(transport);
}
