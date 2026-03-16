import { NextResponse } from 'next/server';
import { parseISO, startOfMonth, subMonths, format } from 'date-fns';
import { snowflakeQuery } from '@/lib/snowflake';
import { processData } from '@/lib/pipeline';
import { getLookbackRangeLabel } from '@/lib/lookbackTooltips';
import { SNAPSHOT_SCHEMA_VERSION, COMPUTE_VERSION } from '@/config/snapshotVersion';
import type { AgencyRow, TelemetryMonthly } from '@/lib/schema';
import { computeSimT10Usage } from '@/lib/usageRollups';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SOURCE_TABLE = 'PRODUCT_ANALYTICS.APAP_REPORTS.ADOPTION_VR_PREVIEW';

type RptAdoptionVrRow = {
  ACTIVITY_MONTH: string | Date; // Snowflake SDK may return a Date object or 'YYYY-MM-01' string
  ACCOUNT_NUMBER: string | number | null;
  CUSTOMER_NAME: string | null;
  LICENSE_QUANTITY: number | null;
  PRO_LICENSES?: number | null;
  BASIC_PRO_LICENSES?: number | null;
  ADOPTION_POINTS?: number | null;
  IS_APAP_CONSIDERED?: number | boolean | null;
  EVER_PURCHASED?: number | boolean | null;
  ELIGIBILITY_COHORT: number | null;
  ELIGIBLE_POINTS?: number | null;
  TOTAL_REGISTERED_T10_CONTROLLERS?: number | null;
  AXON_FOOTPRINT?: number | null;
  CONTRACT_START_MONTH?: string | null;
  FIRST_ELIGIBLE_MONTH?: string | null;
  SUB_REGION?: string | null;
  ACCOUNT_MANAGER?: string | null;
  COUNTRY?: string | null;
  T6_SIM_EVENTS?: number | null;
  T12_SIM_EVENTS?: number | null;
  MEETS_ELIGIBILITY?: number | boolean | null;
  DOMAIN_STATUS?: string | null;
  PRODUCTION_TYPE?: string | null;
  IS_FEDERAL?: number | boolean | null;
  IS_ENTERPRISE?: number | boolean | null;
};

function monthKeyFromActivityMonth(activityMonth: string | Date): string {
  // Snowflake SDK may return a Date object or a 'YYYY-MM-01' string
  const d = activityMonth instanceof Date
    ? startOfMonth(activityMonth)
    : startOfMonth(parseISO(String(activityMonth).slice(0, 10)));
  return format(d, 'yyyy-MM');
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickVrLicenses(r: RptAdoptionVrRow): number | null {
  const pro = toNumberOrNull(r.PRO_LICENSES);
  if (pro !== null && pro > 0) return pro;
  const basic = toNumberOrNull(r.BASIC_PRO_LICENSES);
  if (basic !== null && basic > 0) return basic;
  const qty = toNumberOrNull(r.LICENSE_QUANTITY);
  if (qty !== null && qty > 0) return qty;
  return null;
}

function derivePurchaseDate(asOfMonthDate: Date, eligibilityCohort: number | null, contractStartMonth?: string | null): Date | undefined {
  // Legacy pipeline uses purchase_date to compute “new customer” cohorts.
  // Prefer contract_start_month if present; else derive purchase month from activity_month - eligibility_cohort.
  if (contractStartMonth) {
    try {
      return startOfMonth(parseISO(contractStartMonth));
    } catch {
      // fallthrough
    }
  }
  if (eligibilityCohort != null && Number.isFinite(eligibilityCohort)) {
    const months = Math.max(0, Math.floor(eligibilityCohort));
    return startOfMonth(subMonths(asOfMonthDate, months));
  }
  return undefined;
}

function pickOfficerCountForLineSize(
  eligiblePoints: number | null,
  totalRegisteredT10: number | null,
  axonFootprint: number | null
): number | undefined {
  // We need a stable line-size bucket even for ineligible cohorts.
  // ELIGIBLE_POINTS can be 0/null for ineligible rows; fallback to size proxies so Major/T1200 don't collapse to Direct.
  if (eligiblePoints != null && eligiblePoints > 0) return eligiblePoints;
  if (totalRegisteredT10 != null && totalRegisteredT10 > 0) return totalRegisteredT10;
  if (axonFootprint != null && axonFootprint > 0) return axonFootprint;
  // If we have no size signal, leave undefined so it is treated as Unknown and excluded from line-size cohort metrics.
  return undefined;
}

/** Fallback: evenly distribute T6/T12 rollups across 12 months when real per-month data is unavailable. */
function buildSyntheticSimTelemetry(
  agencyId: string,
  asOfMonthDate: Date,
  t6: number,
  t12: number
): TelemetryMonthly[] {
  const safeT12 = Math.max(0, t12);
  const safeT6 = Math.max(0, Math.min(t6, safeT12));
  const first6Total = Math.max(0, safeT12 - safeT6);

  const first6PerMonth = first6Total / 6;
  const last6PerMonth = safeT6 / 6;

  const rows: TelemetryMonthly[] = [];
  for (let i = 11; i >= 0; i--) {
    const month = startOfMonth(subMonths(asOfMonthDate, i));
    const isInLast6 = i <= 5;
    rows.push({
      month,
      agency_id: agencyId,
      product: 'Simulator Training',
      completions: isInLast6 ? last6PerMonth : first6PerMonth,
    });
  }
  return rows;
}

async function getLatestActivityMonth(): Promise<string> {
  const rows = await snowflakeQuery<{ MAX_ACTIVITY_MONTH: string }>(
    `select to_varchar(max(ACTIVITY_MONTH), 'YYYY-MM-01') as MAX_ACTIVITY_MONTH
     from ${SOURCE_TABLE}
     where ACTIVITY_MONTH <= current_date()
       and MEETS_ELIGIBILITY = 1
       and IS_FEDERAL = 0
       and IS_ENTERPRISE = 0
       and lower(DOMAIN_STATUS) = 'active'
       and lower(PRODUCTION_TYPE) = 'live'`
  );
  const v = rows[0]?.MAX_ACTIVITY_MONTH;
  if (!v) throw new Error('Could not determine latest ACTIVITY_MONTH from Snowflake');
  return v;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedMonthKey: string | undefined = body?.monthKey && body.monthKey !== 'auto' ? body.monthKey : undefined;

    const activityMonth = requestedMonthKey
      ? format(startOfMonth(parseISO(requestedMonthKey + '-01')), 'yyyy-MM-01')
      : await getLatestActivityMonth();

    const monthKey = monthKeyFromActivityMonth(activityMonth);
    const asOfMonthDate = startOfMonth(parseISO(activityMonth));

    // Aggregate APAP points from Snowflake source-of-truth fields.
    const apapAgg = await snowflakeQuery<{
      ELIGIBLE_POINTS: number | null;
      ADOPTION_POINTS: number | null;
      ELIGIBLE_COUNT: number | null;
      ADOPTING_COUNT: number | null;
    }>(
      `select
         sum(ELIGIBLE_POINTS) as ELIGIBLE_POINTS,
         sum(ADOPTION_POINTS) as ADOPTION_POINTS,
         count(*) as ELIGIBLE_COUNT,
         count_if(coalesce(ADOPTION_POINTS, 0) > 0) as ADOPTING_COUNT
       from ${SOURCE_TABLE}
       where ACTIVITY_MONTH = to_date(?, 'YYYY-MM-DD')
         and MEETS_ELIGIBILITY = 1
         and IS_FEDERAL = 0
         and IS_ENTERPRISE = 0
         and lower(DOMAIN_STATUS) = 'active'
         and lower(PRODUCTION_TYPE) = 'live'`,
      [activityMonth]
    );
    const eligiblePointsAgg = toNumberOrNull(apapAgg[0]?.ELIGIBLE_POINTS) ?? 0;
    const adoptingPointsAgg = toNumberOrNull(apapAgg[0]?.ADOPTION_POINTS) ?? 0;
    const eligibleCountAgg = toNumberOrNull(apapAgg[0]?.ELIGIBLE_COUNT) ?? 0;
    const adoptingCountAgg = toNumberOrNull(apapAgg[0]?.ADOPTING_COUNT) ?? 0;
    const apapPctAgg = eligiblePointsAgg > 0 ? (adoptingPointsAgg / eligiblePointsAgg) * 100 : 0;

    // Query the trailing 12 months so we get real per-month ADOPTION_POINTS rather than
    // relying on T6/T12 rollup columns and synthetic distribution.
    const twelveMonthsAgoDate = format(startOfMonth(subMonths(asOfMonthDate, 11)), 'yyyy-MM-01');
    const rptRows = await snowflakeQuery<RptAdoptionVrRow>(
      `select
        ACTIVITY_MONTH,
        ACCOUNT_NUMBER,
        CUSTOMER_NAME,
        LICENSE_QUANTITY,
        PRO_LICENSES,
        BASIC_PRO_LICENSES,
        ADOPTION_POINTS,
        ELIGIBLE_POINTS,
        IS_APAP_CONSIDERED,
        EVER_PURCHASED,
        ELIGIBILITY_COHORT,
        TOTAL_REGISTERED_T10_CONTROLLERS,
        AXON_FOOTPRINT,
        CONTRACT_START_MONTH,
        FIRST_ELIGIBLE_MONTH,
        SUB_REGION,
        ACCOUNT_MANAGER,
        COUNTRY,
        T6_SIM_EVENTS,
        T12_SIM_EVENTS,
        MEETS_ELIGIBILITY,
        DOMAIN_STATUS,
        PRODUCTION_TYPE,
        IS_FEDERAL,
        IS_ENTERPRISE
      from ${SOURCE_TABLE}
      where ACTIVITY_MONTH >= to_date(?, 'YYYY-MM-DD')
        and ACTIVITY_MONTH <= to_date(?, 'YYYY-MM-DD')
        and IS_FEDERAL = 0
        and IS_ENTERPRISE = 0
        and lower(DOMAIN_STATUS) = 'active'
        and lower(PRODUCTION_TYPE) = 'live'
        and (IS_APAP_CONSIDERED = 1 or EVER_PURCHASED = 1)
      order by ACCOUNT_NUMBER, ACTIVITY_MONTH`,
      [twelveMonthsAgoDate, activityMonth]
    );

    // Group rows by agency; use the latest month's row for master data.
    const agencyLatestRow = new Map<string, RptAdoptionVrRow>();
    for (const r of rptRows) {
      const agencyIdRaw = r.ACCOUNT_NUMBER;
      if (agencyIdRaw === null || agencyIdRaw === undefined || agencyIdRaw === '') continue;
      const agency_id = String(agencyIdRaw);
      const existing = agencyLatestRow.get(agency_id);
      const rKey = monthKeyFromActivityMonth(r.ACTIVITY_MONTH);
      const existingKey = existing ? monthKeyFromActivityMonth(existing.ACTIVITY_MONTH) : '';
      if (!existing || rKey > existingKey) {
        agencyLatestRow.set(agency_id, r);
      }
    }

    const agencies: AgencyRow[] = [];
    const telemetry: TelemetryMonthly[] = [];

    for (const [agency_id, r] of agencyLatestRow) {
      const agency_name = r.CUSTOMER_NAME ? String(r.CUSTOMER_NAME) : agency_id;

      const vrLicenses = pickVrLicenses(r);
      const vr_licenses = vrLicenses !== null ? vrLicenses : undefined;

      // The legacy pipeline uses officer_count as "points" for APAP/goal weighting.
      // In this Snowflake report, ELIGIBLE_POINTS is the closest equivalent.
      const eligiblePts = toNumberOrNull(r.ELIGIBLE_POINTS);
      const officer_count = pickOfficerCountForLineSize(
        eligiblePts,
        toNumberOrNull(r.TOTAL_REGISTERED_T10_CONTROLLERS),
        toNumberOrNull(r.AXON_FOOTPRINT)
      );

      const eligibilityCohort = toNumberOrNull(r.ELIGIBILITY_COHORT);
      const eligibility_cohort = eligibilityCohort !== null && eligibilityCohort >= 0 ? eligibilityCohort : undefined;
      const purchase_date = derivePurchaseDate(asOfMonthDate, eligibilityCohort, r.CONTRACT_START_MONTH);

      agencies.push({
        agency_id,
        agency_name,
        vr_licenses,
        officer_count,
        eligibility_cohort,
        purchase_date,
        cew_type: 'T10',
        region: r.SUB_REGION ?? undefined,
        csm_owner: r.ACCOUNT_MANAGER ?? undefined,
        notes: r.COUNTRY ? `Country: ${r.COUNTRY}` : undefined,
      });
    }

    // ADOPTION_VR_PREVIEW only exposes rolling T6/T12 totals, not true per-month SIM completions.
    // ADOPTION_POINTS is a binary adoption weight (= ELIGIBLE_POINTS when adopting, 0 otherwise)
    // and cannot be used as monthly completions. We distribute T6/T12 synthetically across months,
    // using each agency's latest available row for the rolling totals.
    for (const [agency_id, latestRow] of agencyLatestRow) {
      const t6 = toNumberOrNull(latestRow.T6_SIM_EVENTS) ?? 0;
      const t12 = toNumberOrNull(latestRow.T12_SIM_EVENTS) ?? 0;
      telemetry.push(...buildSyntheticSimTelemetry(agency_id, asOfMonthDate, t6, t12));
    }

    const processed = processData(agencies, telemetry, monthKey);
    const { computeKPICountsAndPoints } = await import('@/lib/history');
    const apap = {
      apap: apapPctAgg,
      adoptingPoints: adoptingPointsAgg,
      eligiblePoints: eligiblePointsAgg,
      eligibleCount: eligibleCountAgg,
      adoptingCount: adoptingCountAgg,
    };
    const kpiCountsAndPoints = computeKPICountsAndPoints(processed.agencies, processed.agencyLabels);
    const t10Ids = new Set(processed.agencies.map((a) => a.agency_id));
    const simT10 = computeSimT10Usage(telemetry, t10Ids, asOfMonthDate);

    const snapshot = {
      agencies: processed.agencies,
      agencyLabels: Array.from(processed.agencyLabels.entries()),
      nearEligible: processed.nearEligible,
      dataQuality: processed.dataQuality,
      asOfMonth: processed.asOfMonth?.toISOString() ?? null,
      cohortSummaries: processed.cohortSummaries,
      usageRollups: processed.usageRollups,
      // Source-of-truth APAP from Snowflake points (matches adoption_vr_preview sums)
      apap,
      asOfMonthKey: monthKey,
      createdAt: new Date().toISOString(),
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      computeVersion: COMPUTE_VERSION,
      t6RangeLabel: getLookbackRangeLabel(monthKey, 6),
      t12RangeLabel: getLookbackRangeLabel(monthKey, 12),
      source: 'snowflake',
      sourceTable: SOURCE_TABLE,
    };

    return NextResponse.json({
      monthKey,
      activityMonth,
      rowCount: rptRows.length,
      apap,
      kpiCountsAndPoints,
      simT10,
      snapshot,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Snowflake process failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

