import { NextResponse } from 'next/server';
import { parseISO, startOfMonth, subMonths, format } from 'date-fns';
import { snowflakeQuery } from '@/lib/snowflake';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SOURCE_TABLE = 'PRODUCT_ANALYTICS.APAP_REPORTS.ADOPTION_VR_PREVIEW';

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
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
    const monthsBack = clampInt(body?.monthsBack, 6, 1, 24);
    const endMonthKeyRaw: string | undefined =
      typeof body?.endMonthKey === 'string' && body.endMonthKey !== 'auto' ? body.endMonthKey : undefined;

    const endActivityMonth = endMonthKeyRaw
      ? format(startOfMonth(parseISO(endMonthKeyRaw + '-01')), 'yyyy-MM-01')
      : await getLatestActivityMonth();
    const endDate = startOfMonth(parseISO(endActivityMonth));
    const startDate = startOfMonth(subMonths(endDate, monthsBack - 1));
    const startActivityMonth = format(startDate, 'yyyy-MM-01');

    const rows = await snowflakeQuery<{
      ACTIVITY_MONTH: string;
      ELIGIBLE_POINTS: number | null;
      ADOPTION_POINTS: number | null;
      ELIGIBLE_COUNT: number | null;
      ADOPTING_COUNT: number | null;
    }>(
      `select
         to_varchar(ACTIVITY_MONTH, 'YYYY-MM-01') as ACTIVITY_MONTH,
         sum(ELIGIBLE_POINTS) as ELIGIBLE_POINTS,
         sum(ADOPTION_POINTS) as ADOPTION_POINTS,
         count(*) as ELIGIBLE_COUNT,
         count_if(coalesce(ADOPTION_POINTS, 0) > 0) as ADOPTING_COUNT
       from ${SOURCE_TABLE}
       where ACTIVITY_MONTH between to_date(?, 'YYYY-MM-DD') and to_date(?, 'YYYY-MM-DD')
         and MEETS_ELIGIBILITY = 1
         and IS_FEDERAL = 0
         and IS_ENTERPRISE = 0
         and lower(DOMAIN_STATUS) = 'active'
         and lower(PRODUCTION_TYPE) = 'live'
       group by ACTIVITY_MONTH
       order by ACTIVITY_MONTH asc`,
      [startActivityMonth, endActivityMonth]
    );

    const months = rows.map((r) => {
      const eligiblePoints = Number(r.ELIGIBLE_POINTS ?? 0);
      const adoptionPoints = Number(r.ADOPTION_POINTS ?? 0);
      const apap = eligiblePoints > 0 ? (adoptionPoints / eligiblePoints) * 100 : 0;
      const activityMonth = String(r.ACTIVITY_MONTH);
      const monthKey = format(startOfMonth(parseISO(activityMonth)), 'yyyy-MM');
      return {
        monthKey,
        activityMonth,
        eligiblePoints,
        adoptionPoints,
        eligibleCount: Number(r.ELIGIBLE_COUNT ?? 0),
        adoptingCount: Number(r.ADOPTING_COUNT ?? 0),
        apap,
      };
    });

    return NextResponse.json({
      monthsBack,
      startActivityMonth,
      endActivityMonth,
      monthCount: months.length,
      months,
      sourceTable: SOURCE_TABLE,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Snowflake history load failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
