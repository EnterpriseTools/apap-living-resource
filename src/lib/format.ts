/**
 * UI formatting: numbers, month ranges, line size band.
 * Use for consistent display; logic uses domain/metrics only.
 */

import { format as formatDate } from 'date-fns';
import type { LineSizeBand } from '@/config/domain_constants';

/** Display string for line size band; null/unknown shown as "Unknown". */
export function formatLineSizeBand(band: LineSizeBand | null | undefined): string {
  if (band === null || band === undefined) return 'Unknown';
  return band;
}

/** Format number with locale; null/undefined/NaN → "—". */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
    return '—';
  }
  return value.toLocaleString();
}

/** Format number to fixed decimal places; null/undefined/NaN → "—". */
export function formatDecimal(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
    return '—';
  }
  return value.toFixed(fractionDigits);
}

/**
 * Format a percent from a numerator/denominator pair using scaled integer rounding.
 * This avoids common JS floating-point rounding issues (e.g. 40.15 → "40.1").
 */
export function formatPercentFromParts(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  fractionDigits = 1
): string {
  if (numerator === null || numerator === undefined) return '—';
  if (denominator === null || denominator === undefined) return '—';
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return '—';
  if (denominator <= 0) return (0).toFixed(fractionDigits);

  const scale = Math.pow(10, Math.max(0, Math.floor(fractionDigits)));
  const scaled = Math.round((numerator * 100 * scale) / denominator);
  return (scaled / scale).toFixed(fractionDigits);
}

/** Format month key (YYYY-MM) or Date as short label (e.g. "Jan 2026"). */
export function formatMonthLabel(monthKeyOrDate: string | Date | null | undefined): string {
  if (monthKeyOrDate === null || monthKeyOrDate === undefined) return '—';
  const date = typeof monthKeyOrDate === 'string' ? new Date(monthKeyOrDate + '-01') : monthKeyOrDate;
  if (Number.isNaN(date.getTime())) return '—';
  return formatDate(date, 'MMM yyyy');
}

/** Format month range for display (e.g. "Aug 2025 – Jan 2026"). */
export function formatMonthRange(startKey: string, endKey: string): string {
  const start = formatMonthLabel(startKey);
  const end = formatMonthLabel(endKey);
  if (start === '—' || end === '—') return `${start} – ${end}`;
  return `${start} – ${end}`;
}
