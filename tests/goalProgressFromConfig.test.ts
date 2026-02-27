/**
 * Tests for config-based goal progress (GOAL_MODEL_CONFIG_SPEC.md).
 * Verifies eligibility bucket mapping, officer_count mapping (0 => Direct), pointsGap/variancePp math.
 */

import {
  getLineSizeFromConfig,
  getEligBucketFromConfig,
  computeStructuralVarianceFromConfig,
  computeDriverProgressFromConfig,
  type ProcessedMonthData,
} from '../src/lib/goalProgressFromConfig';
import { GOAL_MODEL_CONFIG } from '../src/config/goal_model_config';
import type { Agency, AgencyWithLabel } from '../src/lib/schema';

function makeAgency(
  id: string,
  officerCount: number,
  eligibilityCohort: number,
  purchaseDate?: Date
): Agency {
  return {
    agency_id: id,
    agency_name: `Agency ${id}`,
    officer_count: officerCount,
    eligibility_cohort: eligibilityCohort,
    purchase_date: purchaseDate ?? new Date('2024-01-01'),
    vr_licenses: 10,
    agency_size_band: officerCount >= 501 ? 'Major' : officerCount >= 100 ? 'T1200' : 'Direct',
    months_since_purchase: eligibilityCohort,
    purchase_cohort: `Year ${Math.floor(eligibilityCohort / 12) + 1}`,
    as_of_month: new Date('2026-01-01'),
    cew_type: 'T10',
  };
}

function makeLabel(agencyId: string, adopting: boolean): AgencyWithLabel {
  const L = 10;
  return {
    agency_id: agencyId,
    agency_name: `Agency ${agencyId}`,
    label: adopting ? 'Adopting' : 'Not Adopting',
    metrics: adopting
      ? {
          agency_id: agencyId,
          L,
          C6: 60,
          C12: 240,
          R6: 0.75,
          R12: 2.0,
          last3Months: [10, 10, 10],
          as_of_month: new Date('2026-01-01'),
        }
      : null,
    cohorts: { purchase_cohort: '', agency_size_band: '' },
    why: [],
  };
}

describe('getLineSizeFromConfig', () => {
  it('maps officer_count >= 501 to Major', () => {
    expect(getLineSizeFromConfig(501)).toBe('Major');
    expect(getLineSizeFromConfig(600)).toBe('Major');
  });

  it('maps 100 <= officer_count <= 500 to T1200', () => {
    expect(getLineSizeFromConfig(100)).toBe('T1200');
    expect(getLineSizeFromConfig(500)).toBe('T1200');
  });

  it('maps officer_count < 100 to Direct', () => {
    expect(getLineSizeFromConfig(99)).toBe('Direct');
  });

  it('maps officer_count 0 to Direct', () => {
    expect(getLineSizeFromConfig(0)).toBe('Direct');
  });

  it('returns Unknown for missing or invalid officer_count', () => {
    expect(getLineSizeFromConfig(undefined)).toBe('Unknown');
    expect(getLineSizeFromConfig(null)).toBe('Unknown');
    expect(getLineSizeFromConfig(NaN)).toBe('Unknown');
  });
});

describe('getEligBucketFromConfig', () => {
  it('maps 6–12 to 6_12', () => {
    expect(getEligBucketFromConfig(6)).toBe('6_12');
    expect(getEligBucketFromConfig(12)).toBe('6_12');
  });

  it('maps 13–18 to 13_18', () => {
    expect(getEligBucketFromConfig(13)).toBe('13_18');
    expect(getEligBucketFromConfig(18)).toBe('13_18');
  });

  it('maps 19–24 to 19_24', () => {
    expect(getEligBucketFromConfig(19)).toBe('19_24');
    expect(getEligBucketFromConfig(24)).toBe('19_24');
  });

  it('maps 25+ to 25_plus', () => {
    expect(getEligBucketFromConfig(25)).toBe('25_plus');
    expect(getEligBucketFromConfig(36)).toBe('25_plus');
  });

  it('returns ineligible for 0–5', () => {
    expect(getEligBucketFromConfig(0)).toBe('ineligible');
    expect(getEligBucketFromConfig(5)).toBe('ineligible');
  });

  it('returns unknown for missing/invalid', () => {
    expect(getEligBucketFromConfig(undefined)).toBe('unknown');
    expect(getEligBucketFromConfig(null)).toBe('unknown');
  });
});

describe('computeStructuralVarianceFromConfig', () => {
  it('computes pointsGap and variancePp with synthetic data', () => {
    const agencies: Agency[] = [
      makeAgency('1', 200, 8),
      makeAgency('2', 200, 8),
      makeAgency('3', 50, 15),
    ];
    const labels = new Map<string, AgencyWithLabel>([
      ['1', makeLabel('1', true)],
      ['2', makeLabel('2', false)],
      ['3', makeLabel('3', true)],
    ]);

    const data: ProcessedMonthData = {
      agencies,
      agencyLabels: labels,
      asOfMonth: '2026-01',
    };

    const result = computeStructuralVarianceFromConfig(data, GOAL_MODEL_CONFIG, 'high_confidence');

    expect(result.totalEligiblePoints).toBe(200 + 200 + 50);
    expect(result.totalAdoptingPoints).toBe(200 + 0 + 50);

    const t1200_6_12 = result.cohortRows.find(
      (r) => r.lineSize === 'T1200' && r.eligBucket === '6_12'
    );
    expect(t1200_6_12).toBeDefined();
    expect(t1200_6_12!.eligiblePointsActual).toBe(400);
    expect(t1200_6_12!.adoptingPointsActual).toBe(200);
    expect(t1200_6_12!.apapActualRate).toBe(0.5);
    const targetRate = GOAL_MODEL_CONFIG.structuralTargets.high_confidence.T1200['6_12'];
    expect(t1200_6_12!.targetApapRate).toBe(targetRate);
    expect(t1200_6_12!.variancePp).toBeCloseTo((0.5 - targetRate) * 100);
    expect(t1200_6_12!.requiredAdoptingPoints).toBe(targetRate * 400);
    expect(t1200_6_12!.pointsGap).toBeCloseTo(targetRate * 400 - 200);
  });

  it('excludes unknown line size and counts in dataQuality', () => {
    const agencies: Agency[] = [
      makeAgency('1', 200, 8),
      { ...makeAgency('2', 200, 8), officer_count: undefined },
    ];
    const labels = new Map<string, AgencyWithLabel>([
      ['1', makeLabel('1', true)],
      ['2', makeLabel('2', false)],
    ]);
    const data: ProcessedMonthData = {
      agencies,
      agencyLabels: labels,
      asOfMonth: '2026-01',
    };
    const result = computeStructuralVarianceFromConfig(data, GOAL_MODEL_CONFIG, 'high_confidence');
    expect(result.dataQuality.excludedUnknownLineSize).toBe(1);
  });
});

describe('computeDriverProgressFromConfig', () => {
  it('returns insufficient_baseline when baseline month data is null', () => {
    const data: ProcessedMonthData = {
      agencies: [makeAgency('1', 200, 8)],
      agencyLabels: new Map([['1', makeLabel('1', true)]]),
      asOfMonth: '2026-01',
    };
    const result = computeDriverProgressFromConfig(
      data,
      null,
      GOAL_MODEL_CONFIG,
      'high_confidence'
    );
    expect(result.baselineAvailable).toBe(false);
    const retentionRows = result.rows.filter((r) => r.driver === 'retention');
    expect(retentionRows.every((r) => r.status === 'insufficient_baseline')).toBe(true);
  });
});
