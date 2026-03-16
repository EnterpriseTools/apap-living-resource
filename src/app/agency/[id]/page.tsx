'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { AgencyWithLabel, Agency } from '@/lib/schema';
import type { SimTelemetryMonthly } from '@/lib/schema';
import { ArrowLeft, User, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, AlertCircle, Clock, AlertTriangle } from 'lucide-react';
import { getProcessedDataParsed, getCurrentMonth } from '@/lib/storage';
import { isAdoptingFromMetrics, isEligible } from '@/lib/domain';
import { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD } from '@/config/domain_constants';
import { getTrailingMonthKeys, toMonthKey } from '@/lib/timeWindows';
import { format, parseISO, startOfMonth } from 'date-fns';
import { formatNumber, formatDecimal } from '@/lib/format';

type StoredData = {
  agencies: Agency[];
  agencyLabels: [string, AgencyWithLabel][];
  simTelemetry?: SimTelemetryMonthly[];
  asOfMonth: string | null;
};

// ── Inline SVG bar chart ───────────────────────────────────────────────────

function MonthlyBarChart({
  data,
  vrLicenses,
  height = 180,
}: {
  data: { monthKey: string; completions: number }[];
  vrLicenses: number;
  height?: number;
}) {
  if (!data.length) return <div style={{ color: 'var(--fg-secondary)', padding: '2rem', textAlign: 'center' }}>No monthly data available.</div>;

  const maxVal = Math.max(...data.map(d => d.completions), 1);
  const paddingLeft = 44;
  const paddingRight = 8;
  const paddingTop = 12;
  const paddingBottom = 32;
  const chartW = 760;
  const chartH = height;
  const innerW = chartW - paddingLeft - paddingRight;
  const innerH = chartH - paddingTop - paddingBottom;
  const n = data.length;
  const barW = Math.max(4, (innerW / n) * 0.6);
  const gap = innerW / n;

  // T6 threshold line: agency is adopting if avg monthly completions >= L * R6_threshold / 6
  const t6MonthlyTarget = vrLicenses * ADOPTION_R6_THRESHOLD;
  const t12MonthlyTarget = vrLicenses * ADOPTION_R12_THRESHOLD / 2;
  const thresholdY = (v: number) => paddingTop + innerH - (v / maxVal) * innerH;

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxVal / yTicks) * i));

  const getBarColor = (completions: number) => {
    const rate = completions / vrLicenses;
    if (rate >= ADOPTION_R6_THRESHOLD) return 'var(--fg-success)';
    if (rate >= ADOPTION_R6_THRESHOLD * 0.5) return 'var(--fg-alert)';
    return completions > 0 ? 'var(--fg-secondary)' : 'var(--border-color)';
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={chartW} height={chartH} style={{ display: 'block', fontFamily: 'inherit' }}>
        {/* Y-axis grid + labels */}
        {yTickVals.map((val) => {
          const y = paddingTop + innerH - (val / maxVal) * innerH;
          return (
            <g key={val}>
              <line x1={paddingLeft} x2={paddingLeft + innerW} y1={y} y2={y} stroke="var(--border-color)" strokeWidth={1} strokeDasharray="3 3" />
              <text x={paddingLeft - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--fg-secondary)">{val}</text>
            </g>
          );
        })}

        {/* T6 avg monthly threshold line */}
        {t6MonthlyTarget <= maxVal && (
          <g>
            <line
              x1={paddingLeft} x2={paddingLeft + innerW}
              y1={thresholdY(t6MonthlyTarget)} y2={thresholdY(t6MonthlyTarget)}
              stroke="var(--fg-success)" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.7}
            />
            <text x={paddingLeft + innerW + 2} y={thresholdY(t6MonthlyTarget) + 4} fontSize={9} fill="var(--fg-success)" opacity={0.9}>T6 tgt</text>
          </g>
        )}

        {/* T12 avg monthly threshold line (if different from T6) */}
        {t12MonthlyTarget <= maxVal && Math.abs(t12MonthlyTarget - t6MonthlyTarget) > 0.5 && (
          <g>
            <line
              x1={paddingLeft} x2={paddingLeft + innerW}
              y1={thresholdY(t12MonthlyTarget)} y2={thresholdY(t12MonthlyTarget)}
              stroke="var(--fg-action)" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.6}
            />
            <text x={paddingLeft + innerW + 2} y={thresholdY(t12MonthlyTarget) + 4} fontSize={9} fill="var(--fg-action)" opacity={0.9}>T12 tgt</text>
          </g>
        )}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = Math.max(1, (d.completions / maxVal) * innerH);
          const x = paddingLeft + i * gap + (gap - barW) / 2;
          const y = paddingTop + innerH - barH;
          const color = getBarColor(d.completions);
          const label = format(parseISO(d.monthKey + '-01'), 'MMM yy');
          return (
            <g key={d.monthKey}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx={2} opacity={0.85} />
              {d.completions > 0 && barH > 14 && (
                <text x={x + barW / 2} y={y + 11} textAnchor="middle" fontSize={9} fill="white" fontWeight={600}>
                  {Math.round(d.completions)}
                </text>
              )}
              <text x={x + barW / 2} y={chartH - 4} textAnchor="middle" fontSize={10} fill="var(--fg-secondary)">
                {label}
              </text>
            </g>
          );
        })}

        {/* Y-axis line */}
        <line x1={paddingLeft} x2={paddingLeft} y1={paddingTop} y2={paddingTop + innerH} stroke="var(--border-color)" strokeWidth={1} />
        {/* X-axis line */}
        <line x1={paddingLeft} x2={paddingLeft + innerW} y1={paddingTop + innerH} y2={paddingTop + innerH} stroke="var(--border-color)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── MoM change helpers ─────────────────────────────────────────────────────

function momChange(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return null; // can't compute % from zero
  return ((current - previous) / previous) * 100;
}

function MomBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)' }}>—</span>;
  if (Math.abs(pct) < 1) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)' }}>
      <Minus size={12} /> flat
    </span>
  );
  const up = pct > 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: up ? 'var(--fg-success)' : 'var(--fg-destructive)', fontSize: 'var(--text-caption-size)', fontWeight: 600 }}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

// ── Label helpers ──────────────────────────────────────────────────────────

function getLabelColor(label: string) {
  if (label === 'Top Performer') return 'var(--fg-action)';
  if (label === 'Adopting') return 'var(--fg-success)';
  if (label.includes('At Risk')) return 'var(--fg-alert)';
  if (label === 'Churned Out') return 'var(--fg-destructive)';
  if (label === 'Ineligible (0–5 months)') return 'var(--fg-action)';
  return 'var(--fg-secondary)';
}

function getLabelIcon(label: string) {
  if (label === 'Adopting' || label === 'Top Performer') return CheckCircle2;
  if (label.includes('At Risk')) return AlertCircle;
  if (label === 'Churned Out') return XCircle;
  if (label === 'Ineligible (0–5 months)') return Clock;
  return AlertTriangle;
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AgencyDetailPage() {
  const params = useParams();
  const id = decodeURIComponent(String(params?.id ?? ''));
  const [data, setData] = useState<StoredData | null>(null);

  useEffect(() => {
    const monthKey = getCurrentMonth();
    const result = getProcessedDataParsed(monthKey ?? undefined);
    if (result) {
      try {
        const parsed = result.data;
        const simTelemetry = parsed.simTelemetry
          ? (parsed.simTelemetry as any[]).map((t) => ({ ...t, month: new Date(t.month) }))
          : [];
        const agencies = parsed.agencies
          ? (parsed.agencies as any[]).map((a) => ({
              ...a,
              purchase_date: a.purchase_date ? new Date(a.purchase_date) : undefined,
              as_of_month: a.as_of_month ? new Date(a.as_of_month) : null,
            }))
          : [];
        const agencyLabels = (parsed.agencyLabels as [string, any][]).map(([aid, l]) => {
          const converted = { ...l };
          if (converted.metrics?.as_of_month) converted.metrics = { ...converted.metrics, as_of_month: new Date(converted.metrics.as_of_month) };
          return [aid, converted] as [string, AgencyWithLabel];
        });
        setData({ ...parsed as any, agencies, agencyLabels, simTelemetry });
      } catch (err) {
        console.error('Failed to parse stored data:', err);
      }
    }
  }, []);

  const agency = useMemo(() => data?.agencies.find(a => a.agency_id === id) ?? null, [data, id]);
  const labelItem = useMemo(() => {
    if (!data) return null;
    return new Map(data.agencyLabels).get(id) ?? null;
  }, [data, id]);

  // 12-month series: prefer monthlyCompletions from AgencyMetrics (stored in snapshot for both
  // Snowflake and Excel paths). Fall back to filtering raw simTelemetry when metrics aren't
  // available (e.g. agency is missing licenses).
  // Use asOfMonthKey (YYYY-MM) rather than asOfMonth (ISO datetime) so getTrailingMonthKeys
  // receives a format it can parse reliably.
  const monthlyData = useMemo(() => {
    const asOfKey = (data as any)?.asOfMonthKey ?? data?.asOfMonth;
    if (!asOfKey) return [];
    const keys = getTrailingMonthKeys(asOfKey, 12);

    // Primary: use pre-computed monthlyCompletions from AgencyMetrics
    const stored = (labelItem?.metrics as any)?.monthlyCompletions as
      | { monthKey: string; completions: number }[]
      | undefined;
    if (stored && stored.length > 0) {
      const byKey = new Map(stored.map(r => [r.monthKey, r.completions]));
      return keys.map(k => ({ monthKey: k, completions: byKey.get(k) ?? 0 }));
    }

    // Fallback: build from raw simTelemetry (Excel upload path without metrics)
    if (data.simTelemetry?.length) {
      const keySet = new Set(keys);
      const byKey = new Map<string, number>();
      for (const t of data.simTelemetry) {
        if (t.agency_id !== id) continue;
        const k = toMonthKey(t.month);
        if (!keySet.has(k)) continue;
        byKey.set(k, (byKey.get(k) ?? 0) + t.completions);
      }
      return keys.map(k => ({ monthKey: k, completions: byKey.get(k) ?? 0 }));
    }

    return keys.map(k => ({ monthKey: k, completions: 0 }));
  }, [data, id, labelItem?.metrics]);

  // Signals
  const metrics = labelItem?.metrics ?? null;
  const vrLicenses = metrics?.L ?? agency?.vr_licenses ?? 0;

  const t6Threshold = vrLicenses * ADOPTION_R6_THRESHOLD;
  const t12Threshold = vrLicenses * ADOPTION_R12_THRESHOLD;
  const isAdopting = isAdoptingFromMetrics(metrics);
  const eligible = isEligible(agency?.eligibility_cohort);

  // MoM % change (latest vs previous month)
  const latestMonth = monthlyData[monthlyData.length - 1];
  const prevMonth = monthlyData[monthlyData.length - 2];
  const momPct = latestMonth && prevMonth ? momChange(latestMonth.completions, prevMonth.completions) : null;

  // % vs trailing 6-month average
  const t6Avg = metrics ? metrics.C6 / 6 : 0;
  const vsT6Avg = latestMonth && t6Avg > 0 ? momChange(latestMonth.completions, t6Avg) : null;

  // Spike/drop flag (>50% MoM change)
  const hasSpike = momPct !== null && momPct > 50;
  const hasDrop = momPct !== null && momPct < -50;

  // Completions needed next month to maintain/achieve adopting (T6 metric)
  // To stay/become adopting via T6: need avg >= L * 0.75 per 6 months
  // Next month: oldest T6 month rolls off, new month added
  // needed = L * 0.75 * 6 - (C6 - oldestT6 + needed_next)  => but we simplify:
  // needed_t6 = max(0, L * R6_threshold * 6 - (C6 - oldestMonth))
  const oldestT6Month = monthlyData.length >= 7 ? monthlyData[monthlyData.length - 7] : null;
  const neededNextT6 = metrics
    ? Math.max(0, Math.ceil(t6Threshold * 6 - (metrics.C6 - (oldestT6Month?.completions ?? 0))))
    : null;

  if (!data) {
    return (
      <div style={{ padding: '3rem 2rem', maxWidth: '900px', margin: '0 auto', minHeight: 'calc(100vh - 80px)', background: 'var(--surface-1)' }}>
        <div style={{ background: 'var(--surface-3)', padding: '3rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <p style={{ color: 'var(--fg-secondary)', marginBottom: '2rem' }}>No data loaded. Please upload files or load from Snowflake.</p>
          <Link href="/upload" style={{ padding: '1rem 2rem', background: 'var(--bg-action)', color: 'white', borderRadius: 'var(--radius-md)', textDecoration: 'none' }}>→ Upload</Link>
        </div>
      </div>
    );
  }

  if (!agency || !labelItem) {
    return (
      <div style={{ padding: '3rem 2rem', maxWidth: '900px', margin: '0 auto', minHeight: 'calc(100vh - 80px)', background: 'var(--surface-1)' }}>
        <Link href="/action-list" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--fg-action)', textDecoration: 'none', marginBottom: '1.5rem', fontSize: 'var(--text-body2-size)' }}>
          <ArrowLeft size={16} /> Back to Agency List
        </Link>
        <div style={{ background: 'var(--surface-3)', padding: '3rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <p style={{ color: 'var(--fg-secondary)' }}>Agency <code>{id}</code> not found in the current snapshot.</p>
        </div>
      </div>
    );
  }

  const LabelIcon = getLabelIcon(labelItem.label);
  const asOfMonthKey = data.asOfMonth ?? '';
  const asOfLabel = asOfMonthKey ? format(startOfMonth(parseISO(asOfMonthKey + '-01')), 'MMMM yyyy') : '';

  return (
    <div style={{ padding: '2rem', maxWidth: '960px', margin: '0 auto', background: 'var(--surface-1)', minHeight: 'calc(100vh - 80px)' }}>

      {/* Back link */}
      <Link href="/action-list" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--fg-action)', textDecoration: 'none', marginBottom: '1.5rem', fontSize: 'var(--text-body2-size)' }}>
        <ArrowLeft size={16} /> Back to Agency List
      </Link>

      {/* Header card */}
      <div style={{ background: 'var(--surface-3)', padding: '2rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-headline-size)', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)', marginBottom: '0.4rem' }}>
              {labelItem.agency_name}
            </h1>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.75rem' }}>ID: {id}{asOfLabel ? ` · As of ${asOfLabel}` : ''}</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: getLabelColor(labelItem.label), fontWeight: 600, padding: '0.3rem 0.85rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: `1px solid ${getLabelColor(labelItem.label)}`, fontSize: 'var(--text-body2-size)' }}>
              <LabelIcon size={14} /> {labelItem.label}
            </span>
          </div>
          {(labelItem.csm_owner || labelItem.region) && (
            <div style={{ textAlign: 'right', fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>
              {labelItem.csm_owner && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
                  <User size={14} /> <strong style={{ color: 'var(--fg-primary)' }}>{labelItem.csm_owner}</strong>
                </div>
              )}
              {labelItem.region && <div>{labelItem.region}</div>}
            </div>
          )}
        </div>

        {/* Stat row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
          {[
            { label: 'VR Licenses', value: formatNumber(vrLicenses) },
            { label: 'Agency Size', value: formatNumber(agency.officer_count) },
            { label: 'Line Size', value: labelItem.cohorts.agency_size_band },
            { label: 'Purchase Cohort', value: labelItem.cohorts.purchase_cohort },
            { label: 'Eligibility', value: eligible ? 'Eligible' : `${agency.months_since_purchase ?? '?'} mo. (ineligible)` },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.2rem' }}>{label}</div>
              <div style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 600, color: 'var(--fg-primary)' }}>{value ?? '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 12-Month Completion Trend */}
      <div style={{ background: 'var(--surface-3)', padding: '1.75rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>
            12-Month Completion Trend
          </h2>
          <div style={{ display: 'flex', gap: '1rem', fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ display: 'inline-block', width: 20, height: 3, background: 'var(--fg-success)', borderRadius: 2 }} />
              T6 monthly target ({Math.round(t6Threshold * 6)} / 6 mo.)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ display: 'inline-block', width: 20, height: 3, background: 'var(--fg-action)', borderRadius: 2 }} />
              T12 monthly equiv.
            </span>
          </div>
        </div>
        <MonthlyBarChart data={monthlyData} vrLicenses={vrLicenses || 1} />
        <div style={{ marginTop: '0.75rem', fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>
          Bar color: <span style={{ color: 'var(--fg-success)' }}>■</span> above T6 threshold &nbsp;
          <span style={{ color: 'var(--fg-alert)' }}>■</span> partial &nbsp;
          <span style={{ color: 'var(--fg-secondary)' }}>■</span> low/zero
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', fontStyle: 'italic' }}>
          Note: Monthly values are estimated by evenly distributing Snowflake T6 / T12 rolling totals across months.
          Real per-month SIM completions are not yet available from this data source, so months within each 6-month
          bucket will appear identical.
        </div>
      </div>

      {/* Metrics + Signals row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>

        {/* T6 / T12 metrics */}
        <div style={{ background: 'var(--surface-3)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)', marginBottom: '1rem' }}>Adoption Metrics</h2>
          {metrics ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { label: 'T6 Completions', value: formatNumber(metrics.C6), sub: `Need ${formatNumber(Math.ceil(t6Threshold * 6))} to adopt via T6`, met: metrics.R6 >= ADOPTION_R6_THRESHOLD },
                { label: 'T6 Rate (R6)', value: formatDecimal(metrics.R6), sub: `Threshold: ${ADOPTION_R6_THRESHOLD}`, met: metrics.R6 >= ADOPTION_R6_THRESHOLD },
                { label: 'T12 Completions', value: formatNumber(metrics.C12), sub: `Need ${formatNumber(Math.ceil(t12Threshold))} to adopt via T12`, met: metrics.R12 >= ADOPTION_R12_THRESHOLD },
                { label: 'T12 Rate (R12)', value: formatDecimal(metrics.R12), sub: `Threshold: ${ADOPTION_R12_THRESHOLD}`, met: metrics.R12 >= ADOPTION_R12_THRESHOLD },
              ].map(({ label, value, sub, met }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ fontSize: 'var(--text-body2-size)', fontWeight: 600, color: 'var(--fg-primary)' }}>{label}</div>
                    <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{sub}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: 'var(--text-subtitle-size)', color: met ? 'var(--fg-success)' : 'var(--fg-primary)' }}>{value}</span>
                    {met
                      ? <CheckCircle2 size={16} color="var(--fg-success)" />
                      : <XCircle size={16} color="var(--fg-destructive)" />}
                  </div>
                </div>
              ))}
              <div style={{ marginTop: '0.25rem', padding: '0.75rem', background: isAdopting ? 'rgba(0,112,87,0.07)' : 'rgba(208,53,65,0.07)', borderRadius: 'var(--radius-sm)', border: `1px solid ${isAdopting ? 'var(--fg-success)' : 'var(--fg-destructive)'}`, fontSize: 'var(--text-body2-size)', fontWeight: 600, color: isAdopting ? 'var(--fg-success)' : 'var(--fg-destructive)', textAlign: 'center' }}>
                {isAdopting ? '✓ Currently Adopting (APAP)' : '✗ Not Currently Adopting'}
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--fg-secondary)' }}>No metrics available (missing licenses or telemetry).</p>
          )}
        </div>

        {/* Trend signals */}
        <div style={{ background: 'var(--surface-3)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)', marginBottom: '1rem' }}>Trend Signals</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-body2-size)', fontWeight: 600, color: 'var(--fg-primary)' }}>Latest month completions</div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{latestMonth?.monthKey ? format(parseISO(latestMonth.monthKey + '-01'), 'MMM yyyy') : '—'}</div>
              </div>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-subtitle-size)', color: 'var(--fg-primary)' }}>
                {formatNumber(latestMonth?.completions ?? 0)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-body2-size)', fontWeight: 600, color: 'var(--fg-primary)' }}>MoM change</div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>vs. prior month</div>
              </div>
              <MomBadge pct={momPct} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-body2-size)', fontWeight: 600, color: 'var(--fg-primary)' }}>vs. T6 monthly avg</div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>T6 avg = {formatDecimal(t6Avg)} / mo.</div>
              </div>
              <MomBadge pct={vsT6Avg} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-body2-size)', fontWeight: 600, color: 'var(--fg-primary)' }}>Completions needed next month</div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>to maintain/achieve T6 adoption</div>
              </div>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-subtitle-size)', color: neededNextT6 === 0 ? 'var(--fg-success)' : 'var(--fg-alert)' }}>
                {neededNextT6 === 0 ? 'Met ✓' : neededNextT6 !== null ? formatNumber(neededNextT6) : '—'}
              </span>
            </div>

            {(hasSpike || hasDrop) && (
              <div style={{ padding: '0.75rem', background: hasDrop ? 'rgba(208,53,65,0.07)' : 'rgba(171,67,7,0.07)', borderRadius: 'var(--radius-sm)', border: `1px solid ${hasDrop ? 'var(--fg-destructive)' : 'var(--fg-alert)'}`, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-body2-size)' }}>
                <AlertTriangle size={15} color={hasDrop ? 'var(--fg-destructive)' : 'var(--fg-alert)'} />
                <span style={{ color: 'var(--fg-primary)' }}>
                  {hasDrop ? `Sharp drop detected (${momPct?.toFixed(0)}% MoM) — churn risk signal.` : `Sharp spike detected (+${momPct?.toFixed(0)}% MoM) — verify data.`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Why bullets + recommended action */}
      {(labelItem.why?.length > 0 || labelItem.recommended_action) && (
        <div style={{ background: 'var(--surface-3)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)', marginBottom: '1rem' }}>Analysis</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2rem', flexWrap: 'wrap' }}>
            {labelItem.why?.length > 0 && (
              <div>
                <h3 style={{ fontSize: 'var(--text-body1-size)', fontWeight: 600, color: 'var(--fg-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '11px' }}>Why this label</h3>
                <ul style={{ marginLeft: '1.25rem', color: 'var(--fg-primary)', fontSize: 'var(--text-body2-size)' }}>
                  {labelItem.why.map((b, i) => <li key={i} style={{ marginBottom: '0.3rem' }}>{b}</li>)}
                </ul>
              </div>
            )}
            {labelItem.recommended_action && (
              <div style={{ minWidth: '180px' }}>
                <h3 style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Action</h3>
                <div style={{ padding: '0.75rem 1rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)', fontWeight: 600 }}>
                  {labelItem.recommended_action}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monthly data table */}
      {monthlyData.length > 0 && (
        <div style={{ background: 'var(--surface-3)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>Monthly Breakdown</h2>
            <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', fontStyle: 'italic' }}>
              Estimated from T6 / T12 rolling totals — per-month values are evenly distributed within each 6-month window
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-body2-size)' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Month</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completions</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rate (/ license)</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MoM Δ</th>
                </tr>
              </thead>
              <tbody>
                {[...monthlyData].reverse().map((row, i, arr) => {
                  const prevRow = arr[i + 1];
                  const pct = prevRow ? momChange(row.completions, prevRow.completions) : null;
                  const rate = vrLicenses > 0 ? row.completions / vrLicenses : 0;
                  const meetsT6 = rate >= ADOPTION_R6_THRESHOLD;
                  return (
                    <tr key={row.monthKey} style={{ borderBottom: '1px solid var(--border-color)', background: i === 0 ? 'var(--surface-2)' : 'transparent' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: i === 0 ? 600 : 400, color: 'var(--fg-primary)' }}>
                        {format(parseISO(row.monthKey + '-01'), 'MMM yyyy')}
                        {i === 0 && <span style={{ marginLeft: '0.4rem', fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>(latest)</span>}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: meetsT6 ? 'var(--fg-success)' : row.completions > 0 ? 'var(--fg-primary)' : 'var(--fg-disabled)' }}>
                        {formatNumber(row.completions)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: meetsT6 ? 'var(--fg-success)' : 'var(--fg-secondary)' }}>
                        {vrLicenses > 0 ? formatDecimal(rate) : '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                        <MomBadge pct={pct} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
