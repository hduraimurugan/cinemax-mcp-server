import { Pool, types } from "pg";
import { env } from "../config/index.js";
import logger from "../logging/logger.js";

// Parse PostgreSQL DATE type (OID 1082) as plain string instead of JS Date object
// to prevent timezone shifting issues when serializing to JSON.
types.setTypeParser(1082, (val) => val);


const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
});

pool.on("error", (err) => {
  logger.error({ err: err.message }, "Read-only PG pool error");
});

export async function query(sql, params = [], scope = { hall_ids: [], role: "admin" }) {
  const client = await pool.connect();
  try {
    const hallIds = scope.hall_ids.length > 0 ? scope.hall_ids : [""];
    await client.query("SELECT set_config('app.current_hall_ids', $1, false)", [hallIds.join(",")]);
    await client.query("SELECT set_config('app.scope_role', $1, false)", [scope.role]);
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function queryTx(sqls, scope) {
  const client = await pool.connect();
  try {
    const hallIds = scope.hall_ids.length > 0 ? scope.hall_ids : [""];
    await client.query("SELECT set_config('app.current_hall_ids', $1, false)", [hallIds.join(",")]);
    await client.query("SELECT set_config('app.scope_role', $1, false)", [scope.role]);
    const results = [];
    for (const { text, values } of sqls) {
      const result = await client.query(text, values);
      results.push(result.rows);
    }
    return results;
  } finally {
    client.release();
  }
}

export async function queryOne(sql, params, scope) {
  const rows = await query(sql, params, scope);
  return rows.length > 0 ? rows[0] : null;
}

// Boot-time check only — not scoped to any caller, so it bypasses the
// set_config()/RLS dance every other query here goes through. Used to warn
// early if MCP_SERVICE_TOKEN's admin lacks the org membership that
// requireActiveHall now requires unconditionally (see server.js).
export async function hasActiveMembership(adminId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM organization_members WHERE admin_id = $1 AND status = 'active' LIMIT 1`,
    [adminId],
  );
  return rows.length > 0;
}

// Occupancy % for a show, weighted against real seat capacity (screens.layout),
// not against COUNT(*) of show_booked_seats. That table is sparse — a row only
// exists once a seat is held or booked — so using its row count as the
// denominator reports ~100% occupancy for a show where 3 of 360 seats sold.
// Embedded as a joinable subquery so existing GROUP BY / AVG() call sites
// keep their shape; only the occupancy source changes.
const OCCUPANCY_SUBQUERY = `
  (SELECT sbs.show_id,
     COUNT(*) FILTER (WHERE sbs.status = 'BOOKED')::numeric
     / NULLIF(cap.capacity, 0) * 100 AS occupancy
   FROM show_booked_seats sbs
   JOIN shows sh2 ON sh2.id = sbs.show_id
   JOIN screens sc2 ON sc2.id = sh2.screen_id
   CROSS JOIN LATERAL (
     SELECT COUNT(*)::int AS capacity
     FROM jsonb_array_elements(sc2.layout->'seats') seat
     WHERE (seat->>'isBlocked')::boolean IS NOT TRUE
   ) cap
   GROUP BY sbs.show_id, cap.capacity)`;

export const listCinemas = (scope, onlyActive) =>
  query(
    `SELECT ch.*,
       (SELECT COUNT(*) FROM screens WHERE cinema_hall_id = ch.id)::int AS screens_count
     FROM cinema_hall ch
     WHERE ($1::bool IS NULL OR ch.is_active = $1)
     ORDER BY ch.name`,
    [onlyActive ?? null],
    scope,
  );

export const getCinema = (id, scope) =>
  queryOne(
    `SELECT ch.*,
       (SELECT COUNT(*) FROM screens WHERE cinema_hall_id = ch.id)::int AS screens_count,
       (SELECT COUNT(*) FROM shows s
        JOIN screens sc ON sc.id = s.screen_id
        WHERE sc.cinema_hall_id = ch.id AND s.show_date = CURRENT_DATE)::int AS shows_today
     FROM cinema_hall ch WHERE ch.id = $1`,
    [id],
    scope,
  );

export const listScreens = (hallId, scope) =>
  query(
    `SELECT id, name, total_seats, premium_seats, gold_seats, silver_seats,
            premium_price, gold_price, silver_price, rows, columns,
            screen_position, created_at,
            layout->'aisleAfterColumns' AS aisle_after_columns,
            layout->'aisleAfterRows' AS aisle_after_rows
     FROM screens WHERE cinema_hall_id = $1 ORDER BY name`,
    [hallId],
    scope,
  );

// Full seat-level layout for one screen — aisle configuration, screen
// position, and every seat's row/column/type/price/isBlocked. `listScreens`
// deliberately omits this (it's the per-hall list view); this is the detail
// view for rendering or reasoning about a specific screen's floor plan.
export const getScreenLayout = (screenId, scope) =>
  queryOne(
    `SELECT sc.id, sc.name, sc.cinema_hall_id, sc.rows, sc.columns,
            sc.screen_position,
            sc.layout->'aisleAfterColumns' AS aisle_after_columns,
            sc.layout->'aisleAfterRows' AS aisle_after_rows,
            sc.layout->'seats' AS seats
     FROM screens sc WHERE sc.id = $1`,
    [screenId],
    scope,
  );

// Resolve the cinema_hall_id a booking belongs to, so a caller who only has
// a booking_id can still send the required X-Hall-Id header to the API.
// Runs under the same RLS scope as every other read here, so a booking
// outside the caller's authorized halls resolves to nothing rather than
// leaking which hall it belongs to.
export const resolveHallForBooking = (bookingId, scope) =>
  queryOne(
    `SELECT sc.cinema_hall_id
     FROM bookings b
     JOIN shows sh ON sh.id = b.show_id
     JOIN screens sc ON sc.id = sh.screen_id
     WHERE b.id = $1`,
    [bookingId],
    scope,
  );

// Same as resolveHallForBooking, but starting from a show_id.
export const resolveHallForShow = (showId, scope) =>
  queryOne(
    `SELECT sc.cinema_hall_id
     FROM shows sh
     JOIN screens sc ON sc.id = sh.screen_id
     WHERE sh.id = $1`,
    [showId],
    scope,
  );

// Per-seat status for one show: real row||column label, seat type, and
// current status (BOOKED/HELD if touched, else AVAILABLE). Built from the
// screen's layout as the source of truth for seat existence, left-joined
// against show_booked_seats — mirrors how SeatSelectionPage.jsx renders
// the live seat map, but read-only and via MCP.
export const getShowSeatMap = (showId, scope) =>
  query(
    `SELECT
       seat->>'id' AS seat_id,
       (seat->>'row') || (seat->>'column') AS label,
       seat->>'row' AS row,
       (seat->>'column')::int AS column,
       seat->>'type' AS seat_type,
       COALESCE((seat->>'isBlocked')::boolean, FALSE) AS is_blocked,
       COALESCE(sbs.status, 'AVAILABLE') AS status
     FROM shows sh
     JOIN screens sc ON sc.id = sh.screen_id
     CROSS JOIN LATERAL jsonb_array_elements(sc.layout->'seats') AS seat
     LEFT JOIN show_booked_seats sbs
       ON sbs.show_id = sh.id AND sbs.seat_id = seat->>'id'
     WHERE sh.id = $1
     ORDER BY seat->>'row', (seat->>'column')::int`,
    [showId],
    scope,
  );

export const getDailyCollections = (hallId, from, to, scope) =>
  query(
    `SELECT gs.date::date AS date,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(SUM(b.convenience_fee), 0)::numeric(10,2) AS convenience_fee,
       COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst,
       COALESCE(SUM(b.discount_amount), 0)::numeric(10,2) AS total_discount,
       COUNT(b.id) FILTER (WHERE b.offer_code IS NOT NULL)::int AS bookings_with_offer,
       COUNT(b.id)::int AS bookings_count
     FROM generate_series($2::date, $3::date, '1 day') gs(date)
     LEFT JOIN shows sh ON sh.show_date = gs.date
       AND sh.screen_id IN (SELECT id FROM screens WHERE cinema_hall_id = $1)
     LEFT JOIN bookings b ON b.show_id = sh.id AND b.booking_status = 'confirmed'
     GROUP BY gs.date
     ORDER BY gs.date`,
    [hallId, from, to],
    scope,
  );

export const getWeeklyCollections = (hallId, from, to, scope) =>
  query(
    `SELECT DATE_TRUNC('week', gs.date)::date AS week_start,
       (DATE_TRUNC('week', gs.date) + INTERVAL '6 days')::date AS week_end,
       'Week ' || TO_CHAR(gs.date, 'IW') AS label,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(SUM(b.discount_amount), 0)::numeric(10,2) AS total_discount,
       COUNT(b.id)::int AS bookings_count
     FROM generate_series($2::date, $3::date, '1 day') gs(date)
     LEFT JOIN shows sh ON sh.show_date = gs.date
       AND sh.screen_id IN (SELECT id FROM screens WHERE cinema_hall_id = $1)
     LEFT JOIN bookings b ON b.show_id = sh.id AND b.booking_status = 'confirmed'
     GROUP BY DATE_TRUNC('week', gs.date)
     ORDER BY week_start`,
    [hallId, from, to],
    scope,
  );

export const getMonthlyCollections = (hallId, year, scope) =>
  query(
    `SELECT EXTRACT(MONTH FROM sh.show_date)::int AS month,
       EXTRACT(YEAR FROM sh.show_date)::int AS year,
       COUNT(b.id)::int AS bookings_count,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(SUM(b.convenience_fee), 0)::numeric(10,2) AS convenience_fee,
       COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst,
       COALESCE(SUM(b.discount_amount), 0)::numeric(10,2) AS total_discount
     FROM shows sh
     JOIN screens sc ON sc.id = sh.screen_id
     LEFT JOIN bookings b ON b.show_id = sh.id AND b.booking_status = 'confirmed'
     WHERE sc.cinema_hall_id = $1 AND EXTRACT(YEAR FROM sh.show_date) = $2
     GROUP BY year, month
     ORDER BY year, month`,
    [hallId, year],
    scope,
  );

export const getHallOccupancy = (hallId, date, scope) =>
  query(
    `SELECT sh.id AS show_id, m.title AS movie_title, sc.name AS screen_name,
       sh.start_time::text, sh.end_time::text, sh.status,
       (SELECT COUNT(*) FROM jsonb_array_elements(sc.layout->'seats') s
        WHERE (s->>'isBlocked')::boolean IS NOT TRUE)::int AS total_seats,
       (SELECT COUNT(*) FROM show_booked_seats
        WHERE show_id = sh.id AND status = 'BOOKED')::int AS booked_seats
     FROM shows sh
     JOIN movies m ON m.id = sh.movie_id
     JOIN screens sc ON sc.id = sh.screen_id
     WHERE sc.cinema_hall_id = $1 AND sh.show_date = $2
     ORDER BY sh.start_time`,
    [hallId, date],
    scope,
  );

export const getSeatUtilization = (hallId, from, to, scope) =>
  query(
    `WITH seat_stats AS (
       SELECT sc.name AS screen_name,
         (SELECT COUNT(*) FROM jsonb_array_elements(sc.layout->'seats') s
          WHERE (s->>'isBlocked')::boolean IS NOT TRUE)::int AS capacity,
         (SELECT COUNT(*) FROM shows WHERE screen_id = sc.id
          AND show_date BETWEEN $2 AND $3)::int AS shows_count,
         (SELECT COUNT(*) FROM show_booked_seats sbs
          JOIN shows s ON s.id = sbs.show_id
          WHERE s.screen_id = sc.id AND s.show_date BETWEEN $2 AND $3
          AND sbs.status = 'BOOKED')::int AS booked
       FROM screens sc WHERE sc.cinema_hall_id = $1
     )
     SELECT screen_name, capacity, shows_count, booked,
       ROUND(booked::numeric / NULLIF(capacity * shows_count, 0) * 100, 1) AS utilization_pct
     FROM seat_stats`,
    [hallId, from, to],
    scope,
  );

export const getMoviePerformance = (hallId, from, to, scope) =>
  query(
    `SELECT m.id AS movie_id, m.title, m.poster_url, m.genre,
       COUNT(DISTINCT sh.id)::int AS shows_count,
       COUNT(b.id)::int AS bookings,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(
         ROUND(AVG(occ.occupancy), 1), 0
       ) AS avg_occupancy_pct
     FROM movies m
     JOIN shows sh ON sh.movie_id = m.id
     JOIN screens sc ON sc.id = sh.screen_id
     LEFT JOIN bookings b ON b.show_id = sh.id AND b.booking_status = 'confirmed'
     LEFT JOIN ${OCCUPANCY_SUBQUERY} occ ON occ.show_id = sh.id
     WHERE sc.cinema_hall_id = $1 AND sh.show_date BETWEEN $2 AND $3
     GROUP BY m.id, m.title, m.poster_url, m.genre
     ORDER BY revenue DESC`,
    [hallId, from, to],
    scope,
  );

export const getShowOccupancy = (showId, scope) =>
  queryOne(
    `SELECT sh.id AS show_id, m.title AS movie_title, sc.name AS screen_name,
       sh.show_date::text, sh.start_time::text, sh.end_time::text,
       (SELECT COUNT(*) FROM jsonb_array_elements(sc.layout->'seats') s
        WHERE (s->>'isBlocked')::boolean IS NOT TRUE)::int AS total_seats,
       (SELECT COUNT(*) FROM show_booked_seats WHERE show_id = $1 AND status = 'BOOKED')::int AS booked_seats,
       (SELECT COALESCE(json_agg(cat), '[]'::json) FROM (
          SELECT
            s->>'type' AS seat_type,
            COUNT(*)::int AS total_seats,
            COUNT(*) FILTER (
              WHERE (s->>'id') IN (
                SELECT seat_id FROM show_booked_seats WHERE show_id = $1 AND status = 'BOOKED'
              )
            )::int AS booked_seats
          FROM jsonb_array_elements(sc.layout->'seats') s
          WHERE (s->>'isBlocked')::boolean IS NOT TRUE
          GROUP BY s->>'type'
        ) cat
       ) AS by_category
     FROM shows sh
     JOIN movies m ON m.id = sh.movie_id
     JOIN screens sc ON sc.id = sh.screen_id
     WHERE sh.id = $1`,
    [showId],
    scope,
  );

export const getShowPerformance = (hallId, from, to, scope) =>
  query(
    `SELECT sh.id AS show_id, m.title AS movie_title, sc.name AS screen_name,
       sh.show_date::text, sh.start_time::text,
       sh.status,
       COUNT(b.id)::int AS bookings_count,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS total_revenue,
       COALESCE(
         ROUND(AVG(occ.occupancy), 1), 0
       ) AS occupancy_pct
     FROM shows sh
     JOIN movies m ON m.id = sh.movie_id
     JOIN screens sc ON sc.id = sh.screen_id
     LEFT JOIN bookings b ON b.show_id = sh.id AND b.booking_status = 'confirmed'
     LEFT JOIN ${OCCUPANCY_SUBQUERY} occ ON occ.show_id = sh.id
     WHERE sc.cinema_hall_id = $1 AND sh.show_date BETWEEN $2 AND $3
     GROUP BY sh.id, m.title, sc.name, sh.show_date, sh.start_time, sh.status
     ORDER BY sh.show_date, sh.start_time`,
    [hallId, from, to],
    scope,
  );

export const getBookingSummary = (hallId, from, to, scope) =>
  queryOne(
    `SELECT
       COUNT(*)::int AS total_bookings,
       COUNT(*) FILTER (WHERE booking_status = 'confirmed')::int AS confirmed_bookings,
       COUNT(*) FILTER (WHERE booking_status = 'cancelled')::int AS cancelled_bookings,
       COALESCE(SUM(total_amount) FILTER (WHERE booking_status = 'confirmed'), 0)::numeric(10,2) AS total_revenue,
       COALESCE(SUM(convenience_fee), 0)::numeric(10,2) AS total_convenience_fee,
       COALESCE(SUM(gst_amount), 0)::numeric(10,2) AS total_gst,
       COALESCE(SUM(discount_amount), 0)::numeric(10,2) AS total_discount,
       COUNT(*) FILTER (WHERE offer_code IS NOT NULL)::int AS bookings_with_offer,
       ROUND(
         COALESCE(SUM(total_amount) FILTER (WHERE booking_status = 'confirmed'), 0)
         / NULLIF(COUNT(*) FILTER (WHERE booking_status = 'confirmed'), 0), 2
       ) AS avg_ticket_price
     FROM bookings b
     JOIN shows sh ON sh.id = b.show_id
     JOIN screens sc ON sc.id = sh.screen_id
     WHERE sc.cinema_hall_id = $1 AND sh.show_date BETWEEN $2 AND $3`,
    [hallId, from, to],
    scope,
  );

export const getCustomerBookingHistory = (customerId, page, limit, scope) => {
  const offset = (page - 1) * limit;
  return queryTx(
    [
      {
        // Seat labels are derived the same way the API does for the customer
        // (booking.Controller.js getBookingByPaymentId) — b.seats holds seat
        // *ids* like "0-0", not the human-readable "A1" a customer recognizes.
        text: `SELECT b.id, m.title AS movie_title, sh.show_date::text, sh.start_time::text,
                  sc.name AS screen_name, ch.name AS cinema_hall_name,
                  b.total_amount, b.offer_code, b.discount_amount, b.booking_status, b.created_at,
                  ARRAY(
                    SELECT (seat_data->>'row') || (seat_data->>'column')
                    FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
                    WHERE seat_data->>'id' IN (SELECT jsonb_array_elements_text(b.seats))
                  ) AS seat_labels
               FROM bookings b
               JOIN shows sh ON sh.id = b.show_id
               JOIN screens sc ON sc.id = sh.screen_id
               JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
               JOIN movies m ON m.id = sh.movie_id
               WHERE b.customer_id = $1
               ORDER BY b.created_at DESC
               LIMIT $2 OFFSET $3`,
        values: [customerId, limit, offset],
      },
      {
        text: "SELECT COUNT(*)::int AS total FROM bookings WHERE customer_id = $1",
        values: [customerId],
      },
    ],
    scope,
  );
};

export const getMovieStats = (movieId, hallId, from, to, scope) =>
  queryOne(
    `SELECT m.id AS movie_id, m.title, m.vote_average, m.vote_count,
       COUNT(b.id)::int AS bookings,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(
         ROUND(AVG(occ.occupancy), 1), 0
       ) AS avg_occupancy_pct,
       COUNT(DISTINCT sh.id)::int AS shows_count,
       ROUND(
         COALESCE(SUM(b.total_amount), 0)
         / NULLIF(COUNT(b.id), 0), 2
       ) AS avg_ticket_price
     FROM movies m
     JOIN shows sh ON sh.movie_id = m.id
     JOIN screens sc ON sc.id = sh.screen_id
     LEFT JOIN bookings b ON b.show_id = sh.id AND b.booking_status = 'confirmed'
     LEFT JOIN ${OCCUPANCY_SUBQUERY} occ ON occ.show_id = sh.id
     WHERE m.id = $1
       AND ($2::uuid IS NULL OR sc.cinema_hall_id = $2)
       AND sh.show_date BETWEEN $3 AND $4
     GROUP BY m.id, m.title`,
    [movieId, hallId ?? null, from, to],
    scope,
  );

export const getCinemaStats = (hallId, fromDate, toDate, scope) =>
  queryOne(
    `WITH stats AS (
       SELECT
         COUNT(b.id)::int AS bookings,
         COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
         COALESCE(SUM(b.convenience_fee), 0)::numeric(10,2) AS convenience_fee,
         COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst,
         COALESCE(SUM(b.discount_amount), 0)::numeric(10,2) AS total_discount
       FROM bookings b
       JOIN shows sh ON sh.id = b.show_id
       JOIN screens sc ON sc.id = sh.screen_id
       WHERE sc.cinema_hall_id = $1 AND sh.show_date BETWEEN $2 AND $3
     ),
     top_movies AS (
       SELECT m.id AS movie_id, m.title,
         COUNT(b.id)::int AS bookings,
         COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue
       FROM bookings b
       JOIN shows sh ON sh.id = b.show_id
       JOIN screens sc ON sc.id = sh.screen_id
       JOIN movies m ON m.id = sh.movie_id
       WHERE sc.cinema_hall_id = $1 AND sh.show_date BETWEEN $2 AND $3
       GROUP BY m.id, m.title
       ORDER BY revenue DESC
       LIMIT 5
     ),
     screens_count AS (
       SELECT COUNT(*)::int AS total FROM screens WHERE cinema_hall_id = $1
     ),
     shows_count AS (
       SELECT COUNT(*)::int AS total FROM shows s
       JOIN screens sc ON sc.id = s.screen_id
       WHERE sc.cinema_hall_id = $1 AND s.show_date BETWEEN $2 AND $3
     )
     SELECT
       (SELECT row_to_json(stats) FROM stats) AS stats,
       (SELECT json_agg(row_to_json(top_movies)) FROM top_movies) AS top_movies,
       (SELECT total FROM screens_count) AS screens_count,
       (SELECT total FROM shows_count) AS shows_count`,
    [hallId, fromDate, toDate],
    scope,
  );

export const getBookingsByDate = (hallId, from, to, scope) =>
  query(
    `SELECT gs.date::date AS date,
       COUNT(b.id)::int AS bookings_count,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(SUM(b.convenience_fee), 0)::numeric(10,2) AS convenience_fee,
       COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst,
       COALESCE(SUM(b.discount_amount), 0)::numeric(10,2) AS total_discount
     FROM generate_series($2::date, $3::date, '1 day') gs(date)
     LEFT JOIN shows sh ON sh.show_date = gs.date
       AND sh.screen_id IN (SELECT id FROM screens WHERE cinema_hall_id = $1)
     LEFT JOIN bookings b ON b.show_id = sh.id AND b.booking_status = 'confirmed'
     GROUP BY gs.date
     ORDER BY gs.date`,
    [hallId, from, to],
    scope,
  );

export const getRevenueReport = (hallId, from, to, scope) =>
  query(
    `SELECT
       m.title AS movie_title,
       sc.name AS screen_name,
       COUNT(b.id)::int AS bookings,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(SUM(b.convenience_fee), 0)::numeric(10,2) AS convenience_fee,
       COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst,
       COALESCE(SUM(b.discount_amount), 0)::numeric(10,2) AS total_discount,
       ROUND(
         COALESCE(SUM(b.total_amount), 0)
         / NULLIF(COUNT(b.id), 0), 2
       ) AS avg_ticket_price
     FROM bookings b
     JOIN shows sh ON sh.id = b.show_id
     JOIN movies m ON m.id = sh.movie_id
     JOIN screens sc ON sc.id = sh.screen_id
     WHERE sc.cinema_hall_id = $1 AND sh.show_date BETWEEN $2 AND $3
       AND b.booking_status = 'confirmed'
      GROUP BY m.title, sc.name
      ORDER BY revenue DESC`,
    [hallId, from, to],
    scope,
  );

// NOTE: org/hall settings and team/role listings used to be queried directly
// against organization_settings, hall_settings, organization_members, roles,
// role_permissions here. Those tables never received RLS policies (sql/02_rls_policies.sql
// stops at cinema_admin_user), so a direct read was scoped by nothing but the
// application-level permission gate. team.tools.js now calls the API
// (GET /api/settings/org, /api/settings/hall/:id, /api/team, /api/roles)
// instead, which enforces org membership the same way the admin app does.

// Revenue impact of discount offers for a cinema hall over a date range.
// bookings.offer_code / discount_amount carry the row-level facts (see
// payment.Controller.js verifyPayment); this aggregates them per offer and
// joins the offers table for a human-readable title. LEFT JOIN so a booking
// whose offer was since deleted still shows up (title falls back to null).
export const getOfferPerformance = (hallId, from, to, scope) =>
  query(
    `SELECT b.offer_code AS code,
       o.title,
       COUNT(b.id)::int AS redemptions,
       COALESCE(SUM(b.discount_amount), 0)::numeric(10,2) AS total_discount,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue_after_discount
     FROM bookings b
     JOIN shows sh ON sh.id = b.show_id
     JOIN screens sc ON sc.id = sh.screen_id
     LEFT JOIN offers o ON o.code = b.offer_code
     WHERE sc.cinema_hall_id = $1 AND sh.show_date BETWEEN $2 AND $3
       AND b.booking_status = 'confirmed' AND b.offer_code IS NOT NULL
     GROUP BY b.offer_code, o.title
     ORDER BY total_discount DESC`,
    [hallId, from, to],
    scope,
  );
