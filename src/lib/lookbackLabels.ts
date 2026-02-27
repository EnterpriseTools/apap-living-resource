// src/lib/lookbackLabels.ts
import { format } from 'date-fns';
import { getTrailingMonthKeys, parseMonthKey } from './timeWindows';

/**
 * Format an ordered list of month keys as a human-readable range.
 * Input: ["2025-08", ..., "2026-01"] (oldest → newest)
 * Output: "Aug 2025–Jan 2026" (en dash)
 */
export function formatMonthKeyRange(monthKeys: string[]): string {
  if (monthKeys.length === 0) return '';
  if (monthKeys.length === 1) {
    try {
      return format(parseMonthKey(monthKeys[0]), 'MMM yyyy');
    } catch {
      return monthKeys[0];
    }
  }
  try {
    const start = format(parseMonthKey(monthKeys[0]), 'MMM yyyy');
    const end = format(parseMonthKey(monthKeys[monthKeys.length - 1]), 'MMM yyyy');
    return `${start}–${end}`;
  } catch {
    return `${monthKeys[0]}–${monthKeys[monthKeys.length - 1]}`;
  }
}

/**
 * Human-readable trailing 6-month range for the given as-of month.
 * Example: getT6RangeLabel("2026-01") => "Aug 2025–Jan 2026"
 */
export function getT6RangeLabel(asOfMonthKey: string): string {
  const keys = getTrailingMonthKeys(asOfMonthKey, 6);
  return formatMonthKeyRange(keys);
}

/**
 * Human-readable trailing 12-month range for the given as-of month.
 * Example: getT12RangeLabel("2026-01") => "Feb 2025–Jan 2026"
 */
export function getT12RangeLabel(asOfMonthKey: string): string {
  const keys = getTrailingMonthKeys(asOfMonthKey, 12);
  return formatMonthKeyRange(keys);
}

/**
 * Human-readable trailing n-month range for the given as-of month.
 * Example: getLookbackRangeLabel("2026-01", 6) => "Aug 2025–Jan 2026"
 */
export function getLookbackRangeLabel(asOfMonthKey: string, n: number): string {
  const keys = getTrailingMonthKeys(asOfMonthKey, n);
  return formatMonthKeyRange(keys);
}

/**
 * Full tooltip text for T6 column: "Trailing 6 months (inclusive): Aug 2025–Jan 2026"
 */
export function getT6Tooltip(asOfMonthKey: string): string {
  const range = getT6RangeLabel(asOfMonthKey);
  return range ? `Trailing 6 months (inclusive): ${range}` : 'Trailing 6 months';
}

/**
 * Full tooltip text for T12 column: "Trailing 12 months (inclusive): Feb 2025–Jan 2026"
 */
export function getT12Tooltip(asOfMonthKey: string): string {
  const range = getT12RangeLabel(asOfMonthKey);
  return range ? `Trailing 12 months (inclusive): ${range}` : 'Trailing 12 months';
}
