'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FileSpreadsheet, TrendingUp, CheckCircle2, AlertTriangle, BarChart3, Target, ArrowUp, ArrowDown, Users } from 'lucide-react';
import { getBaselineData, type BaselineData } from '@/lib/baseline';
import { computeAPAP, getHistoricalData, getHistoricalEntryForComparison, getSimT10CompletionsForMonth, type HistoricalData } from '@/lib/history';
import type { Agency, AgencyWithLabel, TelemetryMonthly } from '@/lib/schema';
import { format, parseISO, subMonths, subYears } from 'date-fns';
import { getProcessedDataParsed, getCurrentMonth } from '@/lib/storage';
import { computeSimT10Usage } from '@/lib/usageRollups';
import { formatPercentFromParts } from '@/lib/format';

export default function Home() {
  const [baseline, setBaseline] = useState<BaselineData | null>(null);
  const [currentData, setCurrentData] = useState<{
    agencies: Agency[];
    agencyLabels: [string, AgencyWithLabel][];
    asOfMonth: string | null;
    simTelemetry?: Array<{ month: string; agency_id: string; product: string; completions: number }>;
    apap?: { apap: number; adoptingPoints: number; eligiblePoints: number; eligibleCount: number; adoptingCount: number };
  } | null>(null);
  const [selectedMonthNoData, setSelectedMonthNoData] = useState(false);
  const [selectedMonthKeyWhenNoData, setSelectedMonthKeyWhenNoData] = useState<string | null>(null);
  const [staleSnapshot, setStaleSnapshot] = useState(false);

  useEffect(() => {
    // Load baseline data - try to initialize if not in localStorage
    const loadBaseline = async () => {
      let baselineData = getBaselineData();
      if (!baselineData) {
        // If not in localStorage, try to load from file
        const { initializeBaseline } = await import('@/lib/baseline');
        baselineData = await initializeBaseline();
        if (baselineData) {
          // Save to localStorage for future use
          try {
            localStorage.setItem('apap_baseline_data', JSON.stringify({
              ...baselineData,
              agencies: Array.from(baselineData.agencies.entries()),
            }));
          } catch (err) {
            console.error('Failed to save baseline to localStorage:', err);
          }
        }
      }
      setBaseline(baselineData);
    };
    loadBaseline();

    // Load current data for the selected viewing month only (do not mix in other months)
    const monthKey = getCurrentMonth();
    const result = getProcessedDataParsed(monthKey ?? undefined);
    const noData = !!monthKey && !result;
    setSelectedMonthNoData(noData);
    setSelectedMonthKeyWhenNoData(noData ? monthKey : null);
    if (result) {
      const parsed = result.data;
      setStaleSnapshot(result.isStale);
      setCurrentData({
        agencies: parsed.agencies || [],
        agencyLabels: parsed.agencyLabels || [],
        asOfMonth: parsed.asOfMonth || null,
        simTelemetry: parsed.simTelemetry || undefined,
        apap: (parsed as any).apap || undefined,
      });
    } else {
      setStaleSnapshot(false);
      setCurrentData(null);
    }
  }, []);

  // Compute current APAP
  const currentAPAP = useMemo(() => {
    if (!currentData) return null;
    if (currentData.apap && Number.isFinite(currentData.apap.apap)) return currentData.apap;
    const labelsMap = new Map(currentData.agencyLabels);
    return computeAPAP(currentData.agencies, labelsMap);
  }, [currentData]);

  // Get comparison data (previous month)
  const comparisonAPAP = useMemo(() => {
    if (!currentAPAP || !currentData?.asOfMonth) return null;
    
    const currentMonthDate = parseISO(currentData.asOfMonth);
    const previousMonthDate = subMonths(currentMonthDate, 1);
    const previousMonthKey = format(previousMonthDate, 'yyyy-MM');
    
    // Check if this is November 2025 (baseline month)
    const baselineData = getBaselineData();
    if (previousMonthKey === '2025-11' && baselineData && baselineData.baseline_apap !== undefined) {
      // For baseline, compute APAP from baseline agencies
      // Baseline agencies are all eligible, so we need to compute adopting count/points
      let eligibleCount = 0;
      let adoptingCount = 0;
      let eligiblePoints = 0;
      let adoptingPoints = 0;
      
      // Match baseline agencies with current agencies to get officer counts
      // We use current agencies to get the most up-to-date officer counts, but use baseline adoption status
      const currentAgenciesMap = new Map<string | number, Agency>();
      for (const agency of currentData.agencies.filter(a => a.cew_type === 'T10')) {
        const idStr = String(agency.agency_id);
        const idNum = Number(agency.agency_id);
        currentAgenciesMap.set(idStr, agency);
        if (!isNaN(idNum)) {
          currentAgenciesMap.set(idNum, agency);
        }
      }
      
      for (const [agencyId, baselineAgency] of baselineData.agencies.entries()) {
        const agencyIdStr = String(agencyId);
        const agencyIdNum = typeof agencyId === 'number' ? agencyId : Number(agencyId);
        const currentAgency = currentAgenciesMap.get(agencyIdStr) || 
                              (typeof agencyIdNum === 'number' && !isNaN(agencyIdNum) ? currentAgenciesMap.get(agencyIdNum) : undefined);
        
        // Only count T10 agencies that are still in current data
        // If agency is not in current data, it may have churned or is no longer T10
        if (!currentAgency || currentAgency.cew_type !== 'T10') {
          continue;
        }
        
        // Use baseline officer_count if available, otherwise use current
        const points = baselineAgency.officer_count ?? currentAgency.officer_count ?? 0;
        eligibleCount++;
        eligiblePoints += points;
        
        // Use baseline adoption status
        if (baselineAgency.is_adopting) {
          adoptingCount++;
          adoptingPoints += points;
        }
      }
      
      return {
        apap: baselineData.baseline_apap,
        adoptingPoints,
        eligiblePoints,
        adoptingCount,
        eligibleCount,
      };
    }
    
    // Get historical entry for previous month
    const historicalEntry = getHistoricalEntryForComparison(currentMonthDate, 'last_month');
    if (!historicalEntry) return null;

    // Prefer stored APAP counts from that month's upload (eligible = cohort >= 6 from that month's agency dataset)
    if (
      historicalEntry.apap != null &&
      historicalEntry.apapEligibleCount != null &&
      historicalEntry.apapEligiblePoints != null &&
      historicalEntry.apapAdoptingCount != null &&
      historicalEntry.apapAdoptingPoints != null
    ) {
      return {
        apap: historicalEntry.apap,
        eligibleCount: historicalEntry.apapEligibleCount,
        eligiblePoints: historicalEntry.apapEligiblePoints,
        adoptingCount: historicalEntry.apapAdoptingCount,
        adoptingPoints: historicalEntry.apapAdoptingPoints,
      };
    }

    // Fallback: compute from current agencies + historical labels
    if (historicalEntry.agencyLabels) {
      const historicalLabelsMap = Array.isArray(historicalEntry.agencyLabels)
        ? new Map(historicalEntry.agencyLabels as [string, AgencyWithLabel][])
        : new Map(Array.from((historicalEntry.agencyLabels as Map<string, AgencyWithLabel>).entries()));
      return computeAPAP(currentData.agencies, historicalLabelsMap);
    }

    return null;
  }, [currentAPAP, currentData]);

  // Use baseline (November 2025) as "previous month" for MoM calculation (fallback)
  const previousMonthAPAP = useMemo(() => {
    if (comparisonAPAP) return comparisonAPAP.apap;
    return baseline?.baseline_apap || null;
  }, [baseline, comparisonAPAP]);

  // Agencies that were eligible (cohort ≥6) in previous month but not in current month
  const droppedEligibility = useMemo(() => {
    if (!currentData?.asOfMonth || !comparisonAPAP) return null;
    const currentMonthKey = format(parseISO(currentData.asOfMonth), 'yyyy-MM');
    const prevMonthKey = format(subMonths(parseISO(currentData.asOfMonth), 1), 'yyyy-MM');
    const prevResult = getProcessedDataParsed(prevMonthKey);
    if (!prevResult) return null;
    const prevAgencies: Agency[] = (prevResult.data.agencies as Agency[]) || [];
    const isEligible = (a: { eligibility_cohort?: number | null }) =>
      a.eligibility_cohort != null && a.eligibility_cohort >= 6;
    const eligiblePrev = new Set(prevAgencies.filter(isEligible).map((a) => a.agency_id));
    const currentAgenciesMap = new Map(currentData.agencies.map((a) => [a.agency_id, a]));
    const dropped: Array<{ agency_id: string; agency_name: string; officer_count: number | null; prevCohort: number; reason: string }> = [];
    eligiblePrev.forEach((id) => {
      const curr = currentAgenciesMap.get(id);
      const prevA = prevAgencies.find((a) => a.agency_id === id);
      const officerCount = prevA?.officer_count ?? curr?.officer_count ?? null;
      if (!curr) {
        dropped.push({
          agency_id: id,
          agency_name: (prevA && prevA.agency_name) || id,
          officer_count: officerCount ?? null,
          prevCohort: prevA?.eligibility_cohort ?? 0,
          reason: 'Not in current month\'s upload',
        });
      } else if (!isEligible(curr)) {
        dropped.push({
          agency_id: id,
          agency_name: curr.agency_name || id,
          officer_count: officerCount ?? null,
          prevCohort: prevA?.eligibility_cohort ?? 0,
          reason: `Cohort in ${currentMonthKey}: ${curr.eligibility_cohort ?? 'missing'} (was ${prevA?.eligibility_cohort ?? '?'})`,
        });
      }
    });
    return { prevMonthKey, currentMonthKey, dropped };
  }, [currentData, comparisonAPAP]);

  // Get APAP history for chart (baseline + all historical months)
  const apapHistory = useMemo(() => {
    const history: Array<{ month: string; apap: number; label: string }> = [];
    const monthSet = new Set<string>(); // Track which months we've added
    
    // Always add baseline (November 2025) first if available - this should be 37.1%
    if (baseline && baseline.baseline_apap !== undefined) {
      history.push({
        month: '2025-11',
        apap: baseline.baseline_apap,
        label: 'Nov 2025 (Baseline)',
      });
      monthSet.add('2025-11');
      console.log(`✅ Added baseline November 2025 with APAP ${baseline.baseline_apap.toFixed(1)}%`);
    } else {
      console.warn('⚠️ Baseline not loaded:', { 
        hasBaseline: !!baseline, 
        baseline_apap: baseline?.baseline_apap 
      });
    }
    
    // Get historical data and include months with stored APAP values
    // But NEVER overwrite baseline month (2025-11)
    try {
      const historicalData: HistoricalData = getHistoricalData();
      const sortedMonths = Object.keys(historicalData).sort();
      
      for (const monthKey of sortedMonths) {
        // Skip if we already have this month (e.g., baseline) - baseline takes precedence
        if (monthSet.has(monthKey)) continue;
        
        const entry = historicalData[monthKey];
        if (entry && entry.apap !== undefined) {
          const monthDate = parseISO(entry.asOfMonth);
          history.push({
            month: monthKey,
            apap: entry.apap,
            label: format(monthDate, 'MMM yyyy'),
          });
          monthSet.add(monthKey);
        }
      }
    } catch (err) {
      console.error('Error loading historical data:', err);
    }
    
    // Add current month if we have data (viewing month)
    // NEVER overwrite baseline month (2025-11) - baseline always takes precedence
    if (currentAPAP && currentData) {
      const viewingMonth = getCurrentMonth();
      const result = getProcessedDataParsed(viewingMonth ?? undefined);
      if (result) {
        const parsed = result.data;
        if (parsed.asOfMonth) {
          const currentMonthDate = parseISO(parsed.asOfMonth as string);
          const currentMonthKey = format(currentMonthDate, 'yyyy-MM');
          if (currentMonthKey === '2025-11') {
            // Skip - baseline is the source of truth for November
          } else {
            const existingIndex = history.findIndex(h => h.month === currentMonthKey);
            const currentPoint = {
              month: currentMonthKey,
              apap: currentAPAP.apap,
              label: format(currentMonthDate, 'MMM yyyy'),
            };
            if (existingIndex >= 0) {
              history[existingIndex] = currentPoint;
            } else {
              history.push(currentPoint);
              monthSet.add(currentMonthKey);
            }
          }
        }
      }
    }
    
    // Sort by month
    const sorted = history.sort((a, b) => a.month.localeCompare(b.month));
    // Only show points up to selected asOf month (no future months)
    const viewingMonthKey = currentData?.asOfMonth ? format(parseISO(currentData.asOfMonth), 'yyyy-MM') : null;
    const filtered = viewingMonthKey ? sorted.filter((h) => h.month <= viewingMonthKey) : sorted;
    return filtered;
  }, [baseline, currentAPAP, currentData]);

  // Compute progress toward goals (works with or without baseline)
  const goalProgress = useMemo(() => {
    if (!currentAPAP) return null;

    const gapToHighConfidence = 42 - currentAPAP.apap;
    const gapToHardClimb = 46 - currentAPAP.apap;
    
    // Calculate MoM change
    const momChange = previousMonthAPAP !== null 
      ? currentAPAP.apap - previousMonthAPAP 
      : null;
    
    // If baseline exists, calculate progress from baseline
    const progressFromBaseline = baseline ? currentAPAP.apap - baseline.baseline_apap : null;
    
    // Calculate progress toward goals (from baseline if available, otherwise from 0)
    const progressToHighConfidence = baseline 
      ? (currentAPAP.apap - baseline.baseline_apap) / (42 - baseline.baseline_apap) * 100
      : (currentAPAP.apap / 42) * 100;
    const progressToHardClimb = baseline
      ? (currentAPAP.apap - baseline.baseline_apap) / (46 - baseline.baseline_apap) * 100
      : (currentAPAP.apap / 46) * 100;

    return {
      current: currentAPAP.apap,
      baseline: baseline?.baseline_apap || null,
      previous_month: previousMonthAPAP,
      mom_change: momChange,
      high_confidence: 42,
      hard_climb: 46,
      gap_to_high_confidence: gapToHighConfidence,
      gap_to_hard_climb: gapToHardClimb,
      progress_from_baseline: progressFromBaseline,
      progress_to_high_confidence: Math.min(100, Math.max(0, progressToHighConfidence)),
      progress_to_hard_climb: Math.min(100, Math.max(0, progressToHardClimb)),
    };
  }, [currentAPAP, baseline, previousMonthAPAP]);

  // SIM Engagement goal: T12 180K (Nov'25) → 290K (Nov'26). Also YoY growth for single month.
  const SIM_GOAL_START = 180000;
  const SIM_GOAL_END = 290000;
  /** Dec 2024 T10 SIM completions baseline for YoY comparison (Dec 2025 vs Dec 2024). */
  const DEC_2024_SIM_BASELINE = 7262;

  const simEngagement = useMemo(() => {
    if (!currentData?.asOfMonth || !currentData.simTelemetry?.length || !currentData.agencies?.length) return null;
    const asOfMonthDate = new Date(currentData.asOfMonth);
    // Only T10 agencies: pipeline already restricts currentData.agencies to cew_type === 'T10'
    const t10Ids = new Set(currentData.agencies.map((a) => a.agency_id));
    const simTelemetryWithDates: TelemetryMonthly[] = currentData.simTelemetry.map((t) => ({
      ...t,
      month: new Date(t.month),
    }));
    const simT10 = computeSimT10Usage(simTelemetryWithDates, t10Ids, asOfMonthDate);
    const prevEntry = getHistoricalEntryForComparison(asOfMonthDate, 'last_month');
    const prevT12 = prevEntry?.simT12Total ?? null;
    const sameMonthLastYearKey = format(subYears(asOfMonthDate, 1), 'yyyy-MM');
    // Prior-year month can be in any upload (e.g. Jan 2025 was in the Dec 2025 telemetry sheet)
    const sameMonthLastYearCompletions =
      sameMonthLastYearKey === '2024-12'
        ? DEC_2024_SIM_BASELINE
        : getSimT10CompletionsForMonth(sameMonthLastYearKey);
    const currentMonthCompletions = simT10.usageByMonth[simT10.asOfMonth] ?? 0;
    const progressPct = (simT10.t12Total - SIM_GOAL_START) / (SIM_GOAL_END - SIM_GOAL_START) * 100;
    const momChange = prevT12 != null ? simT10.t12Total - prevT12 : null;
    const yoyGrowthPct =
      sameMonthLastYearCompletions != null && sameMonthLastYearCompletions > 0
        ? (currentMonthCompletions - sameMonthLastYearCompletions) / sameMonthLastYearCompletions * 100
        : null;
    return {
      simT10,
      prevT12,
      sameMonthLastYearCompletions,
      currentMonthCompletions,
      progressPct,
      momChange,
      yoyGrowthPct,
      asOfMonthKey: simT10.asOfMonth,
      asOfMonthLabel: format(asOfMonthDate, 'MMM yyyy'),
      sameMonthLastYearLabel: format(subYears(asOfMonthDate, 1), 'MMM yyyy'),
      /** True when comparing Dec 2025 vs Dec 2024 using stored baseline 7,262 */
      usesDec2024Baseline: sameMonthLastYearKey === '2024-12',
    };
  }, [currentData]);

  // Compute APAP by cohort for tracking (works with or without baseline)
  const cohortProgress = useMemo(() => {
    if (!currentData || !baseline || !baseline.cohort_targets.length) return null;

    const labelsMap = new Map(currentData.agencyLabels);
    const cohortAPAPs: Array<{
      cohort_name: string;
      target_rate: number;
      current_apap: number;
      gap: number;
      eligible_count: number;
      sub_cohorts?: Array<{
        sub_cohort_name: string;
        target_rate: number;
        current_apap: number;
        gap: number;
        eligible_count: number;
      }>;
    }> = [];

    for (const cohortTarget of baseline.cohort_targets) {
      // Try to map cohort name to our cohort dimensions
      // This is a heuristic - we'll need to refine based on actual Excel structure
      let filter: { time_since_purchase_cohort?: string[]; agency_size_band?: string[]; cew_type?: string[] } | undefined;
      
      // Simple mapping - can be refined
      if (cohortTarget.cohort_name.toLowerCase().includes('adopting')) {
        // This might be all currently adopting agencies - we can't filter by this directly
        // For now, skip or compute overall
        continue;
      }
      
      // Try to match by agency size if sub-cohorts mention it
      if (cohortTarget.sub_cohorts) {
        const sizeBands: string[] = [];
        for (const sub of cohortTarget.sub_cohorts) {
          if (sub.sub_cohort_name === 'Major') sizeBands.push('Major');
          else if (sub.sub_cohort_name === 'T1200') sizeBands.push('T1200');
          else if (sub.sub_cohort_name === 'Other' || sub.sub_cohort_name === 'Small' || sub.sub_cohort_name === 'Direct') {
            sizeBands.push('Direct');
          }
        }
        if (sizeBands.length > 0) {
          filter = { agency_size_band: sizeBands };
        }
      }

      const cohortAPAP = filter 
        ? computeAPAP(currentData.agencies, labelsMap, filter)
        : (currentAPAP || { apap: 0, eligibleCount: 0 }); // Fallback to overall if we can't map

      const subCohortAPAPs = cohortTarget.sub_cohorts?.map(sub => {
        let subFilter: { agency_size_band?: string[] } | undefined;
        if (sub.sub_cohort_name === 'Major') subFilter = { agency_size_band: ['Major'] };
        else if (sub.sub_cohort_name === 'T1200') subFilter = { agency_size_band: ['T1200'] };
        else if (sub.sub_cohort_name === 'Other' || sub.sub_cohort_name === 'Small' || sub.sub_cohort_name === 'Direct') {
          subFilter = { agency_size_band: ['Direct'] };
        }
        
        const subAPAP = subFilter 
          ? computeAPAP(currentData.agencies, labelsMap, subFilter)
          : null;
        
        return {
          sub_cohort_name: sub.sub_cohort_name,
          target_rate: sub.target_adoption_rate,
          current_apap: subAPAP?.apap || 0,
          gap: (subAPAP?.apap || 0) - sub.target_adoption_rate,
          eligible_count: subAPAP?.eligibleCount || 0,
        };
      });

      cohortAPAPs.push({
        cohort_name: cohortTarget.cohort_name,
        target_rate: cohortTarget.target_adoption_rate,
        current_apap: cohortAPAP.apap,
        gap: cohortAPAP.apap - cohortTarget.target_adoption_rate,
        eligible_count: cohortAPAP.eligibleCount || 0,
        sub_cohorts: subCohortAPAPs,
      });
    }

    return cohortAPAPs;
  }, [currentData, baseline, currentAPAP]);

  return (
    <div style={{
      padding: '4rem 2rem',
      maxWidth: '1200px',
      margin: '0 auto',
      minHeight: 'calc(100vh - 80px)',
      background: 'linear-gradient(180deg, var(--surface-1) 0%, var(--surface-2) 100%)',
    }}>
      <div style={{
        background: 'var(--surface-3)',
        padding: '4rem',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        border: `1px solid var(--border-color)`,
      }}>
        {selectedMonthNoData && selectedMonthKeyWhenNoData && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1rem 1.5rem',
            background: 'var(--bg-alert)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--fg-alert)',
            color: 'var(--fg-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}>
            <AlertTriangle size={20} color="var(--fg-alert)" />
            <span style={{ fontSize: 'var(--text-body1-size)' }}>
              No snapshot for {format(parseISO(selectedMonthKeyWhenNoData + '-01'), 'MMM yyyy')}. Upload data for that month or select another month from the dropdown.
            </span>
          </div>
        )}
        {staleSnapshot && currentData && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1rem 1.5rem',
            background: 'var(--bg-alert)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--fg-alert)',
            color: 'var(--fg-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}>
            <AlertTriangle size={20} color="var(--fg-alert)" />
            <span style={{ fontSize: 'var(--text-body1-size)' }}>
              Snapshot computed with older logic — re-upload to refresh.
            </span>
          </div>
        )}
        <div style={{ marginBottom: '3rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem',
          }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)',
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <TrendingUp size={32} color="white" />
            </div>
            <div>
              <h1 style={{
                fontSize: '32px',
                lineHeight: '40px',
                fontWeight: 600,
                marginBottom: '0.25rem',
                color: 'var(--fg-primary)',
              }}>
                Welcome to VR APAP Dashboard
              </h1>
              <p style={{
                fontSize: 'var(--text-body1-size)',
                color: 'var(--fg-secondary)',
                lineHeight: 'var(--text-body1-line)',
              }}>
                Analyze agency adoption, churn, and risk metrics
              </p>
            </div>
          </div>
        </div>

        {/* High-level APAP this month: metric, MoM, bps to goals */}
        {goalProgress && (
          <div style={{
            marginTop: '1.5rem',
            marginBottom: '0.5rem',
            padding: '1.25rem 1.5rem',
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '1.25rem',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                APAP this month
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--fg-primary)' }}>
                {currentAPAP
                  ? `${formatPercentFromParts(currentAPAP.adoptingPoints, currentAPAP.eligiblePoints, 1)}%`
                  : `${goalProgress.current.toFixed(1)}%`}
              </div>
            </div>
            {goalProgress.mom_change !== null && (
              <div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                  MoM change
                </div>
                <div style={{
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  color: goalProgress.mom_change >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}>
                  {goalProgress.mom_change >= 0 ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
                  {goalProgress.mom_change >= 0 ? '+' : ''}{goalProgress.mom_change.toFixed(1)} pp
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                vs High Confidence (42%)
              </div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 600,
                color: goalProgress.gap_to_high_confidence >= 0 ? 'var(--fg-secondary)' : 'var(--fg-live)',
              }}>
                {goalProgress.gap_to_high_confidence >= 0
                  ? `${Math.round(goalProgress.gap_to_high_confidence * 100)} bps below`
                  : `${Math.round(-goalProgress.gap_to_high_confidence * 100)} bps above`}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                vs Hard Climb (46%)
              </div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 600,
                color: goalProgress.gap_to_hard_climb >= 0 ? 'var(--fg-secondary)' : 'var(--fg-alert)',
              }}>
                {goalProgress.gap_to_hard_climb >= 0
                  ? `${Math.round(goalProgress.gap_to_hard_climb * 100)} bps below`
                  : `${Math.round(-goalProgress.gap_to_hard_climb * 100)} bps above`}
              </div>
            </div>
          </div>
        )}

        {/* SIM Engagement – T12 usage goal 180K → 290K, YoY growth */}
        {simEngagement && (
          <div style={{
            marginTop: '2.5rem',
            padding: '1.5rem',
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{ marginBottom: '1rem' }}>
              <h2 style={{
                fontSize: 'var(--text-title-size)',
                fontWeight: 'var(--text-title-weight)',
                margin: '0 0 0.25rem 0',
                color: 'var(--fg-primary)',
              }}>
                SIM Engagement – VR (T10)
              </h2>
              <p style={{
                fontSize: 'var(--text-body2-size)',
                color: 'var(--fg-secondary)',
                margin: 0,
              }}>
                Trailing 12 month Simulator Training completions. Goal: 180K (Nov’25) → 290K (Nov’26). Target: 60% YoY growth.
              </p>
            </div>

            {/* Metrics row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
              alignItems: 'start',
            }}>
              <div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                  T12 completions
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--fg-primary)' }}>
                  {(simEngagement.simT10.t12Total / 1000).toFixed(1)}K
                </div>
              </div>
              {simEngagement.momChange !== null && (
                <div>
                  <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                    MoM vs prior T12
                  </div>
                  <div style={{
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    color: simEngagement.momChange >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}>
                    {simEngagement.momChange >= 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                    {(simEngagement.momChange / 1000).toFixed(1)}K
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                  Progress to goal
                </div>
                <div style={{
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  color: simEngagement.progressPct >= 100 ? 'var(--fg-live)' : 'var(--fg-primary)',
                }}>
                  {Math.min(100, Math.max(0, Math.round(simEngagement.progressPct)))}%
                </div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>
                  (180K → 290K)
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem' }}>
                  This month vs same month last year
                </div>
                <div style={{
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  color: (simEngagement.yoyGrowthPct ?? 0) >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)',
                }}>
                  {simEngagement.yoyGrowthPct != null
                    ? `${simEngagement.yoyGrowthPct >= 0 ? '+' : ''}${simEngagement.yoyGrowthPct.toFixed(0)}% YoY`
                    : '—'}
                </div>
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>
                  {simEngagement.asOfMonthLabel} vs {simEngagement.sameMonthLastYearLabel}
                  {simEngagement.usesDec2024Baseline && (
                    <span style={{ display: 'block', marginTop: '0.125rem' }}>
                      Dec 2024 baseline: 7,262 (T10)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Chart: last 12 months monthly completions + YoY reference where available */}
            {simEngagement.simT10.availableMonths.length > 0 && (() => {
              const asOfDate = parseISO(simEngagement.asOfMonthKey + '-01');
              const monthsToShow: string[] = [];
              for (let i = 0; i < 12; i++) {
                const m = subMonths(asOfDate, 11 - i);
                monthsToShow.push(format(m, 'yyyy-MM'));
              }
              const getPriorYearCompletions = (monthKey: string): number | null => {
                const priorKey = format(subYears(parseISO(monthKey + '-01'), 1), 'yyyy-MM');
                return priorKey === '2024-12' ? DEC_2024_SIM_BASELINE : getSimT10CompletionsForMonth(priorKey);
              };
              const values = monthsToShow.map((key) => simEngagement.simT10.usageByMonth[key] ?? 0);
              const priorYearValues = monthsToShow.map(getPriorYearCompletions);
              const priorNums = priorYearValues.filter((n): n is number => n != null);
              const maxVal = Math.max(...values, ...priorNums, 1);
              const chartHeight = 200;
              const chartWidth = 560;
              const padding = { top: 24, right: 10, bottom: 28, left: 44 };
              const innerWidth = chartWidth - padding.left - padding.right;
              const innerHeight = chartHeight - padding.top - padding.bottom;
              const barW = Math.max(2, (innerWidth / 12) - 4);
              return (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{
                    fontSize: 'var(--text-body2-size)',
                    fontWeight: 'var(--text-subtitle-weight)',
                    color: 'var(--fg-primary)',
                    marginBottom: '0.25rem',
                  }}>
                    Monthly SIM completions (last 12 months)
                  </div>
                  <div style={{
                    fontSize: 'var(--text-caption-size)',
                    color: 'var(--fg-secondary)',
                    marginBottom: '0.5rem',
                  }}>
                    Most recent month ({simEngagement.asOfMonthLabel}):{' '}
                    <strong style={{ color: 'var(--fg-primary)' }}>
                      {simEngagement.currentMonthCompletions.toLocaleString()}
                    </strong>{' '}
                    completions (T10). <span style={{ color: 'var(--fg-secondary)' }}>Dashed line = same month prior year (where available).</span>
                  </div>
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ width: '100%', maxWidth: chartWidth, height: chartHeight }}
                  >
                    {/* X-axis */}
                    <line
                      x1={padding.left}
                      y1={padding.top + innerHeight}
                      x2={padding.left + innerWidth}
                      y2={padding.top + innerHeight}
                      stroke="var(--border-color)"
                      strokeWidth="1"
                    />
                    {/* Bars */}
                    {values.map((v, i) => {
                      const x = padding.left + (i * (innerWidth / 12)) + (innerWidth / 12 - barW) / 2;
                      const h = (v / maxVal) * innerHeight;
                      const y = padding.top + innerHeight - h;
                      const isCurrentMonth = monthsToShow[i] === simEngagement.asOfMonthKey;
                      const priorYear = priorYearValues[i];
                      const priorY = priorYear != null ? padding.top + innerHeight - (priorYear / maxVal) * innerHeight : null;
                      const yoyPct = priorYear != null && priorYear > 0 && v > 0
                        ? ((v - priorYear) / priorYear) * 100
                        : null;
                      return (
                        <g key={monthsToShow[i]}>
                          <rect
                            x={x}
                            y={y}
                            width={barW}
                            height={h}
                            fill={isCurrentMonth ? 'var(--fg-action)' : 'var(--fg-secondary)'}
                            opacity={isCurrentMonth ? 1 : 0.7}
                            rx={2}
                          />
                          {/* Prior-year reference: horizontal dash at same-month-last-year height */}
                          {priorY != null && (
                            <>
                              <line
                                x1={x - 2}
                                x2={x + barW + 2}
                                y1={priorY}
                                y2={priorY}
                                stroke="var(--fg-live)"
                                strokeWidth="1.5"
                                strokeDasharray="4 3"
                                opacity={0.9}
                              />
                              <text
                                x={x + barW / 2}
                                y={Math.max(padding.top + 10, priorY - 4)}
                                textAnchor="middle"
                                fontSize="9"
                                fill="var(--fg-live)"
                                fontWeight="500"
                              >
                                {yoyPct != null ? `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(0)}%` : priorYear != null ? `vs ${(priorYear / 1000).toFixed(1)}K` : '—'}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}
                    {monthsToShow.map((key, i) => {
                      const x = padding.left + (i + 0.5) * (innerWidth / 12);
                      return (
                        <text
                          key={key}
                          x={x}
                          y={chartHeight - 6}
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--fg-secondary)"
                        >
                          {format(parseISO(key + '-01'), 'MMM')}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}
          </div>
        )}

        {/* APAP (Adoption Percentage) Section */}
        {currentAPAP && currentData ? (
          <div style={{
            marginTop: '3rem',
            padding: '1.5rem',
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid var(--border-color)`,
          }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <h2 style={{
                fontSize: 'var(--text-title-size)',
                fontWeight: 'var(--text-title-weight)',
                margin: '0 0 0.5rem 0',
                color: 'var(--fg-primary)',
              }}>
                APAP (Adoption Percentage)
              </h2>
              <p style={{
                fontSize: 'var(--text-body2-size)',
                color: 'var(--fg-secondary)',
                margin: 0,
              }}>
                Weighted adoption: (Adopting Points / Eligible Points) × 100
              </p>
              </div>
            
            {/* APAP Display - Prominent Number */}
            <div style={{
              marginBottom: '1.5rem',
                padding: '1.5rem',
                background: 'var(--surface-3)',
                borderRadius: 'var(--radius-md)',
              border: `2px solid var(--border-color)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem' }}>
                <div style={{ flex: '0 0 380px', textAlign: 'center' }}>
                  <div style={{
                    fontSize: '3rem',
                    fontWeight: 'var(--text-headline-weight)',
                  color: 'var(--fg-primary)',
                    lineHeight: 1,
                    marginBottom: '0.5rem',
                }}>
                    {currentAPAP.apap.toFixed(1)}%
                  </div>
                <div style={{
                    fontSize: 'var(--text-caption-size)',
                    color: 'var(--fg-secondary)',
                    marginBottom: '0.5rem',
                  }}>
                    {currentAPAP.adoptingPoints.toLocaleString()} adopting points / {currentAPAP.eligiblePoints.toLocaleString()} eligible points
                  </div>
                  <div style={{
                    fontSize: 'var(--text-caption-size)',
                    color: 'var(--fg-secondary)',
                    marginBottom: '0.75rem',
                  }}>
                    {currentAPAP.adoptingCount} agencies adopting / {currentAPAP.eligibleCount} eligible
                  </div>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    marginTop: '0.5rem',
                  }}>
                    {/* Change vs Baseline (Nov 2025) */}
                    {baseline?.baseline_apap != null && (
                      <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: 'var(--text-body2-size)',
                        color: currentAPAP.apap >= baseline.baseline_apap ? 'var(--fg-success)' : 'var(--fg-destructive)',
                        padding: '0.5rem 1rem',
                        background: 'var(--surface-2)',
                        borderRadius: 'var(--radius-sm)',
                      }}>
                        {currentAPAP.apap >= baseline.baseline_apap ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                        {(currentAPAP.apap - baseline.baseline_apap).toFixed(1)}pp vs Baseline (Nov 2025)
                      </div>
                    )}
                    {/* Change vs Last Month */}
                    {comparisonAPAP != null && (
                      <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: 'var(--text-body2-size)',
                        color: currentAPAP.apap >= comparisonAPAP.apap ? 'var(--fg-success)' : 'var(--fg-destructive)',
                        padding: '0.5rem 1rem',
                        background: 'var(--surface-2)',
                        borderRadius: 'var(--radius-sm)',
                      }}>
                        {currentAPAP.apap >= comparisonAPAP.apap ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                        {(currentAPAP.apap - comparisonAPAP.apap).toFixed(1)}pp vs Last Month ({currentData?.asOfMonth ? format(subMonths(parseISO(currentData.asOfMonth), 1), 'MMM yyyy') : 'prior'})
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Detailed Metrics */}
                {comparisonAPAP && (
                  <div style={{ flex: '1 1 500px', minWidth: '450px', padding: '1rem' }}>
                      <div style={{
                      fontSize: 'var(--text-body2-size)',
                        fontWeight: 'var(--text-subtitle-weight)',
                        color: 'var(--fg-primary)',
                        marginBottom: '0.5rem',
                      }}>
                      Changes vs Previous Month ({currentData?.asOfMonth ? format(subMonths(parseISO(currentData.asOfMonth), 1), 'MMM yyyy') : 'prior'}) — eligible = cohort ≥6 from that month&apos;s upload
                      </div>
                      <div style={{
                        display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                      }}>
                        <div style={{
                        fontSize: 'var(--text-body2-size)',
                        color: 'var(--fg-primary)',
                      }}>
                        Eligible agencies: {currentAPAP.eligibleCount}
                        <span style={{ 
                          color: currentAPAP.eligibleCount >= comparisonAPAP.eligibleCount ? 'var(--fg-success)' : 'var(--fg-destructive)',
                          marginLeft: '0.25rem'
                        }}>
                          ({currentAPAP.eligibleCount >= comparisonAPAP.eligibleCount ? '+' : ''}{currentAPAP.eligibleCount - comparisonAPAP.eligibleCount})
                        </span>
                        </div>
                        <div style={{
                          fontSize: 'var(--text-body2-size)',
                        color: 'var(--fg-primary)',
                      }}>
                        Adopting agencies: {currentAPAP.adoptingCount}
                        <span style={{ 
                          color: currentAPAP.adoptingCount >= comparisonAPAP.adoptingCount ? 'var(--fg-success)' : 'var(--fg-destructive)',
                          marginLeft: '0.25rem'
                        }}>
                          ({currentAPAP.adoptingCount >= comparisonAPAP.adoptingCount ? '+' : ''}{currentAPAP.adoptingCount - comparisonAPAP.adoptingCount})
                        </span>
                      </div>
                      <div style={{
                        fontSize: 'var(--text-body2-size)',
                        color: 'var(--fg-primary)',
                      }}>
                        Eligible points: {currentAPAP.eligiblePoints.toLocaleString()}
                        <span style={{ 
                          color: currentAPAP.eligiblePoints >= comparisonAPAP.eligiblePoints ? 'var(--fg-success)' : 'var(--fg-destructive)',
                          marginLeft: '0.25rem'
                        }}>
                          ({currentAPAP.eligiblePoints >= comparisonAPAP.eligiblePoints ? '+' : ''}{(currentAPAP.eligiblePoints - comparisonAPAP.eligiblePoints).toLocaleString()})
                        </span>
                        </div>
                        <div style={{
                              fontSize: 'var(--text-body2-size)',
                        color: 'var(--fg-primary)',
                      }}>
                        Adopting points: {currentAPAP.adoptingPoints.toLocaleString()}
                                <span style={{
                          color: currentAPAP.adoptingPoints >= comparisonAPAP.adoptingPoints ? 'var(--fg-success)' : 'var(--fg-destructive)',
                          marginLeft: '0.25rem'
                                }}>
                          ({currentAPAP.adoptingPoints >= comparisonAPAP.adoptingPoints ? '+' : ''}{(currentAPAP.adoptingPoints - comparisonAPAP.adoptingPoints).toLocaleString()})
                                </span>
                              </div>
                            </div>
                        </div>
                      )}
                    </div>
                </div>

                {/* Who dropped out of eligibility (Dec → Jan) — only when comparing to previous month */}
                {droppedEligibility && (
                  <div style={{
                    marginTop: '1.5rem',
                    padding: '1rem',
                    background: 'var(--surface-3)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}>
                    <div style={{
                      fontSize: 'var(--text-body2-size)',
                      fontWeight: 'var(--text-subtitle-weight)',
                      color: 'var(--fg-primary)',
                      marginBottom: '0.5rem',
                    }}>
                      Agencies that dropped out of eligibility ({droppedEligibility.prevMonthKey} → {droppedEligibility.currentMonthKey})
                    </div>
                    <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.75rem' }}>
                      Eligible = cohort ≥6 from that month&apos;s agency upload. These were eligible in the previous month but not in the current month.
                    </p>
                    {droppedEligibility.dropped.length === 0 ? (
                      <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-success)' }}>
                        No agencies dropped out of eligibility. If the summary above shows a decrease in eligible count, the comparison may be using different data (e.g. stored counts from an older upload).
                      </p>
                    ) : (
                      <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-caption-size)' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Agency ID</th>
                              <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Agency name</th>
                              <th style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 600 }}>Footprint / Officer count</th>
                              <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {droppedEligibility.dropped.map((d) => (
                              <tr key={d.agency_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={{ padding: '0.5rem' }}>{d.agency_id}</td>
                                <td style={{ padding: '0.5rem' }}>{d.agency_name}</td>
                                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{d.officer_count != null ? d.officer_count.toLocaleString() : '—'}</td>
                                <td style={{ padding: '0.5rem', color: 'var(--fg-secondary)' }}>{d.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
          </div>
        ) : null}

        {/* APAP Growth Chart - Show if we have at least baseline or current data */}
        <APAPGrowthChartSection 
          apapHistory={apapHistory}
          baseline={baseline}
          currentAPAP={currentAPAP}
          currentData={currentData}
        />

        <div style={{
          marginTop: '3rem',
          padding: '2rem',
          background: 'linear-gradient(135deg, var(--surface-2) 0%, rgba(4, 93, 210, 0.05) 100%)',
          borderRadius: 'var(--radius-md)',
          border: `1px solid var(--border-color)`,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}>
            <BarChart3 size={20} color="var(--fg-action)" />
            <h2 style={{
              fontSize: 'var(--text-subtitle-size)',
              fontWeight: 'var(--text-subtitle-weight)',
              color: 'var(--fg-primary)',
            }}>
              Quick Start Guide
            </h2>
          </div>
          <ol style={{
            fontSize: 'var(--text-body2-size)',
            color: 'var(--fg-secondary)',
            marginLeft: '1.5rem',
            lineHeight: '2',
          }}>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <FileSpreadsheet size={16} color="var(--fg-action)" style={{ marginTop: '2px', flexShrink: 0 }} />
              <span>Upload your <strong style={{ color: 'var(--fg-action)' }}>Agencies.xlsx</strong> file with agency master data</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <FileSpreadsheet size={16} color="var(--fg-action)" style={{ marginTop: '2px', flexShrink: 0 }} />
              <span>Upload one or more <strong style={{ color: 'var(--fg-action)' }}>telemetry .xlsx</strong> files with usage data</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <CheckCircle2 size={16} color="var(--fg-success)" style={{ marginTop: '2px', flexShrink: 0 }} />
              <span>Review validation results and data quality reports</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <AlertTriangle size={16} color="var(--fg-alert)" style={{ marginTop: '2px', flexShrink: 0 }} />
              <span>Navigate to Action List to see agencies flagged for attention</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// Client-side only chart section component to prevent hydration errors
function APAPGrowthChartSection({
  apapHistory,
  baseline,
  currentAPAP,
  currentData,
}: {
  apapHistory: Array<{ month: string; apap: number; label: string }>;
  baseline: BaselineData | null;
  currentAPAP: { apap: number; adoptingPoints: number; eligiblePoints: number; eligibleCount: number; adoptingCount: number } | null;
  currentData: { agencies: Agency[]; agencyLabels: [string, AgencyWithLabel][]; asOfMonth: string | null } | null;
}) {
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  if (!isMounted) {
    return (
      <div style={{
        marginTop: '3rem',
        padding: '2rem',
        background: 'var(--surface-2)',
        borderRadius: 'var(--radius-md)',
        border: `1px solid var(--border-color)`,
        minHeight: '400px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ color: 'var(--fg-secondary)' }}>Loading chart...</div>
      </div>
    );
  }
  
  // Build chart data - ensure we always have data if baseline or currentAPAP exists
  let chartData = apapHistory;
  if (chartData.length === 0) {
    if (baseline && baseline.baseline_apap !== undefined) {
      chartData = [{
        month: '2025-11',
        apap: baseline.baseline_apap,
        label: 'Nov 2025 (Baseline)',
      }];
    }
    if (currentAPAP && currentData) {
      const viewingMonth = getCurrentMonth();
      const result = getProcessedDataParsed(viewingMonth ?? undefined);
      if (result?.data?.asOfMonth) {
        const currentMonthDate = parseISO(result.data.asOfMonth as string);
        const currentMonthKey = format(currentMonthDate, 'yyyy-MM');
        const currentPoint = {
          month: currentMonthKey,
          apap: currentAPAP.apap,
          label: format(currentMonthDate, 'MMM yyyy'),
        };
        if (!chartData.some(h => h.month === currentMonthKey)) {
          chartData = [...chartData, currentPoint];
        }
      }
    }
  }
  
  // Only show chart if we have at least one data point
  if (chartData.length === 0) return null;
  
  return (
    <div style={{
      marginTop: '3rem',
      padding: '2rem',
      background: 'var(--surface-2)',
      borderRadius: 'var(--radius-md)',
      border: `1px solid var(--border-color)`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginBottom: '1.5rem',
      }}>
        <TrendingUp size={24} color="var(--fg-action)" />
        <h2 style={{
          fontSize: 'var(--text-title-size)',
          fontWeight: 'var(--text-title-weight)',
          color: 'var(--fg-primary)',
        }}>
          APAP Growth (Month over Month)
        </h2>
      </div>
      <APAPGrowthChart data={chartData} />
    </div>
  );
}

type GoalProgressType = {
  current: number;
  baseline: number | null;
  previous_month: number | null;
  mom_change: number | null;
  high_confidence: number;
  hard_climb: number;
  gap_to_high_confidence: number;
  gap_to_hard_climb: number;
  progress_from_baseline: number | null;
  progress_to_high_confidence: number;
  progress_to_hard_climb: number;
};

type CurrentAPAPType = {
  apap: number;
  adoptingPoints: number;
  eligiblePoints: number;
  eligibleCount: number;
  adoptingCount: number;
};

// APAP Trend Chart Component for Home Page (simplified, no cohort filters)
function APAPTrendChartHome({
  currentAPAP,
  apapHistory,
}: {
  currentAPAP: number;
  apapHistory: Array<{ month: string; apap: number; label: string }>;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  // Use last 6 months from history
  const recentHistory = apapHistory.slice(-6);
  
  if (recentHistory.length === 0) {
  return (
    <div style={{
        padding: '1rem',
        textAlign: 'center',
        color: 'var(--fg-secondary)',
        fontSize: 'var(--text-body2-size)',
      }}>
        No trend data available
      </div>
    );
  }
  
  const chartHeight = 200;
  const chartWidth = 500;
  const padding = { top: 15, right: 15, bottom: 35, left: 50 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  
  const values = recentHistory.map(h => h.apap);
  const minValue = Math.max(0, Math.min(...values) - 5);
  const maxValue = Math.min(100, Math.max(...values) + 5);
  const valueRange = maxValue - minValue;
  
  const xStep = innerWidth / Math.max(1, recentHistory.length - 1);
  
  const points = recentHistory.map((entry, i) => {
    const x = padding.left + (i * xStep);
    const y = padding.top + innerHeight - ((entry.apap - minValue) / valueRange * innerHeight);
    return { x, y, ...entry };
  });
  
  const pathData = points.map((p, i) => 
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
  ).join(' ');
  
  return (
    <div style={{ position: 'relative', overflow: 'visible' }}>
          <div style={{
        fontSize: 'var(--text-body2-size)',
            fontWeight: 'var(--text-subtitle-weight)',
        color: 'var(--fg-primary)',
        marginBottom: '0.5rem',
        textAlign: 'center',
      }}>
        APAP Trend (Last 6 Months)
                </div>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: chartHeight, overflow: 'visible' }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {/* Y-axis */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + innerHeight}
          stroke="var(--border-color)"
          strokeWidth="1"
        />
        
        {/* Y-axis labels */}
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + innerHeight - (ratio * innerHeight);
          const value = minValue + (valueRange * ratio);
          return (
            <text
              key={ratio}
              x={padding.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--fg-secondary)"
            >
              {Math.round(value)}%
            </text>
          );
        })}
        
        {/* X-axis */}
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight}
          stroke="var(--border-color)"
          strokeWidth="1"
        />
        
        {/* X-axis labels (show first, middle, last) */}
        {recentHistory.length > 0 && (
          <>
            <text
              x={padding.left}
              y={chartHeight - 8}
              textAnchor="middle"
              fontSize="11"
              fill="var(--fg-secondary)"
            >
              {recentHistory[0].label.split(' ')[0]}
            </text>
            {recentHistory.length > 1 && (
              <text
                x={padding.left + innerWidth}
                y={chartHeight - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--fg-secondary)"
              >
                {recentHistory[recentHistory.length - 1].label.split(' ')[0]}
              </text>
            )}
          </>
        )}
        
        {/* Trend line */}
        <path
          d={pathData}
          fill="none"
          stroke="var(--fg-action)"
          strokeWidth="3"
        />
        
        {/* Data points */}
        {points.map((point, i) => {
          const isHovered = hoveredIndex === i;
          const isCurrent = i === points.length - 1;
          
          return (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.y}
                r={isHovered || isCurrent ? 5 : 3}
                fill={isCurrent ? 'var(--fg-action)' : 'var(--fg-action)'}
                stroke="white"
                strokeWidth={isHovered || isCurrent ? 2 : 1}
                onMouseEnter={() => setHoveredIndex(i)}
                style={{ cursor: 'pointer' }}
              />
              {isHovered && (
                <g>
                  <rect
                    x={point.x - 52}
                    y={point.y - 40}
                    width="104"
                    height="36"
                    fill="var(--surface-3)"
                    stroke="var(--border-color)"
                    rx="4"
                  />
                  <text
                    x={point.x}
                    y={point.y - 24}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--fg-primary)"
                    fontWeight="bold"
                  >
                    {point.label}
                  </text>
                  <text
                    x={point.x}
                    y={point.y - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--fg-primary)"
                  >
                    {point.apap.toFixed(1)}%
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}


function APAPGrowthChart({ data }: { data: Array<{ month: string; apap: number; label: string }> }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  if (data.length === 0) {
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: 'var(--fg-secondary)',
      }}>
        No historical data available
      </div>
    );
  }
  
  // Prevent hydration mismatch by only rendering chart on client
  // Return a placeholder with the same dimensions during SSR
  if (!isMounted) {
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: 'var(--fg-secondary)',
        minHeight: '300px',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div>Loading chart...</div>
      </div>
    );
  }

  const chartHeight = 300;
  const chartWidth = 900; // Increased to accommodate goal labels
  const padding = { top: 20, right: 100, bottom: 60, left: 60 }; // Increased right padding for goal labels
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Fixed y-axis range: 30% to 50%
  const minAPAP = 30;
  const maxAPAP = 50;
  const yRange = maxAPAP - minAPAP; // 20
  
  // Goal lines
  const highConfidenceGoal = 42;
  const hardClimbGoal = 46;

  // Calculate x positions
  const xStep = innerWidth / Math.max(1, data.length - 1);
  
  // Generate path for line
  const points = data.map((d, i) => {
    const x = padding.left + (i * xStep);
    const y = padding.top + innerHeight - ((d.apap - minAPAP) / yRange * innerHeight);
    return { x, y, ...d };
  });

  // Calculate MoM changes for each segment
  const segments = points.map((p, i) => {
    if (i === 0) return null;
    const prevPoint = points[i - 1];
    const momChange = p.apap - prevPoint.apap;
    return {
      start: prevPoint,
      end: p,
      momChange,
    };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  // Segment color by MoM: positive = green, negative = red (distinct from goal lines)
  const getColorForChange = (change: number): string => {
    if (change > 0) return 'var(--fg-success)';
    if (change < 0) return 'var(--fg-destructive)';
    return 'var(--fg-secondary)';
  };

  // Y-axis ticks (30%, 32%, 34%, 36%, 38%, 40%, 42%, 44%, 46%, 48%, 50%)
  const yTickValues = [30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50];

  return (
    <div style={{ position: 'relative', width: '100%', overflow: 'visible' }}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: `${chartHeight}px`,
          minWidth: `${chartWidth}px`,
          overflow: 'visible',
        }}
      >
        {/* Grid lines */}
        {yTickValues.map((value, i) => {
          const y = padding.top + innerHeight - ((value - minAPAP) / yRange * innerHeight);
          return (
            <line
              key={`grid-${i}`}
              x1={padding.left}
              y1={y}
              x2={padding.left + innerWidth}
              y2={y}
              stroke="var(--border-color)"
              strokeWidth="1"
              opacity={0.3}
            />
          );
        })}

        {/* Goal lines: purple (HC) and blue (Hard Climb) so distinct from green/red trend */}
        <line
          x1={padding.left}
          y1={padding.top + innerHeight - ((highConfidenceGoal - minAPAP) / yRange * innerHeight)}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight - ((highConfidenceGoal - minAPAP) / yRange * innerHeight)}
          stroke="var(--fg-live)"
          strokeWidth="2"
          strokeDasharray="6,4"
          opacity={0.85}
        />
        <line
          x1={padding.left}
          y1={padding.top + innerHeight - ((hardClimbGoal - minAPAP) / yRange * innerHeight)}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight - ((hardClimbGoal - minAPAP) / yRange * innerHeight)}
          stroke="var(--fg-action)"
          strokeWidth="2"
          strokeDasharray="4,6"
          opacity={0.9}
        />

        {/* Y-axis labels */}
        {yTickValues.map((value, i) => {
          const y = padding.top + innerHeight - ((value - minAPAP) / yRange * innerHeight);
          const isGoalLine = Math.abs(value - highConfidenceGoal) < 0.1 || Math.abs(value - hardClimbGoal) < 0.1;
          const goalColor = Math.abs(value - highConfidenceGoal) < 0.1 ? 'var(--fg-live)' : 'var(--fg-action)';
          return (
            <text
              key={`y-label-${i}`}
              x={padding.left - 10}
              y={y + 4}
              textAnchor="end"
              fontSize="12"
              fill={isGoalLine ? goalColor : 'var(--fg-secondary)'}
              fontWeight={isGoalLine ? '600' : '400'}
            >
              {value.toFixed(1)}%
            </text>
          );
        })}
        
        {/* Goal line labels on the right (match line colors) */}
        <text
          x={padding.left + innerWidth + 10}
          y={padding.top + innerHeight - ((highConfidenceGoal - minAPAP) / yRange * innerHeight) + 4}
          fontSize="11"
          fill="var(--fg-live)"
          fontWeight="600"
        >
          Goal: 42%
        </text>
        <text
          x={padding.left + innerWidth + 10}
          y={padding.top + innerHeight - ((hardClimbGoal - minAPAP) / yRange * innerHeight) + 4}
          fontSize="11"
          fill="var(--fg-action)"
          fontWeight="600"
        >
          Goal: 46%
        </text>

        {/* Line segments with gradient colors based on MoM changes */}
        {segments.length > 0 && segments.map((segment, i) => {
          const color = getColorForChange(segment.momChange);
          return (
            <line
              key={`segment-${i}-${segment.start.month}-${segment.end.month}`}
              x1={segment.start.x}
              y1={segment.start.y}
              x2={segment.end.x}
              y2={segment.end.y}
              stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
          );
        })}

        {/* Data points */}
        {points.map((point, i) => {
          const isBaseline = point.label.includes('Baseline');
          const isHovered = hoveredIndex === i;
          return (
            <g key={`point-${i}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={isHovered ? 6 : isBaseline ? 5 : 4}
                fill={isBaseline ? 'var(--fg-secondary)' : 'var(--fg-action)'}
                stroke="var(--surface-3)"
                strokeWidth={isHovered ? 3 : 2}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
              
              {/* Tooltip */}
              {isHovered && (
                <g>
                  <rect
                    x={point.x - 70}
                    y={point.y - 56}
                    width="140"
                    height="48"
                    fill="var(--surface-2)"
                    stroke="var(--border-color)"
                    strokeWidth="1"
                    rx="4"
                  />
                  <text
                    x={point.x}
                    y={point.y - 40}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="600"
                    fill="var(--fg-primary)"
                  >
                    {point.label}
                  </text>
                  <text
                    x={point.x}
                    y={point.y - 22}
                    textAnchor="middle"
                    fontSize="14"
                    fontWeight="600"
                    fill="var(--fg-action)"
                  >
                    {point.apap.toFixed(1)}%
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {points.map((point, i) => {
          // Show all labels if few points, otherwise show every other or every third
          const showLabel = data.length <= 6 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1;
          if (!showLabel) return null;
          
          return (
            <text
              key={`x-label-${i}`}
              x={point.x}
              y={chartHeight - padding.bottom + 20}
              textAnchor="middle"
              fontSize="11"
              fill="var(--fg-secondary)"
              transform={`rotate(-45 ${point.x} ${chartHeight - padding.bottom + 20})`}
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

