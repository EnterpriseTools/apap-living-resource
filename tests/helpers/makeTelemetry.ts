import { getTrailingMonthKeys, parseMonthKey } from '../../src/lib/timeWindows';
import type { SimTelemetryMonthly } from '../../src/lib/schema';

/** Telemetry rows with month as string (YYYY-MM) for sumAgencyCompletionsByMonthKeys. */
export function makeMonthlyTelemetry(
  agencyId: string,
  months: string[],
  completionsPerMonth: number,
  product: string = 'Simulator Training'
) {
  return months.map((month) => ({
    agency_id: agencyId,
    month,
    completions: completionsPerMonth,
    product,
  }));
}

/**
 * Build SimTelemetryMonthly for exactly n trailing months (asOf + previous n-1).
 * Uses getTrailingMonthKeys so month keys match production T6/T12 logic.
 */
export function makeSimTelemetryForTrailingMonths(
  agencyId: string,
  asOfMonthKey: string,
  n: number,
  completionsPerMonth: number
): SimTelemetryMonthly[] {
  const keys = getTrailingMonthKeys(asOfMonthKey, n);
  return keys.map((key) => ({
    agency_id: agencyId,
    month: parseMonthKey(key),
    completions: completionsPerMonth,
    product: 'Simulator Training' as const,
  }));
}