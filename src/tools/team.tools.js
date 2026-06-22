import { z } from "zod";
import { getOrgSettings, getHallSettings, listTeamMembers, listRolesPermissions } from "../db/readonly.js";

export const teamTools = [
  {
    name: "get_org_settings",
    description: "Fetch all configuration settings sections (general, payment, branding, etc.) for the caller's organization.",
    inputSchema: {},
    permission: "admin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const rows = await getOrgSettings(scope);
      const settings = {};
      rows.forEach((r) => {
        settings[r.section] = r.value;
      });
      return { content: [{ type: "text", text: JSON.stringify({ settings }) }] };
    },
  },
  {
    name: "get_hall_settings",
    description: "Fetch configuration settings (cinema_profile, showtimes, booking, offers) for a specific cinema hall.",
    inputSchema: { cinema_hall_id: z.string().uuid() },
    permission: "admin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const rows = await getHallSettings(args.cinema_hall_id, scope);
      const settings = {};
      rows.forEach((r) => {
        settings[r.section] = r.value;
      });
      return { content: [{ type: "text", text: JSON.stringify({ cinema_hall_id: args.cinema_hall_id, settings }) }] };
    },
  },
  {
    name: "list_team_members",
    description: "List all administrators and staff members in the caller's organization, including their assigned roles and status.",
    inputSchema: {},
    permission: "admin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const members = await listTeamMembers(scope);
      return { content: [{ type: "text", text: JSON.stringify({ members }) }] };
    },
  },
  {
    name: "list_roles_permissions",
    description: "List all roles and their associated permissions configured in the caller's organization.",
    inputSchema: {},
    permission: "admin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const roles = await listRolesPermissions(scope);
      return { content: [{ type: "text", text: JSON.stringify({ roles }) }] };
    },
  },
];
