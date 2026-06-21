import { z } from "zod";
import { apiClient } from "../api/client.js";

const dateStr = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const platformTools = [
  {
    name: "get_dashboard_stats",
    description: "All dashboard metrics in one call: today's stats, 7-day trend, recent bookings, today's shows with occupancy. Mirrors the existing admin dashboard endpoint.",
    inputSchema: { cinema_hall_id: z.string().uuid().optional() },
    permission: "any",
    rateLimit: { capacity: 10, refillPerSec: 0.5 },
    handler: async (args) => {
      const client = apiClient({ hall_ids: args.cinema_hall_id ? [args.cinema_hall_id] : [] });
      const { data } = await client.get("/api/dashboard/stats");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_payment_orders",
    description: "Payment orders for a cinema hall with date range, status, and search filters. Paginated.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
      status: z.enum(["created", "paid", "failed", "expired"]).optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "any",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.from_date) params.set("from_date", args.from_date);
      if (args.to_date) params.set("to_date", args.to_date);
      if (args.status) params.set("status", args.status);
      if (args.search) params.set("search", args.search);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient({ hall_ids: [args.cinema_hall_id] });
      const { data } = await client.get(`/api/payment/admin/orders?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_refunds",
    description: "Refund records for a cinema hall, filterable by status and paginated.",
    inputSchema: {
      cinema_hall_id: z.string().uuid(),
      status: z.enum(["initiated", "processed", "failed"]).optional(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "any",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.from_date) params.set("from_date", args.from_date);
      if (args.to_date) params.set("to_date", args.to_date);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient({ hall_ids: [args.cinema_hall_id] });
      const { data } = await client.get(`/api/refunds?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_offers",
    description: "All discount offers/coupons. Supports filtering by scope, active status, and text search. SuperAdmin only.",
    inputSchema: {
      scope: z.enum(["global", "hall"]).optional(),
      is_active: z.boolean().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.scope) params.set("scope", args.scope);
      if (args.is_active !== undefined) params.set("is_active", String(args.is_active));
      if (args.search) params.set("search", args.search);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient();
      const { data } = await client.get(`/api/offers?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_active_ads",
    description: "Currently active advertisements by placement (banner or side). Public data.",
    inputSchema: {
      placement: z.enum(["banner", "side"]).optional(),
    },
    permission: "any",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async (args) => {
      const params = args.placement ? `?placement=${args.placement}` : "";
      const client = apiClient();
      const { data } = await client.get(`/api/ads/active${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_settings",
    description: "System-wide configuration: convenience fee per ticket and GST percentage. Public data.",
    inputSchema: {},
    permission: "any",
    rateLimit: { capacity: 30, refillPerSec: 2 },
    handler: async () => {
      const client = apiClient();
      const { data } = await client.get("/api/settings");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_admins",
    description: "All cinema hall admins with their hall details, paginated. SuperAdmin only.",
    inputSchema: {
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 10, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.search) params.set("search", args.search);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient();
      const { data } = await client.get(`/api/auth/admins?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_admin_audit_logs",
    description: "Security audit logs for a specific cinema admin. SuperAdmin only.",
    inputSchema: { admin_id: z.string().uuid() },
    permission: "superAdmin",
    rateLimit: { capacity: 10, refillPerSec: 0.5 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/auth/admins/${args.admin_id}/logs`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
];
