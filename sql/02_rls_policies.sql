-- ============================================================================
-- 02_rls_policies.sql
-- Row-Level Security policies for the cinemax_reader role.
-- These enforce that MCP tool queries can only see data belonging to the
-- cinema halls authorized for the caller's API key.
--
-- Session vars set by MCP server before each query:
--   SET LOCAL app.current_hall_ids = 'uuid1,uuid2,...';   (comma-separated UUIDs)
--   SET LOCAL app.scope_role = 'admin' | 'superAdmin';
--
-- SuperAdmin bypass: when app.scope_role = 'superAdmin', policies allow all rows.
-- ============================================================================

-- Helper function: parse comma-separated hall IDs
CREATE OR REPLACE FUNCTION cinemax_parse_hall_ids()
RETURNS uuid[] AS $$
BEGIN
  RETURN COALESCE(
    string_to_array(NULLIF(current_setting('app.current_hall_ids', true), ''), ',')::uuid[],
    '{}'::uuid[]
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: check if the current session is superAdmin
CREATE OR REPLACE FUNCTION cinemax_is_superadmin()
RETURNS boolean AS $$
BEGIN
  RETURN current_setting('app.scope_role', true) = 'superAdmin';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: parse organization IDs for authorized halls
CREATE OR REPLACE FUNCTION cinemax_parse_org_ids()
RETURNS uuid[] AS $$
DECLARE
  orgs uuid[];
BEGIN
  SELECT array_agg(DISTINCT org_id) INTO orgs
  FROM cinema_hall
  WHERE id = ANY(cinemax_parse_hall_ids());
  RETURN COALESCE(orgs, '{}'::uuid[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- cinema_hall
-- ============================================================================
ALTER TABLE cinema_hall ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cinema_hall_select ON cinema_hall;
CREATE POLICY cinema_hall_select ON cinema_hall
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR id = ANY(cinemax_parse_hall_ids())
  );

-- ============================================================================
-- screens
-- ============================================================================
ALTER TABLE screens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS screens_select ON screens;
CREATE POLICY screens_select ON screens
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR cinema_hall_id = ANY(cinemax_parse_hall_ids())
  );

-- ============================================================================
-- shows
-- ============================================================================
ALTER TABLE shows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shows_select ON shows;
CREATE POLICY shows_select ON shows
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR screen_id IN (
      SELECT id FROM screens WHERE cinema_hall_id = ANY(cinemax_parse_hall_ids())
    )
  );

-- ============================================================================
-- show_booked_seats
-- ============================================================================
ALTER TABLE show_booked_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS show_booked_seats_select ON show_booked_seats;
CREATE POLICY show_booked_seats_select ON show_booked_seats
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR show_id IN (
      SELECT s.id FROM shows s
      JOIN screens sc ON sc.id = s.screen_id
      WHERE sc.cinema_hall_id = ANY(cinemax_parse_hall_ids())
    )
  );

-- ============================================================================
-- bookings
-- ============================================================================
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_select ON bookings;
CREATE POLICY bookings_select ON bookings
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR show_id IN (
      SELECT s.id FROM shows s
      JOIN screens sc ON sc.id = s.screen_id
      WHERE sc.cinema_hall_id = ANY(cinemax_parse_hall_ids())
    )
  );

-- ============================================================================
-- payment_orders
-- ============================================================================
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_orders_select ON payment_orders;
CREATE POLICY payment_orders_select ON payment_orders
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR show_id IN (
      SELECT s.id FROM shows s
      JOIN screens sc ON sc.id = s.screen_id
      WHERE sc.cinema_hall_id = ANY(cinemax_parse_hall_ids())
    )
  );

-- ============================================================================
-- refunds
-- ============================================================================
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refunds_select ON refunds;
CREATE POLICY refunds_select ON refunds
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR booking_id IN (
      SELECT b.id FROM bookings b
      JOIN shows s ON s.id = b.show_id
      JOIN screens sc ON sc.id = s.screen_id
      WHERE sc.cinema_hall_id = ANY(cinemax_parse_hall_ids())
    )
  );

-- ============================================================================
-- customers (superAdmin only)
-- ============================================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select ON customers;
CREATE POLICY customers_select ON customers
  FOR SELECT TO cinemax_reader
  USING (cinemax_is_superadmin());

-- ============================================================================
-- cinema_admin_user (superAdmin or organization members only)
-- ============================================================================
ALTER TABLE cinema_admin_user ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cinema_admin_user_select ON cinema_admin_user;
CREATE POLICY cinema_admin_user_select ON cinema_admin_user
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR id IN (
      SELECT admin_id FROM organization_members WHERE org_id = ANY(cinemax_parse_org_ids())
    )
  );

-- ============================================================================
-- offers & offer_redemptions
-- ============================================================================
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offers_select ON offers;
CREATE POLICY offers_select ON offers
  FOR SELECT TO cinemax_reader
  USING (TRUE);  -- offers are public; RLS handled by tool-level permission

ALTER TABLE offer_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offer_redemptions_select ON offer_redemptions;
CREATE POLICY offer_redemptions_select ON offer_redemptions
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR offer_id IN (
      SELECT id FROM offers WHERE cinema_hall_id IS NULL
      OR cinema_hall_id = ANY(cinemax_parse_hall_ids())
    )
  );

-- ============================================================================
-- ads & ad_clicks
-- ============================================================================
ALTER TABLE ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_select ON ads;
CREATE POLICY ads_select ON ads
  FOR SELECT TO cinemax_reader
  USING (TRUE);  -- ads are public

ALTER TABLE ad_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_clicks_select ON ad_clicks;
CREATE POLICY ad_clicks_select ON ad_clicks
  FOR SELECT TO cinemax_reader
  USING (cinemax_is_superadmin());

-- ============================================================================
-- organizations
-- ============================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR id = ANY(cinemax_parse_org_ids())
  );

-- ============================================================================
-- organization_settings
-- ============================================================================
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_settings_select ON organization_settings;
CREATE POLICY organization_settings_select ON organization_settings
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR org_id = ANY(cinemax_parse_org_ids())
  );

-- ============================================================================
-- hall_settings
-- ============================================================================
ALTER TABLE hall_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hall_settings_select ON hall_settings;
CREATE POLICY hall_settings_select ON hall_settings
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR hall_id = ANY(cinemax_parse_hall_ids())
  );

-- ============================================================================
-- user_settings
-- ============================================================================
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_select ON user_settings;
CREATE POLICY user_settings_select ON user_settings
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR admin_id IN (
      SELECT admin_id FROM organization_members WHERE org_id = ANY(cinemax_parse_org_ids())
    )
  );

-- ============================================================================
-- roles
-- ============================================================================
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR org_id = ANY(cinemax_parse_org_ids())
  );

-- ============================================================================
-- permissions
-- ============================================================================
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permissions_select ON permissions;
CREATE POLICY permissions_select ON permissions
  FOR SELECT TO cinemax_reader
  USING (TRUE);

-- ============================================================================
-- role_permissions
-- ============================================================================
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_permissions_select ON role_permissions;
CREATE POLICY role_permissions_select ON role_permissions
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR role_id IN (
      SELECT id FROM roles WHERE org_id = ANY(cinemax_parse_org_ids())
    )
  );

-- ============================================================================
-- organization_members
-- ============================================================================
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_members_select ON organization_members;
CREATE POLICY organization_members_select ON organization_members
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR org_id = ANY(cinemax_parse_org_ids())
  );

-- ============================================================================
-- hall_assignments
-- ============================================================================
ALTER TABLE hall_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hall_assignments_select ON hall_assignments;
CREATE POLICY hall_assignments_select ON hall_assignments
  FOR SELECT TO cinemax_reader
  USING (
    cinemax_is_superadmin()
    OR hall_id = ANY(cinemax_parse_hall_ids())
    OR org_member_id IN (
      SELECT id FROM organization_members WHERE org_id = ANY(cinemax_parse_org_ids())
    )
  );
