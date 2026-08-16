# Cinemax MCP Server

Model Context Protocol (MCP) server for the Cinemax cinema booking platform. Provides **read-only** tools for AI assistants to query cinema, movie, show, booking, user, and analytics data.

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

Phase 1 provides **49 read-only tools** across 8 domains:

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

Team tools call the API (`/api/team`, `/api/roles`, `/api/settings/*`) rather than querying the database directly — those tables never received Row-Level Security policies (see `sql/02_rls_policies.sql`), so routing through the API's own org-membership checks is what actually scopes them.

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
│  (Claude,     │ <────────────────── │  (McpServer + 49   │ <─────────────── │  (Express 5  │
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
| 1 | Read-only tools (49 tools, DB + API) | ✅ Complete |
| 2 | Advanced analytics, caching, materialized views | 🔜 Planned |
| 3 | Admin management (CRUD via `prepare_`/`confirm_` pattern) | 🔜 Planned |
| 4 | Booking management (holds, confirms, refunds) | 🔜 Planned |
| 5 | AI-powered analytics (predictions, recommendations) | 🔜 Planned |
| 6 | Multi-cinema business intelligence | 🔜 Planned |
