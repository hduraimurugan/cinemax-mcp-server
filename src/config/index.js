import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_BASE_URL: z.string().url().default("http://localhost:5000"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  HTTP_PORT: z.coerce.number().default(8787),
  MCP_API_KEYS: z.string().optional(),
  CINEMAX_MCP_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SENTRY_DSN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuration error:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
