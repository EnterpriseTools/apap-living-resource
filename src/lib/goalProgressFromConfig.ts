/**
 * Goal progress from hard-coded config (no Excel).
 * SIM-only adoption labels unchanged.
 */

import { format, parseISO } from 'date-fns';
import type { Agency, AgencyWithLabel } from './schema';
import type { GoalModelConfig, Scenario, LineSize, EligBucket, Driver, CohortBaselineKey } from '@/config/goal_model_config';
import { getLineSizeBand } from './domain';
import { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD } from '@/config/domain_constants';

export type ProcessedMonthData = {
  agencies: Agency[];
  agencyLabels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>;
  asOfMonth: string | null;
};

/** Line size from officer_count (canonical getLineSizeBand). 0 => Direct. */
export function getLineSizeFromConfig(officerCount: number | undefined | null): LineSize | 'Unknown' {
  const band = getLineSizeBand(officerCount);
  return band ?? 'Unknown';
}

// --- Eligibility buckets: 6–12, 13–18, 19–24, 25+ ---
export function getEligBucketFromConfig(
  eligibilityCohort: number | undefined | null
): EligBucket | 'ineligible' | 'unknown' {
  if (
    eligibilityCohort === undefined ||
    eligibilityCohort === null ||
    typeof eligibilityCohort !== 'number'
  )
    return 'unknown';
  if (eligibilityCohort < 6) return 'ineligible';
  if (eligibilityCohort <= 12) return '6_12';
  if (eligibilityCohort <= 18) return '13_18';
  if (eligibilityCohort <= 24) return '19_24';
  return '25_plus';
}

/** APAP: adoption thresholds (eligibility enforced by caller). */
function meetsAPAPThreshold(label: AgencyWithLabel | undefined): boolean {
  if (!label?.metrics) return false;
  const { R6, R12 } = label.metrics;
  return (R6 != null && R6 >= ADOPTION_R6_THRESHOLD) || (R12 != null && R12 >= ADOPTION_R12_THRESHOLD);
}

function labelsMap(data: ProcessedMonthData): Map<string, AgencyWithLabel> {
  return Array.isArray(data.agencyLabels)
    ? new Map(data.agencyLabels)
    : data.agencyLabels;
}

// --- Structural variance ---

export type CohortRow = {
  lineSize: LineSize;
  eligBucket: EligBucket;
  eligiblePointsActual: number;
  adoptingPointsActual: number;
  eligibleAgencyCount: number;
  adoptingAgencyCount: number;
  apapActualRate: number;
  apapActualPct: number;
  targetApapRate: number;
  targetApapPct: number;
  variancePp: number;
  requiredAdoptingPoints: number;
  pointsGap: number;
  gapSharePct: number;
  ppImpactIfClosed: number;
};

export type StructuralVarianceResult = {
  scenario: Scenario;
  asOfMonth: string | null;
  overallApapActualRate: number;
  overallApapActualPct: number;
  totalEligiblePoints: number;
  totalAdoptingPoints: number;
  overallPointsGap: number;
  cohortRows: CohortRow[];
  topCohortGaps: Array<{ lineSize: LineSize; eligBucket: EligBucket; pointsGap: number }>;
  dataQuality: {
    excludedUnknownLineSize: number;
    excludedMissingEligibility: number;
  };
};

const LINE_SIZES: LineSize[] = ['Major', 'T1200', 'Direct'];
const ELIG_BUCKETS: EligBucket[] = ['6_12', '13_18', '19_24', '25_plus'];

export type StructuralSliceApapResult = {
  apap: number;
  adoptingPoints: number;
  eligiblePoints: number;
  adoptingCount: number;
  eligibleCount: number;
  /** Eligible points by cell for weighting goal rates: key = `${lineSize}|${eligBucket}` */
  eligiblePointsByKey: Record<string, number>;
};

/**
 * Compute APAP for a structural slice (eligibility buckets × line sizes).
 * Only T10 agencies; eligibility_cohort >= 6; filters by selected buckets/sizes.
 */
export function computeAPAPForStructuralSlice(
  agencies: Agency[],
  labels: Map<string, AgencyWithLabel> | Array<[string, AgencyWithLabel]>,
  selectedEligBuckets: EligBucket[],
  selectedLineSizes: LineSize[]
): StructuralSliceApapResult {
  const labelsMap = Array.isArray(labels) ? new Map(labels) : labels;
  const eligSet = new Set(selectedEligBuckets);
  const lineSet = new Set(selectedLineSizes);
  type Key = `${LineSize}|${EligBucket}`;
  const eligiblePointsByKey: Record<string, number> = {};
  let eligiblePoints = 0;
  let adoptingPoints = 0;
  let eligibleCount = 0;
  let adoptingCount = 0;

  for (const agency of agencies) {
    if (agency.cew_type !== 'T10') continue;
    const lineSize = getLineSizeFromConfig(agency.officer_count);
    if (lineSize === 'Unknown' || !lineSet.has(lineSize)) continue;
    const eligBucket = getEligBucketFromConfig(agency.eligibility_cohort);
    if (eligBucket === 'unknown' || eligBucket === 'ineligible' || !eligSet.has(eligBucket)) continue;

    const pts = agency.officer_count ?? 0;
    const key: Key = `${lineSize}|${eligBucket}`;
    eligiblePointsByKey[key] = (eligiblePointsByKey[key] ?? 0) + pts;
    eligiblePoints += pts;
    eligibleCount += 1;

    const label = labelsMap.get(agency.agency_id);
    if (meetsAPAPThreshold(label)) {
      adoptingPoints += pts;
      adoptingCount += 1;
    }
  }

  const apap = eligiblePoints > 0 ? (adoptingPoints / eligiblePoints) * 100 : 0;
  return {
    apap,
    adoptingPoints,
    eligiblePoints,
    adoptingCount,
    eligibleCount,
    eligiblePointsByKey,
  };
}

/**
 * Goal rates (HC, Hard Climb) for the selected slice — weighted average of structural targets by eligible points.
 * If no selection or empty eligiblePointsByKey, returns overall goals.
 */
export function getGoalRatesForSlice(
  config: GoalModelConfig,
  selectedEligBuckets: EligBucket[],
  selectedLineSizes: LineSize[],
  eligiblePointsByKey: Record<string, number>
): { highConfidencePct: number; hardClimbPct: number } {
  const totalPoints = Object.values(eligiblePointsByKey).reduce((a, b) => a + b, 0);
  if (
    selectedEligBuckets.length === 0 ||
    selectedLineSizes.length === 0 ||
    totalPoints === 0
  ) {
    return {
      highConfidencePct: config.overall.high_confidence.overallTargetApapPct,
      hardClimbPct: config.overall.hard_climb.overallTargetApapPct,
    };
  }

  let weightedHC = 0;
  let weightedHardClimb = 0;
  for (const ls of selectedLineSizes) {
    for (const eb of selectedEligBuckets) {
      const key = `${ls}|${eb}`;
      const pts = eligiblePointsByKey[key] ?? 0;
      if (pts === 0) continue;
      const hcRate = config.structuralTargets.high_confidence[ls][eb];
      const hardClimbRate = config.structuralTargets.hard_climb[ls][eb];
      weightedHC += hcRate * pts;
      weightedHardClimb += hardClimbRate * pts;
    }
  }
  return {
    highConfidencePct: totalPoints > 0 ? (weightedHC / totalPoints) * 100 : config.overall.high_confidence.overallTargetApapPct,
    hardClimbPct: totalPoints > 0 ? (weightedHardClimb / totalPoints) * 100 : config.overall.hard_climb.overallTargetApapPct,
  };
}

/** Map EligBucket to November baseline table key (12-24 row used for both 13_18 and 19_24). */
function baselineKeyForElig(eb: EligBucket): CohortBaselineKey {
  if (eb === '13_18' || eb === '19_24') return '12_24';
  if (eb === '6_12') return '6_12';
  return '25_plus';
}

/**
 * November 2025 baseline APAP for a slice using cohort baselines from config (2026 Baseline table).
 * Each (baselineKey × lineSize) is counted once (13_18 and 19_24 both map to 12_24).
 */
export function getNovemberBaselineAPAPForSlice(
  config: GoalModelConfig,
  selectedEligBuckets: EligBucket[],
  selectedLineSizes: LineSize[]
): number | null {
  const cohort = config.cohortBaselineNovember;
  if (!cohort) return null;
  const added = new Set<string>();
  let adoptingPoints = 0;
  let eligiblePoints = 0;
  for (const eb of selectedEligBuckets) {
    const bkey = baselineKeyForElig(eb);
    for (const ls of selectedLineSizes) {
      const key = `${bkey}|${ls}`;
      if (added.has(key)) continue;
      added.add(key);
      const cell = cohort[bkey]?.[ls];
      if (cell) {
        adoptingPoints += cell.adoptingPoints;
        eligiblePoints += cell.eligiblePoints;
      }
    }
  }
  if (eligiblePoints === 0) return null;
  return (adoptingPoints / eligiblePoints) * 100;
}

export function computeStructuralVarianceFromConfig(
  processedMonthData: ProcessedMonthData,
  config: GoalModelConfig,
  scenario: Scenario
): StructuralVarianceResult {
  const labels = labelsMap(processedMonthData);
  type Key = `${LineSize}|${EligBucket}`;
  const eligiblePoints: Record<Key, number> = {} as Record<Key, number>;
  const adoptingPoints: Record<Key, number> = {} as Record<Key, number>;
  const eligibleCount: Record<Key, number> = {} as Record<Key, number>;
  const adoptingCount: Record<Key, number> = {} as Record<Key, number>;

  for (const ls of LINE_SIZES) {
    for (const eb of ELIG_BUCKETS) {
      const key: Key = `${ls}|${eb}`;
      eligiblePoints[key] = 0;
      adoptingPoints[key] = 0;
      eligibleCount[key] = 0;
      adoptingCount[key] = 0;
    }
  }

  let excludedUnknownLineSize = 0;
  let excludedMissingEligibility = 0;

  for (const agency of processedMonthData.agencies) {
    const lineSize = getLineSizeFromConfig(agency.officer_count);
    if (lineSize === 'Unknown') {
      excludedUnknownLineSize++;
      continue;
    }
    const eligBucket = getEligBucketFromConfig(agency.eligibility_cohort);
    if (eligBucket === 'unknown') {
      excludedMissingEligibility++;
      continue;
    }
    if (eligBucket === 'ineligible') continue;

    const pts = agency.officer_count ?? 0;
    const key: Key = `${lineSize}|${eligBucket}`;
    eligiblePoints[key] += pts;
    eligibleCount[key] += 1;

    const label = labels.get(agency.agency_id);
    if (meetsAPAPThreshold(label)) {
      adoptingPoints[key] += pts;
      adoptingCount[key] += 1;
    }
  }

  const targets = config.structuralTargets[scenario];
  const cohortRows: CohortRow[] = [];
  let totalEligiblePoints = 0;
  let totalAdoptingPoints = 0;
  const positiveGaps: Array<{ lineSize: LineSize; eligBucket: EligBucket; pointsGap: number }> = [];

  for (const lineSize of LINE_SIZES) {
    for (const eligBucket of ELIG_BUCKETS) {
      const key: Key = `${lineSize}|${eligBucket}`;
      const ep = eligiblePoints[key];
      const ap = adoptingPoints[key];
      const targetRate = targets[lineSize][eligBucket] ?? 0;

      const apapActualRate = ep > 0 ? ap / ep : 0;
      const apapActualPct = apapActualRate * 100;
      const targetApapPct = targetRate * 100;
      const variancePp = (apapActualRate - targetRate) * 100;
      const requiredAdoptingPoints = targetRate * ep;
      const pointsGap = requiredAdoptingPoints - ap;

      cohortRows.push({
        lineSize,
        eligBucket,
        eligiblePointsActual: ep,
        adoptingPointsActual: ap,
        eligibleAgencyCount: eligibleCount[key],
        adoptingAgencyCount: adoptingCount[key],
        apapActualRate,
        apapActualPct,
        targetApapRate: targetRate,
        targetApapPct,
        variancePp,
        requiredAdoptingPoints,
        pointsGap,
        gapSharePct: 0,
        ppImpactIfClosed: 0,
      });

      totalEligiblePoints += ep;
      totalAdoptingPoints += ap;
      if (pointsGap > 0) positiveGaps.push({ lineSize, eligBucket, pointsGap });
    }
  }

  const overallPointsGap = positiveGaps.reduce((s, g) => s + g.pointsGap, 0);
  const overallApapActualRate =
    totalEligiblePoints > 0 ? totalAdoptingPoints / totalEligiblePoints : 0;
  const overallApapActualPct = overallApapActualRate * 100;

  for (const row of cohortRows) {
    row.gapSharePct =
      row.pointsGap > 0 && overallPointsGap > 0 ? (row.pointsGap / overallPointsGap) * 100 : 0;
    row.ppImpactIfClosed =
      totalEligiblePoints > 0 ? (row.pointsGap / totalEligiblePoints) * 100 : 0;
  }

  const topCohortGaps = positiveGaps
    .sort((a, b) => b.pointsGap - a.pointsGap)
    .slice(0, 3);
  cohortRows.sort((a, b) => b.pointsGap - a.pointsGap);

  return {
    scenario,
    asOfMonth: processedMonthData.asOfMonth,
    overallApapActualRate,
    overallApapActualPct,
    totalEligiblePoints,
    totalAdoptingPoints,
    overallPointsGap,
    cohortRows,
    topCohortGaps,
    dataQuality: {
      excludedUnknownLineSize,
      excludedMissingEligibility,
    },
  };
}

// --- Driver progress ---

export type DriverRow = {
  driver: Driver;
  lineSize: LineSize;
  actualRate: number;
  assumedRate: number;
  variancePp: number;
  denominator: number;
  numerator: number;
  status: 'ok' | 'insufficient_baseline' | 'insufficient_data';
};

export type DriverProgressResult = {
  scenario: Scenario;
  asOfMonth: string | null;
  baselineMonth: string;
  goalMonth: string;
  baselineAvailable: boolean;
  rows: DriverRow[];
};

function getPurchaseMonth(agency: Agency): string | null {
  const d = agency.purchase_date;
  if (!d) return null;
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, 'yyyy-MM');
}

function monthsInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function computeDriverProgressFromConfig(
  currentMonthData: ProcessedMonthData,
  baselineMonthData: ProcessedMonthData | null,
  config: GoalModelConfig,
  scenario: Scenario
): DriverProgressResult {
  const currentLabels = labelsMap(currentMonthData);
  const baselineLabels = baselineMonthData ? labelsMap(baselineMonthData) : null;
  const baselineAvailable = !!baselineMonthData && !!baselineLabels;

  const rows: DriverRow[] = [];
  const assumptions = config.driverAssumptions[scenario];
  const baselineAgencies = baselineMonthData?.agencies ?? [];
  const currentAgencies = currentMonthData.agencies;
  const newCustomerMonths = monthsInRange(
    config.newCustomerPurchaseWindow.start,
    config.newCustomerPurchaseWindow.end
  );

  const baselineEligibleAdopterIdsByLine = new Map<LineSize, Set<string>>();
  const baselineEligibleNonAdopterIdsByLine = new Map<LineSize, Set<string>>();
  const baselineIneligibleIdsByLine = new Map<LineSize, Set<string>>();

  if (baselineAvailable && baselineMonthData) {
    for (const agency of baselineAgencies) {
      const lineSize = getLineSizeFromConfig(agency.officer_count);
      if (lineSize === 'Unknown') continue;
      const elig = agency.eligibility_cohort;
      if (elig === undefined || elig === null) continue;
      if (elig >= 6) {
        const label = baselineLabels!.get(agency.agency_id);
        const adopting = meetsAPAPThreshold(label);
        if (!baselineEligibleAdopterIdsByLine.has(lineSize))
          baselineEligibleAdopterIdsByLine.set(lineSize, new Set());
        if (!baselineEligibleNonAdopterIdsByLine.has(lineSize))
          baselineEligibleNonAdopterIdsByLine.set(lineSize, new Set());
        if (adopting) baselineEligibleAdopterIdsByLine.get(lineSize)!.add(agency.agency_id);
        else baselineEligibleNonAdopterIdsByLine.get(lineSize)!.add(agency.agency_id);
      } else {
        if (!baselineIneligibleIdsByLine.has(lineSize))
          baselineIneligibleIdsByLine.set(lineSize, new Set());
        baselineIneligibleIdsByLine.get(lineSize)!.add(agency.agency_id);
      }
    }
  }

  for (const lineSize of LINE_SIZES) {
    const assumedRetention = assumptions.retention[lineSize];
    const baselineAdopters = baselineEligibleAdopterIdsByLine.get(lineSize);
    if (!baselineAvailable || !baselineAdopters) {
      rows.push({
        driver: 'retention',
        lineSize,
        actualRate: 0,
        assumedRate: assumedRetention,
        variancePp: 0,
        denominator: 0,
        numerator: 0,
        status: 'insufficient_baseline',
      });
    } else {
      const denom = baselineAdopters.size;
      let retained = 0;
      for (const id of baselineAdopters) {
        const label = currentLabels.get(id);
        if (meetsAPAPThreshold(label)) retained++;
      }
      const actualRate = denom > 0 ? retained / denom : 0;
      rows.push({
        driver: 'retention',
        lineSize,
        actualRate,
        assumedRate: assumedRetention,
        variancePp: (actualRate - assumedRetention) * 100,
        denominator: denom,
        numerator: retained,
        status: 'ok',
      });
    }

    const assumedConversion = assumptions.conversion[lineSize];
    const baselineNonAdopters = baselineEligibleNonAdopterIdsByLine.get(lineSize);
    if (!baselineAvailable || !baselineNonAdopters) {
      rows.push({
        driver: 'conversion',
        lineSize,
        actualRate: 0,
        assumedRate: assumedConversion,
        variancePp: 0,
        denominator: 0,
        numerator: 0,
        status: 'insufficient_baseline',
      });
    } else {
      const denom = baselineNonAdopters.size;
      let converted = 0;
      for (const id of baselineNonAdopters) {
        const label = currentLabels.get(id);
        if (meetsAPAPThreshold(label)) converted++;
      }
      const actualRate = denom > 0 ? converted / denom : 0;
      rows.push({
        driver: 'conversion',
        lineSize,
        actualRate,
        assumedRate: assumedConversion,
        variancePp: (actualRate - assumedConversion) * 100,
        denominator: denom,
        numerator: converted,
        status: 'ok',
      });
    }

    const assumedBaselineIneligible = assumptions.baseline_ineligible[lineSize];
    const baselineIneligible = baselineIneligibleIdsByLine.get(lineSize);
    if (!baselineIneligible || baselineIneligible.size === 0) {
      rows.push({
        driver: 'baseline_ineligible',
        lineSize,
        actualRate: 0,
        assumedRate: assumedBaselineIneligible,
        variancePp: 0,
        denominator: 0,
        numerator: 0,
        status: 'insufficient_data',
      });
    } else {
      let nowEligible = 0;
      let adopting = 0;
      for (const id of baselineIneligible) {
        const agency = currentAgencies.find((a) => a.agency_id === id);
        if (!agency) continue;
        const elig = agency.eligibility_cohort;
        if (elig === undefined || elig === null || elig < 6) continue;
        nowEligible++;
        const label = currentLabels.get(id);
        if (meetsAPAPThreshold(label)) adopting++;
      }
      const actualRate = nowEligible > 0 ? adopting / nowEligible : 0;
      rows.push({
        driver: 'baseline_ineligible',
        lineSize,
        actualRate,
        assumedRate: assumedBaselineIneligible,
        variancePp: (actualRate - assumedBaselineIneligible) * 100,
        denominator: nowEligible,
        numerator: adopting,
        status: nowEligible > 0 ? 'ok' : 'insufficient_data',
      });
    }

    const assumedNewCustomer = assumptions.new_customer[lineSize];
    let newEligible = 0;
    let newAdopting = 0;
    for (const agency of currentAgencies) {
      const elig = agency.eligibility_cohort;
      if (elig === undefined || elig === null || elig < 6) continue;
      const purchaseMonth = getPurchaseMonth(agency);
      if (!purchaseMonth || !newCustomerMonths.includes(purchaseMonth)) continue;
      const ls = getLineSizeFromConfig(agency.officer_count);
      if (ls !== lineSize) continue;
      newEligible++;
      const label = currentLabels.get(agency.agency_id);
      if (meetsAPAPThreshold(label)) newAdopting++;
    }
    const newActualRate = newEligible > 0 ? newAdopting / newEligible : 0;
    rows.push({
      driver: 'new_customer',
      lineSize,
      actualRate: newActualRate,
      assumedRate: assumedNewCustomer,
      variancePp: (newActualRate - assumedNewCustomer) * 100,
      denominator: newEligible,
      numerator: newAdopting,
      status: newEligible > 0 ? 'ok' : 'insufficient_data',
    });
  }

  return {
    scenario,
    asOfMonth: currentMonthData.asOfMonth,
    baselineMonth: config.baselineMonth,
    goalMonth: config.goalMonth,
    baselineAvailable,
    rows,
  };
}
