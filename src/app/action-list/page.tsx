'use client';

import React, { useState, useEffect } from 'react';
import type { AgencyWithLabel, Agency } from '@/lib/schema';
import type { SimTelemetryMonthly } from '@/lib/schema';
import Link from 'next/link';
import { ListChecks, Download, AlertCircle, AlertTriangle, TrendingUp, CheckCircle2, XCircle, Clock, ArrowUpDown, ArrowUp, ArrowDown, User } from 'lucide-react';
import { calculateCompletionsNeeded, computeAgencyMetrics } from '@/lib/compute';
import { isEligible as isEligibleDomain, isAdoptingFromMetrics } from '@/lib/domain';
import { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD } from '@/config/domain_constants';
import { getBaselineData, compareAgenciesToBaseline, findMissingBaselineAgencies, type BaselineComparison } from '@/lib/baseline';
import { findLastAdoptingMonth } from '@/lib/labels';
import { getProcessedDataParsed, getCurrentMonth } from '@/lib/storage';
import { format } from 'date-fns';
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

/** Parsed label from storage (dates may be strings) */
type ParsedLabel = Record<string, unknown> & {
  metrics?: { as_of_month?: string };
  training_dates?: { latest_cew_training_date?: string; next_cew_training_date?: string };
};

type SortField = 'agency_name' | 'agency_id' | 'label' | 'agency_size_band' | 'purchase_cohort' | 'officer_count' | 'vr_licenses' | 'r6' | 'r12' | 'c6' | 'c12' | 'licenses' | 'csm_owner';
type SortDirection = 'asc' | 'desc' | null;

export default function ActionListPage() {
  const [data, setData] = useState<StoredData | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [filterCsm, setFilterCsm] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('officer_count');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [baseline, setBaseline] = useState<ReturnType<typeof getBaselineData> | null>(null);
  const [baselineComparisons, setBaselineComparisons] = useState<Map<string, BaselineComparison>>(new Map());
  const [missingBaselineAgencies, setMissingBaselineAgencies] = useState<Array<{ agency_id: string; baseline_adopting_points: number; was_adopting: boolean }>>([]);
  const [staleSnapshot, setStaleSnapshot] = useState(false);

  useEffect(() => {
    const baselineData = getBaselineData();
    setBaseline(baselineData);

    const monthKey = getCurrentMonth();
    const result = getProcessedDataParsed(monthKey ?? undefined);
    if (result) {
      try {
        setStaleSnapshot(result.isStale);
        const parsed = result.data;
        const labelsMap = new Map(parsed.agencyLabels as [string, AgencyWithLabel][]);
        const simTelemetry = parsed.simTelemetry ? parsed.simTelemetry.map((t: any) => ({
          ...t,
          month: new Date(t.month),
        })) : [];
        const agencies = parsed.agencies ? parsed.agencies.map((agency: any) => ({
          ...agency,
          purchase_date: agency.purchase_date ? new Date(agency.purchase_date) : undefined,
          as_of_month: agency.as_of_month ? new Date(agency.as_of_month) : null,
          latest_cew_training_date: agency.latest_cew_training_date ? new Date(agency.latest_cew_training_date) : undefined,
          next_cew_training_date: agency.next_cew_training_date ? new Date(agency.next_cew_training_date) : undefined,
        })) : [];
        const entries = Array.from(labelsMap.entries()) as [string, ParsedLabel][];
        const convertedLabels = entries.map(([id, label]) => {
          const convertedLabel: ParsedLabel = { ...label };
          if (convertedLabel.metrics?.as_of_month) {
            (convertedLabel.metrics as Record<string, unknown>).as_of_month = new Date(convertedLabel.metrics.as_of_month);
          }
          if (convertedLabel.training_dates) {
            (convertedLabel as Record<string, unknown>).training_dates = {
              latest_cew_training_date: convertedLabel.training_dates.latest_cew_training_date ? new Date(convertedLabel.training_dates.latest_cew_training_date) : undefined,
              next_cew_training_date: convertedLabel.training_dates.next_cew_training_date ? new Date(convertedLabel.training_dates.next_cew_training_date) : undefined,
            };
          }
          return [id, convertedLabel] as unknown as [string, AgencyWithLabel];
        });
        setData({ ...parsed, agencies, agencyLabels: convertedLabels, simTelemetry } as StoredData);
      } catch (err) {
        console.error('Failed to parse stored data:', err);
      }
    } else {
      setStaleSnapshot(false);
    }
  }, []);

  useEffect(() => {
    if (data && baseline) {
      const labelsMap = new Map(data.agencyLabels.map(([id, label]) => [id, { label: label.label, agency_name: label.agency_name }]));
      const comparisons = compareAgenciesToBaseline(data.agencies, labelsMap, baseline);
      setBaselineComparisons(new Map(comparisons.map(c => [c.agency_id, c])));
      const missing = findMissingBaselineAgencies(data.agencies, baseline);
      setMissingBaselineAgencies(missing);
    } else {
      setMissingBaselineAgencies([]);
    }
  }, [data, baseline]);

  if (!data) {
    return (
      <div style={{ padding: '3rem 2rem', maxWidth: '1200px', margin: '0 auto', minHeight: 'calc(100vh - 80px)', background: 'var(--surface-1)' }}>
        <div style={{ background: 'var(--surface-3)', padding: '3rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-headline-size)', fontWeight: 'var(--text-headline-weight)', marginBottom: '1rem', color: 'var(--fg-primary)' }}>Agency List</h1>
          <p style={{ color: 'var(--fg-secondary)', marginBottom: '2rem', fontSize: 'var(--text-body1-size)' }}>No data available. Please upload your files to get started.</p>
          <Link href="/upload" style={{ padding: '1rem 2rem', background: 'var(--bg-action)', color: 'white', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-button-size)', fontWeight: 'var(--text-button-weight)', letterSpacing: 'var(--text-button-letter)', textTransform: 'uppercase', display: 'inline-block', textDecoration: 'none' }}>→ Go to Upload Page</Link>
        </div>
      </div>
    );
  }

  const labelsMap = new Map(data.agencyLabels);
  const allAgenciesWithLabels: AgencyWithLabel[] = data.agencies
    .filter((agency) => agency.cew_type === 'T10')
    .map((agency) => labelsMap.get(agency.agency_id))
    .filter((item): item is AgencyWithLabel => item !== undefined);

  // Unique CSM owners for filter dropdown
  const csmOwners = Array.from(
    new Set(allAgenciesWithLabels.map(item => item.csm_owner).filter((v): v is string => !!v))
  ).sort();

  const isEligibleItem = (item: AgencyWithLabel): boolean => {
    const agency = data.agencies.find((a) => a.agency_id === item.agency_id);
    return agency != null && isEligibleDomain(agency.eligibility_cohort);
  };

  const meetsAPAP = (item: AgencyWithLabel): boolean => {
    const byMetrics = isAdoptingFromMetrics(item.metrics);
    const byLabel = item.label === 'Adopting' || item.label === 'Top Performer' || item.label === 'At Risk (Next Month)' || item.label === 'At Risk (Next Quarter)';
    return byMetrics || byLabel;
  };

  let filtered = allAgenciesWithLabels;
  if (searchTerm) {
    filtered = filtered.filter(
      (item) =>
        item.agency_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.agency_id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }
  if (filterLabel === 'adopting_apap') {
    filtered = filtered.filter((item) => isEligibleItem(item) && meetsAPAP(item));
  } else if (filterLabel === 'Adopting' || filterLabel === 'Top Performer') {
    filtered = filtered.filter((item) => item.label === filterLabel && isEligibleItem(item));
  } else if (filterLabel !== 'all') {
    filtered = filtered.filter((item) => item.label === filterLabel);
  }
  if (filterCsm !== 'all') {
    filtered = filtered.filter((item) =>
      filterCsm === '__unassigned__' ? !item.csm_owner : item.csm_owner === filterCsm
    );
  }

  const getCompletionsNeeded = (item: AgencyWithLabel): { t6: number | null; t12: number | null } => {
    if (!item.metrics) return { t6: null, t12: null };
    if (!data?.simTelemetry?.length) {
      if (isAdoptingFromMetrics(item.metrics)) return { t6: 0, t12: 0 };
      const t6Needed = Math.max(0, Math.ceil(ADOPTION_R6_THRESHOLD * item.metrics.L - item.metrics.C6));
      const t12Needed = Math.max(0, Math.ceil(ADOPTION_R12_THRESHOLD * item.metrics.L - item.metrics.C12));
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

  const getStatusCategory = (label: string): string => {
    if (label === 'Top Performer' || label === 'Adopting') return 'actively_adopting';
    if (label.includes('At Risk')) return 'at_risk';
    if (label === 'Churned Out') return 'recently_churned';
    if (label === 'Not Adopting') return 'unengaged';
    if (label === 'Ineligible (0–5 months)') return 'close_to_adopting';
    return 'other';
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') setSortDirection(null);
      else setSortField('agency_name');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  if (sortDirection !== null) {
    filtered = [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      const agencyA = data.agencies.find(ag => ag.agency_id === a.agency_id);
      const agencyB = data.agencies.find(ag => ag.agency_id === b.agency_id);
      switch (sortField) {
        case 'agency_name': aVal = a.agency_name.toLowerCase(); bVal = b.agency_name.toLowerCase(); break;
        case 'agency_id': aVal = a.agency_id.toLowerCase(); bVal = b.agency_id.toLowerCase(); break;
        case 'label': aVal = a.label; bVal = b.label; break;
        case 'agency_size_band': aVal = a.cohorts.agency_size_band; bVal = b.cohorts.agency_size_band; break;
        case 'purchase_cohort': aVal = a.cohorts.purchase_cohort; bVal = b.cohorts.purchase_cohort; break;
        case 'r6': aVal = a.metrics?.R6 ?? -1; bVal = b.metrics?.R6 ?? -1; break;
        case 'r12': aVal = a.metrics?.R12 ?? -1; bVal = b.metrics?.R12 ?? -1; break;
        case 'officer_count': aVal = agencyA?.officer_count ?? -1; bVal = agencyB?.officer_count ?? -1; break;
        case 'vr_licenses': case 'licenses': aVal = a.metrics?.L ?? -1; bVal = b.metrics?.L ?? -1; break;
        case 'csm_owner': aVal = a.csm_owner ?? ''; bVal = b.csm_owner ?? ''; break;
        default: return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  } else {
    const priorityOrder: Record<string, number> = {
      'At Risk (Next Month)': 1, 'At Risk (Next Quarter)': 2, 'Churned Out': 3, 'Top Performer': 4, 'Adopting': 5, 'Not Adopting': 6, 'Ineligible (0–5 months)': 7, 'Unknown (No license count)': 8,
    };
    filtered = [...filtered].sort((a, b) => {
      const pa = priorityOrder[a.label] ?? 10;
      const pb = priorityOrder[b.label] ?? 10;
      if (pa !== pb) return pa - pb;
      const oa = data.agencies.find(ag => ag.agency_id === a.agency_id)?.officer_count ?? 0;
      const ob = data.agencies.find(ag => ag.agency_id === b.agency_id)?.officer_count ?? 0;
      return ob - oa;
    });
  }

  const handleExportCSV = () => {
    const headers = [
      'Agency ID', 'Agency Name', 'Line Size', 'Agency Size', 'VR Licenses', 'Label', 'Adopting (APAP)',
      'CSM Owner', 'Region',
      `${t6Label} Completions`, `${t12Label} Completions`, `${t6Label} Completions PP`, `${t12Label} Completions PP`,
      'Time As Customer', `${t6Label} Completions Needed`, `${t12Label} Completions Needed`, 'Adopting in 2025 baseline',
    ];
    const rows = filtered.map((item) => {
      const needed = getCompletionsNeeded(item);
      const agency = data.agencies.find(ag => ag.agency_id === item.agency_id);
      const comparison = baselineComparisons.get(item.agency_id);
      const wasAdoptingInBaseline = comparison?.baseline_status === 'adopting';
      return [
        item.agency_id, item.agency_name, item.cohorts.agency_size_band,
        agency?.officer_count?.toLocaleString() ?? '', item.metrics?.L?.toLocaleString() ?? '',
        item.label, (isEligibleItem(item) && meetsAPAP(item)) ? 'Y' : '',
        item.csm_owner ?? '', item.region ?? '',
        item.metrics?.C6 != null ? item.metrics.C6.toFixed(0) : '', item.metrics?.C12 != null ? item.metrics.C12.toFixed(0) : '',
        item.metrics?.R6 != null ? item.metrics.R6.toFixed(2) : '', item.metrics?.R12 != null ? item.metrics.R12.toFixed(2) : '',
        item.cohorts.purchase_cohort,
        needed.t6 != null && needed.t6 > 0 ? needed.t6.toFixed(0) : 'Met',
        needed.t12 != null && needed.t12 > 0 ? needed.t12.toFixed(0) : 'Met',
        wasAdoptingInBaseline ? 'Y' : '',
      ];
    });
    const escape = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
    const csvContent = [headers.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agency-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLineSizeColor = (lineSize: string): string => {
    if (lineSize === 'Direct') return 'var(--fg-action)';
    if (lineSize === 'T1200') return 'var(--fg-live)';
    if (lineSize === 'Major') return 'var(--fg-success)';
    return 'var(--fg-secondary)';
  };

  const getLabelColor = (label: string): string => {
    if (label === 'Top Performer') return 'var(--fg-action)';
    if (label === 'Adopting') return 'var(--fg-success)';
    if (label.includes('At Risk')) return 'var(--fg-alert)';
    if (label === 'Churned Out') return 'var(--fg-destructive)';
    return 'var(--fg-secondary)';
  };

  const getLabelIcon = (label: string) => {
    if (label === 'Top Performer') return TrendingUp;
    if (label === 'Adopting') return CheckCircle2;
    if (label.includes('At Risk')) return AlertCircle;
    if (label === 'Churned Out') return XCircle;
    return Clock;
  };

  const getRowBackgroundColor = (label: string): string => {
    const status = getStatusCategory(label);
    if (status === 'actively_adopting') return 'rgba(0, 112, 87, 0.05)';
    if (status === 'at_risk') return 'rgba(171, 67, 7, 0.05)';
    if (status === 'recently_churned') return 'rgba(208, 53, 65, 0.05)';
    if (status === 'unengaged') return 'rgba(92, 92, 92, 0.05)';
    if (status === 'close_to_adopting') return 'rgba(4, 93, 210, 0.05)';
    return 'var(--surface-3)';
  };

  /** Returns React.CSSProperties for DataTable rowStyle (never a string). */
  const getRowStyle = (label: string): React.CSSProperties => ({
    background: getRowBackgroundColor(label),
    borderLeft: `3px solid ${getLabelColor(label)}`,
  });

  const getSortIcon = (field: SortField) => {
    if (sortField !== field || sortDirection === null) return <ArrowUpDown size={14} style={{ opacity: 0.3 }} />;
    return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  };

  const t6Label = 'T6';
  const t12Label = 'T12';
  const asOfMonthKey = data.asOfMonth ?? '';
  const metricsProgressTooltip = asOfMonthKey ? `${getT6Tooltip(asOfMonthKey)} ${getT12Tooltip(asOfMonthKey)}` : 'Trailing 6/12 months (inclusive)';

  const columns: DataTableColumn<AgencyWithLabel>[] = [
    { id: 'agency_name', label: 'Agency Name', sortKey: 'agency_name', render: (item) => (
      <Link href={`/agency/${encodeURIComponent(item.agency_id)}`} style={{ fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-action)', textDecoration: 'none' }} title="View agency detail">
        {item.agency_name}
      </Link>
    )},
    { id: 'agency_id', label: 'Agency ID', sortKey: 'agency_id', render: (item) => <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{item.agency_id}</span> },
    { id: 'agency_size_band', label: 'Line size', sortKey: 'agency_size_band', render: (item) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.5rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', color: getLineSizeColor(item.cohorts.agency_size_band), fontWeight: 'var(--text-subtitle-weight)' }}>{item.cohorts.agency_size_band}</span>
    )},
    { id: 'officer_count', label: 'Agency Size', sortKey: 'officer_count', render: (item) => formatNumber(data.agencies.find(ag => ag.agency_id === item.agency_id)?.officer_count) },
    { id: 'vr_licenses', label: 'VR Licenses', sortKey: 'vr_licenses', render: (item) => formatNumber(item.metrics?.L) },
    { id: 'label', label: 'Label', sortKey: 'label', render: (item) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: getLabelColor(item.label), fontWeight: 'var(--text-subtitle-weight)', padding: '0.25rem 0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
        {React.createElement(getLabelIcon(item.label), { size: 14 })}
        {item.label}
      </span>
    )},
    { id: 'csm_owner', label: <TooltipHeader label="CSM Owner" tooltip="Account manager / CSM responsible for this agency" />, sortKey: 'csm_owner', render: (item) => item.csm_owner
      ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
          <User size={13} style={{ color: 'var(--fg-secondary)' }} />
          {item.csm_owner}
        </span>
      )
      : <span style={{ color: 'var(--fg-disabled)' }}>—</span>,
    },
    ...(baseline ? [{
      id: 'baseline',
      label: 'Baseline Status',
      render: (item: AgencyWithLabel) => {
        const comparison = baselineComparisons.get(item.agency_id);
        const wasAdoptingInBaseline = comparison?.baseline_status === 'adopting';
        if (wasAdoptingInBaseline) return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.5rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', color: 'var(--fg-primary)', fontWeight: 'var(--text-subtitle-weight)' }}>Adopting in 2025 baseline</span>;
        if (comparison) return '—';
        return <span style={{ fontStyle: 'italic', color: 'var(--fg-secondary)' }}>New 2026 Agency</span>;
      },
    } as DataTableColumn<AgencyWithLabel>] : []),
    { id: 'purchase_cohort', label: 'Time As Customer', sortKey: 'purchase_cohort', render: (item) => item.cohorts.purchase_cohort ?? '—' },
    { id: 'metrics_progress', label: <TooltipHeader label="Metrics & Progress" tooltip={metricsProgressTooltip} />, sortKey: 'r12', headerTooltip: metricsProgressTooltip, render: (item) => {
      if (!item.metrics) return <span style={{ color: 'var(--fg-disabled)' }}>—</span>;
      const needed = getCompletionsNeeded(item);
      const isAdopting = isAdoptingFromMetrics(item.metrics);
      return (
        <>
          {needed.t6 != null && needed.t6 > 0 && <div style={{ color: 'var(--fg-alert)' }}><strong>{t6Label}:</strong> {formatNumber(needed.t6)} completions needed</div>}
          {needed.t12 != null && needed.t12 > 0 && <div style={{ marginTop: (needed.t6 != null && needed.t6 > 0) ? '0.5rem' : '0', color: 'var(--fg-alert)' }}><strong>{t12Label}:</strong> {formatNumber(needed.t12)} completions needed</div>}
          {isAdopting && needed.t6 === 0 && needed.t12 === 0 && <div style={{ color: 'var(--fg-success)' }}>Meeting both {t6Label} and {t12Label} thresholds</div>}
        </>
      );
    }},
  ];

  const expandableRow = (item: AgencyWithLabel) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Why</h3>
        <ul style={{ marginLeft: '1.5rem', color: 'var(--fg-primary)' }}>{item.why.map((bullet, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{bullet}</li>)}</ul>
      </div>
      {item.label === 'Churned Out' && data?.simTelemetry && item.metrics && (() => {
        const asOfMonth = data.asOfMonth ? new Date(data.asOfMonth + '-01') : new Date();
        const lastAdopting = findLastAdoptingMonth(item.agency_id, data.simTelemetry, asOfMonth, item.metrics.L);
        return lastAdopting ? (
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--surface-3)', borderRadius: 'var(--radius-sm)' }}>
            <h4 style={{ fontSize: 'var(--text-body1-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-destructive)' }}>Churn Details</h4>
            <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
              <strong>Last adopting month:</strong> {formatMonthLabel(lastAdopting)}
            </div>
          </div>
        ) : null;
      })()}
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
          </div>
        </div>
      )}
      {item.training_dates && (item.training_dates.latest_cew_training_date || item.training_dates.next_cew_training_date) && (
        <div>
          <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Training Dates</h3>
          <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
            {item.training_dates.latest_cew_training_date && <div><strong>Latest:</strong> {format(new Date(item.training_dates.latest_cew_training_date), 'PPP')}</div>}
            {item.training_dates.next_cew_training_date && <div><strong>Next:</strong> {format(new Date(item.training_dates.next_cew_training_date), 'PPP')}</div>}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', background: 'var(--surface-1)', minHeight: 'calc(100vh - 80px)' }}>
      <div style={{ background: 'var(--surface-3)', padding: '2rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)', padding: '0.75rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ListChecks size={24} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 'var(--text-headline-size)', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)', marginBottom: '0.25rem' }}>Agency List</h1>
              <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>Agencies flagged for attention with adoption, churn, and risk metrics</p>
            </div>
          </div>
          <button type="button" onClick={handleExportCSV} style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-action)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-button-size)', fontWeight: 'var(--text-button-weight)', letterSpacing: 'var(--text-button-letter)', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Download size={16} /> Export CSV
          </button>
        </div>

        {staleSnapshot && (
          <div style={{ marginBottom: '1.5rem', padding: '1rem 1.5rem', background: 'var(--bg-alert)', borderRadius: 'var(--radius-md)', border: '1px solid var(--fg-alert)', color: 'var(--fg-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle size={20} color="var(--fg-alert)" />
            <span style={{ fontSize: 'var(--text-body1-size)' }}>Snapshot computed with older logic — re-upload to refresh.</span>
          </div>
        )}

        <FilterBar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Search agency name or ID..."
          filters={[
            {
              label: 'Label',
              value: filterLabel,
              onChange: setFilterLabel,
              options: [
                { value: 'all', label: 'All Labels' },
                { value: 'adopting_apap', label: 'Adopting (meeting APAP)' },
                { value: 'At Risk (Next Month)', label: 'At Risk (Next Month)' },
                { value: 'At Risk (Next Quarter)', label: 'At Risk (Next Quarter)' },
                { value: 'Churned Out', label: 'Churned Out' },
                { value: 'Top Performer', label: 'Top Performer' },
                { value: 'Adopting', label: 'Adopting' },
                { value: 'Not Adopting', label: 'Not Adopting' },
                { value: 'Ineligible (0–5 months)', label: 'Ineligible' },
              ],
            },
            ...(csmOwners.length > 0 ? [{
              label: 'CSM Owner',
              value: filterCsm,
              onChange: setFilterCsm,
              options: [
                { value: 'all', label: 'All CSM Owners' },
                { value: '__unassigned__', label: 'Unassigned' },
                ...csmOwners.map(o => ({ value: o, label: o })),
              ],
            }] : []),
          ]}
        />

        <DataTable<AgencyWithLabel>
          columns={columns}
          rows={filtered}
          getRowKey={(item) => item.agency_id}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          getSortIcon={(field) => sortField !== field || sortDirection === null ? <ArrowUpDown size={14} style={{ opacity: 0.3 }} /> : sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          rowStyle={(item) => getRowStyle(item.label)}
          expandableRow={expandableRow}
          expandedRowId={expandedRow}
          onExpandedRowChange={setExpandedRow}
          emptyMessage="No agencies match the current filters."
          showIndex
        />

        {baseline && missingBaselineAgencies.length > 0 && (
          <div style={{ marginTop: '3rem', padding: '2rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <AlertCircle size={20} color="var(--fg-alert)" />
              <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>Agencies No Longer Eligible (Were in Baseline)</h2>
            </div>
            <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)', marginBottom: '1rem' }}>These agencies were eligible in the November 2025 baseline but are no longer appearing in current data.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-body2-size)' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-3)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>Agency ID</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>Baseline Status</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>Adopting Points</th>
                  </tr>
                </thead>
                <tbody>
                  {missingBaselineAgencies.map((agency) => (
                    <tr key={agency.agency_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.75rem', color: 'var(--fg-primary)' }}>{agency.agency_id}</td>
                      <td style={{ padding: '0.75rem', color: agency.was_adopting ? 'var(--fg-success)' : 'var(--fg-secondary)' }}>{agency.was_adopting ? 'Was Adopting' : 'Was Not Adopting'}</td>
                      <td style={{ padding: '0.75rem', color: 'var(--fg-primary)' }}>{agency.baseline_adopting_points.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
