import { parseISO, startOfMonth } from 'date-fns';
import type {
  AgencyRow,
  Agency,
  TelemetryMonthly,
  SimTelemetryMonthly,
  AgencyWithLabel,
  DataQualityReport,
} from './schema';
import { normalizeTelemetry, generateDataQualityReport } from './ingest';
import { computeAsOfMonth } from './compute';
import { enrichAgency } from './cohorts';
import { computeLabelsForAgencies, findLastAdoptingMonth } from './labels';
import { generateWhyBullets, getRecommendedAction } from './explain';
import { isNearEligible } from './cohorts';
import { generateCohortSummaries, type CohortSummary } from './aggregate';
import { mergeTelemetryWithHistory, getPreviousMonthCohortSummaries, getPreviousQuarterCohortSummaries } from './history';
import { computeUsageRollups, type UsageRollups } from './usageRollups';
import { toMonthKey } from './timeWindows';

/**
 * Main pipeline: process agencies and telemetry, compute labels and metrics.
 * When selectedMonthKey (YYYY-MM) is provided, telemetry is filtered to that month or earlier
 * and asOfMonth is set to that month so T6/T12 use exactly 6/12 months inclusive of it.
 */
export function processData(
  agencies: AgencyRow[],
  telemetry: TelemetryMonthly[],
  selectedMonthKey?: string
): {
  agencies: Agency[];
  simTelemetry: SimTelemetryMonthly[];
  asOfMonth: Date | null;
  agencyLabels: Map<string, AgencyWithLabel>;
  dataQuality: DataQualityReport;
  nearEligible: Agency[];
  cohortSummaries: Record<string, CohortSummary[]>;
  usageRollups: UsageRollups;
} {
  // Telemetry is already normalized by the upload page
  const normalizedTelemetry = telemetry;

  // When a month is selected, filter telemetry to that month or earlier and use it as asOfMonth
  // so T6/T12 windows are correct (exactly 6/12 months inclusive of selected month).
  let telemetryForPipeline = normalizedTelemetry;
  let asOfMonth: Date | null;
  if (selectedMonthKey) {
    telemetryForPipeline = normalizedTelemetry.filter((t) => toMonthKey(t.month) <= selectedMonthKey);
    asOfMonth = startOfMonth(parseISO(selectedMonthKey + '-01'));
  } else {
    asOfMonth = computeAsOfMonth(normalizedTelemetry);
  }

  // Ensure agencies is an array
  if (!Array.isArray(agencies)) {
    throw new Error('Agencies data is invalid. Please upload an agency file or ensure previous month\'s data is available.');
  }

  // Enrich agencies with derived fields
  // FILTER: Only include T10 customers (cew_type === 'T10')
  // Note: ingest.ts already sets cew_type='T10' for agencies where it was missing
  const enrichedAgencies = agencies
    .filter((agency) => agency.cew_type === 'T10')
    .map((agency) => enrichAgency(agency, asOfMonth));

  // Filter SIM telemetry (from pipeline-scoped telemetry so asOfMonth is consistent)
  let simTelemetry = telemetryForPipeline.filter(
    (t) => t.product === 'Simulator Training'
  ) as SimTelemetryMonthly[];

  // Merge with historical data to ensure we have full 12+ month history
  if (asOfMonth) {
    simTelemetry = mergeTelemetryWithHistory(simTelemetry, asOfMonth);
  }

  const asOf = asOfMonth || new Date();
  const { labelsMap, metricsMap } = computeLabelsForAgencies(enrichedAgencies, simTelemetry, asOf);

  const agencyLabels = new Map<string, AgencyWithLabel>();
  for (const agency of enrichedAgencies) {
    const label = labelsMap.get(agency.agency_id) || 'Not Adopting';
    const metrics = metricsMap.get(agency.agency_id) ?? null;

    // Find last adopting month for churned/previously adopting agencies
    const lastAdoptingMonth = (label === 'Churned Out' || label === 'Not Adopting') && metrics && agency.vr_licenses
      ? findLastAdoptingMonth(agency.agency_id, simTelemetry, asOf, agency.vr_licenses)
      : null;

    const why = generateWhyBullets(agency, label, metrics, lastAdoptingMonth, simTelemetry);
    const recommended_action = getRecommendedAction(label);

    agencyLabels.set(agency.agency_id, {
      agency_id: agency.agency_id,
      agency_name: agency.agency_name,
      label,
      metrics,
      cohorts: {
        purchase_cohort: agency.purchase_cohort,
        agency_size_band: agency.agency_size_band,
        cew_type: agency.cew_type,
      },
      why,
      recommended_action,
      training_dates: agency.latest_cew_training_date || agency.next_cew_training_date
        ? {
            latest_cew_training_date: agency.latest_cew_training_date,
            next_cew_training_date: agency.next_cew_training_date,
          }
        : undefined,
    });
  }

  // Get near eligible agencies
  const nearEligible = enrichedAgencies.filter(isNearEligible);

  // Generate data quality report (from full normalized telemetry for report accuracy)
  const dataQuality = generateDataQualityReport(agencies, normalizedTelemetry);

  // Get previous month and quarter summaries for trend analysis
  const previousMonthSummaries = asOfMonth ? (getPreviousMonthCohortSummaries(asOfMonth) || undefined) : undefined;
  const previousQuarterSummaries = asOfMonth ? (getPreviousQuarterCohortSummaries(asOfMonth) || undefined) : undefined;

  // Generate cohort summaries with trend data
  const cohortSummaries = generateCohortSummaries(
    enrichedAgencies,
    agencyLabels,
    previousMonthSummaries,
    previousQuarterSummaries
  );

  // Compute usage rollups from pipeline-scoped telemetry (months <= asOfMonth)
  const usageRollups = computeUsageRollups(telemetryForPipeline);

  return {
    agencies: enrichedAgencies,
    simTelemetry,
    asOfMonth,
    agencyLabels,
    dataQuality,
    nearEligible,
    cohortSummaries,
    usageRollups,
  };
}

