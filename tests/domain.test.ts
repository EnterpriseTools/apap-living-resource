/**
 * Tests for canonical domain helpers (domain_constants + domain.ts).
 * Prevents regressions on eligibility, adoption thresholds, and line size bands.
 */

import {
  getLineSizeBand,
  isEligible,
  isAdoptingFromMetrics,
  ADOPTION_R6_THRESHOLD,
  ADOPTION_R12_THRESHOLD,
  ELIGIBILITY_MIN_COHORT,
} from '../src/lib/domain';

describe('getLineSizeBand', () => {
  it('maps officer_count 0 to Direct', () => {
    expect(getLineSizeBand(0)).toBe('Direct');
  });

  it('maps officer_count 99 to Direct', () => {
    expect(getLineSizeBand(99)).toBe('Direct');
  });

  it('maps officer_count 100 to T1200', () => {
    expect(getLineSizeBand(100)).toBe('T1200');
  });

  it('maps officer_count 500 to T1200', () => {
    expect(getLineSizeBand(500)).toBe('T1200');
  });

  it('maps officer_count 501 to Major', () => {
    expect(getLineSizeBand(501)).toBe('Major');
  });

  it('returns null for null/undefined/NaN', () => {
    expect(getLineSizeBand(null)).toBeNull();
    expect(getLineSizeBand(undefined)).toBeNull();
    expect(getLineSizeBand(NaN)).toBeNull();
  });

  it('treats negative as Direct', () => {
    expect(getLineSizeBand(-1)).toBe('Direct');
  });
});

describe('isEligible', () => {
  it('returns false for 5', () => {
    expect(isEligible(5)).toBe(false);
  });

  it('returns true for 6', () => {
    expect(isEligible(6)).toBe(true);
  });

  it('returns true for 7 and above', () => {
    expect(isEligible(7)).toBe(true);
    expect(isEligible(12)).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isEligible(null)).toBe(false);
    expect(isEligible(undefined)).toBe(false);
  });
});

describe('isAdoptingFromMetrics', () => {
  it('returns true when R6 >= threshold', () => {
    expect(isAdoptingFromMetrics({ R6: ADOPTION_R6_THRESHOLD, R12: null })).toBe(true);
    expect(isAdoptingFromMetrics({ R6: 1, R12: 0 })).toBe(true);
  });

  it('returns true when R12 >= threshold', () => {
    expect(isAdoptingFromMetrics({ R6: null, R12: ADOPTION_R12_THRESHOLD })).toBe(true);
    expect(isAdoptingFromMetrics({ R6: 0, R12: 2.5 })).toBe(true);
  });

  it('returns true when either threshold is met (metrics present)', () => {
    expect(isAdoptingFromMetrics({ R6: 0.75, R12: 2.0 })).toBe(true);
    expect(isAdoptingFromMetrics({ R6: 0.8, R12: 1.0 })).toBe(true);
  });

  it('returns false when both below threshold', () => {
    expect(isAdoptingFromMetrics({ R6: 0.5, R12: 1.0 })).toBe(false);
    expect(isAdoptingFromMetrics({ R6: 0.74, R12: 1.99 })).toBe(false);
  });

  it('returns false for null/undefined metrics', () => {
    expect(isAdoptingFromMetrics(null)).toBe(false);
    expect(isAdoptingFromMetrics(undefined)).toBe(false);
  });

  it('boundary: R6 exactly 0.75 is adopting', () => {
    expect(isAdoptingFromMetrics({ R6: 0.75, R12: null })).toBe(true);
  });

  it('boundary: R12 exactly 2.0 is adopting', () => {
    expect(isAdoptingFromMetrics({ R6: null, R12: 2.0 })).toBe(true);
  });
});

describe('constants', () => {
  it('ELIGIBILITY_MIN_COHORT is 6', () => {
    expect(ELIGIBILITY_MIN_COHORT).toBe(6);
  });

  it('ADOPTION_R6_THRESHOLD is 0.75', () => {
    expect(ADOPTION_R6_THRESHOLD).toBe(0.75);
  });

  it('ADOPTION_R12_THRESHOLD is 2.0', () => {
    expect(ADOPTION_R12_THRESHOLD).toBe(2.0);
  });
});
