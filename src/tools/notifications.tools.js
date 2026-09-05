import { z } from "zod";
import { apiClient } from "../api/client.js";

const dateStr = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const channelsSchema = () => z.array(z.enum(["push", "email"])).optional();

// Broadcast sends are synchronous end-to-end server-side (sequential
// per-recipient DB writes + live FCM/SMTP calls, no batching), so they can
// legitimately take much longer than a typical read — hence the longer
// timeout write tools use below instead of the 10s default.
const WRITE_TIMEOUT_MS = 45000;
// How far back to look when recovering from a client-side timeout: the
// server doesn't cancel work on client disconnect, so a "timed out" call may
// well have completed moments later.
const TIMEOUT_RECOVERY_WINDOW_MS = 5 * 60 * 1000;

async function fetchBroadcastDetail(client, broadcastId) {
  const { data } = await client.get(`/api/notifications/broadcast/${broadcastId}`);
  return data;
}

// After a client-side timeout (ECONNABORTED), look up whether the broadcast
// actually went through anyway, instead of letting the caller assume it
// failed. `source` narrows the search (manual/offer/ad) and `match` picks
// the specific row out of the recent list.
async function recoverBroadcastAfterTimeout(client, { source, match }) {
  const { data } = await client.get(`/api/notifications/broadcast?source=${source}`);
  const cutoff = Date.now() - TIMEOUT_RECOVERY_WINDOW_MS;
  const candidate = (data.broadcasts || [])
    .filter((b) => new Date(b.created_at).getTime() >= cutoff && match(b))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (!candidate) return null;
  return fetchBroadcastDetail(client, candidate.id);
}

// Read tools call the API rather than the database directly — admin_broadcasts,
// notifications, notification_dispatch_log, device_tokens, and audit_logs never
// received grants/RLS policies (see sql/01_readonly_role.sql, sql/02_rls_policies.sql),
// so the API's own superAdmin/audit.view checks are what actually scope them
// (same rationale as team.tools.js).
//
// Write tools are a deliberate departure from this server's Phase 1 read-only
// design: they send real push/email/in-app notifications to real users. Each
// requires `confirm: true` as a required literal input — omitting it (or
// passing false) fails schema validation before the handler ever runs, so a
// model can't trigger a send without an explicit, conscious opt-in.
export const notificationsTools = [
  {
    name: "list_broadcasts",
    description: "List Super Admin broadcasts (manual sends, or auto-generated from offer/ad announcements). Filterable by source. SuperAdmin only.",
    inputSchema: {
      source: z.enum(["manual", "offer", "ad", "all"]).optional(),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = args.source ? `?source=${args.source}` : "";
      const client = apiClient();
      const { data } = await client.get(`/api/notifications/broadcast${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_broadcast",
    description: "Full detail for one broadcast, including its per-recipient dispatch log (channel, status, error). SuperAdmin only.",
    inputSchema: { broadcast_id: z.string().uuid() },
    permission: "superAdmin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/notifications/broadcast/${args.broadcast_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_notification_activity",
    description: "Unified feed of everything the system sent on its own: offer/ad announcements plus individual event notifications (booking_confirmed, show_reminder, refund_*, ...). Paginated, 50 per page. SuperAdmin only.",
    inputSchema: {
      source: z.enum(["all", "offer", "ad", "event"]).optional(),
      event: z.string().optional(),
      status: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.source) params.set("source", args.source);
      if (args.event) params.set("event", args.event);
      if (args.status) params.set("status", args.status);
      params.set("page", String(args.page));

      const client = apiClient();
      const { data } = await client.get(`/api/notifications/activity?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "get_device_tokens",
    description: "Registered push-device metadata (platform, last seen, registered date) for one customer or admin. Never returns the raw device token. Powers the 'pick specific devices' step of the broadcast composer. SuperAdmin only.",
    inputSchema: {
      type: z.enum(["customer", "admin"]),
      id: z.string().uuid(),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args) => {
      const client = apiClient();
      const { data } = await client.get(`/api/notifications/device-tokens?type=${args.type}&id=${args.id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "list_audit_logs",
    description: "Org-wide audit trail of admin actions (who did what, to which resource, when), filterable by admin, action, resource type, hall, and date range. Paginated. Broader than get_admin_audit_logs, which only covers one admin's security log. SuperAdmin only.",
    inputSchema: {
      org_id: z.string().uuid().optional(),
      admin_id: z.string().uuid().optional(),
      resource_type: z.string().optional(),
      action: z.string().optional(),
      hall_id: z.string().uuid().optional(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.org_id) params.set("orgId", args.org_id);
      if (args.admin_id) params.set("adminId", args.admin_id);
      if (args.resource_type) params.set("resourceType", args.resource_type);
      if (args.action) params.set("action", args.action);
      if (args.hall_id) params.set("hallId", args.hall_id);
      if (args.from_date) params.set("from_date", args.from_date);
      if (args.to_date) params.set("to_date", args.to_date);
      params.set("page", String(args.page));
      params.set("limit", String(args.limit));

      const client = apiClient();
      const { data } = await client.get(`/api/audit-logs?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  },
  {
    name: "create_broadcast",
    description:
      "Send a new Super Admin broadcast (push/email/in-app) to all customers, all admins, a hall's customers, or a custom recipient list. Mirrors the admin 'New Notification' composer. " +
      "SIDE-EFFECTING — sends real notifications to real users. " +
      "Before calling this tool, ask the user for every field below one at a time (or as a group) — do not invent a title, message, audience, or delivery timing on their behalf: " +
      "(1) Title, (2) Message body, (3) an optional image URL, (4) which channels beyond in-app (push, email, or both — in-app always fires), " +
      "(5) audience (all customers / all admins / a specific hall's customers, which needs cinema_hall_id / a custom pick of specific customer_ids and admin_ids), " +
      "and (6) whether to send now or schedule for later (scheduled_for). If this notification is about a specific movie, offer, or ad, look up its poster/image first " +
      "(get_movie, list_movies, list_offers, list_active_ads) and offer to use it as image_url rather than sending without one. " +
      "Only pass confirm: true once the user has supplied and confirmed these choices. The response includes the full per-recipient delivery breakdown, not just totals. SuperAdmin only.",
    inputSchema: {
      confirm: z.literal(true).describe("Set true only after the user has explicitly reviewed and approved the title, message, audience, channels, and delivery timing below."),
      title: z.string().min(1).describe("Notification title. Ask the user for this — do not invent it."),
      body: z.string().min(1).describe("Notification message body. Ask the user for this — do not invent it."),
      image_url: z.string().optional().describe("Optional image URL for the notification. Ask the user if they want one; omit if they don't."),
      audience_type: z
        .enum(["all_customers", "all_admins", "custom", "hall_customers"])
        .describe("Who receives this. Ask the user to pick one: all_customers, all_admins, hall_customers (a specific hall's customers — needs cinema_hall_id), or custom (specific people — needs customer_ids and/or admin_ids)."),
      customer_ids: z.array(z.string().uuid()).optional().describe("Required (at least one, along with/instead of admin_ids) when audience_type is 'custom'. Ask the user which customers."),
      admin_ids: z.array(z.string().uuid()).optional().describe("Required (at least one, along with/instead of customer_ids) when audience_type is 'custom'. Ask the user which admins."),
      cinema_hall_id: z.string().uuid().optional().describe("Required when audience_type is 'hall_customers'. Ask the user which cinema hall."),
      channels: channelsSchema().describe("Delivery channels in addition to in-app (which always fires): push, email, both, or neither. Ask the user which they want; defaults to push if omitted."),
      scheduled_for: z.string().optional().describe("ISO datetime to schedule the send for later. Ask the user 'send now, or schedule for a specific time?' — omit this field entirely for send-now."),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 3, refillPerSec: 0.05 },
    handler: async (args) => {
      const body = {
        title: args.title,
        body: args.body,
        imageUrl: args.image_url,
        audienceType: args.audience_type,
        customerIds: args.customer_ids,
        adminIds: args.admin_ids,
        cinemaHallId: args.cinema_hall_id,
        channels: args.channels,
        scheduledFor: args.scheduled_for,
      };

      const client = apiClient(undefined, { timeout: WRITE_TIMEOUT_MS });
      try {
        const { data } = await client.post("/api/notifications/broadcast", body);
        const detail = await fetchBroadcastDetail(client, data.broadcast.id);
        return { content: [{ type: "text", text: JSON.stringify(detail) }] };
      } catch (err) {
        if (err.code !== "ECONNABORTED") throw err;
        const recovered = await recoverBroadcastAfterTimeout(client, {
          source: "manual",
          match: (b) => b.title === args.title,
        });
        if (recovered) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                note: "The request timed out waiting for a response, but the server doesn't cancel work on client disconnect — this broadcast completed anyway (found by looking it up afterward). Do not resend.",
                ...recovered,
              }),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: "The request timed out and no matching broadcast was found afterward — the outcome is unknown. Check list_broadcasts before retrying, to avoid a possible duplicate send.",
          }],
          isError: true,
        };
      }
    },
  },
  {
    name: "announce_offer",
    description:
      "Re-send the 'Announce' notification for an existing offer (push/email/in-app promo blast). If title/body are omitted, the API fills in sensible defaults from the offer itself. " +
      "SIDE-EFFECTING — sends real notifications to real users. Before calling, confirm with the user which offer, which channels (in-app always fires; ask about push/email), " +
      "and whether they want custom title/body text or the offer's default wording. Only pass confirm: true once approved. SuperAdmin only.",
    inputSchema: {
      confirm: z.literal(true).describe("Set true only after the user has approved sending this announcement."),
      offer_id: z.string().uuid().describe("The offer to announce. Ask the user which offer if not already clear."),
      channels: channelsSchema().describe("Delivery channels in addition to in-app (which always fires): push, email, both, or neither. Ask the user which they want."),
      title: z.string().optional().describe("Custom title; ask the user if they want to override the offer's default announcement title."),
      body: z.string().optional().describe("Custom message; ask the user if they want to override the offer's default announcement text."),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 3, refillPerSec: 0.05 },
    handler: async (args) => {
      const client = apiClient(undefined, { timeout: WRITE_TIMEOUT_MS });
      try {
        const { data } = await client.post(`/api/offers/${args.offer_id}/announce`, {
          channels: args.channels,
          title: args.title,
          body: args.body,
        });
        const detail = await fetchBroadcastDetail(client, data.broadcast.id);
        return { content: [{ type: "text", text: JSON.stringify(detail) }] };
      } catch (err) {
        if (err.code !== "ECONNABORTED") throw err;
        const recovered = await recoverBroadcastAfterTimeout(client, {
          source: "offer",
          match: (b) => b.origin_id === args.offer_id,
        });
        if (recovered) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                note: "The request timed out waiting for a response, but the server doesn't cancel work on client disconnect — this announcement completed anyway (found by looking it up afterward). Do not resend.",
                ...recovered,
              }),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: "The request timed out and no matching announcement was found afterward — the outcome is unknown. Check list_broadcasts (source: offer) before retrying, to avoid a possible duplicate send.",
          }],
          isError: true,
        };
      }
    },
  },
  {
    name: "announce_ad",
    description:
      "Re-send the 'Announce' notification for an existing advertisement (push/email/in-app blast). If title/body are omitted, the API fills in sensible defaults from the ad itself. " +
      "SIDE-EFFECTING — sends real notifications to real users. Before calling, confirm with the user which ad, which channels (in-app always fires; ask about push/email), " +
      "and whether they want custom title/body text or the ad's default wording. Only pass confirm: true once approved. SuperAdmin only.",
    inputSchema: {
      confirm: z.literal(true).describe("Set true only after the user has approved sending this announcement."),
      ad_id: z.string().uuid().describe("The advertisement to announce. Ask the user which ad if not already clear."),
      channels: channelsSchema().describe("Delivery channels in addition to in-app (which always fires): push, email, both, or neither. Ask the user which they want."),
      title: z.string().optional().describe("Custom title; ask the user if they want to override the ad's default announcement title."),
      body: z.string().optional().describe("Custom message; ask the user if they want to override the ad's default announcement text."),
    },
    permission: "superAdmin",
    rateLimit: { capacity: 3, refillPerSec: 0.05 },
    handler: async (args) => {
      const client = apiClient(undefined, { timeout: WRITE_TIMEOUT_MS });
      try {
        const { data } = await client.post(`/api/ads/${args.ad_id}/announce`, {
          channels: args.channels,
          title: args.title,
          body: args.body,
        });
        const detail = await fetchBroadcastDetail(client, data.broadcast.id);
        return { content: [{ type: "text", text: JSON.stringify(detail) }] };
      } catch (err) {
        if (err.code !== "ECONNABORTED") throw err;
        const recovered = await recoverBroadcastAfterTimeout(client, {
          source: "ad",
          match: (b) => b.origin_id === args.ad_id,
        });
        if (recovered) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                note: "The request timed out waiting for a response, but the server doesn't cancel work on client disconnect — this announcement completed anyway (found by looking it up afterward). Do not resend.",
                ...recovered,
              }),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: "The request timed out and no matching announcement was found afterward — the outcome is unknown. Check list_broadcasts (source: ad) before retrying, to avoid a possible duplicate send.",
          }],
          isError: true,
        };
      }
    },
  },
];
