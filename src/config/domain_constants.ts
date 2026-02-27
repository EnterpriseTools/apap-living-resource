/**
 * Single source-of-truth for domain rules (STEP_0_SPEC, PRD).
 * Do not change adoption/eligibility thresholds without product approval.
 */

/** Eligibility: eligibility_cohort >= this value means eligible. */
export const ELIGIBILITY_MIN_COHORT = 6;

/** Adoption (SIM-only): R6 completions per license >= this meets threshold. */
export const ADOPTION_R6_THRESHOLD = 0.75;

/** Adoption (SIM-only): R12 completions per license >= this meets threshold. */
export const ADOPTION_R12_THRESHOLD = 2.0;

/**
 * Line size bands by officer_count (inclusive).
 * Direct: < 100 (including 0)
 * T1200: 100..500
 * Major: >= 501
 */
export const LINE_SIZE_BANDS = {
  Direct: { min: 0, max: 99 },
  T1200: { min: 100, max: 500 },
  Major: { min: 501, max: Infinity },
} as const;

/**
 * Treat officer_count 0 as Direct (not Unknown).
 * Missing/null/undefined officer_count remains Unknown (No officer count) for schema.
 */
export const OFFICER_COUNT_ZERO_HANDLING = 'Direct' as const;

export type LineSizeBand = 'Major' | 'T1200' | 'Direct';
