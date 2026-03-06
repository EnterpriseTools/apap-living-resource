/**
 * Action List compute module (ACTION_LIST_SPEC.md).
 * Deterministic: no changes to SIM-only adoption label logic.
 */

import { format, parseISO, subMonths, addMonths } from 'date-fns';
import type { Agency, AgencyWithLabel, SimTelemetryMonthly } from './schema';
import type { HistoricalData, HistoricalDataEntry } from './history';
import { ACTION_LIST_CONFIG, getLineSizeFromOfficerCount, type LineSize } from '@/config/action_list_config';
import { calculateCompletionsNeeded, calculateCompletionsNeededToStayAdopting, calculateCompletionsNeededToStayAdoptingNextQuarter } from './compute';
import { isAdoptingFromMetrics, isEligible } from './domain';
import { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD } from '@/config/domain_constants';

export type ActionReason =
  | 'BASELINE_ADOPTER_CHURNED'
  | 'NEW_ADOPTER_CHURNED_2026'
  | 'AT_RISK_NEXT_MONTH'
  | 'AT_RISK_NEXT_QUARTER'
  | 'CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT'
  | 'CLOSE_TO_ADOPTING';

const REASON_PRIORITY: Record<ActionReason, number> = {
  BASELINE_ADOPTER_CHURNED: 1,
  NEW_ADOPTER_CHURNED_2026: 2,
  AT_RISK_NEXT_MONTH: 3,
  AT_RISK_NEXT_QUARTER: 4,
  CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT: 5,
  CLOSE_TO_ADOPTING: 6,
};

export type ProcessedDataInput = {
  agencies: Agency[];
  agencyLabels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>;
  simTelemetry: SimTelemetryMonthly[];
  asOfMonth: string | null;
};

export type BaselineProcessedDataInput = {
  agencies: Agency[];
  agencyLabels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>;
};

export type ActionListRow = {
  agency_id: string;
  agency_name: string;
  line_size: LineSize | 'Unknown';
  line_size_display: string;
  officer_count: number | null;
  vr_licenses: number | null;
  eligibility_cohort: number | null;
  months_since_purchase: number | null;
  current_status: 'Adopting' | 'Not Adopting' | 'Ineligible';
  baseline_eligible: boolean | null;
  baseline_adopting: boolean | null;
  R6: number | null;
  R12: number | null;
  primary_reason: ActionReason;
  reason_category: 'Churn' | 'Close';
  /** For Churn: which table (At Risk, 2025 Churned, 2026 Churned). */
  churn_display_group: 'AT_RISK' | 'BASELINE_CHURNED' | 'CHURN_THIS_MONTH' | null;
  /** Last month (YYYY-MM) agency was adopting; null if adopting or unknown. */
  last_adopting_month: string | null;
  /** First month (YYYY-MM) agency was not adopting (month churned); null if adopting or unknown. */
  month_churned: string | null;
  /** Completions needed this month to be adopting (min of T6/T12 gap including roll-off); null if adopting or no data. */
  completions_needed_this_month: number | null;
  secondary_reasons: ActionReason[];
  tags: string[];
  why_bullets: string[];
  not_adopting_streak: number;
  agency: Agency;
  label: AgencyWithLabel;
};

export type ActionListResult = {
  rows: ActionListRow[];
  baseline_available: boolean;
  counts_by_reason: Record<ActionReason, number>;
  data_quality: {
    excluded_unknown_line_size: number;
    excluded_missing_licenses: number;
    excluded_missing_eligibility: number;
  };
};

function labelsMap(labels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>): Map<string, AgencyWithLabel> {
  return Array.isArray(labels) ? new Map(labels) : labels;
}

function isAdoptingLabel(label: string): boolean {
  return label === 'Adopting' || label === 'Top Performer' || label === 'At Risk (Next Month)' || label === 'At Risk (Next Quarter)';
}

function wasAdoptingInLabels(entry: HistoricalDataEntry | undefined): Set<string> {
  const set = new Set<string>();
  if (!entry?.agencyLabels) return set;
  const arr = entry.agencyLabels as Array<[string, { label: string }]>;
  for (const [id, l] of arr) {
    if (isAdoptingLabel(l.label)) set.add(id);
  }
  return set;
}

function getAdoptionStatusLabel(label: string): ActionListRow['current_status'] {
  if (label === 'Ineligible (0–5 months)') return 'Ineligible';
  if (isAdoptingLabel(label)) return 'Adopting';
  if (label === 'At Risk (Next Month)' || label === 'At Risk (Next Quarter)') return 'Adopting'; // still adopting, at risk of dropping
  return 'Not Adopting';
}

function getReasonCategory(reason: ActionReason): 'Churn' | 'Close' {
  if (reason === 'CLOSE_TO_ADOPTING') return 'Close';
  return 'Churn';
}

function getChurnDisplayGroup(
  primary: ActionReason,
  tags: string[],
  baselineAdopting: boolean | null,
  labelLabel: string
): ActionListRow['churn_display_group'] {
  // At Risk: only agencies that are currently adopting (label is At Risk Next Month/Quarter)
  if ((primary === 'AT_RISK_NEXT_MONTH' || primary === 'AT_RISK_NEXT_QUARTER') &&
      (labelLabel === 'At Risk (Next Month)' || labelLabel === 'At Risk (Next Quarter)')) return 'AT_RISK';
  // 2025 Agencies Churned: was adopting in Nov 2025 baseline and is no longer
  if (primary === 'BASELINE_ADOPTER_CHURNED' || (tags.includes('RECENT_DROP') && baselineAdopting === true)) return 'BASELINE_CHURNED';
  // 2026 Agencies Churned: eligible, were once meeting threshold, now not, and was NOT (adopting and eligible) in Nov 2025
  if ((tags.includes('RECENT_DROP') || primary === 'NEW_ADOPTER_CHURNED_2026') && baselineAdopting !== true) return 'CHURN_THIS_MONTH';
  return 'BASELINE_CHURNED'; // fallback for other churn
}

export function buildActionList(
  processedData: ProcessedDataInput,
  historyData: HistoricalData,
  config: typeof ACTION_LIST_CONFIG,
  baselineProcessedData?: BaselineProcessedDataInput | null
): ActionListResult {
  const { agencies, agencyLabels, simTelemetry, asOfMonth } = processedData;
  const labels = labelsMap(agencyLabels);
  const asOf = asOfMonth ? parseISO(asOfMonth + '-01') : new Date();
  const baselineMonth = config.baselineMonth;
  const baselineEntry = historyData[baselineMonth];
  const baselineProcessed = baselineProcessedData ? {
    agencies: baselineProcessedData.agencies,
    labels: labelsMap(baselineProcessedData.agencyLabels),
  } : null;
  const baselineAvailable = !!(baselineProcessed || baselineEntry?.agencyLabels);

  // Deduplicate agencies by agency_id.
  // Some uploads can include duplicate agency rows; Action List should only show one row per agency.
  const uniqueAgenciesById = new Map<string, Agency>();
  const scoreAgency = (a: Agency): number => {
    let score = 0;
    if (a.agency_name) score += 1;
    if (a.officer_count != null) score += 1;
    if (a.vr_licenses != null) score += 1;
    if (a.eligibility_cohort != null) score += 1;
    if (a.months_since_purchase != null) score += 1;
    if (a.purchase_cohort) score += 1;
    if (a.agency_size_band) score += 1;
    if (a.purchase_date) score += 1;
    return score;
  };
  for (const a of agencies) {
    const id = String(a.agency_id);
    const existing = uniqueAgenciesById.get(id);
    if (!existing) {
      uniqueAgenciesById.set(id, a);
      continue;
    }
    // Prefer the "more complete" row; ties keep the existing row.
    if (scoreAgency(a) > scoreAgency(existing)) uniqueAgenciesById.set(id, a);
  }
  const dedupedAgencies = Array.from(uniqueAgenciesById.values());

  const baselineEligible = new Map<string, boolean>();
  const baselineAdopting = new Map<string, boolean>();
  if (baselineProcessed) {
    for (const a of baselineProcessed.agencies) {
      const elig = a.eligibility_cohort != null && a.eligibility_cohort >= 6;
      baselineEligible.set(a.agency_id, elig);
      const l = baselineProcessed.labels.get(a.agency_id);
      baselineAdopting.set(a.agency_id, !!(l && isAdoptingLabel(l.label)));
    }
  } else if (baselineEntry?.agencyLabels) {
    const arr = baselineEntry.agencyLabels as Array<[string, { label: string }]>;
    for (const [id, l] of arr) {
      baselineEligible.set(id, true);
      baselineAdopting.set(id, isAdoptingLabel(l.label));
    }
  }

  const hadAdoptingPostBaseline = new Map<string, boolean>();
  if (baselineAvailable && asOfMonth) {
    const baselineDate = parseISO(baselineMonth + '-01');
    const currentDate = parseISO(asOfMonth + '-01');
    const startAfterBaseline = new Date(baselineDate);
    startAfterBaseline.setMonth(startAfterBaseline.getMonth() + 1);
    for (let d = new Date(startAfterBaseline); d <= currentDate; d.setMonth(d.getMonth() + 1)) {
      const key = format(d, 'yyyy-MM');
      const entry = historyData[key];
      const adopting = wasAdoptingInLabels(entry);
      adopting.forEach((id) => hadAdoptingPostBaseline.set(id, true));
    }
  }

  const prevMonthKey = asOfMonth ? format(subMonths(parseISO(asOfMonth + '-01'), 1), 'yyyy-MM') : null;
  const prevMonthEntry = prevMonthKey ? historyData[prevMonthKey] : undefined;
  const prevMonthAdopting = wasAdoptingInLabels(prevMonthEntry);

  // Only count months where we have history data; don't assume "not adopting" for months with no data.
  const notAdoptingStreak = new Map<string, number>();
  if (asOfMonth) {
    const currentDate = parseISO(asOfMonth + '-01');
    const monthKeys: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const d = subMonths(currentDate, i);
      monthKeys.push(format(d, 'yyyy-MM'));
    }
    for (const agency of agencies) {
      const id = agency.agency_id;
      let streak = 0;
      for (const key of monthKeys) {
        const entry = historyData[key];
        if (!entry?.agencyLabels) break; // No data for this month — stop lookback; don't infer before data range
        const adopting = wasAdoptingInLabels(entry);
        if (!adopting.has(id)) streak++;
        else break;
      }
      notAdoptingStreak.set(id, streak);
    }
  }

  const dataQuality = {
    excluded_unknown_line_size: 0,
    excluded_missing_licenses: 0,
    excluded_missing_eligibility: 0,
  };
  const countsByReason: Record<ActionReason, number> = {
    BASELINE_ADOPTER_CHURNED: 0,
    NEW_ADOPTER_CHURNED_2026: 0,
    AT_RISK_NEXT_MONTH: 0,
    AT_RISK_NEXT_QUARTER: 0,
    CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT: 0,
    CLOSE_TO_ADOPTING: 0,
  };

  const rows: ActionListRow[] = [];
  const t10Agencies = dedupedAgencies.filter((a) => a.cew_type === 'T10');

  for (const agency of t10Agencies) {
    const label = labels.get(agency.agency_id);
    if (!label) continue;

    const lineSize = getLineSizeFromOfficerCount(agency.officer_count);
    const lineSizeDisplay = lineSize;

    const metrics = label.metrics;
    const vrLicenses = agency.vr_licenses && agency.vr_licenses > 0 ? agency.vr_licenses : null;
    const R6 = metrics?.R6 ?? null;
    const R12 = metrics?.R12 ?? null;
    const eligCohort = agency.eligibility_cohort ?? null;
    if (!isEligible(eligCohort)) continue;
    const metricsBasedAdopting = isAdoptingFromMetrics(label.metrics);
    const isAdopting = metricsBasedAdopting || (label ? isAdoptingLabel(label.label) : false);
    const currentStatus = getAdoptionStatusLabel(label.label);

    const reasons: ActionReason[] = [];

    if (baselineAvailable) {
      const wasBaselineAdopter = baselineAdopting.get(agency.agency_id) ?? false;
      const wasBaselineEligible = baselineEligible.get(agency.agency_id) ?? false;
      if (wasBaselineEligible && wasBaselineAdopter && !isAdopting) {
        reasons.push('BASELINE_ADOPTER_CHURNED');
      }
    }

    // 2026 Agencies Churned: eligible now, NOT a baseline adopter, had at least one post-baseline month adopting (or is labeled Churned Out),
    // and is no longer adopting. This intentionally includes agencies that became eligible after the baseline month.
    const wasBaselineAdopter = baselineAdopting.get(agency.agency_id) ?? false;
    const hadAdoptingPostBaselineOrChurnedOut =
      hadAdoptingPostBaseline.get(agency.agency_id) ||
      (label.label === 'Churned Out' && !wasBaselineAdopter);
    const is2026Churned =
      baselineAvailable &&
      !wasBaselineAdopter &&
      !isAdopting &&
      hadAdoptingPostBaselineOrChurnedOut;
    if (is2026Churned) {
      reasons.push('NEW_ADOPTER_CHURNED_2026');
    }

    if (label.label === 'At Risk (Next Month)') reasons.push('AT_RISK_NEXT_MONTH');
    if (label.label === 'At Risk (Next Quarter)') reasons.push('AT_RISK_NEXT_QUARTER');

    // Close to adopting: either metric at/above threshold (never require both).
    if (
      !isAdopting &&
      reasons.length === 0 &&
      ((R6 != null && R6 >= config.closeToAdoptR6Threshold) || (R12 != null && R12 >= config.closeToAdoptR12Threshold))
    ) {
      reasons.push('CLOSE_TO_ADOPTING');
    }

    if (reasons.length === 0) continue;

    const primary = reasons.slice().sort((a, b) => REASON_PRIORITY[a] - REASON_PRIORITY[b])[0];
    const secondary = reasons.filter((r) => r !== primary);
    reasons.forEach((r) => countsByReason[r]++);

    const tags: string[] = [];
    const streak = notAdoptingStreak.get(agency.agency_id) ?? 0;
    if (streak >= config.notAdoptingStreakTagMinMonths) {
      tags.push(`NOT_ADOPTING_STREAK_${streak}`);
    }
    if (!isAdopting && prevMonthAdopting.has(agency.agency_id)) {
      tags.push('RECENT_DROP');
    }

    const baseElig = baselineProcessed || baselineEntry?.agencyLabels ? (baselineEligible.get(agency.agency_id) ?? false) : null;
    const baseAdopt = baselineAvailable ? (baselineAdopting.get(agency.agency_id) ?? false) : null;
    const churnDisplayGroup = getReasonCategory(primary) === 'Churn' ? getChurnDisplayGroup(primary, tags, baseAdopt, label.label) : null;
    const lastAdoptingMonth =
      !isAdopting && asOfMonth
        ? (prevMonthKey && prevMonthAdopting.has(agency.agency_id)
            ? prevMonthKey
            : (streak >= 1
                ? format(subMonths(parseISO(asOfMonth + '-01'), streak), 'yyyy-MM')
                : null))
        : null;
    const monthChurned =
      lastAdoptingMonth && asOfMonth
        ? (lastAdoptingMonth === prevMonthKey ? asOfMonth : format(addMonths(parseISO(lastAdoptingMonth + '-01'), 1), 'yyyy-MM'))
        : null;
    let completionsNeededThisMonth: number | null = null;
    if (vrLicenses && label.metrics) {
      if (simTelemetry.length > 0) {
        if (isAdopting && primary === 'AT_RISK_NEXT_MONTH') {
          completionsNeededThisMonth = calculateCompletionsNeededToStayAdopting(agency.agency_id, label.metrics, simTelemetry);
        } else if (isAdopting && primary === 'AT_RISK_NEXT_QUARTER') {
          completionsNeededThisMonth = calculateCompletionsNeededToStayAdoptingNextQuarter(agency.agency_id, label.metrics, simTelemetry);
        } else if (!isAdopting) {
          const { t6, t12 } = calculateCompletionsNeeded(agency.agency_id, label.metrics, simTelemetry);
          completionsNeededThisMonth = Math.min(t6, t12);
        }
      } else if (!isAdopting) {
        // Fallback when we don't have month-by-month SIM telemetry (e.g., Snowflake snapshots).
        // This doesn't model roll-off, but it restores a useful "gap to threshold" signal.
        const L = label.metrics.L ?? 0;
        const C6 = label.metrics.C6 ?? 0;
        const C12 = label.metrics.C12 ?? 0;
        if (L > 0) {
          const t6 = Math.max(0, Math.ceil(ADOPTION_R6_THRESHOLD * L - C6));
          const t12 = Math.max(0, Math.ceil(ADOPTION_R12_THRESHOLD * L - C12));
          completionsNeededThisMonth = Math.min(t6, t12);
        }
      }
    }

    const whyBullets: string[] = [];
    if (primary === 'BASELINE_ADOPTER_CHURNED') {
      whyBullets.push('Adopting in 2025-11 baseline (eligible & met threshold).');
      whyBullets.push(`Not adopting in ${asOfMonth}; T6 Completions PP=${R6?.toFixed(2) ?? '—'}, T12 Completions PP=${R12?.toFixed(2) ?? '—'}.`);
      if (streak >= config.notAdoptingStreakTagMinMonths) {
        whyBullets.push(`Not adopting for ${streak} consecutive months.`);
      }
    } else if (primary === 'NEW_ADOPTER_CHURNED_2026') {
      whyBullets.push('Had at least one month after baseline where adopting=true.');
      whyBullets.push(`Not adopting in ${asOfMonth}; T6 Completions PP=${R6?.toFixed(2) ?? '—'}, T12 Completions PP=${R12?.toFixed(2) ?? '—'}.`);
    } else if (primary === 'AT_RISK_NEXT_MONTH' || primary === 'AT_RISK_NEXT_QUARTER') {
      whyBullets.push(`Projected to fall below adoption threshold (${primary === 'AT_RISK_NEXT_MONTH' ? 'next month' : 'within next quarter'}).`);
      if (metrics) {
        whyBullets.push(`T6 Completions PP=${metrics.R6?.toFixed(2) ?? '—'}, T12 Completions PP=${metrics.R12?.toFixed(2) ?? '—'}.`);
      }
    } else if (primary === 'CLOSE_TO_ADOPTING') {
      whyBullets.push(`Not adopting now; close to adoption thresholds: T6 Completions PP=${R6?.toFixed(2) ?? '—'} (need 0.75) or T12 Completions PP=${R12?.toFixed(2) ?? '—'} (need 2).`);
    }

    rows.push({
      not_adopting_streak: streak,
      agency_id: agency.agency_id,
      agency_name: agency.agency_name ?? '',
      line_size: lineSize,
      line_size_display: lineSizeDisplay,
      officer_count: agency.officer_count ?? null,
      vr_licenses: vrLicenses,
      eligibility_cohort: eligCohort,
      months_since_purchase: agency.months_since_purchase ?? null,
      current_status: currentStatus,
      baseline_eligible: baseElig,
      baseline_adopting: baseAdopt,
      R6,
      R12,
      primary_reason: primary,
      reason_category: getReasonCategory(primary),
      churn_display_group: churnDisplayGroup,
      last_adopting_month: lastAdoptingMonth,
      month_churned: monthChurned,
      completions_needed_this_month: completionsNeededThisMonth,
      secondary_reasons: secondary,
      tags,
      why_bullets: whyBullets,
      agency,
      label,
    });
  }

  return {
    rows,
    baseline_available: baselineAvailable,
    counts_by_reason: countsByReason,
    data_quality: dataQuality,
  };
}
