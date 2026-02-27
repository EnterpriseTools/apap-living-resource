import { startOfMonth } from 'date-fns';
import type { TelemetryMonthly } from './schema';
import { getTrailingMonthKeys, toMonthKey } from './timeWindows';

/**
 * Usage rollups for overview page
 */
export type UsageRollups = {
  availableMonths: string[]; // YYYY-MM format, sorted
  usageByMonthTotal: Record<string, number>; // month (YYYY-MM) -> total completions (all products)
  usageByMonthByProduct: Record<string, Record<string, number>>; // product -> month (YYYY-MM) -> completions
};

/** T10-only Simulator Training usage for engagement goal reporting */
export type SimT10Usage = {
  usageByMonth: Record<string, number>; // month (YYYY-MM) -> completions (T10, Simulator Training only)
  availableMonths: string[];
  t12Total: number; // trailing 12 month total as of asOfMonth
  asOfMonth: string; // YYYY-MM
};

/**
 * Compute usage rollups from telemetry
 */
export function computeUsageRollups(telemetry: TelemetryMonthly[]): UsageRollups {
  // Get all unique months, sorted
  const monthSet = new Set<string>();
  telemetry.forEach((t) => {
    const monthKey = toMonthKey(t.month);
    monthSet.add(monthKey);
  });
  const availableMonths = Array.from(monthSet).sort();

  // Compute total usage by month (all products)
  const usageByMonthTotal: Record<string, number> = {};
  telemetry.forEach((t) => {
    const monthKey = toMonthKey(t.month);
    usageByMonthTotal[monthKey] = (usageByMonthTotal[monthKey] || 0) + t.completions;
  });

  // Compute usage by month by product
  const usageByMonthByProduct: Record<string, Record<string, number>> = {};
  telemetry.forEach((t) => {
    const monthKey = toMonthKey(t.month);
    if (!usageByMonthByProduct[t.product]) {
      usageByMonthByProduct[t.product] = {};
    }
    usageByMonthByProduct[t.product][monthKey] =
      (usageByMonthByProduct[t.product][monthKey] || 0) + t.completions;
  });

  return {
    availableMonths,
    usageByMonthTotal,
    usageByMonthByProduct,
  };
}

/**
 * Compute T10-only Simulator Training usage by month and T12 total.
 * Only agencies in t10AgencyIds are included; all others are excluded.
 * Used for engagement goal: 180K (Nov'25) → 290K (Nov'26).
 */
export function computeSimT10Usage(
  simTelemetry: TelemetryMonthly[],
  t10AgencyIds: Set<string>,
  asOfMonth: Date
): SimT10Usage {
  const t10Only = simTelemetry.filter((t) => t10AgencyIds.has(t.agency_id));
  const usageByMonth: Record<string, number> = {};
  t10Only.forEach((t) => {
    const monthKey = toMonthKey(t.month);
    usageByMonth[monthKey] = (usageByMonth[monthKey] || 0) + t.completions;
  });
  const availableMonths = Array.from(new Set(Object.keys(usageByMonth))).sort();
  const asOfMonthKey = toMonthKey(startOfMonth(asOfMonth));
  const t12Keys = getTrailingMonthKeys(asOfMonthKey, 12);
  const t12Total = t12Keys.reduce((sum, key) => sum + (usageByMonth[key] || 0), 0);
  return {
    usageByMonth,
    availableMonths,
    t12Total,
    asOfMonth: asOfMonthKey,
  };
}

