import { z } from "zod";
import { getShowOccupancy } from "../db/readonly.js";
import { apiClient } from "../api/client.js";

export const showTools = [
  {
    name: "list_shows_by_date",
    description: "Shows scheduled for a specific date, grouped by movie with screen name, timings, pricing, and status.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    permission: "any",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/shows/date/${args.date}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_show",
    description: "Full show details with screen name, timings, status, pricing, and seat occupancy breakdown.",
    inputSchema: { show_id: z.string().uuid() },
    permission: "any",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/shows/get/${args.show_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_show_occupancy",
    description: "Seat occupancy breakdown for a show: booked vs available by seat category (premium, gold, silver).",
    inputSchema: { show_id: z.string().uuid() },
    permission: "any",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const row = await getShowOccupancy(args.show_id, scope);
      if (!row) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Show not found" }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify({ occupancy: row }) }] };
    },
  },
  {
    name: "get_show_booking_count",
    description: "Confirmed booking count and total amount for a show. Useful for admin cancel-warning dialogs.",
    inputSchema: { show_id: z.string().uuid() },
    permission: "any",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/shows/booking-count/${args.show_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
];
