/**
 * Canonical domain helpers. All adoption/eligibility/line-size logic should use these.
 * Thresholds and bands come from domain_constants.
 */

import {
  ELIGIBILITY_MIN_COHORT,
  ADOPTION_R6_THRESHOLD,
  ADOPTION_R12_THRESHOLD,
  type LineSizeBand,
} from '@/config/domain_constants';

/** Metrics shape used for adoption check (R6, R12, L optional). */
export type AdoptionMetricsLike = {
  R6?: number | null;
  R12?: number | null;
  L?: number | null;
};

/**
 * Get line size band from officer_count. 0 => Direct; < 100 => Direct; 100..500 => T1200; >= 501 => Major.
 * Returns null for null/undefined/NaN (caller uses schema 'Unknown (No officer count)').
 */
export function getLineSizeBand(officerCount: number | null | undefined): LineSizeBand | null {
  if (
    officerCount === undefined ||
    officerCount === null ||
    typeof officerCount !== 'number' ||
    Number.isNaN(officerCount)
  ) {
    return null;
  }
  if (officerCount < 0) return 'Direct';
  if (officerCount < 100) return 'Direct';
  if (officerCount <= 500) return 'T1200';
  return 'Major';
}

/**
 * Eligibility: eligibility_cohort >= ELIGIBILITY_MIN_COHORT (6).
 */
export function isEligible(eligibilityCohort: number | null | undefined): boolean {
  if (eligibilityCohort === null || eligibilityCohort === undefined) return false;
  if (typeof eligibilityCohort !== 'number' || Number.isNaN(eligibilityCohort)) return false;
  return eligibilityCohort >= ELIGIBILITY_MIN_COHORT;
}

/**
 * Adopting (SIM-only) when at least one metric is present and meets threshold: R6 >= 0.75 OR R12 >= 2.0.
 * Does not require both; metrics must be present where checked.
 */
export function isAdoptingFromMetrics(metrics: AdoptionMetricsLike | null | undefined): boolean {
  if (!metrics) return false;
  const r6 = metrics.R6;
  const r12 = metrics.R12;
  return (
    (r6 != null && r6 >= ADOPTION_R6_THRESHOLD) ||
    (r12 != null && r12 >= ADOPTION_R12_THRESHOLD)
  );
}

export { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD, ELIGIBILITY_MIN_COHORT };
export type { LineSizeBand };
