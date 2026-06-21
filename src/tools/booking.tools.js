import { z } from "zod";
import { getBookingSummary, getBookingsByDate } from "../db/readonly.js";
import { apiClient } from "../api/client.js";

export const bookingTools = [
  {
    name: "get_booking",
    description: "Fetch a single booking by UUID with full details. Scoped to the admin's cinema hall (cannot read bookings from other halls).",
    inputSchema: { booking_id: z.string().uuid() },
    permission: "any",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/booking/admin/verify/${args.booking_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_bookings",
    description: "List bookings for a cinema hall with date range, status, screen, and text search filters. Paginated. Includes aggregate stats.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.enum(["confirmed", "cancelled"]).optional(),
      screen_id: z.string().uuid().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "any",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.from_date) params.set("from_date", args.from_date);
      if (args.to_date) params.set("to_date", args.to_date);
      if (args.status) params.set("status", args.status);
      if (args.screen_id) params.set("screen_id", args.screen_id);
      if (args.search) params.set("search", args.search);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient({ hall_ids: [args.cinema_hall_id] });
      const { data } = await client.get(`/api/booking/admin/all?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_booking_summary",
    description: "Aggregate booking statistics for a cinema hall over a date range: confirmed/cancelled counts, revenue, fees, average ticket price.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    permission: "any",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const today = new Date();
      const from = args.from_date ?? new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const to = args.to_date ?? today.toISOString().slice(0, 10);

      const summary = await getBookingSummary(args.cinema_hall_id, from, to, scope);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              cinema_hall_id: args.cinema_hall_id,
              range: { from, to },
              summary: summary ?? {},
            }),
          },
        ],
      };
    },
  },
  {
    name: "get_bookings_by_date",
    description: "Booking count and revenue grouped by individual dates in a range. Shows daily trend.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    permission: "any",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const today = new Date();
      const from = args.from_date ?? new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
      const to = args.to_date ?? today.toISOString().slice(0, 10);

      const rows = await getBookingsByDate(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ series: rows }) }] };
    },
  },
];
