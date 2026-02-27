import type { Agency, AgencyMetrics, Label, SimTelemetryMonthly } from './schema';
import { computeAgencyMetrics } from './metrics';
import { projectNextMonthMetrics, projectNextQuarterMetrics } from './compute';
import { isAdoptingFromMetrics } from './domain';

/**
 * Find the last month an agency was adopting (within the previous 12 months).
 * Uses metrics module for C6/C12; domain for adoption check.
 */
export function findLastAdoptingMonth(
  agencyId: string,
  simTelemetry: SimTelemetryMonthly[],
  asOfMonth: Date,
  vrLicenses: number
): Date | null {
  const agencySimTelemetry = simTelemetry.filter((t) => t.agency_id === agencyId);
  if (agencySimTelemetry.length === 0) return null;

  const asOf = new Date(asOfMonth);
  const historicalMonths = agencySimTelemetry
    .filter((t) => t.month < asOf)
    .map((t) => t.month.getTime());

  if (historicalMonths.length === 0) return null;

  const uniqueMonths = Array.from(new Set(historicalMonths)).sort((a, b) => b - a);

  for (const monthTime of uniqueMonths.slice(0, 12)) {
    const historicalMonth = new Date(monthTime);
    const historicalMetrics = computeAgencyMetrics(
      agencyId,
      simTelemetry,
      historicalMonth,
      vrLicenses
    );
    if (historicalMetrics && isAdoptingFromMetrics(historicalMetrics)) {
      return historicalMonth;
    }
  }

  return null;
}

function wasPreviouslyAdopting(
  agencyId: string,
  simTelemetry: SimTelemetryMonthly[],
  asOfMonth: Date,
  currentMetrics: AgencyMetrics | null
): boolean {
  if (!currentMetrics) return false;
  return findLastAdoptingMonth(agencyId, simTelemetry, asOfMonth, currentMetrics.L) !== null;
}

/**
 * Compute label for an agency using pre-computed metrics.
 * Does not recompute metrics; uses domain helpers for adoption.
 */
export function computeLabel(
  agency: Agency,
  metrics: AgencyMetrics | null,
  simTelemetry: SimTelemetryMonthly[],
  asOfMonth: Date
): Label {
  if (!agency.vr_licenses || agency.vr_licenses <= 0) {
    return 'Unknown (No license count)';
  }
  if (agency.purchase_cohort === 'Ineligible') {
    return 'Ineligible (0–5 months)';
  }
  if (!metrics) {
    return 'Unknown (No license count)';
  }

  const isAdopting = isAdoptingFromMetrics(metrics);
  const previouslyAdopting = wasPreviouslyAdopting(
    agency.agency_id,
    simTelemetry,
    asOfMonth,
    metrics
  );

  if (previouslyAdopting && !isAdopting) {
    return 'Churned Out';
  }

  const nextMonthProjection = projectNextMonthMetrics(metrics, agency.agency_id, simTelemetry);
  if (isAdopting && nextMonthProjection.projectedLessThanDropped && !nextMonthProjection.adopting_next) {
    return 'At Risk (Next Month)';
  }

  const nextQuarterProjection = projectNextQuarterMetrics(metrics, agency.agency_id, simTelemetry);
  if (isAdopting && nextQuarterProjection.projectedLessThanDropped && !nextQuarterProjection.adopting_next_quarter) {
    return 'At Risk (Next Quarter)';
  }

  if (isAdopting) {
    return 'Adopting';
  }
  return 'Not Adopting';
}

const TOP_PERFORMERS_PER_LINE = 15;

/**
 * Compute all labels and metrics in one pass.
 * Returns labels map and metrics map so pipeline does not recompute metrics.
 */
export function computeLabelsForAgencies(
  agencies: Agency[],
  simTelemetry: SimTelemetryMonthly[],
  asOfMonth: Date
): { labelsMap: Map<string, Label>; metricsMap: Map<string, AgencyMetrics | null> } {
  const labelsMap = new Map<string, Label>();
  const metricsMap = new Map<string, AgencyMetrics | null>();
  const adoptingByLineSize = new Map<string, Array<{ agency_id: string; metrics: AgencyMetrics }>>();

  for (const agency of agencies) {
    const metrics = computeAgencyMetrics(
      agency.agency_id,
      simTelemetry,
      asOfMonth,
      agency.vr_licenses
    );
    metricsMap.set(agency.agency_id, metrics);

    const label = computeLabel(agency, metrics, simTelemetry, asOfMonth);
    labelsMap.set(agency.agency_id, label);

    if (
      metrics &&
      isAdoptingFromMetrics(metrics) &&
      label !== 'Ineligible (0–5 months)' &&
      label !== 'Unknown (No license count)' &&
      agency.agency_size_band !== 'Unknown (No officer count)'
    ) {
      const lineSize = agency.agency_size_band;
      if (!adoptingByLineSize.has(lineSize)) {
        adoptingByLineSize.set(lineSize, []);
      }
      adoptingByLineSize.get(lineSize)!.push({ agency_id: agency.agency_id, metrics });
    }
  }

  for (const adoptingAgencies of adoptingByLineSize.values()) {
    adoptingAgencies.sort((a, b) => b.metrics.C12 - a.metrics.C12);
    const top15 = adoptingAgencies.slice(0, TOP_PERFORMERS_PER_LINE);
    for (const { agency_id } of top15) {
      const currentLabel = labelsMap.get(agency_id);
      if (
        currentLabel === 'Adopting' ||
        currentLabel === 'At Risk (Next Month)' ||
        currentLabel === 'At Risk (Next Quarter)'
      ) {
        labelsMap.set(agency_id, 'Top Performer');
      }
    }
  }

  for (const agency of agencies) {
    if (agency.agency_size_band === 'Unknown (No officer count)') {
      const currentLabel = labelsMap.get(agency.agency_id);
      if (currentLabel === 'Top Performer') {
        labelsMap.set(agency.agency_id, 'Adopting');
      }
    }
  }

  return { labelsMap, metricsMap };
}
