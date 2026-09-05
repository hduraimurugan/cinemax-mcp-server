# Cinemax MCP Server

Model Context Protocol (MCP) server for the Cinemax cinema booking platform. Provides mostly **read-only** tools for AI assistants to query cinema, movie, show, booking, user, analytics, and notification data — plus a small set of explicit, confirm-gated write tools for sending notifications.

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
- Set `CINEMAX_MCP_API_KEY` to a secure random key
- Set `API_BASE_URL` to your Cinemax API endpoint
- Set `MCP_SERVICE_TOKEN` to a cinema-admin JWT for the HTTP-backed tools. This admin **must be an active member of an organization** (`organization_members.status = 'active'`) — `requireActiveHall` on the API side requires org membership unconditionally, including for `superAdmin` tokens. The server checks this at boot and logs a warning if it's missing.

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
        "CINEMAX_MCP_API_KEY": "cmax_...",
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

Deploy with `MCP_TRANSPORT=http` and register `https://your-host:8787/mcp` with header `x-api-key: cmax_...`.

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

- **API key** → scope resolver → `{role, hall_ids}`
- **Permission gate** restricts superAdmin-only tools
- **RLS policies** enforce hall-scoped reads at the database level for the tables they cover (cinema halls, screens, shows, bookings, payment orders, refunds, customers, admin users) — team/settings/role tables are read through the API instead, see the Tools table above
- **Hall-scope check** — HTTP-backed tools that take a `cinema_hall_id` verify it's inside the caller's authorized `hall_ids` (or that the caller is superAdmin) before sending `X-Hall-Id`, rather than trusting whatever the model passes in
- **Rate limiter** prevents runaway agent loops

## Security

- Read-only PostgreSQL role (`cinemax_reader`) — no write capabilities
- Row-Level Security enforces per-hall data isolation
- Tool-level permission gate (admin vs superAdmin)
- Parameterized SQL only — no raw query injection from tool arguments
- Sensitive columns (passwords, tokens, OTPs) explicitly revoked, along with the RBAC/settings tables that have no RLS policies (`organization_settings`, `hall_settings`, `user_settings`, `organizations`, `roles`, `permissions`, `role_permissions`, `hall_assignments`) — `organization_members` is the one exception, kept readable only for the boot-time service-token preflight
- HTTP requests to the API carry `X-Org-Id` (from scope) alongside `X-Hall-Id`, ready for when `requireActiveOrg` is wired to routes on the API side
- All tool calls logged with scope, duration, and status

## Phase Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Read-only tools (54 tools, DB + API) | ✅ Complete |
| 1.5 | Notification write tools (`create_broadcast`, `announce_offer`, `announce_ad`, gated by `confirm: true`) | ✅ Complete |
| 2 | Advanced analytics, caching, materialized views | 🔜 Planned |
| 3 | Broader admin management (CRUD via `prepare_`/`confirm_` pattern) | 🔜 Planned |
| 4 | Booking management (holds, confirms, refunds) | 🔜 Planned |
| 5 | AI-powered analytics (predictions, recommendations) | 🔜 Planned |
| 6 | Multi-cinema business intelligence | 🔜 Planned |
