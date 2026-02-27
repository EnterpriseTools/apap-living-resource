'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { AgencyWithLabel, Agency } from '@/lib/schema';
import type { SimTelemetryMonthly } from '@/lib/schema';
import Link from 'next/link';
import { Clock, Download, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
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

type SortField = 'agency_name' | 'agency_id' | 'agency_size_band' | 'purchase_cohort' | 'months_since_purchase' | 'officer_count' | 'vr_licenses' | 'r6' | 'r12' | 'c6' | 'c12';
type SortDirection = 'asc' | 'desc' | null;

export default function NearEligiblePage() {
  const [data, setData] = useState<StoredData | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('officer_count');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    // Load data for the viewing month (latest stored data for that month)
    const monthKey = getCurrentMonth();
    const stored = getProcessedData(monthKey ?? undefined);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Convert agencyLabels array back to Map
        const labelsMap = new Map(parsed.agencyLabels);
        // Convert simTelemetry dates back to Date objects
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

  // All hooks must run before any conditional return (Rules of Hooks)
  const nearEligibleWithLabels = useMemo(() => {
    if (!data) return [];
    const labelsMap = new Map(data.agencyLabels);
    return data.nearEligible
      .filter((agency) => agency.cew_type === 'T10')
      .map((agency) => labelsMap.get(agency.agency_id))
      .filter((item): item is AgencyWithLabel => item !== undefined);
  }, [data]);

  const filtered = useMemo(() => {
    let list = nearEligibleWithLabels;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.agency_name.toLowerCase().includes(q) ||
          item.agency_id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [nearEligibleWithLabels, searchTerm]);

  const sorted = useMemo(() => {
    if (sortDirection === null) return [...filtered];
    return [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortField) {
        case 'agency_name':
          aVal = a.agency_name.toLowerCase();
          bVal = b.agency_name.toLowerCase();
          break;
        case 'agency_id':
          aVal = a.agency_id.toLowerCase();
          bVal = b.agency_id.toLowerCase();
          break;
        case 'agency_size_band':
          aVal = a.cohorts.agency_size_band;
          bVal = b.cohorts.agency_size_band;
          break;
        case 'purchase_cohort':
          aVal = a.cohorts.purchase_cohort ?? '';
          bVal = b.cohorts.purchase_cohort ?? '';
          break;
        case 'months_since_purchase': {
          const agencyA = data?.nearEligible.find(ag => ag.agency_id === a.agency_id);
          const agencyB = data?.nearEligible.find(ag => ag.agency_id === b.agency_id);
          aVal = agencyA?.months_since_purchase ?? -1;
          bVal = agencyB?.months_since_purchase ?? -1;
          break;
        }
        case 'r6':
          aVal = a.metrics?.R6 ?? -1;
          bVal = b.metrics?.R6 ?? -1;
          break;
        case 'r12':
          aVal = a.metrics?.R12 ?? -1;
          bVal = b.metrics?.R12 ?? -1;
          break;
        case 'c6':
          aVal = a.metrics?.C6 ?? -1;
          bVal = b.metrics?.C6 ?? -1;
          break;
        case 'c12':
          aVal = a.metrics?.C12 ?? -1;
          bVal = b.metrics?.C12 ?? -1;
          break;
        case 'officer_count': {
          const agencyA = data?.nearEligible.find(ag => ag.agency_id === a.agency_id);
          const agencyB = data?.nearEligible.find(ag => ag.agency_id === b.agency_id);
          aVal = agencyA?.officer_count ?? -1;
          bVal = agencyB?.officer_count ?? -1;
          break;
        }
        case 'vr_licenses':
          aVal = a.metrics?.L ?? -1;
          bVal = b.metrics?.L ?? -1;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDirection, data?.nearEligible]);

  if (!data) {
    return (
      <div style={{
        padding: '3rem 2rem',
        maxWidth: '1200px',
        margin: '0 auto',
        minHeight: 'calc(100vh - 80px)',
        background: 'var(--surface-1)',
      }}>
        <div style={{
          background: 'var(--surface-3)',
          padding: '3rem',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          border: `1px solid var(--border-color)`,
          textAlign: 'center',
        }}>
          <h1 style={{
            fontSize: 'var(--text-headline-size)',
            lineHeight: 'var(--text-headline-line)',
            fontWeight: 'var(--text-headline-weight)',
            marginBottom: '1rem',
            color: 'var(--fg-primary)',
          }}>
            Near Eligible
          </h1>
          <p style={{
            color: 'var(--fg-secondary)',
            marginBottom: '2rem',
            fontSize: 'var(--text-body1-size)',
          }}>
            No data available. Please upload your files to get started.
          </p>
          <Link
            href="/upload"
            className="btn-primary"
            style={{
              padding: '1rem 2rem',
              background: 'var(--bg-action)',
              color: 'white',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-button-size)',
              fontWeight: 'var(--text-button-weight)',
              letterSpacing: 'var(--text-button-letter)',
              textTransform: 'uppercase',
              display: 'inline-block',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            → Go to Upload Page
          </Link>
        </div>
      </div>
    );
  }

  const labelsMap = new Map(data.agencyLabels);

  // Calculate completions needed to meet T6/T12 thresholds
  const getCompletionsNeeded = (item: AgencyWithLabel): { t6: number | null; t12: number | null } => {
    if (!item.metrics) return { t6: null, t12: null };
    
    // If no simTelemetry available, calculate based on current metrics only
    if (!data?.simTelemetry || data.simTelemetry.length === 0) {
      if (isAdoptingFromMetrics(item.metrics)) {
        return { t6: 0, t12: 0 };
      }
      const t6Needed = item.metrics.R6 != null && item.metrics.R6 >= ADOPTION_R6_THRESHOLD ? 0 : Math.max(0, Math.ceil(ADOPTION_R6_THRESHOLD * item.metrics.L - item.metrics.C6));
      const t12Needed = item.metrics.R12 != null && item.metrics.R12 >= ADOPTION_R12_THRESHOLD ? 0 : Math.max(0, Math.ceil(ADOPTION_R12_THRESHOLD * item.metrics.L - item.metrics.C12));
      return { t6: t6Needed, t12: t12Needed };
    }
    
    try {
      const needed = calculateCompletionsNeeded(item.agency_id, item.metrics, data.simTelemetry);
      return { t6: needed.t6, t12: needed.t12 };
    } catch (error) {
      console.error('Error calculating completions needed:', error);
      if (isAdoptingFromMetrics(item.metrics)) {
        return { t6: 0, t12: 0 };
      }
      const t6Needed = Math.max(0, Math.ceil(ADOPTION_R6_THRESHOLD * item.metrics.L - item.metrics.C6));
      const t12Needed = Math.max(0, Math.ceil(ADOPTION_R12_THRESHOLD * item.metrics.L - item.metrics.C12));
      return { t6: t6Needed, t12: t12Needed };
    }
  };

  // Get total completions for an agency (all available data)
  const getTotalCompletions = (item: AgencyWithLabel): number => {
    if (!item.metrics) return 0;
    // Use C12 as it represents all completions in the available 12-month window
    // This is the best approximation of "all available data"
    return item.metrics.C12;
  };

  // Handle column sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field || sortDirection === null) {
      return <ArrowUpDown size={14} style={{ opacity: 0.3 }} />;
    }
    return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  };

  const t6Label = 'T6';
  const t12Label = 'T12';
  const asOfMonthKey = data.asOfMonth ?? '';
  const earlyUsageTooltip = asOfMonthKey ? `${getT6Tooltip(asOfMonthKey)} ${getT12Tooltip(asOfMonthKey)}` : 'Trailing 6/12 months (inclusive)';

  const columns: DataTableColumn<AgencyWithLabel>[] = [
    { id: 'agency_name', label: 'Agency Name', sortKey: 'agency_name', render: (item) => <span style={{ fontWeight: 'var(--text-subtitle-weight)' }}>{item.agency_name}</span> },
    { id: 'agency_id', label: 'Agency ID', sortKey: 'agency_id', render: (item) => <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{item.agency_id}</span> },
    { id: 'agency_size_band', label: 'Line Size', sortKey: 'agency_size_band', render: (item) => item.cohorts.agency_size_band ?? '—' },
    { id: 'officer_count', label: 'Agency Size', sortKey: 'officer_count', render: (item) => formatNumber(data.nearEligible.find(a => a.agency_id === item.agency_id)?.officer_count) },
    { id: 'vr_licenses', label: 'VR Licenses', sortKey: 'vr_licenses', render: (item) => formatNumber(item.metrics?.L) },
    { id: 'purchase_cohort', label: 'Purchase Cohort', sortKey: 'purchase_cohort', render: (item) => {
      const agency = data.nearEligible.find(a => a.agency_id === item.agency_id);
      return (
        <>
          {item.cohorts.purchase_cohort ?? '—'}
          {agency != null && (
            <div style={{ fontSize: 'var(--text-label-size)', color: 'var(--fg-secondary)', marginTop: '0.25rem' }}>
              {agency.months_since_purchase} months since purchase
            </div>
          )}
        </>
      );
    }},
    { id: 'cohorts', label: 'Cohorts', render: () => '—' },
    { id: 'early_usage', label: <TooltipHeader label="Early Usage Signals" tooltip={earlyUsageTooltip} />, sortKey: 'c6', headerTooltip: earlyUsageTooltip, render: (item) => {
      if (!item.metrics) return <span style={{ color: 'var(--fg-disabled)' }}>No usage data yet</span>;
      const needed = getCompletionsNeeded(item);
      const isAdopting = isAdoptingFromMetrics(item.metrics);
      return (
        <>
          <div><strong># Completions:</strong> {formatNumber(getTotalCompletions(item))}</div>
          {needed.t6 != null && needed.t6 > 0 && (
            <div style={{ marginTop: '0.5rem', color: 'var(--fg-alert)' }}><strong>{t6Label}:</strong> {formatNumber(needed.t6)} completions needed</div>
          )}
          {needed.t12 != null && needed.t12 > 0 && (
            <div style={{ marginTop: (needed.t6 != null && needed.t6 > 0) ? '0.25rem' : '0.5rem', color: 'var(--fg-alert)' }}><strong>{t12Label}:</strong> {formatNumber(needed.t12)} completions needed</div>
          )}
          {isAdopting && needed.t6 === 0 && needed.t12 === 0 && (
            <div style={{ marginTop: '0.5rem', color: 'var(--fg-success)' }}>Meeting both {t6Label} and {t12Label} thresholds</div>
          )}
        </>
      );
    }},
    { id: 'action', label: 'Action', render: (item) => item.recommended_action },
  ];

  const expandableRow = (item: AgencyWithLabel) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Why Near Eligible</h3>
        <ul style={{ marginLeft: '1.5rem', color: 'var(--fg-primary)' }}>
          {(() => {
            const agency = data.nearEligible.find(a => a.agency_id === item.agency_id);
            return agency ? (
              <li style={{ marginBottom: '0.25rem' }}>
                {agency.months_since_purchase === 4
                  ? 'Will become eligible in approximately 1 month (currently 4 months since purchase)'
                  : 'Will become eligible in approximately 2 months (currently 5 months since purchase)'}
              </li>
            ) : null;
          })()}
          {item.metrics?.last3Months?.some(v => v > 0) && (
            <li style={{ marginBottom: '0.25rem' }}>
              Early usage signals detected: {item.metrics.last3Months.filter(v => v > 0).length} of last 3 months have completions
            </li>
          )}
          <li style={{ marginBottom: '0.25rem' }}>Recommended: Early engagement and onboarding support to prepare for eligibility assessment</li>
        </ul>
      </div>
      {item.metrics && (
        <div>
          <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>Key Metrics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
            <div><strong>{t6Label} Completions:</strong> {formatNumber(item.metrics.C6)}</div>
            <div><strong>{t12Label} Completions:</strong> {formatNumber(item.metrics.C12)}</div>
            <div><strong>{t6Label} Completions PP:</strong> {formatDecimal(item.metrics.R6)}</div>
            <div><strong>{t12Label} Completions PP:</strong> {formatDecimal(item.metrics.R12)}</div>
            <div><strong>Licenses:</strong> {formatNumber(item.metrics.L)}</div>
            <div><strong>Last 3 months:</strong> {item.metrics.last3Months?.map((v) => formatNumber(v)).join(', ') ?? '—'}</div>
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

  const handleExportCSV = () => {
    const headers = [
      'Agency ID',
      'Agency Name',
      'Line Size',
      'Agency Size',
      'VR Licenses',
      'Purchase Cohort',
      'Months Since Purchase',
      '# Completions',
      `${t6Label} Completions Needed`,
      `${t12Label} Completions Needed`,
    ];

    const rows = sorted.map((item) => {
      const needed = getCompletionsNeeded(item);
      const totalCompletions = getTotalCompletions(item);
      const agency = data.nearEligible.find(a => a.agency_id === item.agency_id);
      return [
        item.agency_id,
        item.agency_name,
        item.cohorts.agency_size_band ?? '',
        agency?.officer_count != null ? agency.officer_count.toLocaleString() : '',
        item.metrics?.L != null ? item.metrics.L.toLocaleString() : '',
        item.cohorts.purchase_cohort ?? '',
        agency?.months_since_purchase ?? '',
        totalCompletions.toFixed(0),
        needed.t6 != null && needed.t6 > 0 ? needed.t6.toFixed(0) : 'Met',
        needed.t12 != null && needed.t12 > 0 ? needed.t12.toFixed(0) : 'Met',
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'near-eligible.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      padding: '2rem',
      maxWidth: '1400px',
      margin: '0 auto',
      background: 'var(--surface-1)',
      minHeight: 'calc(100vh - 80px)',
    }}>
      <div style={{
        background: 'var(--surface-3)',
        padding: '2rem',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        border: `1px solid var(--border-color)`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--bg-alert) 0%, #E67E22 100%)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Clock size={24} color="white" />
            </div>
            <div>
              <h1 style={{
                fontSize: 'var(--text-headline-size)',
                lineHeight: 'var(--text-headline-line)',
                fontWeight: 'var(--text-headline-weight)',
                color: 'var(--fg-primary)',
                marginBottom: '0.25rem',
              }}>
                Near Eligible
              </h1>
              <p style={{
                fontSize: 'var(--text-body2-size)',
                color: 'var(--fg-secondary)',
              }}>
                Agencies that will become eligible for adoption assessment in 1–2 months ({nearEligibleWithLabels.length} agencies)
              </p>
            </div>
          </div>
          <button
            onClick={handleExportCSV}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, var(--bg-action) 0%, #0066CC 100%)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-button-size)',
              fontWeight: 'var(--text-button-weight)',
              letterSpacing: 'var(--text-button-letter)',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 12px rgba(4, 93, 210, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(4, 93, 210, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(4, 93, 210, 0.3)';
            }}
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>

        {/* Info Banner */}
        <div style={{
          marginBottom: '2rem',
          padding: '1rem 1.5rem',
          background: 'var(--bg-alert)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--fg-primary)',
          border: `1px solid var(--fg-alert)`,
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          <AlertCircle size={20} color="var(--fg-alert)" />
          <p style={{ fontSize: 'var(--text-body1-size)', margin: 0 }}>
            These agencies are currently ineligible (0–5 months since purchase) but will become eligible for adoption assessment in the next 1–2 months. Early engagement and onboarding support is recommended.
          </p>
        </div>

        <FilterBar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Search agency name or ID..."
        />

        <DataTable<AgencyWithLabel>
          columns={columns}
          rows={sorted}
          getRowKey={(item) => item.agency_id}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={(field) => handleSort(field as SortField)}
          getSortIcon={getSortIcon}
          expandableRow={expandableRow}
          emptyMessage={searchTerm ? 'No agencies match your search.' : 'No near eligible agencies found.'}
        />
      </div>
    </div>
  );
}

