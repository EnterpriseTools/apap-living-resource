'use client';

import { useState, useMemo } from 'react';
import { parseAgenciesFile, parseTelemetryFile, normalizeTelemetry } from '@/lib/ingest';
import { processData } from '@/lib/pipeline';
import { setProcessedData, setProcessedDataForMonth, getProcessedData } from '@/lib/storage';
import { SNAPSHOT_SCHEMA_VERSION, COMPUTE_VERSION } from '@/config/snapshotVersion';
import { getLookbackRangeLabel } from '@/lib/lookbackTooltips';
import { computeSimT10Usage } from '@/lib/usageRollups';
import type { AgencyRow, TelemetryMonthly } from '@/lib/schema';
import Link from 'next/link';
import { format, parseISO, subMonths } from 'date-fns';
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, ArrowRight, Database } from 'lucide-react';

/** Build month options: Auto + last 24 months (YYYY-MM) for "data is for month" selector */
function buildMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [{ value: 'auto', label: 'Auto (from telemetry)' }];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = subMonths(now, i);
    const yyyyMM = format(d, 'yyyy-MM');
    const label = format(d, 'MMM yyyy');
    options.push({ value: yyyyMM, label });
  }
  return options;
}

export default function UploadPage() {
  const [agenciesFile, setAgenciesFile] = useState<File | null>(null);
  const [telemetryFiles, setTelemetryFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadMode, setLoadMode] = useState<'upload' | 'snowflake' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<{ file: string; error: string }[]>([]);
  const [results, setResults] = useState<ReturnType<typeof processData> | null>(null);
  /** Which month this upload is saved as (auto = use detected month from data). Re-uploading same month overwrites. */
  const [dataForMonth, setDataForMonth] = useState<string>('auto');
  /** Set when we overwrote an existing snapshot for that month (show "Replaced existing snapshot for MMM YYYY"). */
  const [replacedMonthLabel, setReplacedMonthLabel] = useState<string | null>(null);

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  const handleAgenciesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAgenciesFile(file);
      setError(null);
    }
  };

  const handleTelemetryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setTelemetryFiles(files);
      setError(null);
    }
  };

  const handleLoadFromSnowflake = async () => {
    setLoading(true);
    setLoadMode('snowflake');
    setError(null);
    setParseErrors([]);

    try {
      const callSnowflakeProcess = async (monthKey: string) => {
        const resp = await fetch('/api/snowflake/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthKey }),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error || 'Failed to load data from Snowflake');
        return json;
      };

      const json = await callSnowflakeProcess(dataForMonth);
      const monthKey: string = json.monthKey;
      const snapshot = json.snapshot;

      const existingRaw = getProcessedData(monthKey);
      setReplacedMonthLabel(existingRaw ? format(parseISO(monthKey + '-01'), 'MMM yyyy') : null);

      setProcessedData(snapshot, monthKey);

      // Save historical data for trend analysis (mirrors upload flow, but keeps storage compact)
      try {
        const { saveHistoricalData } = await import('@/lib/history');
        const asOfMonthISO = snapshot?.asOfMonth as string | null;
        const asOfMonth = asOfMonthISO ? new Date(asOfMonthISO) : null;
        const agencyLabelsArr = Array.isArray(snapshot?.agencyLabels) ? snapshot.agencyLabels : [];
        const labelsMap = new Map(agencyLabelsArr as any);

        if (asOfMonth) {
          saveHistoricalData(
            asOfMonth,
            [],
            snapshot?.cohortSummaries ?? {},
            snapshot?.usageRollups,
            labelsMap,
            json?.apap?.apap ?? undefined,
            json?.simT10?.t12Total ?? undefined,
            json?.simT10?.usageByMonth ?? undefined,
            json?.apap
              ? {
                  eligibleCount: json.apap.eligibleCount,
                  eligiblePoints: json.apap.eligiblePoints,
                  adoptingCount: json.apap.adoptingCount,
                  adoptingPoints: json.apap.adoptingPoints,
                }
              : undefined,
            json?.kpiCountsAndPoints ?? undefined
          );
        }
      } catch (err) {
        console.warn('Failed to save historical data after Snowflake load:', err);
      }

      // Best-effort: prefetch previous month so “Biggest movers” has MoM context.
      try {
        const prevKey = format(subMonths(parseISO(monthKey + '-01'), 1), 'yyyy-MM');
        const hasPrev = !!getProcessedData(prevKey);
        if (!hasPrev) {
          const prevJson = await callSnowflakeProcess(prevKey);
          const prevSnapshot = prevJson.snapshot;
          setProcessedDataForMonth(prevSnapshot, prevKey, { select: false });

          const { saveHistoricalData } = await import('@/lib/history');
          const prevAsOf = prevSnapshot?.asOfMonth ? new Date(prevSnapshot.asOfMonth) : null;
          const prevLabelsArr = Array.isArray(prevSnapshot?.agencyLabels) ? prevSnapshot.agencyLabels : [];
          const prevLabelsMap = new Map(prevLabelsArr as any);
          if (prevAsOf) {
            saveHistoricalData(
              prevAsOf,
              [],
              prevSnapshot?.cohortSummaries ?? {},
              prevSnapshot?.usageRollups,
              prevLabelsMap,
              prevJson?.apap?.apap ?? undefined,
              prevJson?.simT10?.t12Total ?? undefined,
              prevJson?.simT10?.usageByMonth ?? undefined,
              prevJson?.apap
                ? {
                    eligibleCount: prevJson.apap.eligibleCount,
                    eligiblePoints: prevJson.apap.eligiblePoints,
                    adoptingCount: prevJson.apap.adoptingCount,
                    adoptingPoints: prevJson.apap.adoptingPoints,
                  }
                : undefined,
              prevJson?.kpiCountsAndPoints ?? undefined
            );
          }
        }
      } catch (err) {
        console.warn('Failed to prefetch previous month after Snowflake load:', err);
      }

      // Best-effort: ensure baseline month (2025-11) exists to populate Goal Progress retention/conversion.
      // Goal Progress reads baseline via getProcessedData('2025-11').
      try {
        const baselineKey = '2025-11';
        const hasBaseline = !!getProcessedData(baselineKey);
        if (!hasBaseline) {
          const baseJson = await callSnowflakeProcess(baselineKey);
          const baseSnapshot = baseJson.snapshot;
          setProcessedDataForMonth(baseSnapshot, baselineKey, { select: false });

          const { saveHistoricalData } = await import('@/lib/history');
          const baseAsOf = baseSnapshot?.asOfMonth ? new Date(baseSnapshot.asOfMonth) : null;
          const baseLabelsArr = Array.isArray(baseSnapshot?.agencyLabels) ? baseSnapshot.agencyLabels : [];
          const baseLabelsMap = new Map(baseLabelsArr as any);
          if (baseAsOf) {
            saveHistoricalData(
              baseAsOf,
              [],
              baseSnapshot?.cohortSummaries ?? {},
              baseSnapshot?.usageRollups,
              baseLabelsMap,
              baseJson?.apap?.apap ?? undefined,
              baseJson?.simT10?.t12Total ?? undefined,
              baseJson?.simT10?.usageByMonth ?? undefined,
              baseJson?.apap
                ? {
                    eligibleCount: baseJson.apap.eligibleCount,
                    eligiblePoints: baseJson.apap.eligiblePoints,
                    adoptingCount: baseJson.apap.adoptingCount,
                    adoptingPoints: baseJson.apap.adoptingPoints,
                  }
                : undefined,
              baseJson?.kpiCountsAndPoints ?? undefined
            );
          }
        }
      } catch (err) {
        console.warn('Failed to prefetch baseline month (2025-11) after Snowflake load:', err);
      }

      setResults(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load from Snowflake');
    } finally {
      setLoading(false);
      setLoadMode(null);
    }
  };

  const handleProcess = async () => {
    if (telemetryFiles.length === 0) {
      setError('Please upload at least one telemetry file');
      return;
    }

    setLoading(true);
    setLoadMode('upload');
    setError(null);
    setParseErrors([]);

    try {
      // Parse agencies - use uploaded file if provided, otherwise use previous month's data
      let agencies: AgencyRow[] = [];
      if (agenciesFile) {
        try {
          agencies = await parseAgenciesFile(agenciesFile);
          if (agencies.length === 0) {
            throw new Error(`${agenciesFile.name} appears to be empty or contains no valid T10 agency rows. Please check that the file has data, required columns, and includes T10 agencies (non-T10 agencies are automatically filtered out).`);
          }
          // Debug: Check vr_licenses values
          const withLicenses = agencies.filter(a => a.vr_licenses && a.vr_licenses > 0).length;
          const withoutLicenses = agencies.length - withLicenses;
          console.log(`Parsed ${agencies.length} T10 agencies: ${withLicenses} with licenses, ${withoutLicenses} without licenses`);
          if (withoutLicenses > 0) {
            console.warn(`⚠️ ${withoutLicenses} agencies have missing or invalid vr_licenses values`);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          throw new Error(`Failed to parse ${agenciesFile.name}: ${errorMsg}. Expected columns (any order): agency_id, agency_name, officer_count, vr_licenses, eligibility_cohort. Required: agency_id, agency_name, vr_licenses, officer_count; date: purchase_date or eligibility_cohort. Only T10 agencies should be included.`);
        }
      } else {
        // Fall back to viewing month's stored data (latest stored data for that month)
        const { getProcessedData, getCurrentMonth } = await import('@/lib/storage');
        const monthKey = getCurrentMonth();
        const stored = getProcessedData(monthKey ?? undefined);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.agencies && Array.isArray(parsed.agencies) && parsed.agencies.length > 0) {
              // Convert stored Agency objects back to AgencyRow format
              agencies = parsed.agencies.map((agency: any) => {
                // Handle date conversion - dates might be strings or Date objects
                const parseDate = (dateValue: any): Date | undefined => {
                  if (!dateValue) return undefined;
                  if (dateValue instanceof Date) return dateValue;
                  if (typeof dateValue === 'string') {
                    const parsed = new Date(dateValue);
                    return isNaN(parsed.getTime()) ? undefined : parsed;
                  }
                  return undefined;
                };
                
                // Ensure numeric values are properly handled (convert null/undefined/empty to undefined)
                const parseNumber = (value: any): number | undefined => {
                  if (value === null || value === undefined || value === '' || value === 'N/A' || value === 'n/a') {
                    return undefined;
                  }
                  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
                  return isNaN(num) ? undefined : num;
                };
                
                return {
                  agency_id: agency.agency_id,
                  agency_name: agency.agency_name,
                  purchase_date: parseDate(agency.purchase_date),
                  eligibility_cohort: parseNumber(agency.months_since_purchase ?? agency.eligibility_cohort),
                  vr_licenses: parseNumber(agency.vr_licenses),
                  officer_count: parseNumber(agency.officer_count),
                  cew_type: agency.cew_type,
                  region: agency.region,
                  csm_owner: agency.csm_owner,
                  notes: agency.notes,
                  latest_cew_training_date: parseDate(agency.latest_cew_training_date),
                  next_cew_training_date: parseDate(agency.next_cew_training_date),
                };
              });
            }
          } catch (err) {
            console.warn('Failed to load previous agency data:', err);
          }
        }
        
        if (agencies.length === 0) {
          throw new Error('No agency data available. Please upload Agencies.xlsx file or ensure you have previously processed data with agency information.');
        }
      }

      // Parse all telemetry files
      const allTelemetry: TelemetryMonthly[] = [];
      const errors: { file: string; error: string }[] = [];
      
      for (const file of telemetryFiles) {
        try {
          const telemetryRows = await parseTelemetryFile(file);
          if (telemetryRows.length === 0) {
            errors.push({ file: file.name, error: 'File appears to be empty or contains no valid rows' });
            continue;
          }
          const normalized = normalizeTelemetry(telemetryRows);
          allTelemetry.push(...normalized);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          errors.push({ 
            file: file.name, 
            error: `Failed to parse: ${errorMsg}. Required columns: month, agency_id, product, completions.` 
          });
        }
      }

      if (errors.length > 0) {
        setParseErrors(errors);
      }

      if (allTelemetry.length === 0) {
        throw new Error('No valid telemetry data was parsed from the uploaded files. Please check that at least one telemetry file has valid data with required columns: month, agency_id, product, completions.');
      }

      // Process data; when user selected a month, use it as asOfMonth so T6/T12 are correct
      const processed = processData(
        agencies,
        allTelemetry,
        dataForMonth === 'auto' ? undefined : dataForMonth
      );
      setResults(processed);
      
      // Debug: Log product information
      const uniqueProducts = new Set(allTelemetry.map(t => t.product));
      console.log('=== Telemetry Debug Info ===');
      console.log('Total telemetry rows uploaded:', allTelemetry.length);
      console.log('Unique products found:', Array.from(uniqueProducts));
      console.log('Products that match "Simulator Training":', 
        Array.from(uniqueProducts).filter(p => p === 'Simulator Training'));
      console.log('SIM telemetry rows after processing:', processed.simTelemetry.length);
      console.log('As of month:', processed.asOfMonth?.toISOString());
      if (processed.asOfMonth) {
        const { format } = await import('date-fns');
        console.log('📅 As of month (formatted):', format(processed.asOfMonth, 'MMMM yyyy'));
      }
      
      // Log all unique months in telemetry to help debug
      const allMonths = allTelemetry.map(t => {
        const { format } = require('date-fns');
        return format(t.month, 'yyyy-MM');
      });
      const uniqueMonths = Array.from(new Set(allMonths)).sort();
      console.log('📊 All months in telemetry files:', uniqueMonths);
      console.log('📊 Latest month detected:', uniqueMonths[uniqueMonths.length - 1]);
      
      // Check for December 2025 specifically
      const dec2025Rows = allTelemetry.filter(t => {
        const { format } = require('date-fns');
        return format(t.month, 'yyyy-MM') === '2025-12';
      });
      console.log(`🔍 December 2025 rows found: ${dec2025Rows.length}`);
      if (dec2025Rows.length > 0) {
        console.log('🔍 Sample December 2025 row:', {
          month: dec2025Rows[0].month,
          monthFormatted: require('date-fns').format(dec2025Rows[0].month, 'yyyy-MM'),
          agency_id: dec2025Rows[0].agency_id,
          product: dec2025Rows[0].product,
        });
      }
      
      // Also check raw telemetry before normalization to see what Excel is reading
      console.log('🔍 Checking raw telemetry parsing...');
      if (telemetryFiles.length > 0) {
        // Re-parse first file to see raw month values
        const { parseTelemetryFile } = await import('@/lib/ingest');
        const rawRows = await parseTelemetryFile(telemetryFiles[0]);
        const decRawRows = rawRows.filter(r => {
          const monthStr = r.month instanceof Date 
            ? `${r.month.getFullYear()}-${String(r.month.getMonth() + 1).padStart(2, '0')}`
            : String(r.month);
          return monthStr.includes('2025-12') || monthStr.includes('12/2025') || monthStr.includes('Dec 2025');
        });
        console.log(`🔍 Raw December 2025 rows in file "${telemetryFiles[0].name}": ${decRawRows.length}`);
        if (decRawRows.length > 0) {
          console.log('🔍 Sample raw December row:', {
            month: decRawRows[0].month,
            monthType: typeof decRawRows[0].month,
            agency_id: decRawRows[0].agency_id,
          });
        }
      }
      if (processed.simTelemetry.length === 0 && allTelemetry.length > 0) {
        console.warn('⚠️ WARNING: No SIM telemetry found! Product names in your file:', Array.from(uniqueProducts));
        console.warn('The normalizeProduct function looks for products containing both "simulator" and "training" (case-insensitive)');
      }

      // Save historical data for trend analysis
      if (processed.asOfMonth && processed.simTelemetry.length > 0) {
        const { saveHistoricalData, computeAPAP, computeKPICountsAndPoints } = await import('@/lib/history');
        const apapResult = computeAPAP(processed.agencies, processed.agencyLabels);
        const kpiCountsAndPoints = computeKPICountsAndPoints(processed.agencies, processed.agencyLabels);
        const t10Ids = new Set(processed.agencies.map((a) => a.agency_id));
        const simT10 = computeSimT10Usage(processed.simTelemetry, t10Ids, processed.asOfMonth);
        saveHistoricalData(
          processed.asOfMonth,
          processed.simTelemetry,
          processed.cohortSummaries,
          processed.usageRollups,
          processed.agencyLabels,
          apapResult.apap,
          simT10.t12Total,
          simT10.usageByMonth,
          {
            eligibleCount: apapResult.eligibleCount,
            eligiblePoints: apapResult.eligiblePoints,
            adoptingCount: apapResult.adoptingCount,
            adoptingPoints: apapResult.adoptingPoints,
          },
          kpiCountsAndPoints
        );
      }

      // Store in sessionStorage for action-list page
      console.log('=== Storing processed data ===');
      console.log(`Agencies count: ${processed.agencies.length}`);
      console.log(`Agency labels count: ${processed.agencyLabels.size}`);
      if (processed.agencies.length > 0) {
        console.log('Sample agency:', {
          agency_id: processed.agencies[0].agency_id,
          agency_name: processed.agencies[0].agency_name,
          cew_type: processed.agencies[0].cew_type,
          purchase_cohort: processed.agencies[0].purchase_cohort,
        });
      }
      
      const monthKey =
        dataForMonth === 'auto' && processed.asOfMonth
          ? format(processed.asOfMonth, 'yyyy-MM')
          : dataForMonth;
      const asOfMonthKey = monthKey;
      const existingRaw = getProcessedData(monthKey);
      if (existingRaw) {
        setReplacedMonthLabel(format(parseISO(monthKey + '-01'), 'MMM yyyy'));
      } else {
        setReplacedMonthLabel(null);
      }
      setProcessedData(
        {
          agencies: processed.agencies,
          agencyLabels: Array.from(processed.agencyLabels.entries()),
          nearEligible: processed.nearEligible,
          dataQuality: processed.dataQuality,
          asOfMonth: processed.asOfMonth?.toISOString() ?? null,
          cohortSummaries: processed.cohortSummaries,
          usageRollups: processed.usageRollups,
          simTelemetry: processed.simTelemetry.map((t) => ({
            ...t,
            month: t.month.toISOString(),
          })),
          allTelemetry: allTelemetry.map((t) => ({
            ...t,
            month: t.month.toISOString(),
          })),
          asOfMonthKey,
          createdAt: new Date().toISOString(),
          snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
          computeVersion: COMPUTE_VERSION,
          t6RangeLabel: getLookbackRangeLabel(asOfMonthKey, 6),
          t12RangeLabel: getLookbackRangeLabel(asOfMonthKey, 12),
        },
        monthKey
      );

      console.log(`✅ Data stored for month ${monthKey} (persists across sessions)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process files');
    } finally {
      setLoading(false);
      setLoadMode(null);
    }
  };

  return (
    <div style={{
      padding: '2rem',
      maxWidth: '1200px',
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
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1rem',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <UploadIcon size={24} color="white" />
          </div>
          <div>
            <h1 style={{
              fontSize: 'var(--text-headline-size)',
              lineHeight: 'var(--text-headline-line)',
              fontWeight: 'var(--text-headline-weight)',
              marginBottom: '0.25rem',
              color: 'var(--fg-primary)',
            }}>
              Upload & Validate
            </h1>
            <p style={{
              fontSize: 'var(--text-body1-size)',
              color: 'var(--fg-secondary)',
            }}>
              Upload your agency master data and telemetry files
            </p>
          </div>
        </div>

        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem 1.25rem',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
        }}>
          <label style={{
            display: 'block',
            fontSize: 'var(--text-body2-size)',
            fontWeight: 'var(--text-subtitle-weight)',
            color: 'var(--fg-primary)',
            marginBottom: '0.5rem',
          }}>
            Save this upload as dataset for month
          </label>
          <select
            value={dataForMonth}
            onChange={(e) => setDataForMonth(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: 'var(--text-body2-size)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-3)',
              color: 'var(--fg-primary)',
              minWidth: '200px',
            }}
          >
            {monthOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginTop: '0.5rem', marginBottom: 0 }}>
            Auto uses the latest month in your telemetry. Picking a month saves/overwrites that month&apos;s dataset so you can re-run analysis or correct data later.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Agencies File Upload */}
          <div style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, var(--surface-2) 0%, rgba(4, 93, 210, 0.03) 100%)',
            borderRadius: 'var(--radius-md)',
            border: `2px solid ${agenciesFile ? 'var(--fg-success)' : 'var(--border-color)'}`,
            transition: 'all 0.2s ease',
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: 'var(--text-subtitle-size)',
              fontWeight: 'var(--text-subtitle-weight)',
              marginBottom: '0.75rem',
              color: 'var(--fg-primary)',
            }}>
              <FileSpreadsheet size={18} color={agenciesFile ? 'var(--fg-success)' : 'var(--fg-action)'} />
              Agencies.xlsx <span style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)' }}>(optional - will use previous month's data if not provided)</span>
            </label>
            <input
              type="file"
              accept=".xlsx"
              onChange={handleAgenciesUpload}
              style={{
                padding: '0.75rem',
                border: `2px solid ${agenciesFile ? 'var(--fg-success)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-body1-size)',
                background: 'var(--surface-4)',
                color: 'var(--fg-primary)',
                width: '100%',
                maxWidth: '500px',
                cursor: 'pointer',
              }}
            />
            {agenciesFile && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                background: 'var(--bg-success)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-body2-size)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <CheckCircle2 size={16} />
                <span>Selected: <strong>{agenciesFile.name}</strong></span>
              </div>
            )}
            {!agenciesFile && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                background: 'var(--bg-alert)',
                color: 'var(--fg-primary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-body2-size)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <AlertTriangle size={16} />
                <span>No file selected - will use previous month's agency data if available</span>
              </div>
            )}
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: 'var(--surface-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-body2-size)',
              color: 'var(--fg-secondary)',
            }}>
              <div style={{
                marginBottom: '0.5rem',
                padding: '0.5rem',
                background: 'var(--bg-alert)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--fg-primary)',
                fontWeight: 'var(--text-subtitle-weight)',
              }}>
                ⚠️ <strong>Important:</strong> Only T10 agencies should be included in this file. Non-T10 agencies will be automatically filtered out during processing.
              </div>
              <strong>Expected column order</strong> (any order accepted): agency_id, agency_name, officer_count, vr_licenses, eligibility_cohort<br />
              <strong>Required:</strong> agency_id, agency_name, vr_licenses, officer_count. <strong>Date:</strong> purchase_date OR eligibility_cohort (months since purchase)<br />
              <strong>Optional:</strong> cew_type, region, csm_owner, notes, latest_cew_training_date, next_cew_training_date
            </div>
          </div>

          {/* Telemetry Files Upload */}
          <div style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, var(--surface-2) 0%, rgba(4, 93, 210, 0.03) 100%)',
            borderRadius: 'var(--radius-md)',
            border: `2px solid ${telemetryFiles.length > 0 ? 'var(--fg-success)' : 'var(--border-color)'}`,
            transition: 'all 0.2s ease',
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: 'var(--text-subtitle-size)',
              fontWeight: 'var(--text-subtitle-weight)',
              marginBottom: '0.75rem',
              color: 'var(--fg-primary)',
            }}>
              <FileSpreadsheet size={18} color={telemetryFiles.length > 0 ? 'var(--fg-success)' : 'var(--fg-action)'} />
              Telemetry Files <span style={{ color: 'var(--fg-destructive)' }}>*</span>
            </label>
            <input
              type="file"
              accept=".xlsx"
              multiple
              onChange={handleTelemetryUpload}
              style={{
                padding: '0.75rem',
                border: `2px solid ${telemetryFiles.length > 0 ? 'var(--fg-success)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-body1-size)',
                background: 'var(--surface-4)',
                color: 'var(--fg-primary)',
                width: '100%',
                maxWidth: '500px',
                cursor: 'pointer',
              }}
            />
            {telemetryFiles.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{
                  padding: '0.75rem',
                  background: 'var(--bg-success)',
                  color: 'white',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-body2-size)',
                  marginBottom: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <CheckCircle2 size={16} />
                  <span>Selected <strong>{telemetryFiles.length}</strong> file(s)</span>
                </div>
                <ul style={{
                  fontSize: 'var(--text-body2-size)',
                  color: 'var(--fg-secondary)',
                  marginLeft: '1.5rem',
                  marginTop: '0.5rem',
                }}>
                  {telemetryFiles.map((file, i) => (
                    <li key={i} style={{ marginBottom: '0.25rem' }}>{file.name}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: 'var(--surface-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-body2-size)',
              color: 'var(--fg-secondary)',
            }}>
              <strong>Required columns:</strong> month, agency_id, product, completions<br />
              <strong>Optional columns:</strong> platform, license_type<br />
              <strong>Note:</strong> Product names containing "Simulator Training" will be normalized automatically.
            </div>
          </div>

          {/* Process Button */}
          <div style={{
            padding: '1.5rem',
            background: telemetryFiles.length > 0 ? 'var(--surface-2)' : 'var(--surface-1)',
            borderRadius: 'var(--radius-md)',
            border: `2px dashed ${telemetryFiles.length > 0 ? 'var(--fg-action)' : 'var(--border-color)'}`,
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <button
              onClick={handleProcess}
              disabled={loading || telemetryFiles.length === 0}
              style={{
                padding: '1rem 2rem',
                background: loading 
                  ? 'var(--fg-disabled)'
                  : telemetryFiles.length === 0
                  ? 'var(--fg-disabled)'
                  : 'var(--bg-action)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-button-size)',
                fontWeight: 'var(--text-button-weight)',
                letterSpacing: 'var(--text-button-letter)',
                textTransform: 'uppercase',
                cursor: (loading || telemetryFiles.length === 0) ? 'not-allowed' : 'pointer',
                width: '100%',
                maxWidth: '300px',
                transition: 'all 0.2s ease',
                boxShadow: telemetryFiles.length === 0 ? 'none' : 'var(--shadow-md)',
              }}
              onMouseEnter={(e) => {
                if (!loading && telemetryFiles.length > 0) {
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {loading
                ? loadMode === 'snowflake'
                  ? 'Loading from Snowflake...'
                  : 'Processing...'
                : telemetryFiles.length === 0
                ? 'Upload Telemetry Files First'
                : 'Process Files'}
            </button>

            <button
              onClick={handleLoadFromSnowflake}
              disabled={loading}
              style={{
                padding: '1rem 1.25rem',
                background: loading ? 'var(--fg-disabled)' : 'var(--surface-4)',
                color: 'var(--fg-primary)',
                border: `1px solid var(--border-color)`,
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-button-size)',
                fontWeight: 'var(--text-button-weight)',
                letterSpacing: 'var(--text-button-letter)',
                textTransform: 'uppercase',
                cursor: loading ? 'not-allowed' : 'pointer',
                width: '100%',
                maxWidth: '300px',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
              title="Fetches data from Snowflake and runs the same pipeline (no Excel upload needed)."
            >
              <Database size={16} />
              Load from Snowflake
            </button>
            </div>
            <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginTop: '0.75rem', marginBottom: 0 }}>
              Tip: Use the month selector above. Snowflake mode uses `RPT_ADOPTION_VR` for that month and synthesizes monthly Simulator Training telemetry from T6/T12 rollups.
            </p>
            {telemetryFiles.length === 0 && (
              <p style={{
                fontSize: 'var(--text-body2-size)',
                color: 'var(--fg-secondary)',
                marginTop: '0.75rem',
                fontStyle: 'italic',
              }}>
                Please upload at least one telemetry file to enable processing.
              </p>
            )}
          </div>

          {error && (
            <div style={{
              padding: '1.25rem',
              background: 'var(--bg-destructive)',
              color: 'white',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body1-size)',
              border: '2px solid var(--fg-destructive)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
            }}>
              <XCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.5rem' }}>
                  Error Processing Files
                </div>
                <div>{error}</div>
              </div>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div style={{
              padding: '1.25rem',
              background: 'var(--bg-alert)',
              color: 'white',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body1-size)',
              border: '2px solid var(--fg-alert)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
            }}>
              <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'var(--text-subtitle-weight)', marginBottom: '0.75rem' }}>
                  Some Files Had Issues
                </div>
                <ul style={{ marginLeft: '1.5rem' }}>
                  {parseErrors.map((err, i) => (
                    <li key={i} style={{ marginBottom: '0.5rem' }}>
                      <strong>{err.file}:</strong> {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {results && (
            <div style={{
              marginTop: '2rem',
              padding: '1.5rem',
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius-md)',
              border: `1px solid var(--border-color)`,
            }}>
              <h2 style={{
                fontSize: 'var(--text-title-size)',
                lineHeight: 'var(--text-title-line)',
                fontWeight: 'var(--text-title-weight)',
                marginBottom: '1rem',
                color: 'var(--fg-primary)',
              }}>
                Validation Results
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <strong style={{ color: 'var(--fg-primary)' }}>Row Counts:</strong>
                  <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                    <li>Agencies: {results.dataQuality.row_counts.agencies}</li>
                    <li>Telemetry rows: {results.dataQuality.row_counts.telemetry_rows}</li>
                    <li style={{ 
                      color: results.dataQuality.row_counts.sim_telemetry_rows === 0 ? 'var(--fg-destructive)' : 'var(--fg-primary)',
                      fontWeight: results.dataQuality.row_counts.sim_telemetry_rows === 0 ? 'bold' : 'normal'
                    }}>
                      SIM telemetry rows: {results.dataQuality.row_counts.sim_telemetry_rows}
                      {results.dataQuality.row_counts.sim_telemetry_rows === 0 && (
                        <span style={{ 
                          display: 'block', 
                          fontSize: 'var(--text-body2-size)', 
                          color: 'var(--fg-destructive)',
                          marginTop: '0.25rem'
                        }}>
                          ⚠️ No Simulator Training telemetry found! Check that your product column contains "Simulator Training" or similar.
                        </span>
                      )}
                    </li>
                  </ul>
                </div>

                {results.dataQuality.unmatched_telemetry_ids.length > 0 && (
                  <div style={{
                    padding: '0.75rem',
                    background: 'var(--bg-alert)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                  }}>
                    <strong>Unmatched Telemetry IDs:</strong> {results.dataQuality.unmatched_telemetry_ids.length} rows
                  </div>
                )}

                {results.dataQuality.agencies_with_no_telemetry.length > 0 && (
                  <div style={{
                    padding: '0.75rem',
                    background: 'var(--bg-alert)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                  }}>
                    <strong>Agencies with no telemetry:</strong> {results.dataQuality.agencies_with_no_telemetry.length}
                  </div>
                )}

                {results.dataQuality.agencies_missing_licenses.length > 0 && (
                  <div style={{
                    padding: '0.75rem',
                    background: 'var(--bg-alert)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                  }}>
                    <strong>Agencies missing licenses:</strong> {results.dataQuality.agencies_missing_licenses.length}
                  </div>
                )}

                {results.dataQuality.agencies_missing_purchase_date.length > 0 && (
                  <div style={{
                    padding: '0.75rem',
                    background: 'var(--bg-alert)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                  }}>
                    <strong>Agencies missing purchase date:</strong> {results.dataQuality.agencies_missing_purchase_date.length}
                  </div>
                )}

                {results.asOfMonth && (
                  <div>
                    <strong style={{ color: 'var(--fg-primary)' }}>As of month:</strong>{' '}
                    {results.asOfMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
                  </div>
                )}
                {replacedMonthLabel && (
                  <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>
                    Replaced existing snapshot for {replacedMonthLabel}.
                  </div>
                )}

                <Link
                  href="/actions"
                  className="btn-primary"
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'linear-gradient(135deg, var(--bg-action) 0%, #0066CC 100%)',
                    color: 'white',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-button-size)',
                    fontWeight: 'var(--text-button-weight)',
                    letterSpacing: 'var(--text-button-letter)',
                    textTransform: 'uppercase',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    width: 'fit-content',
                    marginTop: '1rem',
                    textDecoration: 'none',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 12px rgba(4, 93, 210, 0.3)',
                  }}
                >
                  View Action List
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Add spin animation for loading spinner
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

