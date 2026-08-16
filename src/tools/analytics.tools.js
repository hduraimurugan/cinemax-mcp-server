import { z } from "zod";
import {
  getDailyCollections,
  getWeeklyCollections,
  getMonthlyCollections,
  getHallOccupancy,
  getSeatUtilization,
  getMoviePerformance,
  getShowPerformance,
  getRevenueReport,
  getOfferPerformance,
} from "../db/readonly.js";

const dateStr = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = () => z.string().uuid();
const toDateStr = (d) => d.toISOString().slice(0, 10);
const todayStr = () => toDateStr(new Date());
const daysAgo = (n) => toDateStr(new Date(Date.now() - n * 86400000));

export const analyticsTools = [
  {
    name: "get_daily_collections",
    description: "Daily revenue, bookings, and fees for a cinema hall over a date range.",
    inputSchema: {
      cinema_hall_id: uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const from = args.from_date ?? daysAgo(30);
      const to = args.to_date ?? todayStr();
      const rows = await getDailyCollections(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ series: rows }) }] };
    },
  },
  {
    name: "get_weekly_collections",
    description: "Weekly aggregated revenue and bookings grouped by ISO week.",
    inputSchema: {
      cinema_hall_id: uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const from = args.from_date ?? daysAgo(90);
      const to = args.to_date ?? todayStr();
      const rows = await getWeeklyCollections(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ series: rows }) }] };
    },
  },
  {
    name: "get_monthly_collections",
    description: "Monthly aggregated revenue and bookings for a cinema hall by year.",
    inputSchema: {
      cinema_hall_id: uuid(),
      year: z.coerce.number().int().min(2020).max(2030).optional(),
    },
    permission: "any",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const year = args.year ?? new Date().getFullYear();
      const rows = await getMonthlyCollections(args.cinema_hall_id, year, scope);
      return { content: [{ type: "text", text: JSON.stringify({ year, series: rows }) }] };
    },
  },
  {
    name: "get_hall_occupancy",
    description: "Per-show seat occupancy for a cinema hall on a specific date, with total/booked breakdown.",
    inputSchema: {
      cinema_hall_id: uuid(),
      date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 20, refillPerSec: 1 },
    handler: async (args, scope) => {
      const date = args.date ?? todayStr();
      const rows = await getHallOccupancy(args.cinema_hall_id, date, scope);
      return { content: [{ type: "text", text: JSON.stringify({ date, shows: rows }) }] };
    },
  },
  {
    name: "get_seat_utilization",
    description: "Overall seat utilization percentage for a cinema hall over a period, broken down by screen.",
    inputSchema: {
      cinema_hall_id: uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const from = args.from_date ?? daysAgo(30);
      const to = args.to_date ?? todayStr();
      const rows = await getSeatUtilization(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ screens: rows }) }] };
    },
  },
  {
    name: "get_revenue_report",
    description: "Comprehensive revenue breakdown by movie and screen for a cinema hall. Shows bookings, revenue, fees, and average ticket price.",
    inputSchema: {
      cinema_hall_id: uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 10, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const from = args.from_date ?? daysAgo(30);
      const to = args.to_date ?? todayStr();
      const rows = await getRevenueReport(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ report: rows }) }] };
    },
  },
  {
    name: "get_movie_performance",
    description: "Per-movie performance metrics across all shows in a hall: bookings, revenue, occupancy, shows count.",
    inputSchema: {
      cinema_hall_id: uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const from = args.from_date ?? daysAgo(30);
      const to = args.to_date ?? todayStr();
      const rows = await getMoviePerformance(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ movies: rows }) }] };
    },
  },
  {
    name: "get_show_performance",
    description: "Per-show performance metrics for a cinema hall: revenue, bookings, occupancy percentage.",
    inputSchema: {
      cinema_hall_id: uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const from = args.from_date ?? daysAgo(7);
      const to = args.to_date ?? todayStr();
      const rows = await getShowPerformance(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ shows: rows }) }] };
    },
  },
  {
    name: "get_offer_performance",
    description: "Discount offer redemptions and revenue impact for a cinema hall over a date range, grouped by offer code.",
    inputSchema: {
      cinema_hall_id: uuid(),
      from_date: dateStr().optional(),
      to_date: dateStr().optional(),
    },
    permission: "any",
    rateLimit: { capacity: 15, refillPerSec: 0.5 },
    handler: async (args, scope) => {
      const from = args.from_date ?? daysAgo(30);
      const to = args.to_date ?? todayStr();
      const rows = await getOfferPerformance(args.cinema_hall_id, from, to, scope);
      return { content: [{ type: "text", text: JSON.stringify({ offers: rows }) }] };
    },
  },
];
