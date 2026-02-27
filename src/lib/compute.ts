import { startOfMonth, differenceInMonths, parseISO } from 'date-fns';
import type { TelemetryMonthly, AgencyMetrics, SimTelemetryMonthly } from './schema';
import { getTrailingMonthKeys, toMonthKey, shiftMonthKey } from './timeWindows';
import { computeAgencyMetrics, getCompletionsForMonthKey } from './metrics';
import { isAdoptingFromMetrics } from './domain';
import { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD } from '@/config/domain_constants';

export { computeAgencyMetrics, getCompletionsForMonthKey } from './metrics';

/**
 * Normalize month to first day of month
 */
export function normalizeMonth(date: Date | string): Date {
  if (typeof date === 'string') {
    const parts = date.split('-');
    if (parts.length === 2) {
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      return startOfMonth(new Date(year, month - 1, 1));
    }
    return startOfMonth(parseISO(date));
  }
  return startOfMonth(date);
}

/**
 * Normalize product name (standardize "Simulator Training")
 */
export function normalizeProduct(product: string): string {
  const normalized = product.trim();
  // Case-insensitive match for Simulator Training
  if (normalized.toLowerCase().includes('simulator') && normalized.toLowerCase().includes('training')) {
    return 'Simulator Training';
  }
  return normalized;
}

/**
 * Compute as_of_month (latest month in telemetry)
 */
export function computeAsOfMonth(telemetry: TelemetryMonthly[]): Date | null {
  if (telemetry.length === 0) return null;
  const months = telemetry.map((t) => t.month.getTime());
  return new Date(Math.max(...months));
}

/**
 * Compute months since purchase
 */
export function computeMonthsSincePurchase(
  purchaseDate: Date | undefined,
  asOfMonth: Date | null
): number | null {
  if (!purchaseDate || !asOfMonth) return null;
  const purchaseMonth = startOfMonth(purchaseDate);
  const asOf = startOfMonth(asOfMonth);
  return differenceInMonths(asOf, purchaseMonth);
}

/**
 * Check if agency was adopting at a specific month
 */
export function wasAdoptingAtMonth(
  metrics: AgencyMetrics | null,
  month: Date
): boolean {
  if (!metrics) return false;
  // For historical months, we'd need to recompute metrics as of that month
  // For now, we use the current metrics and check if they meet the threshold (either metric; never require both).
  return isAdoptingFromMetrics(metrics);
}

/**
 * Project next month metrics.
 * Uses actual completions from oldest month in T6/T12 (by month key); drops that month and adds projected.
 */
export function projectNextMonthMetrics(
  metrics: AgencyMetrics,
  agencyId: string,
  simTelemetry: SimTelemetryMonthly[] | undefined
): {
  C6_next: number;
  C12_next: number;
  R6_next: number;
  R12_next: number;
  adopting_next: boolean;
  projectedLessThanDropped: boolean;
} {
  const avgLast3 = metrics.last3Months.reduce((a, b) => a + b, 0) / 3;
  const asOfMonthKey = toMonthKey(metrics.as_of_month);
  const t6Keys = getTrailingMonthKeys(asOfMonthKey, 6);
  const t12Keys = getTrailingMonthKeys(asOfMonthKey, 12);

  const droppedFromC6 = getCompletionsForMonthKey(agencyId, simTelemetry, t6Keys[0]);
  const droppedFromC12 = getCompletionsForMonthKey(agencyId, simTelemetry, t12Keys[0]);

  const projectedLessThanDropped = avgLast3 < droppedFromC12 || avgLast3 < droppedFromC6;

  const C6_next = metrics.C6 - droppedFromC6 + avgLast3;
  const C12_next = metrics.C12 - droppedFromC12 + avgLast3;

  const R6_next = metrics.L > 0 ? C6_next / metrics.L : 0;
  const R12_next = metrics.L > 0 ? C12_next / metrics.L : 0;

  const adopting_next = R6_next >= ADOPTION_R6_THRESHOLD || R12_next >= ADOPTION_R12_THRESHOLD;

  return {
    C6_next,
    C12_next,
    R6_next,
    R12_next,
    adopting_next,
    projectedLessThanDropped,
  };
}

/**
 * Project next quarter metrics (3 months forward).
 * Simulates 3 months using T6/T12 month keys; each step drops oldest month and adds projected.
 */
export function projectNextQuarterMetrics(
  metrics: AgencyMetrics,
  agencyId: string,
  simTelemetry: SimTelemetryMonthly[] | undefined
): {
  adopting_next_quarter: boolean;
  projectedLessThanDropped: boolean;
} {
  const avgLast3 = metrics.last3Months.reduce((a, b) => a + b, 0) / 3;
  const asOfMonthKey = toMonthKey(metrics.as_of_month);
  const t6Keys = getTrailingMonthKeys(asOfMonthKey, 6);
  const t12Keys = getTrailingMonthKeys(asOfMonthKey, 12);

  let C12_sim = metrics.C12;
  let C6_sim = metrics.C6;
  let anyProjectedLessThanDropped = false;

  for (let i = 0; i < 3; i++) {
    const asOfPlusI = shiftMonthKey(asOfMonthKey, i);
    const t6AtStep = getTrailingMonthKeys(asOfPlusI, 6);
    const t12AtStep = getTrailingMonthKeys(asOfPlusI, 12);
    const droppedC6 = getCompletionsForMonthKey(agencyId, simTelemetry, t6AtStep[0]);
    const droppedC12 = getCompletionsForMonthKey(agencyId, simTelemetry, t12AtStep[0]);

    if (avgLast3 < droppedC12 || avgLast3 < droppedC6) {
      anyProjectedLessThanDropped = true;
    }

    C12_sim = C12_sim - droppedC12 + avgLast3;
    C6_sim = C6_sim - droppedC6 + avgLast3;
  }

  const R12_sim = metrics.L > 0 ? C12_sim / metrics.L : 0;
  const R6_sim = metrics.L > 0 ? C6_sim / metrics.L : 0;

  const adopting_next_quarter = R12_sim >= ADOPTION_R12_THRESHOLD || R6_sim >= ADOPTION_R6_THRESHOLD;

  return {
    adopting_next_quarter,
    projectedLessThanDropped: anyProjectedLessThanDropped,
  };
}

/**
 * Calculate completions needed to meet adoption thresholds.
 * Uses T6/T12 month keys; next month the oldest month in each window drops off.
 */
export function calculateCompletionsNeeded(
  agencyId: string,
  metrics: AgencyMetrics,
  simTelemetry: SimTelemetryMonthly[]
): { t6: number; t12: number } {
  if (isAdoptingFromMetrics(metrics)) return { t6: 0, t12: 0 };

  const asOfMonthKey = toMonthKey(metrics.as_of_month);
  const t6Keys = getTrailingMonthKeys(asOfMonthKey, 6);
  const t12Keys = getTrailingMonthKeys(asOfMonthKey, 12);
  const L = metrics.L;

  const droppedC12 = getCompletionsForMonthKey(agencyId, simTelemetry, t12Keys[0]);
  const t12Needed = Math.max(0, Math.ceil(ADOPTION_R12_THRESHOLD * L - metrics.C12 + droppedC12));

  const droppedC6 = getCompletionsForMonthKey(agencyId, simTelemetry, t6Keys[0]);
  const t6Needed = Math.max(0, Math.ceil(ADOPTION_R6_THRESHOLD * L - metrics.C6 + droppedC6));

  return { t6: t6Needed, t12: t12Needed };
}

/**
 * Minimum completions needed this month so the agency still meets at least one adoption threshold next month (to stay adopting / avoid churning).
 * Used for At Risk agencies. Returns 0 if they are not adopting or if no telemetry.
 */
export function calculateCompletionsNeededToStayAdopting(
  agencyId: string,
  metrics: AgencyMetrics,
  simTelemetry: SimTelemetryMonthly[]
): number {
  if (!isAdoptingFromMetrics(metrics) || !simTelemetry.length) return 0;

  const asOfMonthKey = toMonthKey(metrics.as_of_month);
  const t6Keys = getTrailingMonthKeys(asOfMonthKey, 6);
  const t12Keys = getTrailingMonthKeys(asOfMonthKey, 12);
  const L = metrics.L;

  const dropped6 = getCompletionsForMonthKey(agencyId, simTelemetry, t6Keys[0]);
  const dropped12 = getCompletionsForMonthKey(agencyId, simTelemetry, t12Keys[0]);

  const t6ToMaintain = ADOPTION_R6_THRESHOLD * L - metrics.C6 + dropped6;
  const t12ToMaintain = ADOPTION_R12_THRESHOLD * L - metrics.C12 + dropped12;
  const minNeeded = Math.min(t6ToMaintain, t12ToMaintain);
  return Math.max(0, Math.ceil(minNeeded));
}

/**
 * For At Risk next quarter: total completions that drop from T12 and T6 over the next 3 months,
 * and the minimum total needed over those 3 months to still meet one threshold. Returns the average per month (rounded up).
 */
export function calculateCompletionsNeededToStayAdoptingNextQuarter(
  agencyId: string,
  metrics: AgencyMetrics,
  simTelemetry: SimTelemetryMonthly[]
): number {
  if (!isAdoptingFromMetrics(metrics) || !simTelemetry.length) return 0;

  const asOfMonthKey = toMonthKey(metrics.as_of_month);
  const t6Keys = getTrailingMonthKeys(asOfMonthKey, 6);
  const t12Keys = getTrailingMonthKeys(asOfMonthKey, 12);
  const L = metrics.L;

  let drop12Total = 0;
  let drop6Total = 0;
  for (let i = 0; i < 3; i++) {
    const asOfPlusI = shiftMonthKey(asOfMonthKey, i);
    const t6AtStep = getTrailingMonthKeys(asOfPlusI, 6);
    const t12AtStep = getTrailingMonthKeys(asOfPlusI, 12);
    drop12Total += getCompletionsForMonthKey(agencyId, simTelemetry, t12AtStep[0]);
    drop6Total += getCompletionsForMonthKey(agencyId, simTelemetry, t6AtStep[0]);
  }

  const totalNeededForT12 = ADOPTION_R12_THRESHOLD * L - metrics.C12 + drop12Total;
  const totalNeededForT6 = ADOPTION_R6_THRESHOLD * L - metrics.C6 + drop6Total;
  const totalNeeded = Math.min(totalNeededForT12, totalNeededForT6);
  return Math.ceil(Math.max(0, totalNeeded) / 3);
}

