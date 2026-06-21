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

Phase 1 provides **36 read-only tools** across 7 domains:

| Domain | Tools | Description |
|---|---|---|
| Cinema | 4 | List/get halls, screens, hall KPIs |
| Movies | 5 | Catalog search, movie details, now showing/upcoming, movie stats |
| Shows | 4 | Schedule by date, show details, occupancy, booking count |
| Bookings | 4 | Single booking lookup, filtered list, summary, daily trend |
| Users | 3 | Customer list, detail, booking history (superAdmin only) |
| Analytics | 8 | Daily/weekly/monthly collections, occupancy, utilization, revenue, movie/show performance |
| Platform | 8 | Dashboard stats, payment orders, refunds, offers, ads, settings, admins, audit logs |

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
│  (Claude,     │ <────────────────── │  (McpServer + 36   │ <─────────────── │  (Express 5  │
│   ChatGPT,    │     MCP results     │   tools + RLS)     │    SQL results   │  + PostgreSQL│
│   Cursor...)  │                     └────────────────────┘                  └──────────────┘
```

- **API key** → scope resolver → `{role, hall_ids}`
- **Permission gate** restricts superAdmin-only tools
- **RLS policies** enforce hall-scoped reads at the database level
- **Rate limiter** prevents runaway agent loops

## Security

- Read-only PostgreSQL role (`cinemax_reader`) — no write capabilities
- Row-Level Security enforces per-hall data isolation
- Tool-level permission gate (admin vs superAdmin)
- Parameterized SQL only — no raw query injection from tool arguments
- Sensitive columns (passwords, tokens, OTPs) explicitly revoked
- All tool calls logged with scope, duration, and status

## Phase Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Read-only tools (36 tools, DB + API) | ✅ Complete |
| 2 | Advanced analytics, caching, materialized views | 🔜 Planned |
| 3 | Admin management (CRUD via `prepare_`/`confirm_` pattern) | 🔜 Planned |
| 4 | Booking management (holds, confirms, refunds) | 🔜 Planned |
| 5 | AI-powered analytics (predictions, recommendations) | 🔜 Planned |
| 6 | Multi-cinema business intelligence | 🔜 Planned |
