import type { Agency, AgencyWithLabel, DataQualityReport } from './schema';
import type { CohortSummary } from './aggregate';
import { computeKPICounts, computeAPAP, getHistoricalEntryForComparison } from './history';
import { parseISO } from 'date-fns';

export type SummaryBundle = {
  as_of_month: string;
  time_filter: string; // e.g., "trailing_12_months"
  apap: {
    current: number;
    previous_month: number | null;
    mom_change: number | null; // percentage point change
    high_confidence_goal: 42;
    hard_climb_goal: 46;
    gap_to_high_confidence: number;
    gap_to_hard_climb: number;
  };
  kpi: {
    counts: {
      adopting: number;
      at_risk_next_month: number;
      at_risk_next_quarter: number;
      churned_out: number;
      ineligible: number;
      unknown_insufficient: number;
    };
    percentages: {
      adopting: number;
      at_risk_next_month: number;
      at_risk_next_quarter: number;
      churned_out: number;
      ineligible: number;
      unknown_insufficient: number;
    };
    total_agencies: number;
  };
  cohort_highlights: {
    time_since_purchase: {
      best: { cohort: string; pct_adopting: number; agency_count: number } | null;
      worst: { cohort: string; pct_adopting: number; agency_count: number } | null;
    };
    agency_size: {
      best: { cohort: string; pct_adopting: number; agency_count: number } | null;
      worst: { cohort: string; pct_adopting: number; agency_count: number } | null;
    };
    cew_type: {
      best: { cohort: string; pct_adopting: number; agency_count: number } | null;
      worst: { cohort: string; pct_adopting: number; agency_count: number } | null;
    };
  };
  drivers: {
    new_adopting: Array<{
      agency_id: string;
      agency_name: string;
      officer_count: number;
      vr_licenses: number;
      purchase_cohort: string;
      agency_size_band: string;
      r12: number;
      r6: number;
    }>;
  };
  shakers: {
    newly_churned: Array<{
      agency_id: string;
      agency_name: string;
      officer_count: number;
      vr_licenses: number;
      purchase_cohort: string;
      agency_size_band: string;
      last_adopting_month: string | null;
    }>;
    newly_unadopting: Array<{
      agency_id: string;
      agency_name: string;
      officer_count: number;
      vr_licenses: number;
      purchase_cohort: string;
      agency_size_band: string;
      months_since_purchase: number | null;
    }>;
  };
  top_10_lists: {
    at_risk_next_month: Array<{
      agency_id: string;
      agency_name: string;
      officer_count: number;
      vr_licenses: number;
      purchase_cohort: string;
      agency_size_band: string;
    }>;
    churned_out: Array<{
      agency_id: string;
      agency_name: string;
      officer_count: number;
      vr_licenses: number;
      purchase_cohort: string;
      agency_size_band: string;
      last_adopting_month: string | null;
    }>;
    top_performers: Array<{
      agency_id: string;
      agency_name: string;
      officer_count: number;
      vr_licenses: number;
      purchase_cohort: string;
      agency_size_band: string;
      c12: number;
      r12: number;
    }>;
  };
  near_eligible: {
    count: number;
    month_4_count: number;
    month_5_count: number;
    with_usage_signals: number; // Agencies with completions in last 3 months
    summary: {
      total_officers: number;
      total_licenses: number;
      avg_officers_per_agency: number;
    };
  };
  data_caveats: {
    unmatched_telemetry_ids: number;
    agencies_with_no_telemetry: number;
    agencies_missing_licenses: number;
    agencies_missing_purchase_date: number;
  };
  /** Goal progress (SIM-only labels). Only present when goal model is loaded and data available. */
  goal_progress?: {
    selected_scenario: 'high_confidence' | 'hard_climb';
    overall_apap_actual_pct: number;
    overall_points_gap: number;
    top_3_structural_gaps: Array<{ line_size: string; elig_bucket: string; points_gap: number }>;
    driver_variances: {
      top_2_negative: Array<{ driver: string; line_size: string; variance_pp: number }>;
      top_1_positive: { driver: string; line_size: string; variance_pp: number } | null;
    };
  };
};

type ProcessedData = {
  agencies: Agency[];
  agencyLabels: [string, AgencyWithLabel][];
  nearEligible: Agency[];
  dataQuality: DataQualityReport;
  asOfMonth: string | null;
  cohortSummaries: Record<string, CohortSummary[]>;
  /** Snowflake-source APAP aggregate, present in snapshots loaded via the Snowflake route. */
  apap?: { apap: number; adoptingPoints?: number; eligiblePoints?: number; adoptingCount?: number; eligibleCount?: number };
};

export type GoalProgressInput = {
  scenario: 'high_confidence' | 'hard_climb';
  structuralResult: {
    overallApapActualPct: number;
    overallPointsGap: number;
    topCohortGaps: Array<{ lineSize: string; eligBucket: string; pointsGap: number }>;
  };
  driverResult: {
    rows: Array<{ driver: string; lineSize: string; variancePp: number }>;
  };
};

/**
 * Build a compact SummaryBundle JSON from processedData.
 * AI summary must only cite values present in the bundle and must mention SIM-only labels.
 */
export function buildSummaryBundle(
  data: ProcessedData,
  timeFilter: string = 'trailing_12_months',
  goalProgressInput?: GoalProgressInput
): SummaryBundle {
  const labelsMap = new Map(data.agencyLabels);
  const allLabels = Array.from(labelsMap.values());
  const totalAgencies = allLabels.length;

  // Compute current APAP.
  // Prefer the Snowflake-source aggregate (snapshot.apap.apap) which is the official APAP
  // calculated directly from the database. Fall back to the pipeline-computed value only
  // when the snapshot APAP isn't available (e.g. Excel-uploaded data).
  const snowflakeApap = typeof data.apap?.apap === 'number' && data.apap.apap > 0 ? data.apap : null;
  const pipelineAPAP = computeAPAP(data.agencies, labelsMap);
  const currentAPAP = snowflakeApap
    ? {
        apap: snowflakeApap.apap,
        adoptingPoints: snowflakeApap.adoptingPoints ?? pipelineAPAP.adoptingPoints,
        eligiblePoints: snowflakeApap.eligiblePoints ?? pipelineAPAP.eligiblePoints,
        adoptingCount: snowflakeApap.adoptingCount ?? pipelineAPAP.adoptingCount,
        eligibleCount: snowflakeApap.eligibleCount ?? pipelineAPAP.eligibleCount,
      }
    : pipelineAPAP;
  
  // Get previous month APAP for comparison
  let previousMonthAPAP: number | null = null;
  if (data.asOfMonth) {
    const currentAsOfMonth = parseISO(data.asOfMonth);
    const historicalEntry = getHistoricalEntryForComparison(currentAsOfMonth, 'last_month');
    if (historicalEntry?.agencyLabels) {
      const prevAPAP = computeAPAP(data.agencies, historicalEntry.agencyLabels);
      previousMonthAPAP = prevAPAP.apap;
    }
  }
  
  const momAPAPChange = previousMonthAPAP !== null 
    ? currentAPAP.apap - previousMonthAPAP 
    : null;

  // Compute KPI counts
  const kpiCounts = computeKPICounts(labelsMap);

  // Calculate percentages
  const kpiPercentages = {
    adopting: totalAgencies > 0 ? (kpiCounts.adopting / totalAgencies) * 100 : 0,
    at_risk_next_month: totalAgencies > 0 ? (kpiCounts.atRiskNextMonth / totalAgencies) * 100 : 0,
    at_risk_next_quarter: totalAgencies > 0 ? (kpiCounts.atRiskNextQuarter / totalAgencies) * 100 : 0,
    churned_out: totalAgencies > 0 ? (kpiCounts.churnedOut / totalAgencies) * 100 : 0,
    ineligible: totalAgencies > 0 ? (kpiCounts.ineligible / totalAgencies) * 100 : 0,
    unknown_insufficient: totalAgencies > 0 ? (kpiCounts.unknownInsufficient / totalAgencies) * 100 : 0,
  };

  // Get cohort highlights (best/worst by adopting rate)
  const timeCohorts = data.cohortSummaries.time_since_purchase_cohort || [];
  const sizeCohorts = data.cohortSummaries.agency_size_band || [];
  const cewCohorts = data.cohortSummaries.cew_type || [];

  const getBestWorst = (cohorts: CohortSummary[]) => {
    const eligible = cohorts.filter(c => c.agency_count > 0 && c.cohort_value !== 'Ineligible');
    if (eligible.length === 0) return { best: null, worst: null };
    
    const sorted = [...eligible].sort((a, b) => b.pct_adopting - a.pct_adopting);
    return {
      best: sorted[0] ? {
        cohort: sorted[0].cohort_value,
        pct_adopting: sorted[0].pct_adopting,
        agency_count: sorted[0].agency_count,
      } : null,
      worst: sorted[sorted.length - 1] ? {
        cohort: sorted[sorted.length - 1].cohort_value,
        pct_adopting: sorted[sorted.length - 1].pct_adopting,
        agency_count: sorted[sorted.length - 1].agency_count,
      } : null,
    };
  };

  // Get previous month labels to identify new adopters and newly churned
  let previousMonthLabels: Map<string, AgencyWithLabel> | null = null;
  if (data.asOfMonth) {
    const currentAsOfMonth = parseISO(data.asOfMonth);
    const historicalEntry = getHistoricalEntryForComparison(currentAsOfMonth, 'last_month');
    if (historicalEntry?.agencyLabels) {
      previousMonthLabels = new Map(historicalEntry.agencyLabels);
    }
  }

  // Identify new adopting agencies (adopting now but not last month)
  const newAdopting = allLabels
    .filter(l => (l.label === 'Adopting' || l.label === 'Top Performer'))
    .filter(l => {
      if (!previousMonthLabels) return false;
      const prevLabel = previousMonthLabels.get(l.agency_id);
      return !prevLabel || (prevLabel.label !== 'Adopting' && prevLabel.label !== 'Top Performer');
    })
    .map(l => {
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      return {
        agency_id: l.agency_id,
        agency_name: l.agency_name,
        officer_count: agency?.officer_count || 0,
        vr_licenses: agency?.vr_licenses || 0,
        purchase_cohort: l.cohorts.purchase_cohort,
        agency_size_band: l.cohorts.agency_size_band,
        r12: l.metrics?.R12 || 0,
        r6: l.metrics?.R6 || 0,
      };
    })
    .sort((a, b) => b.officer_count - a.officer_count)
    .slice(0, 20);

  // Identify newly churned (churned out now, was adopting last month)
  const newlyChurned = allLabels
    .filter(l => l.label === 'Churned Out')
    .filter(l => {
      if (!previousMonthLabels) return false;
      const prevLabel = previousMonthLabels.get(l.agency_id);
      return prevLabel && (prevLabel.label === 'Adopting' || prevLabel.label === 'Top Performer');
    })
    .map(l => {
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      let lastAdoptingMonth: string | null = null;
      if (l.why && l.why.length > 0) {
        const whyText = l.why.join(' ');
        const match = whyText.match(/last met threshold in (\w+ \d{4})/i);
        if (match) {
          lastAdoptingMonth = match[1];
        }
      }
      return {
        agency_id: l.agency_id,
        agency_name: l.agency_name,
        officer_count: agency?.officer_count || 0,
        vr_licenses: agency?.vr_licenses || 0,
        purchase_cohort: l.cohorts.purchase_cohort,
        agency_size_band: l.cohorts.agency_size_band,
        last_adopting_month: lastAdoptingMonth,
      };
    })
    .sort((a, b) => b.officer_count - a.officer_count)
    .slice(0, 20);

  // Identify newly unadopting (eligible but not adopting, may have been adopting before)
  const newlyUnadopting = allLabels
    .filter(l => {
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      // Eligible (6+ months) but not adopting
      return agency && 
        agency.months_since_purchase !== null && 
        (agency.eligibility_cohort !== undefined && agency.eligibility_cohort !== null ? agency.eligibility_cohort >= 6 : agency.months_since_purchase !== null && agency.months_since_purchase >= 6) &&
        l.label !== 'Adopting' && 
        l.label !== 'Top Performer' &&
        l.label !== 'Ineligible (0–5 months)' &&
        l.label !== 'Unknown (No license count)';
    })
    .filter(l => {
      // Newly eligible (months 6-12) or was adopting before
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      if (!agency) return false;
      const isNewlyEligible = agency.months_since_purchase !== null && 
        (agency.eligibility_cohort !== undefined && agency.eligibility_cohort !== null ? agency.eligibility_cohort >= 6 : agency.months_since_purchase !== null && agency.months_since_purchase >= 6) && 
        agency.months_since_purchase <= 12;
      if (isNewlyEligible) return true;
      // Or was adopting last month
      if (previousMonthLabels) {
        const prevLabel = previousMonthLabels.get(l.agency_id);
        return prevLabel && (prevLabel.label === 'Adopting' || prevLabel.label === 'Top Performer');
      }
      return false;
    })
    .map(l => {
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      return {
        agency_id: l.agency_id,
        agency_name: l.agency_name,
        officer_count: agency?.officer_count || 0,
        vr_licenses: agency?.vr_licenses || 0,
        purchase_cohort: l.cohorts.purchase_cohort,
        agency_size_band: l.cohorts.agency_size_band,
        months_since_purchase: agency?.months_since_purchase || null,
      };
    })
    .sort((a, b) => b.officer_count - a.officer_count)
    .slice(0, 20);

  // Get top 10 lists
  const atRiskNextMonth = allLabels
    .filter(l => l.label === 'At Risk (Next Month)')
    .map(l => {
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      return {
        agency_id: l.agency_id,
        agency_name: l.agency_name,
        officer_count: agency?.officer_count || 0,
        vr_licenses: agency?.vr_licenses || 0,
        purchase_cohort: l.cohorts.purchase_cohort,
        agency_size_band: l.cohorts.agency_size_band,
      };
    })
    .sort((a, b) => b.officer_count - a.officer_count)
    .slice(0, 10);

  const churnedOut = allLabels
    .filter(l => l.label === 'Churned Out')
    .map(l => {
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      // Try to extract last adopting month from "why" bullets
      let lastAdoptingMonth: string | null = null;
      if (l.why && l.why.length > 0) {
        // Look for pattern like "last met threshold in MMMM yyyy"
        const whyText = l.why.join(' ');
        const match = whyText.match(/last met threshold in (\w+ \d{4})/i);
        if (match) {
          lastAdoptingMonth = match[1];
        }
      }
      return {
        agency_id: l.agency_id,
        agency_name: l.agency_name,
        officer_count: agency?.officer_count || 0,
        vr_licenses: agency?.vr_licenses || 0,
        purchase_cohort: l.cohorts.purchase_cohort,
        agency_size_band: l.cohorts.agency_size_band,
        last_adopting_month: lastAdoptingMonth,
      };
    })
    .sort((a, b) => b.officer_count - a.officer_count)
    .slice(0, 10);

  const topPerformers = allLabels
    .filter(l => l.label === 'Top Performer')
    .map(l => {
      const agency = data.agencies.find(a => a.agency_id === l.agency_id);
      return {
        agency_id: l.agency_id,
        agency_name: l.agency_name,
        officer_count: agency?.officer_count || 0,
        vr_licenses: agency?.vr_licenses || 0,
        purchase_cohort: l.cohorts.purchase_cohort,
        agency_size_band: l.cohorts.agency_size_band,
        c12: l.metrics?.C12 || 0,
        r12: l.metrics?.R12 || 0,
      };
    })
    .sort((a, b) => b.c12 - a.c12)
    .slice(0, 10);

  // Near eligible summary
  const nearEligibleAgencies = data.nearEligible || [];
  const month4Count = nearEligibleAgencies.filter(a => a.months_since_purchase === 4).length;
  const month5Count = nearEligibleAgencies.filter(a => a.months_since_purchase === 5).length;
  
  // Count agencies with usage signals (completions in last 3 months)
  const withUsageSignals = nearEligibleAgencies.filter(agency => {
    const label = labelsMap.get(agency.agency_id);
    if (!label?.metrics) return false;
    return label.metrics.last3Months.some(v => v > 0);
  }).length;

  const nearEligibleSummary = {
    total_officers: nearEligibleAgencies.reduce((sum, a) => sum + (a.officer_count || 0), 0),
    total_licenses: nearEligibleAgencies.reduce((sum, a) => sum + (a.vr_licenses || 0), 0),
    avg_officers_per_agency: nearEligibleAgencies.length > 0
      ? nearEligibleAgencies.reduce((sum, a) => sum + (a.officer_count || 0), 0) / nearEligibleAgencies.length
      : 0,
  };

  // Data caveats
  const dataCaveats = {
    unmatched_telemetry_ids: data.dataQuality?.unmatched_telemetry_ids?.length || 0,
    agencies_with_no_telemetry: data.dataQuality?.agencies_with_no_telemetry?.length || 0,
    agencies_missing_licenses: data.dataQuality?.agencies_missing_licenses?.length || 0,
    agencies_missing_purchase_date: data.dataQuality?.agencies_missing_purchase_date?.length || 0,
  };

  return {
    as_of_month: data.asOfMonth || new Date().toISOString(),
    time_filter: timeFilter,
    apap: {
      current: currentAPAP.apap,
      previous_month: previousMonthAPAP,
      mom_change: momAPAPChange,
      high_confidence_goal: 42,
      hard_climb_goal: 46,
      gap_to_high_confidence: 42 - currentAPAP.apap,
      gap_to_hard_climb: 46 - currentAPAP.apap,
    },
    kpi: {
      counts: {
        adopting: kpiCounts.adopting,
        at_risk_next_month: kpiCounts.atRiskNextMonth,
        at_risk_next_quarter: kpiCounts.atRiskNextQuarter,
        churned_out: kpiCounts.churnedOut,
        ineligible: kpiCounts.ineligible,
        unknown_insufficient: kpiCounts.unknownInsufficient,
      },
      percentages: kpiPercentages,
      total_agencies: totalAgencies,
    },
    cohort_highlights: {
      time_since_purchase: getBestWorst(timeCohorts),
      agency_size: getBestWorst(sizeCohorts),
      cew_type: getBestWorst(cewCohorts),
    },
    drivers: {
      new_adopting: newAdopting,
    },
    shakers: {
      newly_churned: newlyChurned,
      newly_unadopting: newlyUnadopting,
    },
    top_10_lists: {
      at_risk_next_month: atRiskNextMonth,
      churned_out: churnedOut,
      top_performers: topPerformers,
    },
    near_eligible: {
      count: nearEligibleAgencies.length,
      month_4_count: month4Count,
      month_5_count: month5Count,
      with_usage_signals: withUsageSignals,
      summary: nearEligibleSummary,
    },
    data_caveats: dataCaveats,
    ...(goalProgressInput && {
      goal_progress: {
        selected_scenario: goalProgressInput.scenario,
        overall_apap_actual_pct: goalProgressInput.structuralResult.overallApapActualPct,
        overall_points_gap: goalProgressInput.structuralResult.overallPointsGap,
        top_3_structural_gaps: goalProgressInput.structuralResult.topCohortGaps.slice(0, 3).map((g) => ({
          line_size: g.lineSize,
          elig_bucket: g.eligBucket,
          points_gap: g.pointsGap,
        })),
        driver_variances: (() => {
          const withVariance = goalProgressInput.driverResult.rows.map((r) => ({
            driver: r.driver,
            line_size: r.lineSize,
            variance_pp: r.variancePp,
          }));
          const negative = withVariance.filter((r) => r.variance_pp < 0).sort((a, b) => a.variance_pp - b.variance_pp);
          const positive = withVariance.filter((r) => r.variance_pp > 0).sort((a, b) => b.variance_pp - a.variance_pp);
          return {
            top_2_negative: negative.slice(0, 2),
            top_1_positive: positive[0] ?? null,
          };
        })(),
      },
    }),
  };
}
