/**
 * Tests for Action List compute module (ACTION_LIST_SPEC.md).
 */

import { buildActionList, type ProcessedDataInput, type BaselineProcessedDataInput } from '../src/lib/actionList';
import { ACTION_LIST_CONFIG, getLineSizeFromOfficerCount } from '../src/config/action_list_config';
import type { Agency, AgencyWithLabel } from '../src/lib/schema';
import type { HistoricalData } from '../src/lib/history';

function makeAgency(overrides: Partial<Agency> & { agency_id: string }): Agency {
  return {
    agency_id: overrides.agency_id,
    agency_name: overrides.agency_name ?? 'Test Agency',
    vr_licenses: overrides.vr_licenses ?? 10,
    officer_count: overrides.officer_count ?? 100,
    eligibility_cohort: overrides.eligibility_cohort,
    months_since_purchase: overrides.months_since_purchase ?? 12,
    purchase_cohort: overrides.purchase_cohort ?? 'Year 1',
    agency_size_band: overrides.agency_size_band ?? 'T1200',
    as_of_month: overrides.as_of_month ?? null,
    cew_type: overrides.cew_type ?? 'T10',
    ...overrides,
  } as Agency;
}

function makeLabel(agencyId: string, label: AgencyWithLabel['label'], metrics?: { R6: number; R12: number }): AgencyWithLabel {
  return {
    agency_id: agencyId,
    agency_name: 'Test Agency',
    label,
    metrics: metrics ? { agency_id: agencyId, L: 10, C6: metrics.R6 * 10, C12: metrics.R12 * 10, R6: metrics.R6, R12: metrics.R12, last3Months: [1, 1, 1], as_of_month: new Date() } : null,
    cohorts: { purchase_cohort: 'Year 1', agency_size_band: 'T1200' },
    why: [],
    recommended_action: 'Review',
  };
}

describe('actionList', () => {
  describe('getLineSizeFromOfficerCount', () => {
    it('maps Major >= 501, T1200 100..500, Direct < 100', () => {
      expect(getLineSizeFromOfficerCount(501)).toBe('Major');
      expect(getLineSizeFromOfficerCount(600)).toBe('Major');
      expect(getLineSizeFromOfficerCount(100)).toBe('T1200');
      expect(getLineSizeFromOfficerCount(500)).toBe('T1200');
    expect(getLineSizeFromOfficerCount(99)).toBe('Direct');
    expect(getLineSizeFromOfficerCount(0)).toBe('Direct');
      expect(getLineSizeFromOfficerCount(null)).toBe('Unknown');
      expect(getLineSizeFromOfficerCount(undefined)).toBe('Unknown');
    });
  });

  describe('buildActionList', () => {
    it('disables BASELINE_ADOPTER_CHURNED when baseline missing and shows baseline_available false', () => {
      const processed: ProcessedDataInput = {
        agencies: [
          makeAgency({ agency_id: 'A1', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
        ],
        agencyLabels: new Map([['A1', makeLabel('A1', 'Not Adopting', { R6: 0.3, R12: 0.8 })]]) as unknown as Map<string, AgencyWithLabel>,
        simTelemetry: [],
        asOfMonth: '2026-01',
      };
      const history: HistoricalData = {};
      const result = buildActionList(processed, history, ACTION_LIST_CONFIG, null);
      expect(result.baseline_available).toBe(false);
      const rowA1 = result.rows.find((r) => r.agency_id === 'A1');
      if (rowA1) {
        expect(rowA1.primary_reason).not.toBe('BASELINE_ADOPTER_CHURNED');
      }
    });

    it('assigns BASELINE_ADOPTER_CHURNED when baseline history exists and agency was adopting in baseline but not now', () => {
      const processed: ProcessedDataInput = {
        agencies: [
          makeAgency({ agency_id: 'B1', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
        ],
        agencyLabels: new Map([['B1', makeLabel('B1', 'Not Adopting', { R6: 0.3, R12: 0.8 })]]) as unknown as Map<string, AgencyWithLabel>,
        simTelemetry: [],
        asOfMonth: '2026-01',
      };
      const history: HistoricalData = {
        '2025-11': {
          asOfMonth: '2025-11-01T00:00:00.000Z',
          simTelemetry: [],
          cohortSummaries: {},
          agencyLabels: [['B1', { agency_id: 'B1', label: 'Adopting' }]],
        } as any,
      };
      const result = buildActionList(processed, history, ACTION_LIST_CONFIG, null);
      expect(result.baseline_available).toBe(true);
      const row = result.rows.find((r) => r.agency_id === 'B1');
      expect(row).toBeDefined();
      expect(row!.primary_reason).toBe('BASELINE_ADOPTER_CHURNED');
    });

    it('resolves primary reason to highest priority when agency matches multiple reasons', () => {
      const processed: ProcessedDataInput = {
        agencies: [
          makeAgency({ agency_id: 'C1', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
        ],
        agencyLabels: new Map([['C1', makeLabel('C1', 'At Risk (Next Month)', { R6: 0.6, R12: 1.8 })]]) as unknown as Map<string, AgencyWithLabel>,
        simTelemetry: [],
        asOfMonth: '2026-01',
      };
      const history: HistoricalData = {};
      const result = buildActionList(processed, history, ACTION_LIST_CONFIG, null);
      const row = result.rows.find((r) => r.agency_id === 'C1');
      expect(row).toBeDefined();
      expect(row!.primary_reason).toBe('AT_RISK_NEXT_MONTH');
    });

    it('includes CLOSE_TO_ADOPTING when eligible, not adopting, and R6 >= 0.5 or R12 >= 1.5', () => {
      const processed: ProcessedDataInput = {
        agencies: [
          makeAgency({ agency_id: 'D1', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
          makeAgency({ agency_id: 'D2', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
        ],
        agencyLabels: new Map([
          ['D1', makeLabel('D1', 'Not Adopting', { R6: 0.15, R12: 0.3 })],
          ['D2', makeLabel('D2', 'Not Adopting', { R6: 0.6, R12: 1.2 })],
        ]) as unknown as Map<string, AgencyWithLabel>,
        simTelemetry: [],
        asOfMonth: '2026-01',
      };
      const history: HistoricalData = {};
      const result = buildActionList(processed, history, ACTION_LIST_CONFIG, null);
      const rowD1 = result.rows.find((r) => r.agency_id === 'D1');
      const rowD2 = result.rows.find((r) => r.agency_id === 'D2');
      expect(rowD1).toBeUndefined();
      expect(rowD2).toBeDefined();
      expect(rowD2!.primary_reason).toBe('CLOSE_TO_ADOPTING');
    });

    it('includes CLOSE_TO_ADOPTING when not adopting and R6 >= 0.5 or R12 >= 1.5, and excludes when already in A–E', () => {
      const processed: ProcessedDataInput = {
        agencies: [
          makeAgency({ agency_id: 'E1', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
          makeAgency({ agency_id: 'E2', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
        ],
        agencyLabels: new Map([
          ['E1', makeLabel('E1', 'Not Adopting', { R6: 0.6, R12: 1.2 })],
          ['E2', makeLabel('E2', 'Not Adopting', { R6: 0.3, R12: 0.5 })],
        ]) as unknown as Map<string, AgencyWithLabel>,
        simTelemetry: [],
        asOfMonth: '2026-01',
      };
      const history: HistoricalData = {};
      const result = buildActionList(processed, history, ACTION_LIST_CONFIG, null);
      const rowE1 = result.rows.find((r) => r.agency_id === 'E1');
      const rowE2 = result.rows.find((r) => r.agency_id === 'E2');
      expect(rowE1).toBeDefined();
      expect(rowE1!.primary_reason).toBe('CLOSE_TO_ADOPTING');
      expect(rowE2).toBeUndefined();
    });

    it('computes NOT_ADOPTING_STREAK_N tag when streak >= config minimum', () => {
      const processed: ProcessedDataInput = {
        agencies: [
          makeAgency({ agency_id: 'F1', officer_count: 200, vr_licenses: 10, eligibility_cohort: 8 }),
        ],
        agencyLabels: new Map([['F1', makeLabel('F1', 'Not Adopting', { R6: 0.6, R12: 1.5 })]]) as unknown as Map<string, AgencyWithLabel>,
        simTelemetry: [],
        asOfMonth: '2026-01',
      };
      const history: HistoricalData = {
        '2026-01': { asOfMonth: '', simTelemetry: [], cohortSummaries: {}, agencyLabels: [['F1', { agency_id: 'F1', label: 'Not Adopting' }]] } as any,
        '2025-12': { asOfMonth: '', simTelemetry: [], cohortSummaries: {}, agencyLabels: [['F1', { agency_id: 'F1', label: 'Not Adopting' }]] } as any,
        '2025-11': { asOfMonth: '', simTelemetry: [], cohortSummaries: {}, agencyLabels: [['F1', { agency_id: 'F1', label: 'Not Adopting' }]] } as any,
      };
      const result = buildActionList(processed, history, ACTION_LIST_CONFIG, null);
      const row = result.rows.find((r) => r.agency_id === 'F1');
      expect(row).toBeDefined();
      expect(row!.tags.some((t) => t.startsWith('NOT_ADOPTING_STREAK_'))).toBe(true);
      expect(row!.not_adopting_streak).toBeGreaterThanOrEqual(ACTION_LIST_CONFIG.notAdoptingStreakTagMinMonths);
    });
  });
});
