import { computeLabel, computeLabelsForAgencies } from '../src/lib/labels';
import type { Agency, SimTelemetryMonthly } from '../src/lib/schema';
import { startOfMonth } from 'date-fns';
import { getTrailingMonthKeys, parseMonthKey } from '../src/lib/timeWindows';
import { makeSimTelemetryForTrailingMonths } from './helpers/makeTelemetry';
import { computeAgencyMetrics } from '../src/lib/metrics';

function getMetrics(agency: Agency, simTelemetry: SimTelemetryMonthly[], asOfMonth: Date) {
  return computeAgencyMetrics(agency.agency_id, simTelemetry, asOfMonth, agency.vr_licenses);
}

describe('Label Logic', () => {
  const asOfMonth = startOfMonth(new Date('2024-01-01'));
  const asOfMonthKey = '2024-01';

  const baseAgency: Agency = {
    agency_id: 'TEST001',
    agency_name: 'Test Agency',
    agency_size_band: 'Direct',
    months_since_purchase: 12,
    time_since_purchase_cohort: 'Year 1 (6–12 months)',
    purchase_cohort: 'Year 1 (6–12 months)',
    as_of_month: asOfMonth,
    vr_licenses: 10,
    purchase_date: new Date('2023-01-01'),
    officer_count: 50,
  };

  describe('Unknown (No license count)', () => {
    it('should return Unknown when vr_licenses is missing', () => {
      const agency: Agency = {
        ...baseAgency,
        vr_licenses: undefined,
      };
      const simTelemetry: SimTelemetryMonthly[] = [];
      const metrics = getMetrics(agency, simTelemetry, asOfMonth);
      const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
      expect(label).toBe('Unknown (No license count)');
    });

    it('should return Unknown when vr_licenses is 0', () => {
      const agency: Agency = {
        ...baseAgency,
        vr_licenses: 0,
      };
      const simTelemetry: SimTelemetryMonthly[] = [];
      const metrics = getMetrics(agency, simTelemetry, asOfMonth);
      const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
      expect(label).toBe('Unknown (No license count)');
    });
  });

  describe('Ineligible (0–5 months)', () => {
    it('should return Ineligible when purchase_cohort is Ineligible (0–5 months)', () => {
      const agency: Agency = {
        ...baseAgency,
        months_since_purchase: 3,
        time_since_purchase_cohort: 'Ineligible (0–5 months)',
        purchase_cohort: 'Ineligible',
        vr_licenses: 10,
      };
      const simTelemetry: SimTelemetryMonthly[] = [];
      const metrics = getMetrics(agency, simTelemetry, asOfMonth);
      const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
      expect(label).toBe('Ineligible (0–5 months)');
    });
  });

  describe('Few months of data in trailing window', () => {
    it('should return Not Adopting when fewer than 6 months of data in T6 window and completions below threshold', () => {
      const agency: Agency = {
        ...baseAgency,
        months_since_purchase: 12,
        time_since_purchase_cohort: 'Year 1 (6–12 months)',
        purchase_cohort: 'Year 1 (6–12 months)',
      };
      const keys = getTrailingMonthKeys(asOfMonthKey, 2);
      const simTelemetry: SimTelemetryMonthly[] = keys.map((key) => ({
        agency_id: 'TEST001',
        month: parseMonthKey(key),
        product: 'Simulator Training',
        completions: 2,
      }));
      const metrics = getMetrics(agency, simTelemetry, asOfMonth);
      const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
      expect(label).toBe('Not Adopting');
    });
  });

  describe('Adopting', () => {
    it('should return Adopting when R12 >= 2.0', () => {
      const agency: Agency = {
        ...baseAgency,
        months_since_purchase: 12,
        time_since_purchase_cohort: 'Year 1 (6–12 months)',
        purchase_cohort: 'Year 1 (6–12 months)',
      };
      const simTelemetry = makeSimTelemetryForTrailingMonths('TEST001', asOfMonthKey, 12, 25);
      const metrics = getMetrics(agency, simTelemetry, asOfMonth);
      const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
      expect(label).toBe('Adopting');
    });

    it('should return Adopting when R6 >= 0.75', () => {
      const agency: Agency = {
        ...baseAgency,
        months_since_purchase: 12,
        time_since_purchase_cohort: 'Year 1 (6–12 months)',
        purchase_cohort: 'Year 1 (6–12 months)',
      };
      const t6 = makeSimTelemetryForTrailingMonths('TEST001', asOfMonthKey, 6, 10);
      const t12Older = getTrailingMonthKeys(asOfMonthKey, 12).slice(0, 6).map((key) => ({
        agency_id: 'TEST001',
        month: parseMonthKey(key),
        product: 'Simulator Training' as const,
        completions: 1,
      }));
      const simTelemetry = [...t12Older, ...t6];
      const metrics = getMetrics(agency, simTelemetry, asOfMonth);
      const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
      expect(label).toBe('Adopting');
    });
  });

  describe('Not Adopting', () => {
    it('should return Not Adopting when R12 < 2.0 and R6 < 0.75', () => {
      const agency: Agency = {
        ...baseAgency,
        months_since_purchase: 12,
        time_since_purchase_cohort: 'Year 1 (6–12 months)',
        purchase_cohort: 'Year 1 (6–12 months)',
      };
      const simTelemetry = makeSimTelemetryForTrailingMonths('TEST001', asOfMonthKey, 12, 1);
      const metrics = getMetrics(agency, simTelemetry, asOfMonth);
      const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
      expect(label).toBe('Not Adopting');
    });
  });

  describe('Top Performer', () => {
    it('should return Top Performer when R12 >= 3.0 (via computeLabelsForAgencies)', () => {
      const agency: Agency = {
        ...baseAgency,
        months_since_purchase: 12,
        time_since_purchase_cohort: 'Year 1 (6–12 months)',
        purchase_cohort: 'Year 1 (6–12 months)',
        agency_size_band: 'T1200',
      };
      const simTelemetry = makeSimTelemetryForTrailingMonths('TEST001', asOfMonthKey, 12, 35);
      const { labelsMap } = computeLabelsForAgencies([agency], simTelemetry, asOfMonth);
      expect(labelsMap.get('TEST001')).toBe('Top Performer');
    });

    it('should return Top Performer when R6 >= 1.25 (via computeLabelsForAgencies)', () => {
      const agency: Agency = {
        ...baseAgency,
        months_since_purchase: 12,
        time_since_purchase_cohort: 'Year 1 (6–12 months)',
        purchase_cohort: 'Year 1 (6–12 months)',
        agency_size_band: 'T1200',
      };
      const t6 = makeSimTelemetryForTrailingMonths('TEST001', asOfMonthKey, 6, 15);
      const t12Older = getTrailingMonthKeys(asOfMonthKey, 12).slice(0, 6).map((key) => ({
        agency_id: 'TEST001',
        month: parseMonthKey(key),
        product: 'Simulator Training' as const,
        completions: 1,
      }));
      const simTelemetry = [...t12Older, ...t6];
      const { labelsMap } = computeLabelsForAgencies([agency], simTelemetry, asOfMonth);
      expect(labelsMap.get('TEST001')).toBe('Top Performer');
    });
  });
});

