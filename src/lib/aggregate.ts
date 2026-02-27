import type { Agency, AgencyWithLabel } from './schema';

export type CohortDimension = 'time_since_purchase_cohort' | 'agency_size_band' | 'cew_type';

export type CohortSummary = {
  cohort_value: string;
  agency_count: number;
  total_officer_count: number; // Sum of officer_count for all agencies in cohort
  pct_adopting: number;
  pct_churned_out: number;
  pct_at_risk_next_month: number;
  pct_at_risk_next_quarter: number;
  count_ineligible: number;
  count_unknown: number;
  // Trend data
  mom_pct_adopting?: number | null; // Month-over-month change in % adopting
  qoq_pct_adopting?: number | null; // Quarter-over-quarter change in % adopting
};

/**
 * Get cohort value for an agency based on dimension
 */
function getCohortValue(agency: Agency, dimension: CohortDimension): string {
  switch (dimension) {
    case 'time_since_purchase_cohort':
      return agency.purchase_cohort || 'Unknown';
    case 'agency_size_band':
      return agency.agency_size_band || 'Unknown';
    case 'cew_type':
      return agency.cew_type || 'Unknown';
    default:
      return 'Unknown';
  }
}

/**
 * Aggregate agencies by cohort dimension and compute summary statistics
 */
export function aggregateCohorts(
  agencies: Agency[],
  agencyLabels: Map<string, AgencyWithLabel>,
  dimension: CohortDimension
): CohortSummary[] {
  // FILTER: Only include T10 customers for cohort aggregation
  agencies = agencies.filter(agency => agency.cew_type === 'T10');
  // Group agencies by cohort value
  const cohortGroups = new Map<string, Agency[]>();
  
  for (const agency of agencies) {
    const cohortValue = getCohortValue(agency, dimension);
    if (!cohortGroups.has(cohortValue)) {
      cohortGroups.set(cohortValue, []);
    }
    cohortGroups.get(cohortValue)!.push(agency);
  }

  // Compute summary for each cohort
  const summaries: CohortSummary[] = [];

  for (const [cohortValue, cohortAgencies] of cohortGroups.entries()) {
    const totalCount = cohortAgencies.length;
    
    // Get labels for all agencies in this cohort
    const labels = cohortAgencies
      .map((a) => agencyLabels.get(a.agency_id))
      .filter((l): l is AgencyWithLabel => l !== undefined);

    // Count by label
    const adoptingCount = labels.filter((l) => l.label === 'Adopting' || l.label === 'Top Performer').length;
    const churnedOutCount = labels.filter((l) => l.label === 'Churned Out').length;
    const atRiskNextMonthCount = labels.filter((l) => l.label === 'At Risk (Next Month)').length;
    const atRiskNextQuarterCount = labels.filter((l) => l.label === 'At Risk (Next Quarter)').length;
    const ineligibleCount = labels.filter((l) => l.label === 'Ineligible (0–5 months)').length;
    const unknownCount = labels.filter((l) => l.label === 'Unknown (No license count)').length;

    // Calculate percentages
    const pct_adopting = totalCount > 0 ? (adoptingCount / totalCount) * 100 : 0;
    const pct_churned_out = totalCount > 0 ? (churnedOutCount / totalCount) * 100 : 0;
    const pct_at_risk_next_month = totalCount > 0 ? (atRiskNextMonthCount / totalCount) * 100 : 0;
    const pct_at_risk_next_quarter = totalCount > 0 ? (atRiskNextQuarterCount / totalCount) * 100 : 0;

    // Calculate total officer count for all agencies in this cohort
    const total_officer_count = cohortAgencies.reduce((sum, agency) => {
      return sum + (agency.officer_count || 0);
    }, 0);

    summaries.push({
      cohort_value: cohortValue,
      agency_count: totalCount,
      total_officer_count,
      pct_adopting,
      pct_churned_out,
      pct_at_risk_next_month,
      pct_at_risk_next_quarter,
      count_ineligible: ineligibleCount,
      count_unknown: unknownCount,
    });
  }

  // Sort by cohort value (natural order for time cohorts, alphabetical for others)
  summaries.sort((a, b) => {
    // Special handling for time cohorts to maintain chronological order
    if (dimension === 'time_since_purchase_cohort') {
      const order = [
        'Ineligible',
        'Year 1',
        'Year 2',
        'Year 3',
        'Year 4',
        'Year 5',
        'Year 6',
        'Year 7',
        'Year 8',
        'Year 9',
        'Year 10',
        'Unknown',
        'No Purchase',
      ];
      const aIndex = order.indexOf(a.cohort_value);
      const bIndex = order.indexOf(b.cohort_value);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }
    return a.cohort_value.localeCompare(b.cohort_value);
  });

  return summaries;
}

/**
 * Generate cohort summaries for all dimensions with trend data
 */
export function generateCohortSummaries(
  agencies: Agency[],
  agencyLabels: Map<string, AgencyWithLabel>,
  previousMonthSummaries?: Record<string, CohortSummary[]>,
  previousQuarterSummaries?: Record<string, CohortSummary[]>
): Record<CohortDimension, CohortSummary[]> {
  const current = {
    time_since_purchase_cohort: aggregateCohorts(agencies, agencyLabels, 'time_since_purchase_cohort'),
    agency_size_band: aggregateCohorts(agencies, agencyLabels, 'agency_size_band'),
    cew_type: aggregateCohorts(agencies, agencyLabels, 'cew_type'),
  };

  // Add trend data if previous summaries are available
  if (previousMonthSummaries || previousQuarterSummaries) {
    for (const dimension of Object.keys(current) as CohortDimension[]) {
      const currentSummaries = current[dimension];
      const prevMonth = previousMonthSummaries?.[dimension] || [];
      const prevQuarter = previousQuarterSummaries?.[dimension] || [];

      for (const summary of currentSummaries) {
        // Find matching previous month summary
        const prevMonthSummary = prevMonth.find(s => s.cohort_value === summary.cohort_value);
        if (prevMonthSummary) {
          summary.mom_pct_adopting = summary.pct_adopting - prevMonthSummary.pct_adopting;
        }

        // Find matching previous quarter summary
        const prevQuarterSummary = prevQuarter.find(s => s.cohort_value === summary.cohort_value);
        if (prevQuarterSummary) {
          summary.qoq_pct_adopting = summary.pct_adopting - prevQuarterSummary.pct_adopting;
        }
      }
    }
  }

  return current;
}

