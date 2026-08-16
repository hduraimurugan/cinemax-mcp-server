import { z } from "zod";
import { apiClient, apiClientForHall } from "../api/client.js";

// These tools used to query organization_settings, hall_settings,
// organization_members, roles, and role_permissions directly over Postgres.
// None of those tables ever received RLS policies (sql/02_rls_policies.sql
// stops at cinema_admin_user), so a direct read was scoped by nothing but
// this file's own "admin" permission gate. The API's requirePermission
// middleware already enforces org membership + the team.manage/roles.read
// permission for every one of these routes, so routing through it closes
// that gap instead of re-deriving the same scoping logic in SQL.
export const teamTools = [
  {
    name: "get_org_settings",
    description: "Fetch all configuration settings sections (general, payment, branding, etc.) for the caller's organization.",
    inputSchema: {},
    permission: "admin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async () => {
      const client = apiClient();
      const { data } = await client.get("/api/settings/org");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_hall_settings",
    description: "Fetch configuration settings (cinema_profile, showtimes, booking, offers) for a specific cinema hall.",
    inputSchema: { cinema_hall_id: z.string().uuid() },
    permission: "admin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const client = apiClientForHall(scope, args.cinema_hall_id);
      const { data } = await client.get(`/api/settings/hall/${args.cinema_hall_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_team_members",
    description: "List administrators and staff members in the caller's organization, including their assigned roles and status. Supports text search and pagination.",
    inputSchema: {
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    },
    permission: "admin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.search) params.set("search", args.search);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient();
      const { data } = await client.get(`/api/team?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_team_member",
    description: "Full detail for one team member: role, contact info, ownership flag, and membership dates.",
    inputSchema: { member_id: z.string().uuid() },
    permission: "admin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/team/members/${args.member_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_member_halls",
    description: "Cinema halls a specific team member is assigned to, with their access scope (full or read_only) for each.",
    inputSchema: { member_id: z.string().uuid() },
    permission: "admin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/team/members/${args.member_id}/halls`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_roles_permissions",
    description: "List all roles and their associated permissions configured in the caller's organization.",
    inputSchema: {},
    permission: "admin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async () => {
      const client = apiClient();
      const { data } = await client.get("/api/roles");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_role",
    description: "Full detail for a single role: its permission list and how many members hold it.",
    inputSchema: { role_id: z.string().uuid() },
    permission: "admin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/roles/${args.role_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
];
