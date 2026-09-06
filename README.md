# Cinemax MCP Server

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MCP SDK](https://img.shields.io/badge/MCP-SDK_%5E1.8-000000?logo=modelcontextprotocol&logoColor=white)](https://modelcontextprotocol.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-RLS-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Model Context Protocol (MCP) server for the Cinemax cinema booking platform. Provides mostly **read-only** tools for AI assistants to query cinema, movie, show, booking, user, analytics, and notification data — plus a small set of explicit, confirm-gated write tools for sending notifications.

> Part of the **[Cinema Hall Platform](../README.md)** — see also [cinema-hall-admin](../cinema-hall-admin) (admin panel), [cinema-hall-api](../cinema-hall-api) (backend), and [cinema-hall-users](../cinema-hall-users) (customer app).

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL database (read-only access recommended)
- Access to the Cinemax API

### Installation

```bash
cd cinemax-mcp-server
npm install
cp .env.example .env
```

Edit `.env`:
- Set `DATABASE_URL` to your PostgreSQL connection string (use the `cinemax_reader` role)
- Set `API_BASE_URL` to your Cinemax API endpoint
- Set `CINEMAX_MCP_API_KEY` to **your own** personal key — generate one from Settings > API Keys in the admin panel (or `POST /api/api-keys` while logged in). This is stdio-mode's one credential for the life of the process; HTTP mode instead reads a per-request `x-api-key` header, so it needs no key here at all.

### Run

```bash
# stdio mode (default) — for Claude Desktop, Cursor, Cline, OpenCode
npm start

# HTTP mode — for ChatGPT, OpenAI Agents, remote access
npm run start:http
```

## Running with AI Assistants

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cinemax": {
      "command": "node",
      "args": ["/path/to/cinemax-mcp-server/src/server.js"],
      "env": {
        "CINEMAX_MCP_API_KEY": "cmk_your_personal_key_here",
        "DATABASE_URL": "postgresql://cinemax_reader:...@host:5432/cinema_hall_db",
        "API_BASE_URL": "http://localhost:5000"
      }
    }
  }
}
```

### OpenCode / Cursor / Windsurf / Cline / Roo Code

Same stdio config format (see `examples/` for templates).

### ChatGPT / OpenAI Agents

Deploy with `MCP_TRANSPORT=http` and register `https://your-host:8787/mcp` with header `x-api-key: cmk_...`. Each teammate uses **their own** key here — a shared deployment naturally gives every caller their own Roles & Permissions, since the header is resolved per request (see Access Model below).

## Tools

Phase 1 provides **57 tools** (54 read-only + 3 confirm-gated write) across 9 domains:

| Domain | Tools | Description |
|---|---|---|
| Cinema | 6 | List halls (org-scoped, via API), list/get cinema halls (DB), screens, screen seat layout, hall KPIs |
| Movies | 5 | Catalog search, movie details, now showing/upcoming, movie stats |
| Shows | 5 | Schedule by date, show details, occupancy (with category breakdown), seat map, booking count |
| Bookings | 4 | Single booking lookup, filtered list, summary, daily trend |
| Users | 3 | Customer list, detail, booking history (superAdmin only) |
| Analytics | 9 | Daily/weekly/monthly collections, occupancy, utilization, revenue, movie/show/offer performance |
| Platform | 10 | Dashboard stats, payment orders, refunds (list + by booking), offers, ads (+ click log), settings, admins, audit logs |
| Team | 7 | Org/hall settings, team members (list + detail + hall assignments), roles/permissions (list + detail) |
| Notifications | 8 | Broadcasts (list + detail), unified auto-send activity feed, device-token metadata, org-wide audit log, **plus** `create_broadcast`/`announce_offer`/`announce_ad` — the only write tools in this server, each requiring `confirm: true` |

Team and Notifications tools call the API (`/api/team`, `/api/roles`, `/api/settings/*`, `/api/notifications/*`, `/api/audit-logs`) rather than querying the database directly — those tables never received Row-Level Security policies (see `sql/02_rls_policies.sql`), so routing through the API's own org-membership/permission checks is what actually scopes them.

See `docs/mcp_implementation_plan.md` for the complete tool catalog with input/output schemas.

## Database Setup

The `sql/` directory contains scripts to create the read-only role and RLS policies:

```bash
# 1. Create the cinemax_reader role
psql -U postgres -d cinema_hall_db -f sql/01_readonly_role.sql

# 2. Enable Row-Level Security for hall-scoped data access
psql -U postgres -d cinema_hall_db -f sql/02_rls_policies.sql
```

## Architecture

```
┌──────────────┐     stdio/HTTP      ┌────────────────────┐     DB / API      ┌──────────────┐
│  AI Assistant │ ──────────────────> │  cinemax-mcp-server │ ───────────────> │  Cinemax API │
│  (Claude,     │ <────────────────── │  (McpServer + 57   │ <─────────────── │  (Express 5  │
│   ChatGPT,    │     MCP results     │   tools + RLS)     │    SQL results   │  + PostgreSQL│
│   Cursor...)  │                     └────────────────────┘                  └──────────────┘
```

- **API key** → `GET /api/api-keys/context` → scope `{role, permissions, hall_ids, ...}`
- **Permission gate** checks the caller's real permission keys against each tool's requirement
- **Tool-level filtering** — a fresh `McpServer` is built per HTTP request (and once at stdio boot) registering only the tools the caller's permissions allow, so `tools/list` itself reflects what they can actually do
- **RLS policies** enforce hall-scoped reads at the database level for the tables they cover (cinema halls, screens, shows, bookings, payment orders, refunds, customers, admin users) — team/settings/role tables are read through the API instead, see the Tools table above
- **Hall-scope check** — HTTP-backed tools that take a `cinema_hall_id` verify it's inside the caller's actual authorized `hall_ids` (from their own hall assignments) before sending `X-Hall-Id`, rather than trusting whatever the model passes in
- **Rate limiter** prevents runaway agent loops

## Access Model — one credential per person, real permissions

Every admin (owner, admin, or any staff role — manager, finance, marketing, auditor, sales, ticket operator, or a custom role) can generate their own personal API key from **Settings > API Keys**. There is no shared "service" identity anymore: the MCP server resolves each key against `cinema-hall-api`'s own `GET /api/api-keys/context`, which returns exactly what that admin can do — their permission keys and the halls they're assigned to (with `read_only`/`full` scope) — resolved fresh from the database on every cache refresh (60s TTL), so a role edit or revocation takes effect within a minute, not "until the process restarts."

A key inherits its owner's permissions exactly — there's no narrower "read-only key" concept (yet); revoking access means revoking the key or editing the person's role. Because the server forwards the caller's own key to the API as `X-API-Key` on every request (instead of one shared token), `cinema-hall-api`'s own `requirePermission`/`requireActiveHall` middleware is the actual enforcement — the MCP layer's checks are a client-side mirror of the same rules, not a separate authority.

## Security

- Read-only PostgreSQL role (`cinemax_reader`) — no write capabilities (except the three explicit, `confirm: true`-gated notification tools, which call the API's own write endpoints)
- Row-Level Security enforces per-hall data isolation, fed the caller's real hall assignments
- Tool-level permission gate checked against real `cinema-hall-api` permission keys, not a coarse 3-tier role
- Parameterized SQL only — no raw query injection from tool arguments
- Sensitive columns (passwords, tokens, OTPs) explicitly revoked, along with the RBAC/settings tables that have no RLS policies (`organization_settings`, `hall_settings`, `user_settings`, `organizations`, `roles`, `permissions`, `role_permissions`, `hall_assignments`)
- An API key is a hashed, revocable, non-JWT credential (`admin_api_keys.token_hash`) — it cannot itself be used to mint or revoke other keys, so a leaked key can't be used to persist access past its own revocation
- All tool calls logged with scope, duration, and status

## Phase Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Read-only tools (54 tools, DB + API) | ✅ Complete |
| 1.5 | Notification write tools (`create_broadcast`, `announce_offer`, `announce_ad`, gated by `confirm: true`) | ✅ Complete |
| 1.6 | Per-user API keys + real Roles & Permissions (replacing the single shared service identity) | ✅ Complete |
| 2 | Advanced analytics, caching, materialized views | 🔜 Planned |
| 3 | Broader admin management (CRUD via `prepare_`/`confirm_` pattern) | 🔜 Planned |
| 4 | Booking management (holds, confirms, refunds) | 🔜 Planned |
| 5 | AI-powered analytics (predictions, recommendations) | 🔜 Planned |
| 6 | Multi-cinema business intelligence | 🔜 Planned |

## License

Licensed under the [MIT License](LICENSE).
