// src/lib/metrics.ts

/**
 * Single place for C6/C12/R6/R12 computation from SIM telemetry.
 * Uses timeWindows (inclusive lookback); no adoption thresholds here.
 */

import { startOfMonth } from 'date-fns';
import type { AgencyMetrics, SimTelemetryMonthly } from './schema';
import { getTrailingMonthKeys, toMonthKey } from './timeWindows';

/**
 * Sum completions for an agency over the given month keys (YYYY-MM).
 * Telemetry rows must have month normalized to "YYYY-MM".
 */
export function sumAgencyCompletionsByMonthKeys(
  telemetry: { agency_id: string; month: string; completions: number }[],
  agencyId: string,
  monthKeys: Set<string>
): number {
  let sum = 0;
  for (const row of telemetry) {
    if (row.agency_id !== agencyId) continue;
    if (!monthKeys.has(row.month)) continue;
    sum += row.completions;
  }
  return sum;
}

function simTelemetryToMonthKeyRows(
  rows: SimTelemetryMonthly[]
): { agency_id: string; month: string; completions: number }[] {
  return rows.map((t) => ({
    agency_id: t.agency_id,
    month: toMonthKey(t.month),
    completions: t.completions,
  }));
}

/**
 * Get completions for a specific month key from telemetry.
 * Used by compute (projections, completions-needed) and by metrics (last3Months).
 */
export function getCompletionsForMonthKey(
  agencyId: string,
  simTelemetry: SimTelemetryMonthly[] | undefined,
  monthKey: string
): number {
  if (!simTelemetry || simTelemetry.length === 0) return 0;
  const row = simTelemetry.find(
    (t) => t.agency_id === agencyId && toMonthKey(t.month) === monthKey
  );
  return row?.completions ?? 0;
}

/**
 * Compute SIM-only metrics for an agency.
 * T6/T12 use getTrailingMonthKeys (exactly 6/12 months inclusive of asOf).
 * Single source of truth for C6/C12/R6/R12 from telemetry.
 */
export function computeAgencyMetrics(
  agencyId: string,
  simTelemetry: SimTelemetryMonthly[],
  asOfMonth: Date,
  vrLicenses: number | undefined
): AgencyMetrics | null {
  if (!vrLicenses || vrLicenses <= 0) return null;

  const agencySimTelemetry = simTelemetry.filter((t) => t.agency_id === agencyId);
  if (agencySimTelemetry.length === 0) return null;

  const asOf = startOfMonth(asOfMonth);
  const asOfMonthKey = toMonthKey(asOf);
  const t6Keys = getTrailingMonthKeys(asOfMonthKey, 6);
  const t12Keys = getTrailingMonthKeys(asOfMonthKey, 12);

  const normalized = simTelemetryToMonthKeyRows(agencySimTelemetry);
  const C6 = sumAgencyCompletionsByMonthKeys(normalized, agencyId, new Set(t6Keys));
  const C12 = sumAgencyCompletionsByMonthKeys(normalized, agencyId, new Set(t12Keys));

  const last3Keys = getTrailingMonthKeys(asOfMonthKey, 3);
  const last3Months: number[] = last3Keys.map((key) =>
    getCompletionsForMonthKey(agencyId, agencySimTelemetry, key)
  );

  const R6 = C6 > 0 && vrLicenses > 0 ? C6 / vrLicenses : 0;
  const R12 = C12 > 0 && vrLicenses > 0 ? C12 / vrLicenses : 0;

  const monthlyCompletions = t12Keys.map((key) => ({
    monthKey: key,
    completions: getCompletionsForMonthKey(agencyId, agencySimTelemetry, key),
  }));

  return {
    agency_id: agencyId,
    L: vrLicenses,
    C6,
    C12,
    R6,
    R12,
    last3Months,
    as_of_month: asOf,
    monthlyCompletions,
  };
}
