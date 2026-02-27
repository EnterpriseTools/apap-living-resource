/**
 * Minimal integration test: telemetry → metrics → adoption check → label.
 * Verifies inclusive lookback, C6/C12/R6/R12, isAdoptingFromMetrics, and label.
 */

import { getTrailingMonthKeys, parseMonthKey } from '../src/lib/timeWindows';
import { computeAgencyMetrics } from '../src/lib/metrics';
import { isAdoptingFromMetrics } from '../src/lib/domain';
import { computeLabel, computeLabelsForAgencies } from '../src/lib/labels';
import type { Agency, SimTelemetryMonthly } from '../src/lib/schema';
import { startOfMonth } from 'date-fns';

const AS_OF = '2026-01';
const AS_OF_DATE = startOfMonth(new Date(2026, 0, 1));

function makeSim(agencyId: string, asOfMonthKey: string, n: number, completionsPerMonth: number): SimTelemetryMonthly[] {
  const keys = getTrailingMonthKeys(asOfMonthKey, n);
  return keys.map((key) => ({
    agency_id: agencyId,
    month: parseMonthKey(key),
    completions: completionsPerMonth,
    product: 'Simulator Training' as const,
  }));
}

describe('integration adoption pipeline', () => {
  it('computes C6/C12/R6/R12 with inclusive window and isAdoptingFromMetrics + label', () => {
    const L = 10;
    const simA = makeSim('A1', AS_OF, 12, 8);
    const simB = makeSim('B1', AS_OF, 12, 1);

    const metricsA = computeAgencyMetrics('A1', simA, AS_OF_DATE, L);
    const metricsB = computeAgencyMetrics('B1', simB, AS_OF_DATE, L);

    expect(metricsA).not.toBeNull();
    expect(metricsB).not.toBeNull();

    const t6Keys = getTrailingMonthKeys(AS_OF, 6);
    const t12Keys = getTrailingMonthKeys(AS_OF, 12);
    expect(t6Keys).toHaveLength(6);
    expect(t12Keys).toHaveLength(12);
    expect(t12Keys[t12Keys.length - 1]).toBe(AS_OF);

    expect(metricsA!.C6).toBe(6 * 8);
    expect(metricsA!.C12).toBe(12 * 8);
    expect(metricsA!.R6).toBe(48 / L);
    expect(metricsA!.R12).toBe(96 / L);
    expect(metricsA!.R6).toBeGreaterThanOrEqual(0.75);
    expect(metricsA!.R12).toBeGreaterThanOrEqual(2.0);
    expect(isAdoptingFromMetrics(metricsA)).toBe(true);

    expect(metricsB!.C12).toBe(12);
    expect(metricsB!.R12).toBe(12 / L);
    expect(metricsB!.R6).toBe(6 / L);
    expect(isAdoptingFromMetrics(metricsB)).toBe(false);

    const agencyA: Agency = {
      agency_id: 'A1',
      agency_name: 'Agency A',
      agency_size_band: 'Direct',
      months_since_purchase: 12,
      purchase_cohort: 'Year 1 (6–12 months)',
      as_of_month: AS_OF_DATE,
      vr_licenses: L,
      officer_count: 50,
    };
    const agencyB: Agency = {
      ...agencyA,
      agency_id: 'B1',
      agency_name: 'Agency B',
    };

    const labelA = computeLabel(agencyA, metricsA, simA, AS_OF_DATE);
    const labelB = computeLabel(agencyB, metricsB, simB, AS_OF_DATE);
    expect(labelA).toBe('Adopting');
    expect(labelB).toBe('Not Adopting');

    const simAll = [...simA, ...simB];
    const agencies: Agency[] = [agencyA, agencyB];
    const { labelsMap } = computeLabelsForAgencies(agencies, simAll, AS_OF_DATE);
    expect(['Adopting', 'Top Performer']).toContain(labelsMap.get('A1'));
    expect(labelsMap.get('B1')).toBe('Not Adopting');
  });
});
