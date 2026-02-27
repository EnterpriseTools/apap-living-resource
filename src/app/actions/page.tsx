'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ListChecks, Download, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { getProcessedData, getCurrentMonth } from '@/lib/storage';
import { getHistoricalData } from '@/lib/history';
import { FilterBar } from '@/components/FilterBar';
import { DataTable, type DataTableColumn } from '@/components/table/DataTable';
import { TooltipHeader } from '@/components/table/TooltipHeader';
import { getT6Tooltip, getT12Tooltip } from '@/lib/lookbackTooltips';
import { buildActionList, type ActionReason, type ActionListRow } from '@/lib/actionList';
import { ACTION_LIST_CONFIG } from '@/config/action_list_config';
import { formatNumber, formatDecimal, formatMonthLabel } from '@/lib/format';

type StoredData = {
  agencies: any[];
  agencyLabels: [string, any][];
  simTelemetry?: any[];
  asOfMonth: string | null;
};

const REASON_PRIORITY: Record<ActionReason, number> = {
  BASELINE_ADOPTER_CHURNED: 1,
  NEW_ADOPTER_CHURNED_2026: 2,
  AT_RISK_NEXT_MONTH: 3,
  AT_RISK_NEXT_QUARTER: 4,
  CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT: 5,
  CLOSE_TO_ADOPTING: 6,
};

const REASON_LABELS: Record<ActionReason, string> = {
  BASELINE_ADOPTER_CHURNED: '2025 agency churned',
  NEW_ADOPTER_CHURNED_2026: '2026 agency churned',
  AT_RISK_NEXT_MONTH: 'At risk next month',
  AT_RISK_NEXT_QUARTER: 'At risk next quarter',
  CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT: 'Close to eligible, low engagement',
  CLOSE_TO_ADOPTING: 'Close to adopting',
};

type LineSizeOption = 'Major' | 'T1200' | 'Direct' | 'Unknown';
type SortField = 'primary_reason' | 'agency_name' | 'agency_id' | 'line_size_display' | 'officer_count' | 'vr_licenses' | 'eligibility_cohort' | 'last_adopting_month' | 'month_churned' | 'completions_needed_this_month' | 'R6' | 'R12' | 'not_adopting_streak';

export default function ActionsPage() {
  const [data, setData] = useState<StoredData | null>(null);
  const [actionResult, setActionResult] = useState<ReturnType<typeof buildActionList> | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [lineSizeSelected, setLineSizeSelected] = useState<Set<LineSizeOption>>(new Set());
  const [sortField, setSortField] = useState<SortField>('officer_count');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const monthKey = getCurrentMonth();
    const stored = getProcessedData(monthKey ?? undefined);
    if (!stored) {
      setData(null);
      setActionResult(null);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      const agencies = parsed.agencies?.map((a: any) => ({
        ...a,
        purchase_date: a.purchase_date ? new Date(a.purchase_date) : undefined,
        as_of_month: a.as_of_month ? new Date(a.as_of_month) : null,
      })) ?? [];
      const agencyLabels = Array.isArray(parsed.agencyLabels) ? parsed.agencyLabels : [];
      const simTelemetry = parsed.simTelemetry?.map((t: any) => ({ ...t, month: new Date(t.month) })) ?? [];
      setData({
        agencies,
        agencyLabels,
        simTelemetry,
        asOfMonth: parsed.asOfMonth ?? null,
      });
    } catch {
      setData(null);
      setActionResult(null);
    }
  }, []);

  useEffect(() => {
    if (!data?.agencies?.length || !data.agencyLabels?.length) {
      setActionResult(null);
      return;
    }
    const labelsMap = new Map(data.agencyLabels as [string, any][]);
    const historyData = getHistoricalData();
    let baselineProcessed: { agencies: any[]; agencyLabels: [string, any][] } | null = null;
    try {
      const baselineRaw = getProcessedData(ACTION_LIST_CONFIG.baselineMonth);
      if (baselineRaw) {
        const baseParsed = JSON.parse(baselineRaw);
        baselineProcessed = {
          agencies: baseParsed.agencies ?? [],
          agencyLabels: Array.isArray(baseParsed.agencyLabels) ? baseParsed.agencyLabels : [],
        };
      }
    } catch {
      /* ignore */
    }
    const result = buildActionList(
      {
        agencies: data.agencies,
        agencyLabels: labelsMap,
        simTelemetry: data.simTelemetry ?? [],
        asOfMonth: data.asOfMonth,
      },
      historyData,
      ACTION_LIST_CONFIG,
      baselineProcessed
    );
    setActionResult(result);
  }, [data]);

  const filteredAndSortedRows = useMemo(() => {
    if (!actionResult?.rows) return [];
    let rows = [...actionResult.rows];
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.agency_name.toLowerCase().includes(q) || r.agency_id.toLowerCase().includes(q)
      );
    }
    if (lineSizeSelected.size > 0) {
      rows = rows.filter((r) => lineSizeSelected.has(r.line_size_display as LineSizeOption));
    }
    rows.sort((a, b) => {
      if (sortField === 'primary_reason') {
        const pa = REASON_PRIORITY[a.primary_reason];
        const pb = REASON_PRIORITY[b.primary_reason];
        if (pa !== pb) return sortDirection === 'asc' ? pa - pb : pb - pa;
        const oa = a.officer_count ?? 0;
        const ob = b.officer_count ?? 0;
        return sortDirection === 'asc' ? oa - ob : ob - oa;
      }
      let va: number | string;
      let vb: number | string;
      switch (sortField) {
        case 'agency_name':
          va = a.agency_name ?? '';
          vb = b.agency_name ?? '';
          break;
        case 'agency_id':
          va = a.agency_id ?? '';
          vb = b.agency_id ?? '';
          break;
        case 'line_size_display':
          va = a.line_size_display ?? '';
          vb = b.line_size_display ?? '';
          break;
        case 'officer_count':
          va = a.officer_count ?? -1;
          vb = b.officer_count ?? -1;
          break;
        case 'vr_licenses':
          va = a.vr_licenses ?? -1;
          vb = b.vr_licenses ?? -1;
          break;
        case 'eligibility_cohort':
          va = a.eligibility_cohort ?? -1;
          vb = b.eligibility_cohort ?? -1;
          break;
        case 'last_adopting_month':
          va = a.last_adopting_month ?? '';
          vb = b.last_adopting_month ?? '';
          break;
        case 'month_churned':
          va = a.month_churned ?? '';
          vb = b.month_churned ?? '';
          break;
        case 'completions_needed_this_month':
          va = a.completions_needed_this_month ?? -1;
          vb = b.completions_needed_this_month ?? -1;
          break;
        case 'R6':
          va = a.R6 ?? -1;
          vb = b.R6 ?? -1;
          break;
        case 'R12':
          va = a.R12 ?? -1;
          vb = b.R12 ?? -1;
          break;
        case 'not_adopting_streak':
          va = a.not_adopting_streak;
          vb = b.not_adopting_streak;
          break;
        default:
          return 0;
      }
      if (va < vb) return sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [actionResult?.rows, searchTerm, lineSizeSelected, sortField, sortDirection]);

  const churnRows = useMemo(() => filteredAndSortedRows.filter((r) => r.reason_category === 'Churn'), [filteredAndSortedRows]);
  const closeRows = useMemo(() => filteredAndSortedRows.filter((r) => r.reason_category === 'Close'), [filteredAndSortedRows]);
  const atRiskRows = useMemo(() => churnRows.filter((r) => r.churn_display_group === 'AT_RISK'), [churnRows]);
  const baselineChurnedRows = useMemo(() => churnRows.filter((r) => r.churn_display_group === 'BASELINE_CHURNED'), [churnRows]);
  const churnThisMonthRows = useMemo(() => churnRows.filter((r) => r.churn_display_group === 'CHURN_THIS_MONTH'), [churnRows]);

  const churnPoints = useMemo(() => churnRows.reduce((sum, r) => sum + (r.officer_count ?? 0), 0), [churnRows]);
  const closePoints = useMemo(() => closeRows.reduce((sum, r) => sum + (r.officer_count ?? 0), 0), [closeRows]);
  const atRiskPoints = useMemo(() => atRiskRows.reduce((sum, r) => sum + (r.officer_count ?? 0), 0), [atRiskRows]);
  const baselineChurnedPoints = useMemo(() => baselineChurnedRows.reduce((sum, r) => sum + (r.officer_count ?? 0), 0), [baselineChurnedRows]);
  const churnThisMonthPoints = useMemo(() => churnThisMonthRows.reduce((sum, r) => sum + (r.officer_count ?? 0), 0), [churnThisMonthRows]);

  const toggleLineSize = (opt: LineSizeOption) => {
    setLineSizeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  };

  const handleExportCSV = () => {
    const headers = [
      '#',
      'Category',
      'Churn display group',
      'Agency Name',
      'Agency ID',
      'Line Size',
      'Officer Count',
      'VR Licenses',
      'Eligibility Cohort',
      'Current Status',
      'Primary Reason',
      'Secondary Reasons',
      'Last adopting month',
      'Month churned',
      'Completions Needed This Month',
      `${t6Label} Completions PP`,
      `${t12Label} Completions PP`,
      'Adopting in 2025 baseline',
      'Why Bullets',
    ];
    const rows = filteredAndSortedRows.map((r, i) => [
      i + 1,
      r.reason_category,
      r.churn_display_group ?? '',
      r.agency_name,
      r.agency_id,
      r.line_size_display,
      r.officer_count ?? '',
      r.vr_licenses ?? '',
      r.eligibility_cohort ?? '',
      r.current_status,
      r.primary_reason,
      r.secondary_reasons.join('; '),
      r.last_adopting_month ?? '',
      r.month_churned ?? '',
      r.completions_needed_this_month ?? '',
      r.R6 ?? '',
      r.R12 ?? '',
      r.baseline_adopting === true ? 'Y' : '',
      r.why_bullets.join(' | '),
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'action-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSort = (field: SortField) => {
    setSortField(field);
    setSortDirection((prev) => (sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
  };

  const asOfMonthKey = data?.asOfMonth ?? null;
  const t6Label = 'T6';
  const t12Label = 'T12';
  const t6Tooltip = asOfMonthKey ? getT6Tooltip(asOfMonthKey) : 'Trailing 6 months (inclusive)';
  const t12Tooltip = asOfMonthKey ? getT12Tooltip(asOfMonthKey) : 'Trailing 12 months (inclusive)';

  const getSortIcon = (field: string) =>
    sortField === field ? (sortDirection === 'asc' ? <ArrowUp size={12} style={{ verticalAlign: 'middle', marginLeft: '2px' }} /> : <ArrowDown size={12} style={{ verticalAlign: 'middle', marginLeft: '2px' }} />) : null;

  const getLineSizeColor = (lineSize: string): string => {
    if (lineSize === 'Direct') return 'var(--fg-action)';
    if (lineSize === 'T1200') return 'var(--fg-live)';
    if (lineSize === 'Major') return 'var(--fg-success)';
    if (lineSize === 'Unknown') return 'var(--fg-secondary)';
    return 'var(--fg-secondary)';
  };

  const churnColumns: DataTableColumn<ActionListRow>[] = [
    { id: 'agency_name', label: 'Name', sortKey: 'agency_name', render: (r) => <span style={{ fontWeight: 'var(--text-subtitle-weight)' }}>{r.agency_name}</span> },
    { id: 'agency_id', label: 'ID', sortKey: 'agency_id', render: (r) => <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{r.agency_id}</span> },
    { id: 'line_size_display', label: 'Line size', sortKey: 'line_size_display', render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.5rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 'var(--text-caption-size)', color: getLineSizeColor(r.line_size_display), fontWeight: 'var(--text-subtitle-weight)' }}>{r.line_size_display}</span>
    )},
    { id: 'officer_count', label: 'Officer count', sortKey: 'officer_count', align: 'right', render: (r) => formatNumber(r.officer_count) },
    { id: 'vr_licenses', label: 'VR licenses', sortKey: 'vr_licenses', align: 'right', render: (r) => formatNumber(r.vr_licenses) },
    { id: 'eligibility_cohort', label: 'Eligibility cohort', sortKey: 'eligibility_cohort', render: (r) => r.eligibility_cohort != null ? String(r.eligibility_cohort) : '—' },
    { id: 'last_adopting_month', label: 'Last adopting month', sortKey: 'last_adopting_month', render: (r) => formatMonthLabel(r.last_adopting_month) },
    { id: 'month_churned', label: 'Month churned', sortKey: 'month_churned', render: (r) => formatMonthLabel(r.month_churned) },
    { id: 'completions_needed_this_month', label: 'Completions Needed This Month', sortKey: 'completions_needed_this_month', align: 'right', render: (r) => formatNumber(r.completions_needed_this_month) },
    { id: 'R6', label: <TooltipHeader label="T6 Completions PP" tooltip={t6Tooltip} />, sortKey: 'R6', align: 'right', render: (r) => formatDecimal(r.R6) },
    { id: 'R12', label: <TooltipHeader label="T12 Completions PP" tooltip={t12Tooltip} />, sortKey: 'R12', align: 'right', render: (r) => formatDecimal(r.R12) },
  ];

  const closeColumns: DataTableColumn<ActionListRow>[] = [
    { id: 'agency_name', label: 'Name', sortKey: 'agency_name', render: (r) => <span style={{ fontWeight: 'var(--text-subtitle-weight)' }}>{r.agency_name}</span> },
    { id: 'agency_id', label: 'ID', sortKey: 'agency_id', render: (r) => <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{r.agency_id}</span> },
    { id: 'line_size_display', label: 'Line size', sortKey: 'line_size_display', render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.5rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 'var(--text-caption-size)', color: getLineSizeColor(r.line_size_display), fontWeight: 'var(--text-subtitle-weight)' }}>{r.line_size_display}</span>
    )},
    { id: 'officer_count', label: 'Officer count', sortKey: 'officer_count', align: 'right', render: (r) => formatNumber(r.officer_count) },
    { id: 'vr_licenses', label: 'VR licenses', sortKey: 'vr_licenses', align: 'right', render: (r) => formatNumber(r.vr_licenses) },
    { id: 'eligibility_cohort', label: 'Eligibility cohort', sortKey: 'eligibility_cohort', render: (r) => r.eligibility_cohort != null ? String(r.eligibility_cohort) : '—' },
    { id: 'completions_needed_this_month', label: 'Completions Needed This Month', sortKey: 'completions_needed_this_month', align: 'right', render: (r) => formatNumber(r.completions_needed_this_month) },
    { id: 'R6', label: <TooltipHeader label="T6 Completions PP" tooltip={t6Tooltip} />, sortKey: 'R6', align: 'right', render: (r) => formatDecimal(r.R6) },
    { id: 'R12', label: <TooltipHeader label="T12 Completions PP" tooltip={t12Tooltip} />, sortKey: 'R12', align: 'right', render: (r) => formatDecimal(r.R12) },
  ];

  const expandableChurnRow = (row: ActionListRow) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Why flagged</h3>
        <ul style={{ marginLeft: '1.5rem', color: 'var(--fg-primary)' }}>
          {row.why_bullets.map((b, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{b}</li>)}
        </ul>
      </div>
      {row.label.metrics && (
        <div>
          <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Key metrics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
            <div><strong>{t6Label} Completions:</strong> {formatNumber(row.label.metrics.C6)}</div>
            <div><strong>{t12Label} Completions:</strong> {formatNumber(row.label.metrics.C12)}</div>
            <div><strong>{t6Label} Completions PP:</strong> {formatDecimal(row.label.metrics.R6)}</div>
            <div><strong>{t12Label} Completions PP:</strong> {formatDecimal(row.label.metrics.R12)}</div>
            <div><strong>Licenses:</strong> {formatNumber(row.label.metrics.L)}</div>
          </div>
        </div>
      )}
    </div>
  );

  const expandableCloseRow = (row: ActionListRow) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Why flagged</h3>
        <ul style={{ marginLeft: '1.5rem', color: 'var(--fg-primary)' }}>
          {row.why_bullets.map((b, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{b}</li>)}
        </ul>
      </div>
      {row.label.metrics && (
        <div>
          <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Key metrics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
            <div><strong>{t6Label} Completions:</strong> {formatNumber(row.label.metrics.C6)}</div>
            <div><strong>{t12Label} Completions:</strong> {formatNumber(row.label.metrics.C12)}</div>
            <div><strong>{t6Label} Completions PP:</strong> {formatDecimal(row.label.metrics.R6)}</div>
            <div><strong>{t12Label} Completions PP:</strong> {formatDecimal(row.label.metrics.R12)}</div>
            <div><strong>Licenses:</strong> {formatNumber(row.label.metrics.L)}</div>
            {row.completions_needed_this_month != null && (
              <div><strong>Completions Needed This Month:</strong> {formatNumber(row.completions_needed_this_month)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (!data) {
    return (
      <div style={{ padding: '3rem 2rem', maxWidth: '1200px', margin: '0 auto', minHeight: 'calc(100vh - 80px)', background: 'var(--surface-1)' }}>
        <div style={{ background: 'var(--surface-3)', padding: '3rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-headline-size)', fontWeight: 'var(--text-headline-weight)', marginBottom: '1rem', color: 'var(--fg-primary)' }}>Action List</h1>
          <p style={{ color: 'var(--fg-secondary)', marginBottom: '2rem', fontSize: 'var(--text-body1-size)' }}>No data available. Please upload your files to get started.</p>
          <Link href="/upload" style={{ padding: '1rem 2rem', background: 'var(--bg-action)', color: 'white', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-button-size)', fontWeight: 'var(--text-button-weight)', letterSpacing: 'var(--text-button-letter)', textTransform: 'uppercase', display: 'inline-block', textDecoration: 'none' }}>→ Go to Upload Page</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', background: 'var(--surface-1)', minHeight: 'calc(100vh - 80px)' }}>
      <div style={{ background: 'var(--surface-3)', padding: '2rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)', padding: '0.75rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ListChecks size={24} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 'var(--text-headline-size)', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)', marginBottom: '0.25rem' }}>Action List</h1>
              <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>Prioritized agencies with clear reasons and recommended actions</p>
            </div>
          </div>
          <button type="button" onClick={handleExportCSV} style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-action)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-button-size)', fontWeight: 'var(--text-button-weight)', letterSpacing: 'var(--text-button-letter)', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Download size={16} /> Export CSV
          </button>
        </div>

        {actionResult && !actionResult.baseline_available && (
          <div style={{ padding: '1rem', marginBottom: '1rem', background: 'var(--bg-alert)', color: 'var(--fg-primary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertCircle size={20} />
            <span>Upload baseline month (2025-11) to unlock baseline churn tracking.</span>
          </div>
        )}

        <FilterBar
          searchValue={searchTerm}
          onSearchChange={(v) => setSearchTerm(v)}
          searchPlaceholder="Search agency name or ID..."
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>Line size:</span>
            {(['Major', 'T1200', 'Direct', 'Unknown'] as LineSizeOption[]).map((opt) => (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--text-body2-size)', cursor: 'pointer' }}>
                <input type="checkbox" checked={lineSizeSelected.has(opt)} onChange={() => toggleLineSize(opt)} />
                {opt}
              </label>
            ))}
          </div>
        </FilterBar>

        {atRiskRows.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.75rem', color: 'var(--fg-destructive)' }}>At Risk ({atRiskRows.length} agencies, {atRiskPoints.toLocaleString()} points)</h2>
            <DataTable<ActionListRow>
              columns={churnColumns}
              rows={atRiskRows}
              getRowKey={(r) => r.agency_id}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              getSortIcon={getSortIcon}
              rowStyle={() => ({ borderLeft: '3px solid var(--fg-destructive)' })}
              expandableRow={expandableChurnRow}
              showIndex
              startIndex={0}
            />
          </div>
        )}
        {baselineChurnedRows.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.75rem', color: 'var(--fg-destructive)' }}>2025 Agencies Churned ({baselineChurnedRows.length} agencies, {baselineChurnedPoints.toLocaleString()} points)</h2>
            <DataTable<ActionListRow>
              columns={churnColumns}
              rows={baselineChurnedRows}
              getRowKey={(r) => r.agency_id}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              getSortIcon={getSortIcon}
              rowStyle={() => ({ borderLeft: '3px solid var(--fg-destructive)' })}
              expandableRow={expandableChurnRow}
              showIndex
              startIndex={atRiskRows.length}
            />
          </div>
        )}
        {churnThisMonthRows.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.75rem', color: 'var(--fg-destructive)' }}>2026 Agencies Churned ({churnThisMonthRows.length} agencies, {churnThisMonthPoints.toLocaleString()} points)</h2>
            <DataTable<ActionListRow>
              columns={churnColumns}
              rows={churnThisMonthRows}
              getRowKey={(r) => r.agency_id}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              getSortIcon={getSortIcon}
              rowStyle={() => ({ borderLeft: '3px solid var(--fg-destructive)' })}
              expandableRow={expandableChurnRow}
              showIndex
              startIndex={atRiskRows.length + baselineChurnedRows.length}
            />
          </div>
        )}
        {closeRows.length > 0 && (
          <div>
            <h2 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.75rem', color: 'var(--fg-success)' }}>Close to Adopting ({closeRows.length} agencies, {closePoints.toLocaleString()} points)</h2>
            <DataTable<ActionListRow>
              columns={closeColumns}
              rows={closeRows}
              getRowKey={(r) => r.agency_id}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              getSortIcon={getSortIcon}
              rowStyle={() => ({ borderLeft: '3px solid var(--fg-success)' })}
              expandableRow={expandableCloseRow}
              showIndex
              startIndex={churnRows.length}
            />
          </div>
        )}

        {filteredAndSortedRows.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-secondary)' }}>No agencies match the current filters.</div>
        )}

        {actionResult && (actionResult.data_quality.excluded_unknown_line_size > 0 || actionResult.data_quality.excluded_missing_licenses > 0 || actionResult.data_quality.excluded_missing_eligibility > 0) && (
          <div style={{ marginTop: '1rem', fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>
            Data quality: {actionResult.data_quality.excluded_unknown_line_size} excluded (unknown line size); {actionResult.data_quality.excluded_missing_licenses} excluded (missing licenses); {actionResult.data_quality.excluded_missing_eligibility} excluded (missing eligibility).
          </div>
        )}
      </div>
    </div>
  );
}
