import { z } from "zod";

export const uuid = z.string().uuid({ message: "Invalid UUID format. Expected a valid UUID v4." });

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Invalid date format. Use YYYY-MM-DD (e.g. 2026-06-21).",
});

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
};

export const dateRange = {
  from_date: dateStr.optional(),
  to_date: dateStr.optional(),
};

export const cinemaHallId = {
  cinema_hall_id: uuid,
};

export const movieStatus = z.enum(["upcoming", "now_showing", "ended"]).optional();

export const bookingStatus = z.enum(["confirmed", "cancelled"]).optional();
