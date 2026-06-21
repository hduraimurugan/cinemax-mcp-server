import axios from "axios";
import { env } from "../config/index.js";

export function apiClient(scope) {
  const headers = { "Content-Type": "application/json" };

  if (process.env.MCP_SERVICE_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MCP_SERVICE_TOKEN}`;
  }
  if (scope?.hall_ids?.length > 0) {
    headers["X-Hall-Id"] = scope.hall_ids[0];
  }

  return axios.create({
    baseURL: env.API_BASE_URL,
    headers,
    timeout: 10000,
    validateStatus: (status) => status < 500,
  });
}
