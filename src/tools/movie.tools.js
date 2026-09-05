import { z } from "zod";
import { getMovieStats } from "../db/readonly.js";
import { apiClient } from "../api/client.js";

export const movieTools = [
  {
    name: "list_movies",
    description: "Search and filter the movie catalog. Supports status (upcoming/now_showing/ended), genre, language, and text search.",
    inputSchema: {
      status: z.enum(["upcoming", "now_showing", "ended"]).optional(),
      genre: z.array(z.string()).optional(),
      language: z.array(z.string()).optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "movies.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.genre) args.genre.forEach((g) => params.append("genre", g));
      if (args.language) args.language.forEach((l) => params.append("language", l));
      if (args.search) params.set("search", args.search);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient(scope);
      const { data } = await client.get(`/api/movies?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_movie",
    description: "Full movie details including description, cast, trailer URL, genres, languages, and TMDB metadata.",
    inputSchema: { movie_id: z.string().uuid() },
    permission: "movies.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const client = apiClient(scope);
      const { data } = await client.get(`/api/movies/${args.movie_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_now_showing_movies",
    description: "Convenience tool — list movies currently showing in theatres.",
    inputSchema: {
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "movies.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const client = apiClient(scope);
      const { data } = await client.get(`/api/movies?status=now_showing&page=${args.page}&limit=${args.limit}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_upcoming_movies",
    description: "Convenience tool — list movies coming soon to theatres.",
    inputSchema: {
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "movies.read",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args, scope) => {
      const client = apiClient(scope);
      const { data } = await client.get(`/api/movies?status=upcoming&page=${args.page}&limit=${args.limit}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_movie_stats",
    description: "Bookings, revenue, and occupancy statistics for a specific movie. Optionally scoped to a cinema hall.",
    inputSchema: {
      movie_id: z.string().uuid(),
      cinema_hall_id: z.string().uuid().optional(),
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    permission: "analytics.view",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const today = new Date();
      const from = args.from_date ?? new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const to = args.to_date ?? today.toISOString().slice(0, 10);
      const row = await getMovieStats(args.movie_id, args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ movie_stats: row ?? null }) }] };
    },
  },
];
