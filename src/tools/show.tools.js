import { z } from "zod";
import { getShowOccupancy, getShowSeatMap, resolveHallForShow } from "../db/readonly.js";
import { apiClient, apiClientForHall } from "../api/client.js";

export const showTools = [
  {
    name: "list_shows_by_date",
    description: "Shows scheduled for a specific date, grouped by movie with screen name, timings, pricing, and status.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    permission: "shows.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      // /api/shows/date/:date is behind requireActiveHall — this tool always
      // took cinema_hall_id but never forwarded it, so every call 400'd.
      const client = apiClientForHall(scope, args.cinema_hall_id);
      const { data } = await client.get(`/api/shows/date/${args.date}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_show",
    description: "Full show details with screen name, timings, status, pricing, and seat occupancy breakdown.",
    inputSchema: { show_id: z.string().uuid() },
    permission: "shows.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      // GET /api/shows/get/:id is a public route — no hall header needed.
      const client = apiClient(scope);
      const { data } = await client.get(`/api/shows/get/${args.show_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_show_occupancy",
    description: "Seat occupancy breakdown for a show: booked vs available overall and by seat category (premium, gold, silver).",
    inputSchema: { show_id: z.string().uuid() },
    permission: "shows.read",
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
    name: "get_show_seat_map",
    description: "Per-seat status for a show: seat label (e.g. A1), type, and whether it's available, held, or booked.",
    inputSchema: { show_id: z.string().uuid() },
    permission: "shows.read",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const seats = await getShowSeatMap(args.show_id, scope);
      return { content: [{ type: "text", text: JSON.stringify({ show_id: args.show_id, seats }) }] };
    },
  },
  {
    name: "get_show_booking_count",
    description: "Confirmed booking count and total amount for a show. Useful for admin cancel-warning dialogs.",
    inputSchema: { show_id: z.string().uuid() },
    permission: "bookings.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      // /api/shows/booking-count/:id is behind requireActiveHall but this
      // tool only takes a show_id — resolve the hall under RLS first so the
      // caller doesn't need to already know it (and can't probe a hall
      // outside their scope: an unauthorized show simply resolves to nothing).
      const hall = await resolveHallForShow(args.show_id, scope);
      if (!hall) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Show not found" }) }],
          isError: true,
        };
      }
      const client = apiClientForHall(scope, hall.cinema_hall_id);
      const { data } = await client.get(`/api/shows/booking-count/${args.show_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
];
