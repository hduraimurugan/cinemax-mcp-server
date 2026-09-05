import { z } from "zod";
import { listCinemas, getCinema, getCinemaStats, listScreens, getScreenLayout } from "../db/readonly.js";
import { apiClient } from "../api/client.js";

export const cinemaTools = [
  {
    name: "list_halls",
    description: "Cinema halls the caller's organization owns or has been assigned to, via the same endpoint the admin app uses. Use this to discover a cinema_hall_id before calling any hall-scoped tool.",
    inputSchema: {},
    permission: "halls.read",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const client = apiClient(scope);
      const { data } = await client.get("/api/halls");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_cinemas",
    description: "List cinema halls. Admins see only their own halls; SuperAdmins see all active halls.",
    inputSchema: { active: z.boolean().optional() },
    permission: "halls.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const rows = await listCinemas(scope, args.active);
      return { content: [{ type: "text", text: JSON.stringify({ cinemas: rows }) }] };
    },
  },
  {
    name: "get_cinema",
    description: "Get a single cinema hall by ID, including screen count and today's show count.",
    inputSchema: { cinema_hall_id: z.string().uuid() },
    permission: "halls.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const cinema = await getCinema(args.cinema_hall_id, scope);
      if (!cinema) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Cinema hall not found" }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify({ cinema }) }] };
    },
  },
  {
    name: "get_cinema_stats",
    description: "Key performance indicators for a cinema hall over a date range: bookings, revenue, fees, top movies.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    permission: "analytics.view",
    rateLimit: { capacity: 10, refillPerSec: 1 },
    handler: async (args, scope) => {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const from = args.from_date ?? thirtyDaysAgo.toISOString().slice(0, 10);
      const to = args.to_date ?? today.toISOString().slice(0, 10);

      const row = await getCinemaStats(args.cinema_hall_id, from, to, scope);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              cinema_hall_id: args.cinema_hall_id,
              range: { from, to },
              ...(row?.stats ?? {}),
              top_movies: row?.top_movies ?? [],
              screens_count: row?.screens_count ?? 0,
              shows_count: row?.shows_count ?? 0,
            }),
          },
        ],
      };
    },
  },
  {
    name: "list_cinema_screens",
    description: "List all screens in a cinema hall with seat configuration, pricing tiers, and aisle layout.",
    inputSchema: { cinema_hall_id: z.string().uuid() },
    permission: "screens.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const rows = await listScreens(args.cinema_hall_id, scope);
      return { content: [{ type: "text", text: JSON.stringify({ screens: rows }) }] };
    },
  },
  {
    name: "get_screen_layout",
    description: "Full seat-level layout for one screen: every seat's row, column, type, price-tier, and blocked status, plus aisle configuration and screen position. Both admin and customer apps render from this exact structure.",
    inputSchema: { screen_id: z.string().uuid() },
    permission: "screens.read",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const layout = await getScreenLayout(args.screen_id, scope);
      if (!layout) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Screen not found" }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify({ screen: layout }) }] };
    },
  },
];
