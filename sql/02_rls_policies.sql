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

-- ============================================================================
-- cinema_hall
-- ============================================================================
ALTER TABLE cinema_hall ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY customers_select ON customers
  FOR SELECT TO cinemax_reader
  USING (cinemax_is_superadmin());

-- ============================================================================
-- cinema_admin_user (superAdmin only for non-admin rows)
-- ============================================================================
ALTER TABLE cinema_admin_user ENABLE ROW LEVEL SECURITY;

CREATE POLICY cinema_admin_user_select ON cinema_admin_user
  FOR SELECT TO cinemax_reader
  USING (cinemax_is_superadmin());

-- ============================================================================
-- offers & offer_redemptions
-- ============================================================================
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY offers_select ON offers
  FOR SELECT TO cinemax_reader
  USING (TRUE);  -- offers are public; RLS handled by tool-level permission

ALTER TABLE offer_redemptions ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY ads_select ON ads
  FOR SELECT TO cinemax_reader
  USING (TRUE);  -- ads are public

ALTER TABLE ad_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY ad_clicks_select ON ad_clicks
  FOR SELECT TO cinemax_reader
  USING (cinemax_is_superadmin());
