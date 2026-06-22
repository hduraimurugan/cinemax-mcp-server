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
            screen_position, created_at
     FROM screens WHERE cinema_hall_id = $1 ORDER BY name`,
    [hallId],
    scope,
  );

export const getDailyCollections = (hallId, from, to, scope) =>
  query(
    `SELECT gs.date::date AS date,
       COALESCE(SUM(b.total_amount), 0)::numeric(10,2) AS revenue,
       COALESCE(SUM(b.convenience_fee), 0)::numeric(10,2) AS convenience_fee,
       COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst,
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
       COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst
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
     LEFT JOIN (
       SELECT show_id,
         COUNT(*) FILTER (WHERE status = 'BOOKED')::numeric
         / NULLIF(COUNT(*), 0) * 100 AS occupancy
       FROM show_booked_seats GROUP BY show_id
     ) occ ON occ.show_id = sh.id
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
       (SELECT COUNT(*) FROM show_booked_seats WHERE show_id = $1 AND status = 'BOOKED')::int AS booked_seats
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
     LEFT JOIN (
       SELECT show_id,
         COUNT(*) FILTER (WHERE status = 'BOOKED')::numeric
         / NULLIF(COUNT(*), 0) * 100 AS occupancy
       FROM show_booked_seats GROUP BY show_id
     ) occ ON occ.show_id = sh.id
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
        text: `SELECT b.id, m.title AS movie_title, sh.show_date::text, sh.start_time::text,
                  sc.name AS screen_name, ch.name AS cinema_hall_name,
                  b.total_amount, b.booking_status, b.seats, b.created_at
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
    `SELECT m.id AS movie_id, m.title,
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
     LEFT JOIN (
       SELECT show_id,
         COUNT(*) FILTER (WHERE status = 'BOOKED')::numeric
         / NULLIF(COUNT(*), 0) * 100 AS occupancy
       FROM show_booked_seats GROUP BY show_id
     ) occ ON occ.show_id = sh.id
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
         COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst
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
       COALESCE(SUM(b.gst_amount), 0)::numeric(10,2) AS gst
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

export const getOrgSettings = (scope) =>
  query(
    `SELECT section, value, schema_version, updated_at
     FROM organization_settings`,
    [],
    scope
  );

export const getHallSettings = (hallId, scope) =>
  query(
    `SELECT section, value, schema_version, updated_at
     FROM hall_settings
     WHERE hall_id = $1`,
    [hallId],
    scope
  );

export const listTeamMembers = (scope) =>
  query(
    `SELECT om.id AS member_id, om.org_id, om.status, om.joined_at,
            cau.id AS admin_id, cau.name, cau.email, cau.phone,
            r.key AS role_key, r.label AS role_label
     FROM organization_members om
     JOIN cinema_admin_user cau ON cau.id = om.admin_id
     JOIN roles r ON r.id = om.role_id
     ORDER BY cau.name`,
    [],
    scope
  );

export const listRolesPermissions = (scope) =>
  query(
    `SELECT r.id AS role_id, r.key AS role_key, r.label AS role_label, r.description AS role_description, r.is_system,
            COALESCE(
              json_agg(
                json_build_object('key', p.key, 'label', p.label, 'resource', p.resource)
              ) FILTER (WHERE p.id IS NOT NULL),
              '[]'::json
            ) AS permissions
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     GROUP BY r.id, r.key, r.label, r.description, r.is_system
     ORDER BY r.is_system DESC, r.label`,
    [],
    scope
  );
