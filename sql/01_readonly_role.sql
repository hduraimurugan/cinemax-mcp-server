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
    CREATE ROLE cinemax_reader WITH LOGIN PASSWORD 'Durai@1234' NOBYPASSRLS;
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
-- Verify the setup
-- ============================================================================
-- SELECT current_user;
-- SELECT table_catalog, table_schema, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE grantee = 'cinemax_reader'
-- ORDER BY table_name, privilege_type;
