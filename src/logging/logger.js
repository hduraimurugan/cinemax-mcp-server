import pino from "pino";
import { env } from "../config/index.js";

const isDev = env.LOG_LEVEL === "debug" || process.env.NODE_ENV !== "production";

const logger = pino({
  level: env.LOG_LEVEL,
  ...(isDev && {
    transport: {
      target: "pino/file",
      options: { destination: 1 },
    },
  }),
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie"],
    censor: "[REDACTED]",
  },
});

export default logger;
