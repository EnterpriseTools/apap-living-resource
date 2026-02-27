// src/lib/timeWindows.ts
import { addMonths, format, parseISO, startOfMonth } from "date-fns";

const YYYY_MM = /^\d{4}-\d{2}$/;

/** Convert Date or "YYYY-MM" string -> "YYYY-MM". Handles invalid dates and string month keys from storage. */
export function toMonthKey(d: Date | string): string {
  if (typeof d === "string") {
    if (YYYY_MM.test(d)) return d;
    const parsed = parseMonthKey(d);
    if (Number.isNaN(parsed.getTime())) return d;
    return format(parsed, "yyyy-MM");
  }
  const normalized = startOfMonth(d);
  if (Number.isNaN(normalized.getTime())) {
    return "invalid";
  }
  return format(normalized, "yyyy-MM");
}

/** Convert "YYYY-MM" -> Date at start of month */
export function parseMonthKey(monthKey: string): Date {
  // parseISO needs a day, so we add "-01"
  return startOfMonth(parseISO(`${monthKey}-01`));
}

/** Shift a monthKey by delta months */
export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const d = parseMonthKey(monthKey);
  return toMonthKey(addMonths(d, deltaMonths));
}

/**
 * Return exactly n month keys, inclusive of asOf month.
 * Ordered oldest -> newest.
 *
 * Example: getTrailingMonthKeys("2026-01", 6)
 * => ["2025-08","2025-09","2025-10","2025-11","2025-12","2026-01"]
 */
export function getTrailingMonthKeys(asOfMonthKey: string, n: number): string[] {
  if (n <= 0) return [];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(shiftMonthKey(asOfMonthKey, -i));
  }
  return out;
}
