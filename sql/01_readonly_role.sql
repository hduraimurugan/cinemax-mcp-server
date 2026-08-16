-- ============================================================================
-- 01_readonly_role.sql
-- Creates a dedicated read-only PostgreSQL role for the MCP server.
-- Run this against your Neon (production) or local PostgreSQL database.
-- ============================================================================
-- Usage:
--   psql -U postgres -d cinema_hall_db -f 01_readonly_role.sql
--   (set :reader_password interactively or via environment)
-- ============================================================================

-- Create the role (set password interactively or via env)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'cinemax_reader') THEN
    CREATE ROLE cinemax_reader WITH LOGIN PASSWORD 'Durai1234' NOBYPASSRLS;
  END IF;
END
$$;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO cinemax_reader;

-- Grant SELECT on all existing tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cinemax_reader;

-- Ensure future tables are also readable
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cinemax_reader;

-- ============================================================================
-- Revoke sensitive tables (no token/password/OTP access)
-- ============================================================================
REVOKE SELECT ON admin_sessions FROM cinemax_reader;
REVOKE SELECT ON customer_sessions FROM cinemax_reader;
REVOKE SELECT ON admin_verification_tokens FROM cinemax_reader;
REVOKE SELECT ON admin_password_reset_tokens FROM cinemax_reader;
REVOKE SELECT ON otp_verifications FROM cinemax_reader;
REVOKE SELECT ON webhook_events FROM cinemax_reader;

-- Revoke sensitive columns on remaining user/admin tables
REVOKE SELECT (password) ON cinema_admin_user FROM cinemax_reader;
REVOKE SELECT (password) ON customers FROM cinemax_reader;

-- ============================================================================
-- Revoke RBAC/org tables that 02_rls_policies.sql does not cover.
--
-- GRANT SELECT ON ALL TABLES (above) handed cinemax_reader unrestricted read
-- access to these — no RLS policy exists for them, so a caller scoped to one
-- hall could read every organization's members, roles, and settings. The MCP
-- tools that used to read these directly (team.tools.js) now go through the
-- API instead, which enforces org membership; nothing in src/ should query
-- these tables directly going forward. Revoke access so that stays true.
--
-- organization_members is the one exception: server.js's boot-time
-- preflight (hasActiveMembership in src/db/readonly.js) reads it directly,
-- unscoped, to check whether MCP_SERVICE_TOKEN's admin has a membership row
-- before the server starts handling hall-scoped calls. It stays grantable;
-- everything it can expose (org_id/admin_id/role_id/status pairs, no
-- settings or permission payloads) is a narrower surface than the tables
-- below, and no tool-facing code path reads it.
-- ============================================================================
REVOKE SELECT ON organization_settings FROM cinemax_reader;
REVOKE SELECT ON hall_settings FROM cinemax_reader;
REVOKE SELECT ON user_settings FROM cinemax_reader;
REVOKE SELECT ON organizations FROM cinemax_reader;
REVOKE SELECT ON roles FROM cinemax_reader;
REVOKE SELECT ON permissions FROM cinemax_reader;
REVOKE SELECT ON role_permissions FROM cinemax_reader;
REVOKE SELECT ON hall_assignments FROM cinemax_reader;

-- ============================================================================
-- Verify the setup
-- ============================================================================
-- SELECT current_user;
-- SELECT table_catalog, table_schema, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE grantee = 'cinemax_reader'
-- ORDER BY table_name, privilege_type;
