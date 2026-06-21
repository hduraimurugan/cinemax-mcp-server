import { z } from "zod";
import { getCustomerBookingHistory } from "../db/readonly.js";
import { apiClient } from "../api/client.js";

export const userTools = [
  {
    name: "list_customers",
    description: "Platform-wide customer list with search and stats. SuperAdmin only.",
    inputSchema: {
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.search) params.set("search", args.search);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient();
      const { data } = await client.get(`/api/customers?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_customer",
    description: "Full customer details including recent bookings and active sessions. SuperAdmin only.",
    inputSchema: { customer_id: z.string().uuid() },
    permission: "superAdmin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/customers/${args.customer_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_customer_booking_history",
    description: "All confirmed bookings for a specific customer, ordered by date descending. SuperAdmin only.",
    inputSchema: {
      customer_id: z.string().uuid(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const [bookings, countResult] = await getCustomerBookingHistory(
        args.customer_id,
        args.page,
        args.limit,
        scope,
      );
      const total = countResult?.[0]?.total ?? 0;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              bookings,
              total,
              page: args.page,
              limit: args.limit,
            }),
          },
        ],
      };
    },
  },
];
