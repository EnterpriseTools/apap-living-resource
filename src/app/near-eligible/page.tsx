'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { AgencyWithLabel, Agency } from '@/lib/schema';
import type { SimTelemetryMonthly } from '@/lib/schema';
import Link from 'next/link';
import { Clock, Download, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, User } from 'lucide-react';
import { calculateCompletionsNeeded } from '@/lib/compute';
import { getProcessedData, getCurrentMonth } from '@/lib/storage';
import { isAdoptingFromMetrics } from '@/lib/domain';
import { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD } from '@/config/domain_constants';
import { FilterBar } from '@/components/FilterBar';
import { DataTable, type DataTableColumn } from '@/components/table/DataTable';
import { TooltipHeader } from '@/components/table/TooltipHeader';
import { getT6Tooltip, getT12Tooltip } from '@/lib/lookbackTooltips';
import { formatNumber, formatDecimal, formatMonthLabel } from '@/lib/format';

type StoredData = {
  agencies: Agency[];
  agencyLabels: [string, AgencyWithLabel][];
  nearEligible: Agency[];
  dataQuality: any;
  asOfMonth: string | null;
  simTelemetry?: SimTelemetryMonthly[];
};

type SortField = 'agency_name' | 'agency_id' | 'agency_size_band' | 'purchase_cohort' | 'months_since_purchase' | 'officer_count' | 'vr_licenses' | 'r6' | 'r12' | 'c6' | 'c12' | 'csm_owner';
type SortDirection = 'asc' | 'desc' | null;

function monthsUntilEligible(monthsSincePurchase: number | null): number | null {
  if (monthsSincePurchase === null) return null;
  return Math.max(0, 6 - monthsSincePurchase);
}

export default function NearEligiblePage() {
  const [data, setData] = useState<StoredData | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCsm, setFilterCsm] = useState<string>('all');
  const [filterSegment, setFilterSegment] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('officer_count');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    const monthKey = getCurrentMonth();
    const stored = getProcessedData(monthKey ?? undefined);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const labelsMap = new Map(parsed.agencyLabels);
        const simTelemetry = parsed.simTelemetry ? parsed.simTelemetry.map((t: any) => ({
          ...t,
          month: new Date(t.month),
        })) : undefined;
        setData({ ...parsed, agencyLabels: Array.from(labelsMap.entries()), simTelemetry });
      } catch (err) {
        console.error('Failed to parse stored data:', err);
      }
    }
  }, []);

  const ineligibleWithLabels = useMemo(() => {
    if (!data) return [];
    const labelsMap = new Map(data.agencyLabels);
    return data.nearEligible
      .filter((agency) => agency.cew_type === 'T10')
      .map((agency) => {
        const labelItem = labelsMap.get(agency.agency_id) as AgencyWithLabel | undefined;
        return labelItem ? { labelItem, agency } : null;
      })
      .filter((item): item is { labelItem: AgencyWithLabel; agency: Agency } => item !== null);
  }, [data]);

  // Unique CSM owners for filter dropdown
  const csmOwners = useMemo(() => {
    const owners = new Set<string>();
    ineligibleWithLabels.forEach(({ labelItem }) => {
      if (labelItem.csm_owner) owners.add(labelItem.csm_owner);
    });
    return Array.from(owners).sort();
  }, [ineligibleWithLabels]);

  const filtered = useMemo(() => {
    let list = ineligibleWithLabels;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        ({ labelItem }) =>
          labelItem.agency_name.toLowerCase().includes(q) ||
          labelItem.agency_id.toLowerCase().includes(q)
      );
    }
    if (filterCsm !== 'all') {
      list = list.filter(({ labelItem }) =>
        filterCsm === '__unassigned__'
          ? !labelItem.csm_owner
          : labelItem.csm_owner === filterCsm
      );
    }
    if (filterSegment === 'near_eligible') {
      list = list.filter(({ agency }) =>
        agency.months_since_purchase === 4 || agency.months_since_purchase === 5
      );
    } else if (filterSegment === 'onboarding') {
      list = list.filter(({ agency }) =>
        agency.months_since_purchase !== null &&
        agency.months_since_purchase >= 0 &&
        agency.months_since_purchase <= 3
      );
    }
    return list;
  }, [ineligibleWithLabels, searchTerm, filterCsm, filterSegment]);

  const sorted = useMemo(() => {
    if (sortDirection === null) return [...filtered];
    return [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortField) {
        case 'agency_name':
          aVal = a.labelItem.agency_name.toLowerCase();
          bVal = b.labelItem.agency_name.toLowerCase();
          break;
        case 'agency_id':
          aVal = a.labelItem.agency_id.toLowerCase();
          bVal = b.labelItem.agency_id.toLowerCase();
          break;
        case 'agency_size_band':
          aVal = a.labelItem.cohorts.agency_size_band;
          bVal = b.labelItem.cohorts.agency_size_band;
          break;
        case 'purchase_cohort':
          aVal = a.labelItem.cohorts.purchase_cohort ?? '';
          bVal = b.labelItem.cohorts.purchase_cohort ?? '';
          break;
        case 'months_since_purchase':
          aVal = a.agency.months_since_purchase ?? -1;
          bVal = b.agency.months_since_purchase ?? -1;
          break;
        case 'r6':
          aVal = a.labelItem.metrics?.R6 ?? -1;
          bVal = b.labelItem.metrics?.R6 ?? -1;
          break;
        case 'r12':
          aVal = a.labelItem.metrics?.R12 ?? -1;
          bVal = b.labelItem.metrics?.R12 ?? -1;
          break;
        case 'c6':
          aVal = a.labelItem.metrics?.C6 ?? -1;
          bVal = b.labelItem.metrics?.C6 ?? -1;
          break;
        case 'c12':
          aVal = a.labelItem.metrics?.C12 ?? -1;
          bVal = b.labelItem.metrics?.C12 ?? -1;
          break;
        case 'officer_count':
          aVal = a.agency.officer_count ?? -1;
          bVal = b.agency.officer_count ?? -1;
          break;
        case 'vr_licenses':
          aVal = a.labelItem.metrics?.L ?? -1;
          bVal = b.labelItem.metrics?.L ?? -1;
          break;
        case 'csm_owner':
          aVal = a.labelItem.csm_owner ?? '';
          bVal = b.labelItem.csm_owner ?? '';
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDirection]);

  if (!data) {
    return (
      <div style={{ padding: '3rem 2rem', maxWidth: '1200px', margin: '0 auto', minHeight: 'calc(100vh - 80px)', background: 'var(--surface-1)' }}>
        <div style={{ background: 'var(--surface-3)', padding: '3rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-headline-size)', fontWeight: 'var(--text-headline-weight)', marginBottom: '1rem', color: 'var(--fg-primary)' }}>Ineligible Agencies</h1>
          <p style={{ color: 'var(--fg-secondary)', marginBottom: '2rem', fontSize: 'var(--text-body1-size)' }}>No data available. Please upload your files to get started.</p>
          <Link href="/upload" style={{ padding: '1rem 2rem', background: 'var(--bg-action)', color: 'white', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-button-size)', fontWeight: 'var(--text-button-weight)', letterSpacing: 'var(--text-button-letter)', textTransform: 'uppercase', display: 'inline-block', textDecoration: 'none' }}>→ Go to Upload Page</Link>
        </div>
      </div>
    );
  }

  const getCompletionsNeeded = (item: AgencyWithLabel): { t6: number | null; t12: number | null } => {
    if (!item.metrics) return { t6: null, t12: null };
    if (!data?.simTelemetry || data.simTelemetry.length === 0) {
      if (isAdoptingFromMetrics(item.metrics)) return { t6: 0, t12: 0 };
      const t6Needed = item.metrics.R6 != null && item.metrics.R6 >= ADOPTION_R6_THRESHOLD ? 0 : Math.max(0, Math.ceil(ADOPTION_R6_THRESHOLD * item.metrics.L - item.metrics.C6));
      const t12Needed = item.metrics.R12 != null && item.metrics.R12 >= ADOPTION_R12_THRESHOLD ? 0 : Math.max(0, Math.ceil(ADOPTION_R12_THRESHOLD * item.metrics.L - item.metrics.C12));
      return { t6: t6Needed, t12: t12Needed };
    }
    try {
      const needed = calculateCompletionsNeeded(item.agency_id, item.metrics, data.simTelemetry);
      return { t6: needed.t6, t12: needed.t12 };
    } catch {
      if (isAdoptingFromMetrics(item.metrics)) return { t6: 0, t12: 0 };
      return { t6: Math.max(0, Math.ceil(ADOPTION_R6_THRESHOLD * item.metrics.L - item.metrics.C6)), t12: Math.max(0, Math.ceil(ADOPTION_R12_THRESHOLD * item.metrics.L - item.metrics.C12)) };
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field || sortDirection === null) return <ArrowUpDown size={14} style={{ opacity: 0.3 }} />;
    return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  };

  const getSegmentBadge = (monthsSincePurchase: number | null) => {
    if (monthsSincePurchase === null) return null;
    const isNear = monthsSincePurchase >= 4;
    return (
      <span style={{
        display: 'inline-block',
        padding: '0.1rem 0.45rem',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-caption-size)',
        fontWeight: 'var(--text-subtitle-weight)',
        background: isNear ? 'rgba(171, 67, 7, 0.08)' : 'rgba(4, 93, 210, 0.08)',
        color: isNear ? 'var(--fg-alert)' : 'var(--fg-action)',
        border: `1px solid ${isNear ? 'var(--fg-alert)' : 'var(--fg-action)'}`,
        marginLeft: '0.4rem',
      }}>
        {isNear ? 'Near Eligible' : 'Onboarding'}
      </span>
    );
  };

  const t6Label = 'T6';
  const t12Label = 'T12';
  const asOfMonthKey = data.asOfMonth ?? '';
  const earlyUsageTooltip = asOfMonthKey ? `${getT6Tooltip(asOfMonthKey)} ${getT12Tooltip(asOfMonthKey)}` : 'Trailing 6/12 months (inclusive)';

  const nearEligibleCount = ineligibleWithLabels.filter(({ agency }) => agency.months_since_purchase !== null && agency.months_since_purchase >= 4).length;
  const onboardingCount = ineligibleWithLabels.filter(({ agency }) => agency.months_since_purchase !== null && agency.months_since_purchase < 4).length;

  // Adapt sorted rows to AgencyWithLabel for DataTable
  const tableRows = sorted.map(({ labelItem }) => labelItem);

  const columns: DataTableColumn<AgencyWithLabel>[] = [
    {
      id: 'agency_name',
      label: 'Agency Name',
      sortKey: 'agency_name',
      render: (item) => {
        const agency = data.nearEligible.find(a => a.agency_id === item.agency_id);
        return (
          <span style={{ fontWeight: 'var(--text-subtitle-weight)' }}>
            {item.agency_name}
            {getSegmentBadge(agency?.months_since_purchase ?? null)}
          </span>
        );
      },
    },
    { id: 'agency_id', label: 'Agency ID', sortKey: 'agency_id', render: (item) => <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{item.agency_id}</span> },
    { id: 'agency_size_band', label: 'Line Size', sortKey: 'agency_size_band', render: (item) => item.cohorts.agency_size_band ?? '—' },
    { id: 'officer_count', label: 'Agency Size', sortKey: 'officer_count', render: (item) => formatNumber(data.nearEligible.find(a => a.agency_id === item.agency_id)?.officer_count) },
    { id: 'vr_licenses', label: 'VR Licenses', sortKey: 'vr_licenses', render: (item) => formatNumber(item.metrics?.L) },
    {
      id: 'months_since_purchase',
      label: <TooltipHeader label="Eligibility Status" tooltip="Months since purchase and months remaining until the 6-month eligibility window opens" />,
      sortKey: 'months_since_purchase',
      render: (item) => {
        const agency = data.nearEligible.find(a => a.agency_id === item.agency_id);
        const msp = agency?.months_since_purchase ?? null;
        const mue = monthsUntilEligible(msp);
        return (
          <div>
            <div style={{ fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>
              {msp !== null ? `${msp} mo. since purchase` : '—'}
            </div>
            {mue !== null && mue > 0 && (
              <div style={{ fontSize: 'var(--text-caption-size)', color: mue <= 2 ? 'var(--fg-alert)' : 'var(--fg-secondary)', marginTop: '0.15rem' }}>
                {mue} mo. until eligible
              </div>
            )}
            {mue === 0 && (
              <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-success)', marginTop: '0.15rem' }}>Eligible this month</div>
            )}
          </div>
        );
      },
    },
    {
      id: 'csm_owner',
      label: <TooltipHeader label="CSM Owner" tooltip="Account manager / CSM responsible for this agency" />,
      sortKey: 'csm_owner',
      render: (item) => item.csm_owner
        ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
            <User size={13} style={{ color: 'var(--fg-secondary)' }} />
            {item.csm_owner}
          </span>
        )
        : <span style={{ color: 'var(--fg-disabled)' }}>—</span>,
    },
    {
      id: 'early_usage',
      label: <TooltipHeader label="Early Usage Signals" tooltip={earlyUsageTooltip} />,
      sortKey: 'c12',
      headerTooltip: earlyUsageTooltip,
      render: (item) => {
        if (!item.metrics) return <span style={{ color: 'var(--fg-disabled)' }}>No usage data yet</span>;
        const needed = getCompletionsNeeded(item);
        const isAdopting = isAdoptingFromMetrics(item.metrics);
        return (
          <>
            <div><strong>Completions (T12):</strong> {formatNumber(item.metrics.C12)}</div>
            {needed.t6 != null && needed.t6 > 0 && (
              <div style={{ marginTop: '0.25rem', color: 'var(--fg-alert)' }}><strong>{t6Label}:</strong> {formatNumber(needed.t6)} needed</div>
            )}
            {needed.t12 != null && needed.t12 > 0 && (
              <div style={{ marginTop: '0.25rem', color: 'var(--fg-alert)' }}><strong>{t12Label}:</strong> {formatNumber(needed.t12)} needed</div>
            )}
            {isAdopting && needed.t6 === 0 && needed.t12 === 0 && (
              <div style={{ color: 'var(--fg-success)' }}>Meeting both thresholds</div>
            )}
          </>
        );
      },
    },
    { id: 'action', label: 'Recommended Action', render: (item) => item.recommended_action },
  ];

  const expandableRow = (item: AgencyWithLabel) => {
    const agency = data.nearEligible.find(a => a.agency_id === item.agency_id);
    const msp = agency?.months_since_purchase ?? null;
    const mue = monthsUntilEligible(msp);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Eligibility Details</h3>
          <ul style={{ marginLeft: '1.5rem', color: 'var(--fg-primary)', fontSize: 'var(--text-body2-size)' }}>
            {msp !== null && (
              <li style={{ marginBottom: '0.25rem' }}>
                {msp} months since purchase — becomes eligible in {mue === 0 ? 'this month' : `${mue} month${mue !== 1 ? 's' : ''}`}
              </li>
            )}
            {item.metrics?.last3Months?.some(v => v > 0) && (
              <li style={{ marginBottom: '0.25rem' }}>
                Early usage detected: {item.metrics.last3Months.filter(v => v > 0).length} of last 3 months have completions
              </li>
            )}
            <li style={{ marginBottom: '0.25rem' }}>
              {msp !== null && msp >= 4
                ? 'Near-eligible — proactive engagement recommended to prepare for adoption assessment.'
                : 'Onboarding phase — focus on setup and early engagement support.'}
            </li>
          </ul>
        </div>
        {(item.csm_owner || item.region) && (
          <div>
            <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Account Info</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
              {item.csm_owner && <div><strong>CSM Owner:</strong> {item.csm_owner}</div>}
              {item.region && <div><strong>Region:</strong> {item.region}</div>}
            </div>
          </div>
        )}
        {item.metrics && (
          <div>
            <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Key Metrics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
              <div><strong>{t6Label} Completions:</strong> {formatNumber(item.metrics.C6)}</div>
              <div><strong>{t12Label} Completions:</strong> {formatNumber(item.metrics.C12)}</div>
              <div><strong>{t6Label} Completions PP:</strong> {formatDecimal(item.metrics.R6)}</div>
              <div><strong>{t12Label} Completions PP:</strong> {formatDecimal(item.metrics.R12)}</div>
              <div><strong>Licenses:</strong> {formatNumber(item.metrics.L)}</div>
              {item.metrics.last3Months && (
                <div><strong>Last 3 months:</strong> {item.metrics.last3Months.map(v => formatNumber(v)).join(', ')}</div>
              )}
            </div>
          </div>
        )}
        {item.training_dates && (item.training_dates.latest_cew_training_date || item.training_dates.next_cew_training_date) && (
          <div>
            <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Training Dates</h3>
            <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
              {item.training_dates.latest_cew_training_date && <div><strong>Latest:</strong> {formatMonthLabel(item.training_dates.latest_cew_training_date)}</div>}
              {item.training_dates.next_cew_training_date && <div><strong>Next:</strong> {formatMonthLabel(item.training_dates.next_cew_training_date)}</div>}
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleExportCSV = () => {
    const headers = [
      'Agency ID', 'Agency Name', 'Line Size', 'Agency Size', 'VR Licenses',
      'Months Since Purchase', 'Months Until Eligible', 'Segment', 'CSM Owner', 'Region',
      'Completions (T12)', `${t6Label} Completions Needed`, `${t12Label} Completions Needed`,
    ];
    const rows = sorted.map(({ labelItem, agency }) => {
      const needed = getCompletionsNeeded(labelItem);
      const msp = agency.months_since_purchase;
      const mue = monthsUntilEligible(msp);
      const segment = msp !== null && msp >= 4 ? 'Near Eligible' : 'Onboarding';
      return [
        labelItem.agency_id, labelItem.agency_name,
        labelItem.cohorts.agency_size_band ?? '',
        agency.officer_count != null ? agency.officer_count : '',
        labelItem.metrics?.L != null ? labelItem.metrics.L : '',
        msp ?? '', mue ?? '', segment,
        labelItem.csm_owner ?? '', labelItem.region ?? '',
        labelItem.metrics?.C12 != null ? labelItem.metrics.C12.toFixed(0) : '',
        needed.t6 != null && needed.t6 > 0 ? needed.t6.toFixed(0) : 'Met',
        needed.t12 != null && needed.t12 > 0 ? needed.t12.toFixed(0) : 'Met',
      ];
    });
    const escape = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
    const csvContent = [headers.join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ineligible-agencies.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const csmFilterOptions = [
    { value: 'all', label: 'All CSM Owners' },
    { value: '__unassigned__', label: 'Unassigned' },
    ...csmOwners.map(o => ({ value: o, label: o })),
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', background: 'var(--surface-1)', minHeight: 'calc(100vh - 80px)' }}>
      <div style={{ background: 'var(--surface-3)', padding: '2rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--bg-alert) 0%, #E67E22 100%)', padding: '0.75rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={24} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 'var(--text-headline-size)', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)', marginBottom: '0.25rem' }}>
                Ineligible Agencies
              </h1>
              <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>
                All agencies in the 0–5 month onboarding window ({ineligibleWithLabels.length} total —{' '}
                <span style={{ color: 'var(--fg-alert)' }}>{nearEligibleCount} near eligible</span>,{' '}
                <span style={{ color: 'var(--fg-action)' }}>{onboardingCount} onboarding</span>)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleExportCSV}
            style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-action)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-button-size)', fontWeight: 'var(--text-button-weight)', letterSpacing: 'var(--text-button-letter)', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Download size={16} /> Export CSV
          </button>
        </div>

        {/* Segment summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ padding: '1rem', background: 'rgba(171, 67, 7, 0.06)', borderRadius: 'var(--radius-md)', border: '1px solid var(--fg-alert)' }}>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-alert)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.25rem' }}>NEAR ELIGIBLE (4–5 mo.)</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)' }}>{nearEligibleCount}</div>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>Becoming eligible in 1–2 months</div>
          </div>
          <div style={{ padding: '1rem', background: 'rgba(4, 93, 210, 0.06)', borderRadius: 'var(--radius-md)', border: '1px solid var(--fg-action)' }}>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-action)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.25rem' }}>ONBOARDING (0–3 mo.)</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)' }}>{onboardingCount}</div>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>Recently purchased, in setup phase</div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.25rem' }}>TOTAL INELIGIBLE</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)' }}>{ineligibleWithLabels.length}</div>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>Not counted in APAP metrics</div>
          </div>
        </div>

        {/* Info Banner */}
        <div style={{ marginBottom: '1.5rem', padding: '1rem 1.5rem', background: 'var(--bg-alert)', borderRadius: 'var(--radius-md)', color: 'var(--fg-primary)', border: '1px solid var(--fg-alert)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <AlertCircle size={20} color="var(--fg-alert)" />
          <p style={{ fontSize: 'var(--text-body1-size)', margin: 0 }}>
            Ineligible agencies are not included in APAP calculations. Use this view for proactive onboarding outreach and to identify low engagement before eligibility begins.
          </p>
        </div>

        <FilterBar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Search agency name or ID..."
          filters={[
            {
              label: 'Segment',
              value: filterSegment,
              onChange: setFilterSegment,
              options: [
                { value: 'all', label: 'All Segments' },
                { value: 'near_eligible', label: 'Near Eligible (4–5 mo.)' },
                { value: 'onboarding', label: 'Onboarding (0–3 mo.)' },
              ],
            },
            ...(csmOwners.length > 0 ? [{
              label: 'CSM Owner',
              value: filterCsm,
              onChange: setFilterCsm,
              options: csmFilterOptions,
            }] : []),
          ]}
        />

        <DataTable<AgencyWithLabel>
          columns={columns}
          rows={tableRows}
          getRowKey={(item) => item.agency_id}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={(field) => handleSort(field as SortField)}
          getSortIcon={getSortIcon}
          rowStyle={(item) => {
            const agency = data.nearEligible.find(a => a.agency_id === item.agency_id);
            const isNear = (agency?.months_since_purchase ?? 0) >= 4;
            return {
              borderLeft: isNear ? '3px solid var(--fg-alert)' : '3px solid var(--fg-action)',
            };
          }}
          expandableRow={expandableRow}
          emptyMessage={searchTerm || filterCsm !== 'all' || filterSegment !== 'all' ? 'No agencies match the current filters.' : 'No ineligible agencies found.'}
          showIndex
        />
      </div>
    </div>
  );
}
