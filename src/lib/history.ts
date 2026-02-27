import type { TelemetryMonthly, SimTelemetryMonthly, AgencyWithLabel, Agency } from './schema';
import type { UsageRollups } from './usageRollups';
import { startOfMonth, format, parseISO, differenceInMonths, subMonths, subYears } from 'date-fns';

const HISTORY_STORAGE_KEY = 'apap_historical_data';
const MAX_HISTORY_MONTHS = 24; // Keep up to 24 months of historical data

export type KPIMetricCountsAndPoints = {
  adopting: { count: number; points: number };
  eligible: { count: number; points: number };
  ineligible: { count: number; points: number };
  atRiskNextMonth: { count: number; points: number };
  atRiskNextQuarter: { count: number; points: number };
  churnedOut: { count: number; points: number };
  closeToAdopting: { count: number; points: number };
  unknownInsufficient: { count: number; points: number };
};

export type HistoricalDataEntry = {
  asOfMonth: string; // ISO string
  simTelemetry: Array<Omit<SimTelemetryMonthly, 'month'> & { month: string }>;
  cohortSummaries: Record<string, any[]>;
  usageRollups?: UsageRollups;
  agencyLabels?: Array<[string, AgencyWithLabel]>;
  apap?: number;
  /** APAP counts from that month's uploaded agency dataset (cohort >= 6) for MoM comparison */
  apapEligibleCount?: number;
  apapEligiblePoints?: number;
  apapAdoptingCount?: number;
  apapAdoptingPoints?: number;
  /** KPI counts and points for MoM comparison (matches overview metrics; unknown agencies excluded from churned/at-risk/close/ineligible) */
  kpiCountsAndPoints?: KPIMetricCountsAndPoints;
  simT12Total?: number;
  simT10UsageByMonth?: Record<string, number>;
};

export type HistoricalData = {
  [asOfMonth: string]: HistoricalDataEntry;
};

/**
 * Get all historical data from localStorage
 */
export function getHistoricalData(): HistoricalData {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) return {};
    return JSON.parse(stored);
  } catch (err) {
    console.error('Failed to load historical data:', err);
    return {};
  }
}

/**
 * Save historical data entry for a specific asOfMonth
 */
export function saveHistoricalData(
  asOfMonth: Date,
  simTelemetry: SimTelemetryMonthly[],
  cohortSummaries: Record<string, any[]>,
  usageRollups?: UsageRollups,
  agencyLabels?: Map<string, AgencyWithLabel>,
  apap?: number,
  simT12Total?: number,
  simT10UsageByMonth?: Record<string, number>,
  apapCounts?: { eligibleCount: number; eligiblePoints: number; adoptingCount: number; adoptingPoints: number },
  kpiCountsAndPoints?: KPIMetricCountsAndPoints
): void {
  if (typeof window === 'undefined') return;
  try {
    const history = getHistoricalData();
    const asOfMonthKey = format(asOfMonth, 'yyyy-MM');
    
    // Store minimal data to avoid quota issues - don't store full telemetry
    // Try to store agencyLabels for filtered comparisons, but handle quota errors gracefully
    let labelsToStore: Array<[string, AgencyWithLabel]> | undefined = undefined;
    if (agencyLabels) {
      // Convert Map to Array for storage
      labelsToStore = Array.from(agencyLabels.entries());
      // Only store essential fields to reduce size: agency_id, label, and key metrics
      labelsToStore = labelsToStore.map(([id, label]) => [
        id,
        {
          agency_id: label.agency_id,
          label: label.label,
          // Store minimal metrics needed for comparison
          metrics: label.metrics ? {
            R6: label.metrics.R6,
            R12: label.metrics.R12,
            last3Months: label.metrics.last3Months,
          } : undefined,
        } as unknown as AgencyWithLabel,
      ]);
    }
    
    history[asOfMonthKey] = {
      asOfMonth: asOfMonth.toISOString(),
      simTelemetry: [],
      cohortSummaries,
      usageRollups,
      agencyLabels: labelsToStore,
      apap,
      apapEligibleCount: apapCounts?.eligibleCount,
      apapEligiblePoints: apapCounts?.eligiblePoints,
      apapAdoptingCount: apapCounts?.adoptingCount,
      apapAdoptingPoints: apapCounts?.adoptingPoints,
      kpiCountsAndPoints,
      simT12Total,
      simT10UsageByMonth,
    };
    
    // Clean up old entries (keep only last MAX_HISTORY_MONTHS months)
    const now = new Date();
    const entriesToKeep: HistoricalData = {};
    const sortedKeys = Object.keys(history).sort().reverse();
    
    for (const key of sortedKeys.slice(0, MAX_HISTORY_MONTHS)) {
      entriesToKeep[key] = history[key];
    }
    
    // Try to save, but handle quota errors gracefully
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entriesToKeep));
    } catch (quotaError) {
      if (quotaError instanceof Error && quotaError.name === 'QuotaExceededError') {
        console.warn('⚠️ localStorage quota exceeded. Clearing old data and retrying...');
        // Clear all historical data except the current month
        const currentMonthData = entriesToKeep[asOfMonthKey];
        const clearedHistory: HistoricalData = {};
        if (currentMonthData) {
          clearedHistory[asOfMonthKey] = currentMonthData;
        }
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(clearedHistory));
          console.log('✅ Cleared old historical data and saved current month');
        } catch (retryError) {
          console.error('❌ Still failed to save after clearing old data:', retryError);
        }
      } else {
        throw quotaError;
      }
    }
  } catch (err) {
    console.error('Failed to save historical data:', err);
  }
}

/**
 * Get T10 SIM completions for a given month (YYYY-MM) from any stored historical entry.
 * Used for YoY comparison when the prior-year month was included in a different upload
 * (e.g. Jan 2025 in the Dec 2025 telemetry sheet). Returns null if not found.
 */
export function getSimT10CompletionsForMonth(monthKey: string): number | null {
  const history = getHistoricalData();
  const keys = Object.keys(history).sort().reverse();
  for (const k of keys) {
    const v = history[k]?.simT10UsageByMonth?.[monthKey];
    if (v != null) return v;
  }
  return null;
}

/**
 * Get historical telemetry data for a specific month
 */
export function getHistoricalTelemetryForMonth(asOfMonth: Date): SimTelemetryMonthly[] {
  const history = getHistoricalData();
  const monthKey = format(asOfMonth, 'yyyy-MM');
  const entry = history[monthKey];
  
  if (!entry || !entry.simTelemetry) return [];
  
  return entry.simTelemetry.map(t => ({
    ...t,
    month: new Date(t.month),
  })) as SimTelemetryMonthly[];
}

/**
 * Merge current telemetry with historical data to get full 12+ month history
 * This ensures we have enough data to compute T12 metrics even when new uploads
 * only contain the last 12 months
 */
export function mergeTelemetryWithHistory(
  currentTelemetry: SimTelemetryMonthly[],
  currentAsOfMonth: Date
): SimTelemetryMonthly[] {
  const history = getHistoricalData();
  // Use a composite key: agency_id + month to avoid overwriting data from different agencies
  const merged = new Map<string, SimTelemetryMonthly>();
  
  // Add current telemetry (this takes precedence)
  for (const t of currentTelemetry) {
    const monthKey = format(t.month, 'yyyy-MM');
    const compositeKey = `${t.agency_id}|${monthKey}`;
    merged.set(compositeKey, t);
  }
  
  // Add historical telemetry for months we don't have in current data
  // We need to go back at least 12 months from current asOfMonth
  const currentMonthKey = format(currentAsOfMonth, 'yyyy-MM');
  const sortedHistoryKeys = Object.keys(history).sort();
  
  // Track which agency+month combinations we already have from current data
  const currentKeys = new Set(Array.from(merged.keys()));
  
  for (const historyKey of sortedHistoryKeys) {
    // Only use historical data that's older than what we have in current data
    // and within the last 12 months from current asOfMonth
    if (historyKey < currentMonthKey) {
      const historyMonth = parseISO(historyKey + '-01');
      const monthsDiff = differenceInMonths(currentAsOfMonth, historyMonth);
      
      // Include historical data if it's within 12 months
      if (monthsDiff <= 12) {
        const entry = history[historyKey];
        if (entry && entry.simTelemetry) {
          for (const t of entry.simTelemetry) {
            const tMonth = new Date(t.month);
            const tMonthKey = format(tMonth, 'yyyy-MM');
            const compositeKey = `${t.agency_id}|${tMonthKey}`;
            // Only add if we don't already have this agency+month from current data
            if (!currentKeys.has(compositeKey)) {
              merged.set(compositeKey, {
                ...t,
                month: tMonth,
              } as SimTelemetryMonthly);
            }
          }
        }
      }
    }
  }
  
  // Convert map to array and sort by month, then agency_id
  return Array.from(merged.values()).sort((a, b) => {
    const monthDiff = a.month.getTime() - b.month.getTime();
    if (monthDiff !== 0) return monthDiff;
    return a.agency_id.localeCompare(b.agency_id);
  });
}

/**
 * Get previous month's cohort summaries for trend comparison
 */
export function getPreviousMonthCohortSummaries(
  currentAsOfMonth: Date
): Record<string, any[]> | null {
  const history = getHistoricalData();
  const currentMonthKey = format(currentAsOfMonth, 'yyyy-MM');
  
  // Find the most recent historical entry before current month
  const sortedKeys = Object.keys(history)
    .filter(key => key < currentMonthKey)
    .sort()
    .reverse();
  
  if (sortedKeys.length === 0) return null;
  
  const previousEntry = history[sortedKeys[0]];
  return previousEntry?.cohortSummaries || null;
}

/**
 * Get previous quarter's cohort summaries for trend comparison
 */
export function getPreviousQuarterCohortSummaries(
  currentAsOfMonth: Date
): Record<string, any[]> | null {
  const history = getHistoricalData();
  const currentMonthKey = format(currentAsOfMonth, 'yyyy-MM');
  
  // Go back 3 months
  const threeMonthsAgo = new Date(currentAsOfMonth);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const threeMonthsAgoKey = format(threeMonthsAgo, 'yyyy-MM');
  
  // Find the most recent historical entry at or before 3 months ago
  const sortedKeys = Object.keys(history)
    .filter(key => key <= threeMonthsAgoKey)
    .sort()
    .reverse();
  
  if (sortedKeys.length === 0) return null;
  
  const previousEntry = history[sortedKeys[0]];
  return previousEntry?.cohortSummaries || null;
}

/**
 * Get historical entry for a specific comparison period
 */
export function getHistoricalEntryForComparison(
  currentAsOfMonth: Date,
  comparisonType: 'last_month' | 'last_quarter' | 'last_year'
): HistoricalDataEntry | null {
  const history = getHistoricalData();
  const currentMonthKey = format(currentAsOfMonth, 'yyyy-MM');
  
  let targetDate: Date;
  switch (comparisonType) {
    case 'last_month':
      targetDate = subMonths(currentAsOfMonth, 1);
      break;
    case 'last_quarter':
      targetDate = subMonths(currentAsOfMonth, 3);
      break;
    case 'last_year':
      targetDate = subYears(currentAsOfMonth, 1);
      break;
  }
  
  const targetKey = format(targetDate, 'yyyy-MM');
  
  // Find the most recent historical entry at or before target date
  const sortedKeys = Object.keys(history)
    .filter(key => key <= targetKey)
    .sort()
    .reverse();
  
  if (sortedKeys.length === 0) return null;
  
  return history[sortedKeys[0]] || null;
}

/** Close to Adopting thresholds (Action List): R6 >= 0.5 or R12 >= 1.5, eligible, not adopting */
const CLOSE_TO_ADOPT_R6 = 0.5;
const CLOSE_TO_ADOPT_R12 = 1.5;

/**
 * Compute KPI counts and points (officer_count) from agencies and labels.
 * T10 only. Eligible = eligibility_cohort >= 6. Close to Adopting = Action List definition.
 */
export function computeKPICountsAndPoints(
  agencies: Agency[],
  agencyLabels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>
): KPIMetricCountsAndPoints {
  const labelsMap = Array.isArray(agencyLabels) ? new Map(agencyLabels) : agencyLabels;
  const t10 = agencies.filter((a) => a.cew_type === 'T10');

  const result: KPIMetricCountsAndPoints = {
    adopting: { count: 0, points: 0 },
    eligible: { count: 0, points: 0 },
    ineligible: { count: 0, points: 0 },
    atRiskNextMonth: { count: 0, points: 0 },
    atRiskNextQuarter: { count: 0, points: 0 },
    churnedOut: { count: 0, points: 0 },
    closeToAdopting: { count: 0, points: 0 },
    unknownInsufficient: { count: 0, points: 0 },
  };

  for (const agency of t10) {
    const pts = agency.officer_count ?? 0;
    const label = labelsMap.get(agency.agency_id);
    const elig = agency.eligibility_cohort != null && agency.eligibility_cohort >= 6;

    if (elig) result.eligible.count += 1;
    result.eligible.points += elig ? pts : 0;

    if (!label) {
      result.unknownInsufficient.count += 1;
      result.unknownInsufficient.points += pts;
      continue;
    }

    const r6 = label.metrics?.R6 ?? null;
    const r12 = label.metrics?.R12 ?? null;
    const isCloseToAdopt =
      elig &&
      label.label === 'Not Adopting' &&
      ((r6 != null && r6 >= CLOSE_TO_ADOPT_R6) || (r12 != null && r12 >= CLOSE_TO_ADOPT_R12));

    if (label.label === 'Adopting' || label.label === 'Top Performer') {
      result.adopting.count += 1;
      result.adopting.points += pts;
    }
    if (label.label === 'Ineligible (0–5 months)') {
      result.ineligible.count += 1;
      result.ineligible.points += pts;
    }
    if (label.label === 'At Risk (Next Month)') {
      result.atRiskNextMonth.count += 1;
      result.atRiskNextMonth.points += pts;
    }
    if (label.label === 'At Risk (Next Quarter)') {
      result.atRiskNextQuarter.count += 1;
      result.atRiskNextQuarter.points += pts;
    }
    if (label.label === 'Churned Out') {
      result.churnedOut.count += 1;
      result.churnedOut.points += pts;
    }
    if (isCloseToAdopt) {
      result.closeToAdopting.count += 1;
      result.closeToAdopting.points += pts;
    }
    if (label.label === 'Unknown (No license count)') {
      result.unknownInsufficient.count += 1;
      result.unknownInsufficient.points += pts;
    }
  }

  return result;
}

/**
 * Compute KPI counts from agency labels (counts only; for comparison when agencies not available).
 * closeToAdopting uses Action List definition: Not Adopting and (R6 >= 0.5 or R12 >= 1.5).
 */
export function computeKPICounts(agencyLabels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>): {
  adopting: number;
  atRiskNextMonth: number;
  atRiskNextQuarter: number;
  churnedOut: number;
  ineligible: number;
  unknownInsufficient: number;
  closeToAdopting: number;
} {
  const labels = Array.isArray(agencyLabels)
    ? Array.from(new Map(agencyLabels).values())
    : Array.from(agencyLabels.values());

  const closeToAdoptCount = labels.filter((l) => {
    if (l.label !== 'Not Adopting') return false;
    const r6 = l.metrics?.R6 ?? null;
    const r12 = l.metrics?.R12 ?? null;
    return (r6 != null && r6 >= CLOSE_TO_ADOPT_R6) || (r12 != null && r12 >= CLOSE_TO_ADOPT_R12);
  }).length;
  
  return {
    adopting: labels.filter(l => l.label === 'Adopting' || l.label === 'Top Performer').length,
    atRiskNextMonth: labels.filter(l => l.label === 'At Risk (Next Month)').length,
    atRiskNextQuarter: labels.filter(l => l.label === 'At Risk (Next Quarter)').length,
    churnedOut: labels.filter(l => l.label === 'Churned Out').length,
    ineligible: labels.filter(l => l.label === 'Ineligible (0–5 months)').length,
    unknownInsufficient: labels.filter(l => 
      l.label === 'Unknown (No license count)'
    ).length,
    closeToAdopting: closeToAdoptCount,
  };
}

/**
 * Compute APAP (Adoption Percentage) metrics
 *
 * APAP rule (single source of truth):
 *   eligibility_cohort >= 6  AND  (T12 completions per license >= 2  OR  T6 completions per license >= 0.75)
 *
 * - T12 = trailing 12-month completions / VR licenses (R12). T6 = trailing 6-month completions / VR licenses (R6).
 * - Eligible points = sum of officer_count for T10 agencies with eligibility_cohort >= 6.
 * - Adopting points = sum of officer_count for those eligible agencies that meet at least one rate threshold.
 * - APAP = (adopting points / eligible points) * 100. No labels (At Risk, etc.) are used.
 */
export function computeAPAP(
  agencies: Agency[],
  agencyLabels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>,
  cohortFilter?: { 
    time_since_purchase_cohort?: string[];
    agency_size_band?: string[];
    cew_type?: string[];
  }
): { apap: number; adoptingPoints: number; eligiblePoints: number; eligibleCount: number; adoptingCount: number } {
  const labelsMap = Array.isArray(agencyLabels)
    ? new Map(agencyLabels)
    : agencyLabels;

  // FILTER: Only include T10 customers for APAP calculation
  let filteredAgencies = agencies.filter(agency => agency.cew_type === 'T10');
  
  // Filter agencies by cohort if specified
  // Multiple values within a dimension use OR logic (union)
  // Multiple dimensions use AND logic (intersection)
  if (cohortFilter) {
    filteredAgencies = filteredAgencies.filter(agency => {
      // Check time_since_purchase_cohort filter
      if (cohortFilter.time_since_purchase_cohort && cohortFilter.time_since_purchase_cohort.length > 0) {
        if (!cohortFilter.time_since_purchase_cohort.includes(agency.purchase_cohort)) {
          return false;
        }
      }
      
      // Check agency_size_band filter
      if (cohortFilter.agency_size_band && cohortFilter.agency_size_band.length > 0) {
        if (!cohortFilter.agency_size_band.includes(agency.agency_size_band)) {
          return false;
        }
      }
      
      // Check cew_type filter
      if (cohortFilter.cew_type && cohortFilter.cew_type.length > 0) {
        if (!agency.cew_type || !cohortFilter.cew_type.includes(agency.cew_type)) {
          return false;
        }
      }
      
      return true;
    });
  }

  // Get eligible agencies (eligibility_cohort >= 6)
  // eligibility_cohort is the authoritative source for eligibility in each month's data
  // If eligibility_cohort is missing or null, the agency is NOT eligible (no fallback)
  const eligibleAgencies = filteredAgencies.filter(agency => {
    // Use eligibility_cohort directly from the uploaded data (month-specific snapshot)
    // Only count as eligible if eligibility_cohort is explicitly set and >= 6
    return agency.eligibility_cohort !== undefined && agency.eligibility_cohort !== null && agency.eligibility_cohort >= 6;
  });

  // Adopting for APAP = eligible + (R6 >= 0.75 OR R12 >= 2). Use metrics only; do not use labels (At Risk, etc.).
  const adoptingEligibleAgencies = eligibleAgencies.filter(agency => {
    const label = labelsMap.get(agency.agency_id);
    if (!label?.metrics) return false;
    const { R6, R12 } = label.metrics;
    return (R6 != null && R6 >= 0.75) || (R12 != null && R12 >= 2.0);
  });

  // Calculate points (officer_count)
  const eligiblePoints = eligibleAgencies.reduce((sum, agency) => sum + (agency.officer_count || 0), 0);
  const adoptingPoints = adoptingEligibleAgencies.reduce((sum, agency) => sum + (agency.officer_count || 0), 0);

  const apap = eligiblePoints > 0 ? (adoptingPoints / eligiblePoints) * 100 : 0;

  return {
    apap,
    adoptingPoints,
    eligiblePoints,
    eligibleCount: eligibleAgencies.length,
    adoptingCount: adoptingEligibleAgencies.length,
  };
}

