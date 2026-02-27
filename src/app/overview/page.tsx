'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { Agency, AgencyWithLabel, TelemetryMonthly } from '@/lib/schema';
import type { UsageRollups } from '@/lib/usageRollups';
import { computeAPAP, computeKPICounts, computeKPICountsAndPoints, getHistoricalEntryForComparison, getHistoricalData, type KPIMetricCountsAndPoints } from '@/lib/history';
import { getBaselineData, type BaselineAgency } from '@/lib/baseline';
import type { CohortSummary, CohortDimension } from '@/lib/aggregate';
import { aggregateCohorts } from '@/lib/aggregate';
import { getProcessedData, getCurrentMonth } from '@/lib/storage';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { TrendingUp, BarChart3, CheckCircle2, AlertTriangle, XCircle, HelpCircle, ArrowUp, ArrowDown, Users, Filter, Target, Crosshair } from 'lucide-react';
import { format, parseISO, subMonths } from 'date-fns';
import { computeSimT10Usage } from '@/lib/usageRollups';
import { GOAL_MODEL_CONFIG, type EligBucket, type LineSize } from '@/config/goal_model_config';
import {
  computeStructuralVarianceFromConfig,
  computeDriverProgressFromConfig,
  computeAPAPForStructuralSlice,
  getGoalRatesForSlice,
  getNovemberBaselineAPAPForSlice,
  getEligBucketFromConfig,
  getLineSizeFromConfig,
  type ProcessedMonthData,
} from '@/lib/goalProgressFromConfig';

type StoredData = {
  agencies: Agency[];
  agencyLabels: [string, AgencyWithLabel][];
  nearEligible: Agency[];
  dataQuality: any;
  asOfMonth: string | null;
  asOfMonthKey?: string | null;
  cohortSummaries: Record<string, any[]>;
  usageRollups?: UsageRollups;
  simTelemetry: any[];
  allTelemetry?: any[];
};

type ComparisonType = 'last_month' | 'last_quarter' | 'last_year' | null;

export default function OverviewPage() {
  const pathname = usePathname();
  const [data, setData] = useState<StoredData | null>(null);
  const [comparisonType, setComparisonType] = useState<ComparisonType>('last_month');
  
  const [apapCohortFilter, setApapCohortFilter] = useState<{
    time_since_purchase_cohort?: string[];
    agency_size_band?: string[];
  }>({});

  const [selectedDimension, setSelectedDimension] = useState<CohortDimension>('time_since_purchase_cohort');
  const [filterPurchaseCohort, setFilterPurchaseCohort] = useState<string>('all');
  const [filterSizeBand, setFilterSizeBand] = useState<string>('all');

  // APAP Goal Progress: filters (eligibility bucket × agency size)
  const ELIG_BUCKETS: EligBucket[] = ['6_12', '13_18', '19_24', '25_plus'];
  const LINE_SIZES: LineSize[] = ['Major', 'T1200', 'Direct'];
  const [goalProgressEligFilter, setGoalProgressEligFilter] = useState<EligBucket[]>(() => [...ELIG_BUCKETS]);
  const [goalProgressLineSizeFilter, setGoalProgressLineSizeFilter] = useState<LineSize[]>(() => [...LINE_SIZES]);


  // Re-load from storage when pathname changes; use viewing month so we show latest stored data for that month
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
        })) : [];
        const allTelemetry = parsed.allTelemetry ? parsed.allTelemetry.map((t: any) => ({
          ...t,
          month: new Date(t.month),
        })) : [];
        setData({ ...parsed, agencyLabels: Array.from(labelsMap.entries()), simTelemetry, allTelemetry });
      } catch (err) {
        console.error('Failed to parse stored data:', err);
      }
    }
  }, [pathname]);

  /** Robust month key for comparisons (supports ISO asOfMonth or explicit asOfMonthKey). */
  const currentMonthKey = useMemo((): string | null => {
    if (!data) return null;
    const explicit = (data.asOfMonthKey ?? null) as string | null;
    if (explicit && typeof explicit === 'string' && /^\d{4}-\d{2}$/.test(explicit)) return explicit;
    const raw = data.asOfMonth;
    if (!raw) return null;
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    try {
      return format(parseISO(raw), 'yyyy-MM');
    } catch {
      return null;
    }
  }, [data]);

  // Get unique values for cohort filters
  const labelsMap = useMemo(() => {
    if (!data) return new Map<string, AgencyWithLabel>();
    return new Map(data.agencyLabels);
  }, [data]);

  const allAgenciesWithLabels = useMemo(() => {
    if (!data) return [];
    // Filter: Only show T10 customers
    return data.agencies
      .filter((agency) => agency.cew_type === 'T10')
      .map((agency) => labelsMap.get(agency.agency_id))
      .filter((item): item is AgencyWithLabel => item !== undefined);
  }, [data, labelsMap]);

  const uniquePurchaseCohorts = useMemo(() => {
    return Array.from(new Set(
      allAgenciesWithLabels.map((a) => a.cohorts.purchase_cohort)
    ))
    .filter(cohort => cohort !== 'Ineligible' && cohort !== 'Ineligible (0–5 months)') // Exclude Ineligible from filter options
    .sort();
  }, [allAgenciesWithLabels]);

  const uniqueSizeBands = useMemo(() => {
    const sizeBands = Array.from(new Set(
      allAgenciesWithLabels.map((a) => a.cohorts.agency_size_band)
    ));
    // Order: Major, T1200, Direct, Unknown (and any others at the end)
    const order = ['Major', 'T1200', 'Direct', 'Unknown (No officer count)'];
    return sizeBands.sort((a, b) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      // If both are in the order, sort by order index
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      // If only one is in the order, prioritize it
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      // If neither is in the order, sort alphabetically
      return a.localeCompare(b);
    });
  }, [allAgenciesWithLabels]);

  // Filter agencies based on other cohort filters (if not the selected dimension)
  const filteredAgencies = useMemo(() => {
    if (!data) return [];
    // FILTER: Only include T10 customers
    let filtered = data.agencies.filter((agency) => agency.cew_type === 'T10');
    
    if (selectedDimension !== 'time_since_purchase_cohort' && filterPurchaseCohort !== 'all') {
      filtered = filtered.filter((a) => a.purchase_cohort === filterPurchaseCohort);
    }
    
    if (selectedDimension !== 'agency_size_band' && filterSizeBand !== 'all') {
      filtered = filtered.filter((a) => a.agency_size_band === filterSizeBand);
    }
    
    return filtered;
  }, [data, selectedDimension, filterPurchaseCohort, filterSizeBand]);

  // Get summaries for filtered agencies
  const filteredSummaries = useMemo(() => {
    if (!data) return [];
    
    // Check if we have other cohort filters applied
    const hasOtherFilters = 
      (selectedDimension !== 'time_since_purchase_cohort' && filterPurchaseCohort !== 'all') ||
      (selectedDimension !== 'agency_size_band' && filterSizeBand !== 'all');
    
    // Use original cohort summaries if available
    let originalSummaries = data.cohortSummaries?.[selectedDimension] || [];
    
    // If summaries are missing, recompute them from available data
    if (originalSummaries.length === 0 && labelsMap.size > 0) {
      const agenciesToUse = hasOtherFilters ? filteredAgencies : data.agencies;
      originalSummaries = aggregateCohorts(agenciesToUse, labelsMap, selectedDimension);
    }
    
    if (originalSummaries.length === 0) return [];
    
    // If we have other filters applied, filter summaries to only show cohorts that match filtered agencies
    if (hasOtherFilters && filteredAgencies.length > 0) {
      const getCohortValue = (agency: Agency, dim: CohortDimension): string => {
        switch (dim) {
          case 'time_since_purchase_cohort': return agency.purchase_cohort || 'Unknown';
          case 'agency_size_band': return agency.agency_size_band || 'Unknown';
          default: return 'Unknown';
        }
      };
      
      const filteredCohortValues = new Set(
        filteredAgencies.map(a => getCohortValue(a, selectedDimension))
      );
      
      return originalSummaries.filter(summary => 
        filteredCohortValues.has(summary.cohort_value)
      );
    }
    
    // No other filters - show all summaries
    return originalSummaries;
  }, [data, filteredAgencies, selectedDimension, labelsMap, filterPurchaseCohort, filterSizeBand]);

  // Initialize filters with all values selected when data loads
  useEffect(() => {
    if (uniquePurchaseCohorts.length > 0 && uniqueSizeBands.length > 0) {
      // Only initialize if filters are currently empty (first load)
      const isEmpty = 
        (!apapCohortFilter.time_since_purchase_cohort || apapCohortFilter.time_since_purchase_cohort.length === 0) &&
        (!apapCohortFilter.agency_size_band || apapCohortFilter.agency_size_band.length === 0);
      
      if (isEmpty) {
        setApapCohortFilter({
          time_since_purchase_cohort: [...uniquePurchaseCohorts],
          agency_size_band: [...uniqueSizeBands],
        });
        } else {
        // Clean up any "Ineligible" that might have been selected previously
        const currentCohorts = apapCohortFilter.time_since_purchase_cohort || [];
        const filteredCohorts = currentCohorts.filter(c => c !== 'Ineligible' && c !== 'Ineligible (0–5 months)');
        if (filteredCohorts.length !== currentCohorts.length) {
          setApapCohortFilter(prev => ({
            ...prev,
            time_since_purchase_cohort: filteredCohorts.length > 0 ? filteredCohorts : [...uniquePurchaseCohorts],
          }));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniquePurchaseCohorts.length, uniqueSizeBands.length]);

  // Overall APAP: same calculation as Home page (no filters). Use this for the primary APAP % so it matches across pages.
  const overallAPAP = useMemo(() => {
    if (!data?.agencies) return null;
    return computeAPAP(data.agencies, labelsMap);
  }, [data?.agencies, labelsMap]);

  // Overall APAP comparison (same period logic as Home) so overall % and MoM match across pages
  const overallComparisonAPAP = useMemo(() => {
    if (!data?.agencies || !comparisonType || !data?.asOfMonth || !overallAPAP) return null;
    const currentMonthDate = parseISO(data.asOfMonth);
    let comparisonMonthDate: Date;
    if (comparisonType === 'last_month') comparisonMonthDate = subMonths(currentMonthDate, 1);
    else if (comparisonType === 'last_quarter') comparisonMonthDate = subMonths(currentMonthDate, 3);
    else if (comparisonType === 'last_year') comparisonMonthDate = subMonths(currentMonthDate, 12);
    else return null;
    const comparisonMonthKey = format(comparisonMonthDate, 'yyyy-MM');
    const baseline = getBaselineData();
    if (comparisonMonthKey === '2025-11' && baseline?.baseline_apap !== undefined) {
      const currentAgenciesMap = new Map<string | number, Agency>();
      for (const agency of data.agencies.filter((a) => a.cew_type === 'T10')) {
        currentAgenciesMap.set(String(agency.agency_id), agency);
        const n = Number(agency.agency_id);
        if (!isNaN(n)) currentAgenciesMap.set(n, agency);
      }
      let eligibleCount = 0, adoptingCount = 0, eligiblePoints = 0, adoptingPoints = 0;
      for (const [agencyId, baselineAgency] of baseline.agencies.entries()) {
        const currentAgency = currentAgenciesMap.get(String(agencyId)) ?? (typeof agencyId === 'number' ? currentAgenciesMap.get(agencyId) : undefined);
        if (!currentAgency || currentAgency.cew_type !== 'T10') continue;
        const points = baselineAgency.officer_count ?? currentAgency.officer_count ?? 0;
        eligibleCount++;
        eligiblePoints += points;
        if (baselineAgency.is_adopting) {
          adoptingCount++;
          adoptingPoints += points;
        }
      }
      return { apap: baseline.baseline_apap, adoptingPoints, eligiblePoints, adoptingCount, eligibleCount };
    }
    const historicalEntry = getHistoricalEntryForComparison(currentMonthDate, comparisonType);
    if (!historicalEntry) return null;
    if (historicalEntry.apap != null && historicalEntry.apapEligibleCount != null && historicalEntry.apapEligiblePoints != null && historicalEntry.apapAdoptingCount != null && historicalEntry.apapAdoptingPoints != null) {
      return {
        apap: historicalEntry.apap,
        eligibleCount: historicalEntry.apapEligibleCount,
        eligiblePoints: historicalEntry.apapEligiblePoints!,
        adoptingCount: historicalEntry.apapAdoptingCount,
        adoptingPoints: historicalEntry.apapAdoptingPoints!,
      };
    }
    if (historicalEntry.agencyLabels) {
      const historicalLabelsMap = Array.isArray(historicalEntry.agencyLabels)
        ? new Map(historicalEntry.agencyLabels as [string, AgencyWithLabel][])
        : new Map(Array.from((historicalEntry.agencyLabels as Map<string, AgencyWithLabel>).entries()));
      return computeAPAP(data.agencies, historicalLabelsMap);
    }
    return null;
  }, [data?.agencies, data?.asOfMonth, comparisonType, overallAPAP]);

  // Compute APAP with cohort filters (for comparison / filtered views)
  // When no filter or "all" selected, use overall APAP (same as Home) so numbers align
  const currentAPAP = useMemo(() => {
    if (!data?.agencies) return null;
    
    const hasSelections =
      (apapCohortFilter.time_since_purchase_cohort?.length ?? 0) > 0 ||
      (apapCohortFilter.agency_size_band?.length ?? 0) > 0;
    const allSelected =
      hasSelections &&
      (apapCohortFilter.time_since_purchase_cohort?.length === uniquePurchaseCohorts.length) &&
      (apapCohortFilter.agency_size_band?.length === uniqueSizeBands.length);
    
    // No selections or all cohorts selected: use overall APAP (same as Home page)
    if (!hasSelections || allSelected) {
      return computeAPAP(data.agencies, labelsMap);
    }
    
    const filter = apapCohortFilter;
    return computeAPAP(data.agencies, labelsMap, filter);
  }, [data, labelsMap, apapCohortFilter, uniquePurchaseCohorts.length, uniqueSizeBands.length]);

  // Get comparison data
  const comparisonData = useMemo(() => {
    if (!data?.asOfMonth || !comparisonType) return null;
    
    const currentAsOfMonth = parseISO(data.asOfMonth);
    const historicalEntry = getHistoricalEntryForComparison(currentAsOfMonth, comparisonType);
    
    if (!historicalEntry) return null;
    
    return {
      kpiCounts: historicalEntry.agencyLabels
        ? computeKPICounts(historicalEntry.agencyLabels)
        : null,
      eligibleCount: historicalEntry.apapEligibleCount ?? null,
      kpiCountsAndPoints: historicalEntry.kpiCountsAndPoints ?? null,
      asOfMonth: historicalEntry.asOfMonth,
      agencyLabels: historicalEntry.agencyLabels,
      usageRollups: historicalEntry.usageRollups,
    };
  }, [data, comparisonType]);

  // Compute comparison APAP with the same cohort filters
  // When no filter, use same logic as Home so numbers align
  const comparisonAPAP = useMemo(() => {
    if (!data?.agencies || !comparisonType || !data?.asOfMonth || !currentAPAP) return null;
    
    const hasSelections =
      (apapCohortFilter.time_since_purchase_cohort?.length ?? 0) > 0 ||
      (apapCohortFilter.agency_size_band?.length ?? 0) > 0;
    const allSelected =
      hasSelections &&
      (apapCohortFilter.time_since_purchase_cohort?.length === uniquePurchaseCohorts.length) &&
      (apapCohortFilter.agency_size_band?.length === uniqueSizeBands.length);
    
    const currentMonthDate = parseISO(data.asOfMonth);
    let comparisonMonthDate: Date;
    if (comparisonType === 'last_month') {
      comparisonMonthDate = subMonths(currentMonthDate, 1);
    } else if (comparisonType === 'last_quarter') {
      comparisonMonthDate = subMonths(currentMonthDate, 3);
    } else if (comparisonType === 'last_year') {
      comparisonMonthDate = subMonths(currentMonthDate, 12);
    } else {
      return null;
    }
    const comparisonMonthKey = format(comparisonMonthDate, 'yyyy-MM');
    const baseline = getBaselineData();

    // No filter or all cohorts selected: use overall comparison (same as Home page)
    if (!hasSelections || allSelected) {
      if (comparisonMonthKey === '2025-11' && baseline && baseline.baseline_apap !== undefined) {
        const currentAgenciesMap = new Map<string | number, Agency>();
        for (const agency of data.agencies.filter(a => a.cew_type === 'T10')) {
          const idStr = String(agency.agency_id);
          const idNum = Number(agency.agency_id);
          currentAgenciesMap.set(idStr, agency);
          if (!isNaN(idNum)) currentAgenciesMap.set(idNum, agency);
        }
        let eligibleCount = 0, adoptingCount = 0, eligiblePoints = 0, adoptingPoints = 0;
        for (const [agencyId, baselineAgency] of baseline.agencies.entries()) {
          const agencyIdStr = String(agencyId);
          const agencyIdNum = typeof agencyId === 'number' ? agencyId : Number(agencyId);
          const currentAgency = currentAgenciesMap.get(agencyIdStr) ||
            (typeof agencyIdNum === 'number' && !isNaN(agencyIdNum) ? currentAgenciesMap.get(agencyIdNum) : undefined);
          if (!currentAgency || currentAgency.cew_type !== 'T10') continue;
          const points = baselineAgency.officer_count ?? currentAgency.officer_count ?? 0;
          eligibleCount++;
          eligiblePoints += points;
          if (baselineAgency.is_adopting) {
            adoptingCount++;
            adoptingPoints += points;
          }
        }
        return {
          apap: baseline.baseline_apap,
          adoptingPoints,
          eligiblePoints,
          adoptingCount,
          eligibleCount,
        };
      }
      const historicalEntry = getHistoricalEntryForComparison(currentMonthDate, comparisonType);
      if (!historicalEntry) return null;
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
      if (historicalEntry.agencyLabels) {
        const historicalLabelsMap = Array.isArray(historicalEntry.agencyLabels)
          ? new Map(historicalEntry.agencyLabels as [string, AgencyWithLabel][])
          : new Map(Array.from((historicalEntry.agencyLabels as Map<string, AgencyWithLabel>).entries()));
        return computeAPAP(data.agencies, historicalLabelsMap);
      }
      return null;
    }

    // Apply the same cohort filter to historical comparison
    const filter = Object.keys(apapCohortFilter).length > 0 ? apapCohortFilter : undefined;
    const historicalData = getHistoricalData();

    // Check if this is November 2025 (baseline month) - compute from baseline data
    if (comparisonMonthKey === '2025-11' && baseline && baseline.baseline_apap !== undefined) {
      // Check if all cohorts are selected (no filter) - use overall baseline APAP
      const isAllCohortsSelected = 
        (!filter?.time_since_purchase_cohort || filter.time_since_purchase_cohort.length === uniquePurchaseCohorts.length) &&
        (!filter?.agency_size_band || filter.agency_size_band.length === uniqueSizeBands.length);
      
      if (isAllCohortsSelected) {
        // Use overall baseline APAP (37.1%) 
        // Build current agencies map with both string and number keys for matching
        // Baseline agency IDs are numbers, current might be strings
        const currentAgenciesMap = new Map<string | number, Agency>();
        for (const agency of data.agencies.filter(a => a.cew_type === 'T10')) {
          // Store with both string and number keys for matching
          const idStr = String(agency.agency_id);
          const idNum = Number(agency.agency_id);
          currentAgenciesMap.set(idStr, agency);
          if (!isNaN(idNum)) {
            currentAgenciesMap.set(idNum, agency);
          }
        }
        
        // Count eligible and adopting from baseline
        // All baseline agencies are eligible (baseline Data sheet only contains eligible agencies)
        // However, we need to verify they're still in current data and still T10
        let eligibleCount = 0;
        let adoptingCount = 0;
        let eligiblePoints = 0;
        let adoptingPoints = 0;
        
        // Create a set of baseline agency IDs for quick lookup (both string and number)
        const baselineAgencyIdSet = new Set<string | number>();
        for (const [agencyId, _] of baseline.agencies.entries()) {
          baselineAgencyIdSet.add(String(agencyId));
          const idNum = typeof agencyId === 'number' ? agencyId : Number(agencyId);
          if (!isNaN(idNum)) {
            baselineAgencyIdSet.add(idNum);
          }
        }
        
        for (const [agencyId, baselineAgency] of baseline.agencies.entries()) {
          // Try matching with both string and number keys to get current agency info
          const agencyIdStr = String(agencyId);
          const agencyIdNum = typeof agencyId === 'number' ? agencyId : Number(agencyId);
          const currentAgency = currentAgenciesMap.get(agencyIdStr) || 
                                (typeof agencyIdNum === 'number' && !isNaN(agencyIdNum) ? currentAgenciesMap.get(agencyIdNum) : undefined);
          
          // Only count T10 agencies that are still in current data
          // If we can't match with current data, the agency may have churned out or is no longer T10
          if (!currentAgency || currentAgency.cew_type !== 'T10') {
            continue; // Skip non-T10 agencies or agencies not in current data
          }
          
          // Count as eligible in November (baseline) - all baseline agencies were eligible (eligibility_cohort >= 6)
          eligibleCount++;
          
          // Use baseline officer_count (from AgencySize column) - this is the eligible points for November
          // Use baseline officer_count (AgencySize) - this is the source of truth for November
          const points = baselineAgency.officer_count ?? currentAgency?.officer_count ?? 0;
          eligiblePoints += points;
          
          if (baselineAgency.is_adopting) {
            adoptingCount++;
            // For adopting points, use the same officer_count (eligible points) for the agency
            adoptingPoints += points;
          }
        }
        
        // Debug: Check for agencies that became eligible in December (were eligibility_cohort = 5 in November)
        // These agencies wouldn't be in baseline (baseline only has eligibility_cohort >= 6), but should be eligible in December
        // Reuse baselineAgencyIdSet that was already created above
        
        // Get all current eligible agencies (T10, eligibility_cohort >= 6)
        // Use eligibility_cohort directly from uploaded file (month-specific snapshot)
        // If eligibility_cohort is missing or null, the agency is NOT eligible (no fallback)
        const currentEligibleAgencies = data.agencies.filter(a => {
          if (a.cew_type !== 'T10') return false;
          // Use eligibility_cohort from uploaded file (authoritative source for this month)
          // Only count as eligible if eligibility_cohort is explicitly set and >= 6
          return a.eligibility_cohort !== undefined && a.eligibility_cohort !== null && a.eligibility_cohort >= 6;
        });
        
        // Find agencies that are eligible in December but weren't in baseline
        // These are agencies that were eligibility_cohort = 5 in November (not in baseline) and are now 6 in December
        const newEligibleAgencies = currentEligibleAgencies.filter(a => {
          const idStr = String(a.agency_id);
          const idNum = Number(a.agency_id);
          return !baselineAgencyIdSet.has(idStr) && (!isNaN(idNum) && !baselineAgencyIdSet.has(idNum));
        });
        
        // Also check: agencies in baseline that are no longer eligible in December (shouldn't happen, but verify)
        const baselineAgenciesNoLongerEligible = Array.from(baseline.agencies.keys()).filter(baselineId => {
          const idStr = String(baselineId);
          const idNum = typeof baselineId === 'number' ? baselineId : Number(baselineId);
          const currentAgency = currentAgenciesMap.get(idStr) || (!isNaN(idNum) ? currentAgenciesMap.get(idNum) : undefined);
          if (!currentAgency || currentAgency.cew_type !== 'T10') return false;
          // Use eligibility_cohort from uploaded file (authoritative source for this month)
          // If eligibility_cohort is missing or null, the agency is NOT eligible
          if (currentAgency.eligibility_cohort !== undefined && currentAgency.eligibility_cohort !== null) {
            return currentAgency.eligibility_cohort < 6; // Return true if NOT eligible
          }
          // If eligibility_cohort is missing, agency is NOT eligible
          return true; // Return true if NOT eligible
        });
        
        console.log('🔍 Baseline Comparison (All Cohorts):', {
          totalBaselineAgencies: baseline.agencies.size,
          baselineEligibleCount: eligibleCount, // November eligible (from baseline, T10 only)
          baselineAdoptingCount: adoptingCount,
          baselineEligiblePoints: eligiblePoints,
          baselineAdoptingPoints: adoptingPoints,
          currentEligibleCount: currentAPAP.eligibleCount, // December eligible (from current data)
          currentAdoptingCount: currentAPAP.adoptingCount,
          currentEligiblePoints: currentAPAP.eligiblePoints,
          currentAdoptingPoints: currentAPAP.adoptingPoints,
          newEligibleAgenciesCount: newEligibleAgencies.length, // Agencies that became eligible in December
          baselineAgenciesNoLongerEligible: baselineAgenciesNoLongerEligible.length, // Should be 0
          eligibleCountChange: currentAPAP.eligibleCount - eligibleCount, // Expected to be positive
          overallBaselineAPAP: baseline.baseline_apap.toFixed(1) + '%',
          currentAPAP: currentAPAP.apap.toFixed(1) + '%',
          ppChange: (currentAPAP.apap - baseline.baseline_apap).toFixed(1) + 'pp',
        });
        
        return {
          apap: baseline.baseline_apap,
          adoptingPoints,
          eligiblePoints,
          adoptingCount,
          eligibleCount,
        };
      }
      
      // For filtered cohorts, compute from baseline data
      // Build current agencies map with both string and number keys for matching
      const currentAgenciesMap = new Map<string | number, Agency>();
      for (const agency of data.agencies.filter(a => a.cew_type === 'T10')) {
        // Store with both string and number keys for matching
        const idStr = String(agency.agency_id);
        const idNum = Number(agency.agency_id);
        currentAgenciesMap.set(idStr, agency);
        if (!isNaN(idNum)) {
          currentAgenciesMap.set(idNum, agency);
        }
      }
      
      // Get all baseline agencies and match with current agencies to get cohort info
      // Note: Baseline agency IDs are numbers, current might be strings - try both
      const baselineAgenciesWithCohorts: Array<{ baseline: BaselineAgency; current: Agency }> = [];
      for (const [agencyId, baselineAgency] of baseline.agencies.entries()) {
        // Try matching as both string and number
        const agencyIdStr = String(agencyId);
        const agencyIdNum = typeof agencyId === 'number' ? agencyId : Number(agencyId);
        const currentAgency = currentAgenciesMap.get(agencyIdStr) || 
                              (typeof agencyIdNum === 'number' && !isNaN(agencyIdNum) ? currentAgenciesMap.get(agencyIdNum) : undefined);
        // Only include T10 agencies
        if (currentAgency && currentAgency.cew_type === 'T10') {
          baselineAgenciesWithCohorts.push({ baseline: baselineAgency, current: currentAgency });
        }
      }
      
      // Filter by cohort filters
      let filteredBaselineAgencies = baselineAgenciesWithCohorts.filter(({ current }) => {
        if (filter?.time_since_purchase_cohort && filter.time_since_purchase_cohort.length > 0) {
          if (!filter.time_since_purchase_cohort.includes(current.purchase_cohort)) {
            return false;
          }
        }
        
        if (filter?.agency_size_band && filter.agency_size_band.length > 0) {
          if (!filter.agency_size_band.includes(current.agency_size_band)) {
            return false;
          }
        }
        
        return true;
      });
      
      // All baseline agencies are eligible
      const eligibleBaselineAgencies = filteredBaselineAgencies;
      const adoptingBaselineAgencies = eligibleBaselineAgencies.filter(({ baseline: baselineAgency }) => 
        baselineAgency.is_adopting === true
      );
      
      // Use baseline officer_count if available (from AgencySize column), otherwise use current
      const eligiblePoints = eligibleBaselineAgencies.reduce((sum, { baseline, current }) => {
        return sum + (baseline.officer_count ?? current.officer_count ?? 0);
      }, 0);
      const adoptingPoints = adoptingBaselineAgencies.reduce((sum, { baseline, current }) => {
        return sum + (baseline.officer_count ?? current.officer_count ?? 0);
      }, 0);
      const baselineAPAP = eligiblePoints > 0 ? (adoptingPoints / eligiblePoints) * 100 : 0;
      
      console.log('🔍 Baseline Comparison (Filtered):', {
        filter,
        totalBaselineAgencies: baseline.agencies.size,
        matchedWithCurrent: baselineAgenciesWithCohorts.length,
        afterCohortFilter: filteredBaselineAgencies.length,
        eligibleCount: eligibleBaselineAgencies.length,
        adoptingCount: adoptingBaselineAgencies.length,
        eligiblePoints,
        adoptingPoints,
        computedBaselineAPAP: baselineAPAP.toFixed(1) + '%',
        currentAPAP: currentAPAP.apap.toFixed(1) + '%',
        ppChange: (currentAPAP.apap - baselineAPAP).toFixed(1) + 'pp',
      });
      
      return {
        apap: baselineAPAP,
        adoptingPoints,
        eligiblePoints,
        adoptingCount: adoptingBaselineAgencies.length,
        eligibleCount: eligibleBaselineAgencies.length,
      };
    }
    
    const historicalEntry = historicalData[comparisonMonthKey];
    
    // Use the EXACT same logic as APAPTrendChart (lines 1399-1421)
    if (historicalEntry) {
      // First try to compute from historical labels if available (filtered)
      if (historicalEntry.agencyLabels) {
        // agencyLabels is stored as Array<[string, AgencyWithLabel]>
        const historicalLabelsMap = new Map(historicalEntry.agencyLabels);
        return computeAPAP(data.agencies, historicalLabelsMap, filter);
      }
      // If no labels but we have stored APAP, we can't compute filtered comparison
      // Return null to match trend chart behavior (it uses overall APAP as approximation)
    }
    
    // If no historical entry or labels available, we can't compute filtered comparison
    return null;
  }, [data?.agencies, data?.asOfMonth, comparisonType, apapCohortFilter, labelsMap, currentAPAP, uniquePurchaseCohorts.length, uniqueSizeBands.length]);

  // APAP Goal Progress: slice by eligibility bucket × line size
  const eligFilter = goalProgressEligFilter.length > 0 ? goalProgressEligFilter : ELIG_BUCKETS;
  const lineFilter = goalProgressLineSizeFilter.length > 0 ? goalProgressLineSizeFilter : LINE_SIZES;
  const currentAPAPGoalProgress = useMemo(() => {
    if (!data?.agencies?.length) return null;
    return computeAPAPForStructuralSlice(data.agencies, labelsMap, eligFilter, lineFilter);
  }, [data?.agencies, labelsMap, eligFilter, lineFilter]);
  const goalRatesForSlice = useMemo(() => {
    if (!currentAPAPGoalProgress) return { highConfidencePct: 42, hardClimbPct: 46.2 };
    return getGoalRatesForSlice(GOAL_MODEL_CONFIG, eligFilter, lineFilter, currentAPAPGoalProgress.eligiblePointsByKey);
  }, [currentAPAPGoalProgress, eligFilter, lineFilter]);
  const comparisonAPAPGoalProgress = useMemo(() => {
    if (!currentAPAPGoalProgress || !data?.asOfMonth || !comparisonType) return null;
    const currentMonthDate = parseISO(data.asOfMonth);
    const prevMonthDate = subMonths(currentMonthDate, comparisonType === 'last_month' ? 1 : comparisonType === 'last_quarter' ? 3 : 12);
    const prevMonthKey = format(prevMonthDate, 'yyyy-MM');
    const stored = getProcessedData(prevMonthKey);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      const prevAgencies: Agency[] = parsed.agencies ?? [];
      const prevLabels = parsed.agencyLabels ? new Map(parsed.agencyLabels as [string, AgencyWithLabel][]) : new Map<string, AgencyWithLabel>();
      if (prevAgencies.length === 0) return null;
      const prev = computeAPAPForStructuralSlice(prevAgencies, prevLabels, eligFilter, lineFilter);
      return { apap: prev.apap, eligibleCount: prev.eligibleCount, adoptingCount: prev.adoptingCount, eligiblePoints: prev.eligiblePoints, adoptingPoints: prev.adoptingPoints };
    } catch {
      return null;
    }
  }, [currentAPAPGoalProgress, data?.asOfMonth, comparisonType, eligFilter, lineFilter]);
  const allCohortsSelected = eligFilter.length === ELIG_BUCKETS.length && lineFilter.length === LINE_SIZES.length;
  const apapGoalProgressHistory = useMemo(() => {
    if (!data?.asOfMonth) return [];
    const currentMonthDate = parseISO(data.asOfMonth);
    const baseline = getBaselineData();
    const history: Array<{ month: string; apap: number; label: string }> = [];
    const useOverall = allCohortsSelected;
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(currentMonthDate, i);
      const monthKey = format(monthDate, 'yyyy-MM');
      if (i === 0) {
        const apap = useOverall && overallAPAP ? overallAPAP.apap : currentAPAPGoalProgress?.apap ?? 0;
        history.push({ month: monthKey, apap, label: format(monthDate, 'MMM yyyy') });
        continue;
      }
      if (monthKey === '2025-11') {
        if (useOverall && baseline?.baseline_apap != null) {
          history.push({ month: monthKey, apap: baseline.baseline_apap, label: format(monthDate, 'MMM yyyy') + ' (Baseline)' });
        } else {
          const apap = getNovemberBaselineAPAPForSlice(GOAL_MODEL_CONFIG, eligFilter, lineFilter);
          if (apap != null) {
            history.push({ month: monthKey, apap, label: format(monthDate, 'MMM yyyy') + ' (Baseline)' });
          }
        }
        continue;
      }
      const stored = getProcessedData(monthKey);
      if (!stored) continue;
      try {
        const parsed = JSON.parse(stored);
        const agencies: Agency[] = parsed.agencies ?? [];
        const labels = parsed.agencyLabels ? new Map(parsed.agencyLabels as [string, AgencyWithLabel][]) : new Map<string, AgencyWithLabel>();
        if (agencies.length === 0) continue;
        const apap = useOverall ? computeAPAP(agencies, labels).apap : computeAPAPForStructuralSlice(agencies, labels, eligFilter, lineFilter).apap;
        history.push({ month: monthKey, apap, label: format(monthDate, 'MMM yyyy') });
      } catch {
        // skip
      }
    }
    return history;
  }, [data?.asOfMonth, currentAPAPGoalProgress, overallAPAP, eligFilter, lineFilter, allCohortsSelected]);

  // Compute current SIM-only KPI counts and points (for cards: count + points per metric)
  const currentKPICountsAndPoints = useMemo((): KPIMetricCountsAndPoints | null => {
    if (!data?.agencies?.length || !data?.agencyLabels?.length) return null;
    return computeKPICountsAndPoints(data.agencies, labelsMap);
  }, [data, labelsMap]);

  const comparisonLabel = comparisonType === 'last_month' ? 'Last Month' :
    comparisonType === 'last_quarter' ? 'Last Quarter' :
    comparisonType === 'last_year' ? 'This Time Last Year' : '';

  // Toggle cohort filter values
  const toggleCohortFilter = (
    dimension: 'time_since_purchase_cohort' | 'agency_size_band',
    value: string
  ) => {
    // Prevent selecting "Ineligible" or "Ineligible (0–5 months)"
    if (value === 'Ineligible' || value === 'Ineligible (0–5 months)') {
      return;
    }
    
    setApapCohortFilter(prev => {
      const current = prev[dimension] || [];
      const newFilter = { ...prev };
      if (current.includes(value)) {
        newFilter[dimension] = current.filter(v => v !== value);
        if (newFilter[dimension]!.length === 0) {
          delete newFilter[dimension];
        }
      } else {
        newFilter[dimension] = [...current, value];
      }
      // Ensure "Ineligible" is never in the filter
      if (newFilter[dimension]) {
        newFilter[dimension] = newFilter[dimension]!.filter(v => v !== 'Ineligible' && v !== 'Ineligible (0–5 months)');
        if (newFilter[dimension]!.length === 0) {
          delete newFilter[dimension];
        }
      }
      return newFilter;
    });
  };

  const selectAllFilters = () => {
    // Select all filters
    setApapCohortFilter({
      time_since_purchase_cohort: uniquePurchaseCohorts,
      agency_size_band: uniqueSizeBands,
    });
  };

  const baselineMonthData = useMemo((): ProcessedMonthData | null => {
    if (typeof window === 'undefined') return null;
    const raw = getProcessedData('2025-11');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const labels = Array.isArray(parsed.agencyLabels) ? new Map(parsed.agencyLabels) : new Map();
      return {
        agencies: parsed.agencies ?? [],
        agencyLabels: labels,
        asOfMonth: '2025-11',
      };
    } catch {
      return null;
    }
  }, []);

  const currentMonthData = useMemo((): ProcessedMonthData | null => {
    if (!data?.agencies?.length) return null;
    return {
      agencies: data.agencies,
      agencyLabels: data.agencyLabels,
      asOfMonth: data.asOfMonth,
    };
  }, [data]);

  const previousMonthData = useMemo((): ProcessedMonthData | null => {
    if (typeof window === 'undefined' || !currentMonthKey) return null;
    try {
      const d = parseISO(currentMonthKey + '-01');
      const prev = subMonths(d, 1);
      const prevKey = format(prev, 'yyyy-MM');
      const raw = getProcessedData(prevKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const labels = Array.isArray(parsed.agencyLabels) ? new Map(parsed.agencyLabels) : new Map();
      return { agencies: parsed.agencies ?? [], agencyLabels: labels, asOfMonth: prevKey };
    } catch {
      return null;
    }
  }, [currentMonthKey]);

  const structuralResult = useMemo(() => {
    if (!currentMonthData) return null;
    return computeStructuralVarianceFromConfig(currentMonthData, GOAL_MODEL_CONFIG, 'high_confidence');
  }, [currentMonthData]);

  const baselineStructuralResult = useMemo(() => {
    if (!baselineMonthData) return null;
    return computeStructuralVarianceFromConfig(baselineMonthData, GOAL_MODEL_CONFIG, 'high_confidence');
  }, [baselineMonthData]);

  const prevMonthStructuralResult = useMemo(() => {
    if (!previousMonthData) return null;
    return computeStructuralVarianceFromConfig(previousMonthData, GOAL_MODEL_CONFIG, 'high_confidence');
  }, [previousMonthData]);

  const driverResult = useMemo(() => {
    if (!currentMonthData) return null;
    return computeDriverProgressFromConfig(
      currentMonthData,
      baselineMonthData,
      GOAL_MODEL_CONFIG,
      'high_confidence'
    );
  }, [currentMonthData, baselineMonthData]);

  const baselineDriverResult = useMemo(() => {
    if (!baselineMonthData) return null;
    return computeDriverProgressFromConfig(baselineMonthData, baselineMonthData, GOAL_MODEL_CONFIG, 'high_confidence');
  }, [baselineMonthData]);

  const prevMonthDriverResult = useMemo(() => {
    if (!previousMonthData) return null;
    return computeDriverProgressFromConfig(previousMonthData, baselineMonthData, GOAL_MODEL_CONFIG, 'high_confidence');
  }, [previousMonthData, baselineMonthData]);

  // Biggest movers: top 3 positive and top 3 negative MoM changes (cohort adoption + driver rates), with goal/variance context
  // If current >= High Confidence, reference variance to Hard Climb; else to High Confidence.
  type MoverEntry = { id: string; label: string; momPp: number; currentPct: number | null; goalPct: number; goalLabel: 'High Confidence' | 'Hard Climb'; variancePp: number | null; source: 'cohort' | 'driver' };
  const HC_OVERALL = GOAL_MODEL_CONFIG.overall.high_confidence.overallTargetApapPct;
  const HC_CLIMB_OVERALL = GOAL_MODEL_CONFIG.overall.hard_climb.overallTargetApapPct;
  const biggestMovers = useMemo((): { topPositive: MoverEntry[]; topNegative: MoverEntry[] } => {
    const entries: MoverEntry[] = [];

    if (currentMonthKey) {
      const prevMonthKey = format(subMonths(parseISO(currentMonthKey + '-01'), 1), 'yyyy-MM');
      const historicalData = getHistoricalData();
      const prevCohortSummaries = historicalData[prevMonthKey]?.cohortSummaries;

      // Cohort-dimension movers (eligibility/time cohort, agency size)
      const dimensions: { key: keyof typeof data.cohortSummaries; label: string }[] = [
        { key: 'time_since_purchase_cohort', label: 'Eligibility cohort' },
        { key: 'agency_size_band', label: 'Agency size' },
      ];
      for (const { key, label: dimLabel } of dimensions) {
        const currentSummaries = (data.cohortSummaries?.[key] ?? []) as CohortSummary[];
        const prevSummaries = (prevCohortSummaries?.[key] ?? []) as CohortSummary[];
        for (const s of currentSummaries) {
          if (s.cohort_value === 'Ineligible (0–5 months)' || s.cohort_value.startsWith('Unknown')) continue;
          const prev = prevSummaries.find((p: CohortSummary) => p.cohort_value === s.cohort_value);
          const momPp = prev != null ? s.pct_adopting - prev.pct_adopting : 0;
          const currentPct = s.pct_adopting;
          const useHardClimb = currentPct >= HC_OVERALL;
          const goalPct = useHardClimb ? HC_CLIMB_OVERALL : HC_OVERALL;
          const goalLabel = useHardClimb ? 'Hard Climb' : 'High Confidence';
          const variancePp = currentPct - goalPct;
          entries.push({
            id: `cohort-${key}-${s.cohort_value}`,
            label: `${s.cohort_value} (${dimLabel})`,
            momPp,
            currentPct,
            goalPct,
            goalLabel,
            variancePp,
            source: 'cohort',
          });
        }
      }

      // Driver movers (retention, conversion, baseline_ineligible, new_customer by line size)
      const driverLabels: Record<string, string> = {
        retention: "2025 Adopting Retention Rate",
        conversion: "2025 Unadopting Conversion Rate",
        baseline_ineligible: "H2 2025 Customers' Adoption Rate",
        new_customer: "H1 2026 New Customers' Adoption Rate",
      };
      if (driverResult?.rows && prevMonthDriverResult?.rows) {
        const prevByKey = new Map(prevMonthDriverResult.rows.map((r) => [`${r.driver}-${r.lineSize}`, r]));
        const hcDriver = GOAL_MODEL_CONFIG.driverAssumptions.high_confidence;
        const hcClimbDriver = GOAL_MODEL_CONFIG.driverAssumptions.hard_climb;
        for (const row of driverResult.rows) {
          const prev = prevByKey.get(`${row.driver}-${row.lineSize}`);
          const momPp = prev != null ? (row.actualRate - prev.actualRate) * 100 : 0;
          const currentPct = row.denominator > 0 ? row.actualRate * 100 : null;
          const hcPct = row.assumedRate * 100;
          const hcClimbPct = (hcClimbDriver[row.driver]?.[row.lineSize] ?? 0) * 100;
          const useHardClimb = currentPct != null && currentPct >= hcPct;
          const goalPct = useHardClimb ? hcClimbPct : hcPct;
          const goalLabel = useHardClimb ? 'Hard Climb' : 'High Confidence';
          const variancePp = currentPct != null ? currentPct - goalPct : null;
          entries.push({
            id: `driver-${row.driver}-${row.lineSize}`,
            label: `${driverLabels[row.driver] ?? row.driver} – ${row.lineSize}`,
            momPp,
            currentPct,
            goalPct,
            goalLabel,
            variancePp,
            source: 'driver',
          });
        }
      }
    }

    const withMom = entries.filter((e) => e.momPp !== 0 || e.currentPct != null);
    const sorted = [...withMom].sort((a, b) => b.momPp - a.momPp);
    const topPositive = sorted.filter((e) => e.momPp > 0).slice(0, 3);
    const topNegative = sorted.filter((e) => e.momPp < 0).slice(-3).reverse();
    return { topPositive, topNegative };
  }, [currentMonthKey, data?.cohortSummaries, driverResult?.rows, prevMonthDriverResult?.rows]);

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
            Analysis
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

  // Format percentage
  const formatPercent = (value: number): string => {
    return `${value.toFixed(1)}%`;
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
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <BarChart3 size={24} color="white" />
            </div>
            <div>
              <h1 style={{
                fontSize: 'var(--text-headline-size)',
                lineHeight: 'var(--text-headline-line)',
                fontWeight: 'var(--text-headline-weight)',
                margin: 0,
                color: 'var(--fg-primary)',
              }}>
                Analysis
              </h1>
              <p style={{
                fontSize: 'var(--text-body2-size)',
                color: 'var(--fg-secondary)',
                margin: '0.25rem 0 0 0',
              }}>
                Product trends and APAP adoption across cohorts
              </p>
            </div>
          </div>
          
          {/* Period Comparison Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label style={{
              fontSize: 'var(--text-body2-size)',
              color: 'var(--fg-secondary)',
              fontWeight: 'var(--text-subtitle-weight)',
            }}>
              Compare to:
            </label>
            <select
              value={comparisonType || ''}
              onChange={(e) => setComparisonType(e.target.value as ComparisonType || null)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid var(--border-color)`,
                background: 'var(--surface-2)',
                color: 'var(--fg-primary)',
                fontSize: 'var(--text-body2-size)',
                cursor: 'pointer',
              }}
            >
              <option value="">None</option>
              <option value="last_month">Last Month</option>
              <option value="last_quarter">Last Quarter</option>
              <option value="last_year">This Time Last Year</option>
            </select>
          </div>
        </div>

        {/* APAP (Adoption Percentage) section + Filter by Cohort (Time Since Purchase / Agency Size) removed in favor of APAP Goal Progress below. Restore from git history if needed: search for "APAP Total Section" or "APAP (Adoption Percentage)". */}

        {/* APAP Goal Progress — Overall APAP (same as Home) + slice by cohorts */}
        {data && overallAPAP && currentAPAPGoalProgress && (
          <div style={{
            marginBottom: '3rem',
            padding: '1.5rem',
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: 'var(--text-title-size)', fontWeight: 'var(--text-title-weight)', margin: '0 0 0.5rem 0', color: 'var(--fg-primary)' }}>
                APAP Goal Progress
              </h2>
              <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)', margin: 0 }}>
                Breakdown progress to our High Confidence and Hard Climb goals by various cohorts and their presumed levels of adoption in our Goal Models.
              </p>
            </div>
            <div style={{ padding: '1.5rem', background: 'var(--surface-3)', borderRadius: 'var(--radius-md)', border: '2px solid var(--border-color)', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 340px', textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.25rem', fontWeight: 'var(--text-subtitle-weight)' }}>
                    Overall APAP (same as Home)
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: 'var(--text-headline-weight)', color: 'var(--fg-primary)', lineHeight: 1, marginBottom: '0.5rem' }}>
                    {overallAPAP.apap.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.5rem' }}>
                    {overallAPAP.adoptingPoints.toLocaleString()} adopting / {overallAPAP.eligiblePoints.toLocaleString()} eligible points
                  </div>
                  <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '0.75rem' }}>
                    {overallAPAP.adoptingCount} adopting / {overallAPAP.eligibleCount} eligible agencies
                  </div>
                  {overallComparisonAPAP && comparisonLabel && (
                    <div style={{
                      display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem',
                      fontSize: 'var(--text-body2-size)',
                      color: overallAPAP.apap >= overallComparisonAPAP.apap ? 'var(--fg-success)' : 'var(--fg-destructive)',
                      padding: '0.5rem 1rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
                    }}>
                      {overallAPAP.apap >= overallComparisonAPAP.apap ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                      {(overallAPAP.apap - overallComparisonAPAP.apap).toFixed(1)}pp vs {comparisonLabel}
                    </div>
                  )}
                  {comparisonAPAPGoalProgress && comparisonLabel && (
                    <>
                      <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', marginTop: '0.5rem', textAlign: 'left' }}>
                        <div style={{ fontWeight: 'var(--text-body2-weight)', marginBottom: '0.5rem', color: 'var(--fg-primary)', fontSize: 'var(--text-body2-size)' }}>
                          For selected cohorts vs {comparisonLabel}:
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <div>Slice APAP: {currentAPAPGoalProgress.apap.toFixed(1)}% ({currentAPAPGoalProgress.apap >= comparisonAPAPGoalProgress.apap ? '+' : ''}{(currentAPAPGoalProgress.apap - comparisonAPAPGoalProgress.apap).toFixed(1)}pp)</div>
                          <div>Eligible agencies: {currentAPAPGoalProgress.eligibleCount}
                            {comparisonAPAPGoalProgress.eligibleCount !== currentAPAPGoalProgress.eligibleCount && (
                              <span style={{ color: currentAPAPGoalProgress.eligibleCount >= comparisonAPAPGoalProgress.eligibleCount ? 'var(--fg-success)' : 'var(--fg-destructive)', marginLeft: '0.25rem' }}>
                                ({currentAPAPGoalProgress.eligibleCount >= comparisonAPAPGoalProgress.eligibleCount ? '+' : ''}{currentAPAPGoalProgress.eligibleCount - comparisonAPAPGoalProgress.eligibleCount})
                              </span>
                            )}
                          </div>
                          <div>Adopting agencies: {currentAPAPGoalProgress.adoptingCount}
                            {comparisonAPAPGoalProgress.adoptingCount !== currentAPAPGoalProgress.adoptingCount && (
                              <span style={{ color: currentAPAPGoalProgress.adoptingCount >= comparisonAPAPGoalProgress.adoptingCount ? 'var(--fg-success)' : 'var(--fg-destructive)', marginLeft: '0.25rem' }}>
                                ({currentAPAPGoalProgress.adoptingCount >= comparisonAPAPGoalProgress.adoptingCount ? '+' : ''}{currentAPAPGoalProgress.adoptingCount - comparisonAPAPGoalProgress.adoptingCount})
                              </span>
                            )}
                          </div>
                          <div>Eligible points: {currentAPAPGoalProgress.eligiblePoints.toLocaleString()}
                            {comparisonAPAPGoalProgress.eligiblePoints !== currentAPAPGoalProgress.eligiblePoints && (
                              <span style={{ color: currentAPAPGoalProgress.eligiblePoints >= comparisonAPAPGoalProgress.eligiblePoints ? 'var(--fg-success)' : 'var(--fg-destructive)', marginLeft: '0.25rem' }}>
                                ({currentAPAPGoalProgress.eligiblePoints >= comparisonAPAPGoalProgress.eligiblePoints ? '+' : ''}{(currentAPAPGoalProgress.eligiblePoints - comparisonAPAPGoalProgress.eligiblePoints).toLocaleString()})
                              </span>
                            )}
                          </div>
                          <div>Adopting points: {currentAPAPGoalProgress.adoptingPoints.toLocaleString()}
                            {comparisonAPAPGoalProgress.adoptingPoints !== currentAPAPGoalProgress.adoptingPoints && (
                              <span style={{ color: currentAPAPGoalProgress.adoptingPoints >= comparisonAPAPGoalProgress.adoptingPoints ? 'var(--fg-success)' : 'var(--fg-destructive)', marginLeft: '0.25rem' }}>
                                ({currentAPAPGoalProgress.adoptingPoints >= comparisonAPAPGoalProgress.adoptingPoints ? '+' : ''}{(currentAPAPGoalProgress.adoptingPoints - comparisonAPAPGoalProgress.adoptingPoints).toLocaleString()})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div style={{ flex: '1 1 480px', minWidth: '400px' }}>
                  <APAPGoalProgressTrendChart
                    history={apapGoalProgressHistory}
                    goalRates={goalRatesForSlice}
                  />
                </div>
              </div>
            </div>
            {/* Filters below the chart — at least one must be selected in each cohort */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', marginTop: '1rem' }}>
              <span style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>Filters</span>
              {(goalProgressEligFilter.length !== ELIG_BUCKETS.length || goalProgressLineSizeFilter.length !== LINE_SIZES.length) && (
                <button
                  type="button"
                  onClick={() => {
                    setGoalProgressEligFilter([...ELIG_BUCKETS]);
                    setGoalProgressLineSizeFilter([...LINE_SIZES]);
                  }}
                  style={{
                    padding: '0.375rem 0.75rem',
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--fg-primary)',
                    fontSize: 'var(--text-body2-size)',
                    cursor: 'pointer',
                  }}
                >
                  Select All
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-body2-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)', marginBottom: '0.5rem' }}>
                  Eligibility Cohort
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {([
                    { key: '6_12' as EligBucket, label: '6–12 Months' },
                    { key: '13_18' as EligBucket, label: '13–18 Months' },
                    { key: '19_24' as EligBucket, label: '19–24 Months' },
                    { key: '25_plus' as EligBucket, label: '2+ Years' },
                  ]).map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
                      <input
                        type="checkbox"
                        checked={goalProgressEligFilter.includes(key)}
                        onChange={() => {
                          setGoalProgressEligFilter(prev => {
                            const next = prev.includes(key) ? prev.filter(e => e !== key) : [...prev, key];
                            if (next.length === 0) return [...ELIG_BUCKETS];
                            return next;
                          });
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-body2-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)', marginBottom: '0.5rem' }}>
                  Agency Size
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {([
                    { key: 'Major' as LineSize, label: 'Major' },
                    { key: 'T1200' as LineSize, label: 'T1200' },
                    { key: 'Direct' as LineSize, label: 'Direct' },
                  ]).map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: 'var(--text-body2-size)', color: 'var(--fg-primary)' }}>
                      <input
                        type="checkbox"
                        checked={goalProgressLineSizeFilter.includes(key)}
                        onChange={() => {
                          setGoalProgressLineSizeFilter(prev => {
                            const next = prev.includes(key) ? prev.filter(l => l !== key) : [...prev, key];
                            if (next.length === 0) return [...LINE_SIZES];
                            return next;
                          });
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SIM-only KPI metrics: between APAP Goal Progress and Biggest Movers; MoM for count and points */}
        {currentKPICountsAndPoints && (
          <div style={{ marginBottom: '3rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              {[
                { key: 'adopting' as const, label: 'Adopting', icon: CheckCircle2, color: 'var(--fg-success)' },
                { key: 'eligible' as const, label: 'Eligible', icon: Users, color: 'var(--fg-action)' },
                { key: 'ineligible' as const, label: 'Ineligible', icon: HelpCircle, color: 'var(--fg-secondary)' },
              ].map(({ key, label, icon: Icon, color }) => {
                const { count, points } = currentKPICountsAndPoints[key];
                const prev = comparisonData?.kpiCountsAndPoints?.[key];
                const compCount = prev ? prev.count : (key === 'eligible' ? comparisonData?.eligibleCount ?? null : comparisonData?.kpiCounts?.[key] ?? null);
                const compPoints = prev ? prev.points : null;
                const countChange = compCount != null ? count - compCount : null;
                const pointsChange = compPoints != null ? points - compPoints : null;
                const countPct = countChange != null && compCount != null && compCount !== 0 ? (countChange / compCount) * 100 : null;
                const goodDir = key === 'ineligible' ? countChange != null && countChange <= 0 : countChange != null && countChange >= 0;
                const changeColor = goodDir ? 'var(--fg-success)' : 'var(--fg-destructive)';

                return (
                  <div key={key} style={{ padding: '1.5rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <Icon size={20} color={color} />
                      <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)', fontWeight: 'var(--text-subtitle-weight)' }}>{label}</div>
                    </div>
                    <div style={{ fontSize: 'var(--text-title-size)', fontWeight: 'var(--text-title-weight)', color: 'var(--fg-primary)', marginBottom: '0.25rem' }}>
                      {count.toLocaleString()} agencies
                    </div>
                    <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)', marginBottom: '0.5rem' }}>
                      {points.toLocaleString()} points
                    </div>
                    {comparisonLabel && (countChange !== null || pointsChange !== null) && (
                      <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: countChange != null ? changeColor : 'inherit' }}>
                          {countChange != null && (countChange >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                          {countChange != null && `${countChange >= 0 ? '+' : ''}${countChange} agencies`}
                          {countChange != null && countPct != null && ` (${countPct >= 0 ? '+' : ''}${countPct.toFixed(1)}%)`}
                        </div>
                        {pointsChange != null && (() => {
                          const pointsGood = key === 'ineligible' ? pointsChange <= 0 : pointsChange >= 0;
                          const pointsColor = pointsGood ? 'var(--fg-success)' : 'var(--fg-destructive)';
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: pointsColor, marginTop: '0.25rem' }}>
                              {pointsChange >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                              {(pointsChange >= 0 ? '+' : '') + pointsChange.toLocaleString()} points
                            </div>
                          );
                        })()}
                        <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-disabled)' }}> vs {comparisonLabel}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              {[
                { key: 'atRiskNextMonth' as const, label: 'At Risk (Next Month)', icon: AlertTriangle, color: 'var(--fg-alert)', invertDirection: true },
                { key: 'atRiskNextQuarter' as const, label: 'At Risk (Next Quarter)', icon: AlertTriangle, color: 'var(--fg-warning)', invertDirection: true },
                { key: 'churnedOut' as const, label: 'Churned Out', icon: XCircle, color: 'var(--fg-destructive)', invertDirection: true },
                { key: 'closeToAdopting' as const, label: 'Close to Adopting', icon: Crosshair, color: 'var(--fg-action)' },
              ].map(({ key, label, icon: Icon, color, invertDirection }) => {
                const { count, points } = currentKPICountsAndPoints[key];
                const prev = comparisonData?.kpiCountsAndPoints?.[key];
                const compCount = prev ? prev.count : comparisonData?.kpiCounts?.[key] ?? null;
                const compPoints = prev ? prev.points : null;
                const countChange = compCount != null ? count - compCount : null;
                const pointsChange = compPoints != null ? points - compPoints : null;
                const countPct = countChange != null && compCount != null && compCount !== 0 ? (countChange / compCount) * 100 : null;
                const goodDir = invertDirection ? countChange != null && countChange <= 0 : countChange != null && countChange >= 0;
                const changeColor = goodDir ? 'var(--fg-success)' : 'var(--fg-destructive)';

                return (
                  <div key={key} style={{ padding: '1.5rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <Icon size={20} color={color} />
                      <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)', fontWeight: 'var(--text-subtitle-weight)' }}>{label}</div>
                    </div>
                    <div style={{ fontSize: 'var(--text-title-size)', fontWeight: 'var(--text-title-weight)', color: 'var(--fg-primary)', marginBottom: '0.25rem' }}>
                      {count.toLocaleString()} agencies
                    </div>
                    <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)', marginBottom: '0.5rem' }}>
                      {points.toLocaleString()} points
                    </div>
                    {comparisonLabel && (countChange !== null || pointsChange !== null) && (
                      <div style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: countChange != null ? changeColor : 'inherit' }}>
                          {countChange != null && (countChange >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                          {countChange != null && `${countChange >= 0 ? '+' : ''}${countChange} agencies`}
                          {countChange != null && countPct != null && ` (${countPct >= 0 ? '+' : ''}${countPct.toFixed(1)}%)`}
                        </div>
                        {pointsChange != null && (() => {
                          const pointsGood = invertDirection ? pointsChange <= 0 : pointsChange >= 0;
                          const pointsColor = pointsGood ? 'var(--fg-success)' : 'var(--fg-destructive)';
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: pointsColor, marginTop: '0.25rem' }}>
                              {pointsChange >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                              {(pointsChange >= 0 ? '+' : '') + pointsChange.toLocaleString()} points
                            </div>
                          );
                        })()}
                        <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-disabled)' }}> vs {comparisonLabel}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Biggest movers: top 3 positive and top 3 negative MoM, with goal/variance context */}
        <div style={{
          marginBottom: '3rem',
          padding: '1.5rem',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <TrendingUp size={24} color="var(--fg-action)" />
            <h2 style={{ fontSize: 'var(--text-title-size)', fontWeight: 'var(--text-title-weight)', margin: 0, color: 'var(--fg-primary)' }}>
              Biggest movers (month over month)
            </h2>
          </div>
          <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '1rem' }}>
            Cohorts with the largest MoM change in adoption or driver rates. Variance is vs High Confidence unless the metric already meets it, in which case we reference Hard Climb.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div>
              <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-success)', marginBottom: '0.75rem' }}>
                Top 3 positive
              </h3>
              {biggestMovers.topPositive.length === 0 ? (
                <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>No positive MoM changes this period.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {biggestMovers.topPositive.map((m) => (
                    <li key={m.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--text-body2-size)' }}>
                      <span style={{ fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>{m.label}</span>
                      <span style={{ color: 'var(--fg-success)', marginLeft: '0.5rem' }}>+{m.momPp.toFixed(1)}pp MoM</span>
                      {m.currentPct != null && (
                        <span style={{ color: 'var(--fg-secondary)', marginLeft: '0.5rem' }}>
                          Current {m.currentPct.toFixed(1)}%; vs {m.goalLabel}: {m.variancePp != null ? (m.variancePp >= 0 ? `+${m.variancePp.toFixed(1)}pp` : `${m.variancePp.toFixed(1)}pp`) : '—'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--text-subtitle-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-destructive)', marginBottom: '0.75rem' }}>
                Top 3 negative
              </h3>
              {biggestMovers.topNegative.length === 0 ? (
                <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-secondary)' }}>No negative MoM changes this period.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {biggestMovers.topNegative.map((m) => (
                    <li key={m.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--text-body2-size)' }}>
                      <span style={{ fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)' }}>{m.label}</span>
                      <span style={{ color: 'var(--fg-destructive)', marginLeft: '0.5rem' }}>{m.momPp.toFixed(1)}pp MoM</span>
                      {m.currentPct != null && (
                        <span style={{ color: 'var(--fg-secondary)', marginLeft: '0.5rem' }}>
                          Current {m.currentPct.toFixed(1)}%; vs {m.goalLabel}: {m.variancePp != null ? (m.variancePp >= 0 ? `+${m.variancePp.toFixed(1)}pp` : `${m.variancePp.toFixed(1)}pp`) : '—'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Goal Progress (v1) */}
        <div style={{
          marginBottom: '3rem',
          padding: '1.5rem',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <Target size={24} color="var(--fg-action)" />
            <h2 style={{ fontSize: 'var(--text-title-size)', fontWeight: 'var(--text-title-weight)', margin: 0, color: 'var(--fg-primary)' }}>
              Goal Progress
            </h2>
          </div>
          <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '1rem' }}>
            Variance to goal and driver progress use SIM-only adoption labels. Goal model from config (High Confidence 42%, Hard Climb 46.2%).
          </p>

          {data && (
            <>
              {/* Panel A (Structural variance) removed — captured in APAP Goal Progress chart above. */}
              {driverResult && (
                <>
                  <h3 style={{ fontSize: 'var(--text-subtitle-size)', marginBottom: '0.5rem', color: 'var(--fg-primary)' }}>
                    Cohort Goal Progress
                  </h3>
                  {!driverResult.baselineAvailable && (
                    <p style={{ fontSize: 'var(--text-body2-size)', color: 'var(--fg-alert)', marginBottom: '0.75rem' }}>
                      Upload baseline month (2025-11) to unlock retention/conversion tracking.
                    </p>
                  )}
                  <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-body2-size)' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border-color)', background: 'var(--surface-2)' }}>
                          <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Line size</th>
                          <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>High confidence</th>
                          <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Hard climb</th>
                          <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', borderLeft: '2px solid var(--border-color)' }}>Actual</th>
                          <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>HC variance (pp)</th>
                          <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Hard climb variance (pp)</th>
                          <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>MoM (pp)</th>
                          <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Progress since baseline (pp)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['retention', 'conversion', 'baseline_ineligible', 'new_customer'] as const).map((driver) => {
                          const sectionLabel = driver === 'baseline_ineligible' ? "H2 2025 Customers' Adoption Rate" : driver === 'new_customer' ? "H1 2026 New Customers' Adoption Rate" : driver === 'retention' ? "2025 Adopting Retention Rate" : "2025 Unadopting Conversion Rate";
                          const rowsForDriver = driverResult.rows.filter((r) => r.driver === driver);
                          const byLine = Object.fromEntries(rowsForDriver.map((r) => [r.lineSize, r]));
                          const baselineByLine = baselineDriverResult ? Object.fromEntries(baselineDriverResult.rows.filter((r) => r.driver === driver).map((r) => [r.lineSize, r])) : {};
                          const prevByLine = prevMonthDriverResult ? Object.fromEntries(prevMonthDriverResult.rows.filter((r) => r.driver === driver).map((r) => [r.lineSize, r])) : {};
                          const lineOrder: Array<'Major' | 'T1200' | 'Direct'> = ['Major', 'T1200', 'Direct'];
                          const hc = GOAL_MODEL_CONFIG.driverAssumptions.high_confidence[driver];
                          const hcl = GOAL_MODEL_CONFIG.driverAssumptions.hard_climb[driver];
                          const isRetention = driver === 'retention';
                          return (
                            <React.Fragment key={driver}>
                              <tr style={{ background: 'var(--surface-2)' }}>
                                <td colSpan={8} style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--fg-primary)' }}>
                                  {sectionLabel}
                                  {driver === 'new_customer' && (
                                    <div style={{ marginTop: '0.25rem', fontSize: 'var(--text-caption-size)', fontWeight: 400, color: 'var(--fg-secondary)' }}>
                                      Note: This counts customers purchased Dec 2025–May 2026 only once they become eligible (eligibility cohort ≥ 6), so it typically begins populating around Jun 2026.
                                    </div>
                                  )}
                                </td>
                              </tr>
                              {lineOrder.map((lineSize) => {
                                const row = byLine[lineSize];
                                if (!row) return null;
                                const highConfPct = (hc[lineSize] * 100);
                                const hardClimbPct = (hcl[lineSize] * 100);
                                const actualPct = row.denominator > 0 ? row.actualRate * 100 : null;
                                const varianceHC = actualPct != null ? actualPct - highConfPct : null;
                                const varianceHcl = actualPct != null ? actualPct - hardClimbPct : null;
                                const prevRow = prevByLine[lineSize];
                                const baselineRow = baselineByLine[lineSize];
                                const momPp = actualPct != null && prevRow?.denominator ? (actualPct - prevRow.actualRate * 100) : null;
                                const progressPp = isRetention ? null : (actualPct != null && baselineRow?.denominator ? (actualPct - baselineRow.actualRate * 100) : null);
                                return (
                                  <tr
                                    key={`${driver}-${lineSize}`}
                                    style={{ borderBottom: '1px solid var(--border-color)' }}
                                    data-driver={driver}
                                    data-line-size={lineSize}
                                    data-denominator={row.denominator}
                                    data-numerator={row.numerator}
                                    data-actual-pct={actualPct != null ? actualPct.toFixed(1) : ''}
                                  >
                                    <td style={{ padding: '0.6rem 0.75rem' }}>{lineSize}</td>
                                    <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>{highConfPct.toFixed(0)}%</td>
                                    <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>{hardClimbPct.toFixed(0)}%</td>
                                    <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem', borderLeft: '2px solid var(--border-color)' }}>{actualPct != null ? `${actualPct.toFixed(1)}%` : '—'}</td>
                                    <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem', color: varianceHC != null ? (varianceHC >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)') : 'var(--fg-secondary)' }}>
                                      {varianceHC != null ? `${varianceHC >= 0 ? '+' : ''}${varianceHC.toFixed(1)}` : '—'}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem', color: varianceHcl != null ? (varianceHcl >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)') : 'var(--fg-secondary)' }}>
                                      {varianceHcl != null ? `${varianceHcl >= 0 ? '+' : ''}${varianceHcl.toFixed(1)}` : '—'}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>{momPp != null ? `${momPp >= 0 ? '+' : ''}${momPp.toFixed(1)}` : '—'}</td>
                                    <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>{isRetention ? '—' : progressPp != null ? `${progressPp >= 0 ? '+' : ''}${progressPp.toFixed(1)}` : '—'}</td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {structuralResult && (
                <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>
                  Data quality: {structuralResult.dataQuality.excludedUnknownLineSize} excluded (unknown line size); {structuralResult.dataQuality.excludedMissingEligibility} excluded (missing eligibility/purchase).
                </div>
              )}
            </>
          )}
        </div>

        {/* Cohort Analysis Section */}
        <div style={{
          marginBottom: '3rem',
          padding: '1.5rem',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)',
          border: `1px solid var(--border-color)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Users size={24} color="white" />
            </div>
            <div>
              <h2 style={{
                fontSize: 'var(--text-title-size)',
                fontWeight: 'var(--text-title-weight)',
                margin: 0,
                color: 'var(--fg-primary)',
              }}>
                Cohort Analysis
              </h2>
              <p style={{
                fontSize: 'var(--text-body2-size)',
                color: 'var(--fg-secondary)',
                margin: '0.25rem 0 0 0',
              }}>
                Analyze adoption, churn, risk, and usage trends by cohort dimensions
              </p>
            </div>
          </div>

          {/* Filters */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            marginBottom: '2rem',
            padding: '1.5rem',
            background: 'var(--surface-3)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid var(--border-color)`,
          }}>
            {/* Cohort Dimension Selector */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 'var(--text-subtitle-size)',
                fontWeight: 'var(--text-subtitle-weight)',
                color: 'var(--fg-primary)',
                marginBottom: '0.5rem',
              }}>
                <Filter size={16} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Cohort Dimension
              </label>
              <select
                value={selectedDimension}
                onChange={(e) => setSelectedDimension(e.target.value as CohortDimension)}
                style={{
                  padding: '0.5rem',
                  border: `1px solid var(--border-color)`,
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-body1-size)',
                  background: 'var(--surface-4)',
                  color: 'var(--fg-primary)',
                  width: '100%',
                  maxWidth: '400px',
                }}
              >
                <option value="time_since_purchase_cohort">Time Since Purchase Cohort</option>
                <option value="agency_size_band">Agency Size Band</option>
              </select>
            </div>

            {/* Other Cohort Filters */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
            }}>
              {selectedDimension !== 'time_since_purchase_cohort' && (
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 'var(--text-body2-size)',
                    fontWeight: 'var(--text-body2-weight)',
                    color: 'var(--fg-secondary)',
                    marginBottom: '0.25rem',
                  }}>
                    Purchase Cohort
                  </label>
                  <select
                    value={filterPurchaseCohort}
                    onChange={(e) => setFilterPurchaseCohort(e.target.value)}
                    style={{
                      padding: '0.5rem',
                      border: `1px solid var(--border-color)`,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-body2-size)',
                      background: 'var(--surface-4)',
                      color: 'var(--fg-primary)',
                      width: '100%',
                    }}
                  >
                    <option value="all">All</option>
                    {uniquePurchaseCohorts.map((cohort) => (
                      <option key={cohort} value={cohort}>{cohort}</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedDimension !== 'agency_size_band' && (
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 'var(--text-body2-size)',
                    fontWeight: 'var(--text-body2-weight)',
                    color: 'var(--fg-secondary)',
                    marginBottom: '0.25rem',
                  }}>
                    Size Band
                  </label>
                  <select
                    value={filterSizeBand}
                    onChange={(e) => setFilterSizeBand(e.target.value)}
                    style={{
                      padding: '0.5rem',
                      border: `1px solid var(--border-color)`,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-body2-size)',
                      background: 'var(--surface-4)',
                      color: 'var(--fg-primary)',
                      width: '100%',
                    }}
                  >
                    <option value="all">All</option>
                    {uniqueSizeBands.map((band) => (
                      <option key={band} value={band}>{band}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Cohort Summary Table */}
          <div style={{
            overflowX: 'auto',
            border: `1px solid var(--border-color)`,
            borderRadius: 'var(--radius-md)',
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 'var(--text-body2-size)',
            }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'left',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                  }}>
                    Cohort
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                  }}>
                    Agency Count
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                  }}>
                    Total Officer Count
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                  }}>
                    % Adopting
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                    fontSize: 'var(--text-caption-size)',
                  }}>
                    % Adopting MoM
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                    fontSize: 'var(--text-caption-size)',
                  }}>
                    % Adopting QoQ
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                  }}>
                    % Churned Out
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                  }}>
                    % At Risk (Next Month)
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: 'var(--text-subtitle-weight)',
                    borderBottom: `1px solid var(--border-color)`,
                    color: 'var(--fg-primary)',
                  }}>
                    % At Risk (Next Quarter)
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSummaries.map((summary, idx) => (
                  <tr
                    key={summary.cohort_value}
                    style={{
                      background: idx % 2 === 0 ? 'var(--surface-3)' : 'var(--surface-2)',
                      borderBottom: `1px solid var(--border-color)`,
                    }}
                  >
                    <td style={{ padding: '0.75rem', color: 'var(--fg-primary)', fontWeight: 'var(--text-subtitle-weight)' }}>
                      {summary.cohort_value}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--fg-primary)', textAlign: 'right' }}>
                      {summary.agency_count}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--fg-primary)', textAlign: 'right' }}>
                      {summary.total_officer_count.toLocaleString()}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--fg-success)', textAlign: 'right' }}>
                      {formatPercent(summary.pct_adopting)}
                    </td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'right',
                      color: summary.mom_pct_adopting !== null && summary.mom_pct_adopting !== undefined
                        ? summary.mom_pct_adopting >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)'
                        : 'var(--fg-secondary)',
                      fontSize: 'var(--text-caption-size)',
                    }}>
                      {summary.mom_pct_adopting !== null && summary.mom_pct_adopting !== undefined
                        ? `${summary.mom_pct_adopting >= 0 ? '+' : ''}${formatPercent(summary.mom_pct_adopting)}`
                        : 'N/A'}
                    </td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'right',
                      color: summary.qoq_pct_adopting !== null && summary.qoq_pct_adopting !== undefined
                        ? summary.qoq_pct_adopting >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)'
                        : 'var(--fg-secondary)',
                      fontSize: 'var(--text-caption-size)',
                    }}>
                      {summary.qoq_pct_adopting !== null && summary.qoq_pct_adopting !== undefined
                        ? `${summary.qoq_pct_adopting >= 0 ? '+' : ''}${formatPercent(summary.qoq_pct_adopting)}`
                        : 'N/A'}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--fg-destructive)', textAlign: 'right' }}>
                      {formatPercent(summary.pct_churned_out)}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--fg-alert)', textAlign: 'right' }}>
                      {formatPercent(summary.pct_at_risk_next_month)}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--fg-alert)', textAlign: 'right' }}>
                      {formatPercent(summary.pct_at_risk_next_quarter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredSummaries.length === 0 && (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--fg-secondary)',
            }}>
              No cohort data available for the selected filters.
            </div>
          )}
        </div>

        {/* Simulator Training (T10) – same definition as Home page SIM Engagement */}
        {data.simTelemetry?.length > 0 && data.agencies?.length > 0 && data.asOfMonth && (() => {
          const t10Ids = new Set(data.agencies.map((a) => a.agency_id));
          const asOfMonthDate = new Date(data.asOfMonth);
          const simT10 = computeSimT10Usage(data.simTelemetry as TelemetryMonthly[], t10Ids, asOfMonthDate);
          if (simT10.availableMonths.length === 0) return null;
          return (
            <div style={{
              marginBottom: '3rem',
              padding: '1.5rem',
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <TrendingUp size={24} color="var(--fg-action)" />
                <h2 style={{ fontSize: 'var(--text-title-size)', fontWeight: 'var(--text-title-weight)', margin: 0, color: 'var(--fg-primary)' }}>
                  Simulator Training (T10)
                </h2>
              </div>
              <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)', marginBottom: '1.5rem' }}>
                Same definition as Home page SIM Engagement — T10 agencies only, Simulator Training product. Uses latest stored data for the current viewing month.
              </p>
              <UsageTrendChart
                data={simT10.usageByMonth}
                months={simT10.availableMonths}
                recordMonth={null}
              />
            </div>
          );
        })()}

      </div>
    </div>
  );
}

// Total Usage Trend Chart Component
function UsageTrendChart({
  data, 
  months,
  comparisonData,
  recordMonth,
}: {
  data: Record<string, number>;
  months: string[];
  comparisonData?: Record<string, number>;
  recordMonth: string | null;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (months.length === 0) return null;

  const chartHeight = 300;
  const chartWidth = 1000;
  const padding = { top: 20, right: 60, bottom: 60, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const values = months.map(m => data[m] || 0);
  const rolling3 = months.map((_, i) => {
    const slice = values.slice(Math.max(0, i - 2), i + 1);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  });
  const maxValue = Math.max(...values, ...rolling3, ...(comparisonData ? Object.values(comparisonData) : []));
  const minValue = 0;

  const xStep = innerWidth / Math.max(1, months.length - 1);
  
  const points = months.map((month, i) => {
    const x = padding.left + (i * xStep);
    const y = padding.top + innerHeight - ((data[month] || 0) - minValue) / (maxValue - minValue) * innerHeight;
    return { x, y, month, value: data[month] || 0 };
  });

  const rollingPoints = months.map((month, i) => {
    const x = padding.left + (i * xStep);
    const val = rolling3[i];
    const y = padding.top + innerHeight - (val - minValue) / (maxValue - minValue) * innerHeight;
    return { x, y, value: val };
  });

  const comparisonPoints = comparisonData ? months.map((month, i) => {
    const x = padding.left + (i * xStep);
    const y = padding.top + innerHeight - ((comparisonData[month] || 0) - minValue) / (maxValue - minValue) * innerHeight;
    return { x, y, month, value: comparisonData[month] || 0 };
  }) : [];

  const pathData = points.map((p, i) => 
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
  ).join(' ');

  const rollingPathData = rollingPoints.length > 0 ? rollingPoints.map((p, i) => 
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
  ).join(' ') : '';

  const comparisonPathData = comparisonPoints.length > 0 ? comparisonPoints.map((p, i) => 
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
  ).join(' ') : '';

  return (
    <div style={{ position: 'relative', width: '100%', overflow: 'visible' }}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: chartHeight }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {/* Y-axis */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + innerHeight}
          stroke="var(--border-color)"
          strokeWidth="2"
        />
        
        {/* Y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + innerHeight - (ratio * innerHeight);
          const value = minValue + (maxValue - minValue) * ratio;
          return (
            <g key={ratio}>
            <line
                x1={padding.left - 5}
              y1={y}
                x2={padding.left}
              y2={y}
              stroke="var(--border-color)"
              strokeWidth="1"
              />
            <text
              x={padding.left - 10}
              y={y + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--fg-secondary)"
            >
                {Math.round(value).toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* X-axis */}
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight}
          stroke="var(--border-color)"
          strokeWidth="2"
        />

        {/* X-axis labels */}
        {months.map((month, i) => {
          const x = padding.left + (i * xStep);
          const monthDate = parseISO(`${month}-01`);
          return (
            <text
              key={month}
              x={x}
              y={padding.top + innerHeight + 20}
              textAnchor="middle"
              fontSize="11"
              fill="var(--fg-secondary)"
            >
              {format(monthDate, 'MMM yyyy')}
            </text>
          );
        })}

        {/* Comparison line (dashed) */}
        {comparisonPathData && (
          <path
            d={comparisonPathData}
            fill="none"
            stroke="var(--fg-secondary)"
            strokeWidth="2"
            strokeDasharray="5,5"
            opacity={0.6}
          />
        )}

        {/* Rolling 3-month average line */}
        {rollingPathData && (
          <path
            d={rollingPathData}
            fill="none"
            stroke="var(--fg-live)"
            strokeWidth="2"
            strokeDasharray="6,4"
            opacity={0.85}
          />
        )}

        {/* Main line */}
          <path
            d={pathData}
            fill="none"
            stroke="var(--fg-action)"
            strokeWidth="3"
          />

        {/* Data points */}
        {points.map((point, i) => {
          const isRecord = recordMonth === point.month;
          const isHovered = hoveredIndex === i;
          const prevValue = i > 0 ? points[i - 1].value : point.value;
          const momChange = calculateMoMChange(point.value, prevValue);
          const lastYearMonth = format(subMonths(parseISO(`${point.month}-01`), 12), 'yyyy-MM');
          const lastYearValue = data[lastYearMonth];
          const yoyChange = lastYearValue != null && lastYearValue !== 0
            ? ((point.value - lastYearValue) / lastYearValue) * 100
            : null;
          const tooltipW = 220;
          const tooltipH = 84;
          const tooltipX = Math.max(8, Math.min(point.x - tooltipW / 2, chartWidth - tooltipW - 8));
          const tooltipY = Math.max(8, point.y - tooltipH - 16);
          return (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.y}
                r={isHovered || isRecord ? 6 : 4}
                fill={isRecord ? 'var(--fg-success)' : 'var(--fg-action)'}
                stroke="white"
                strokeWidth={isHovered || isRecord ? 2 : 1}
                onMouseEnter={() => setHoveredIndex(i)}
                style={{ cursor: 'pointer' }}
              />
              {isHovered && (
                <g>
                  <rect
                    x={tooltipX}
                    y={tooltipY}
                    width={tooltipW}
                    height={tooltipH}
                    fill="var(--surface-3)"
                    stroke="var(--border-color)"
                    rx="6"
                  />
                  <text
                    x={tooltipX + tooltipW / 2}
                    y={tooltipY + 18}
                    textAnchor="middle"
                    fontSize="12"
                    fill="var(--fg-primary)"
                    fontWeight="bold"
                  >
                    {format(parseISO(`${point.month}-01`), 'MMM yyyy')}
                  </text>
                  <text
                    x={tooltipX + tooltipW / 2}
                    y={tooltipY + 38}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--fg-primary)"
                  >
                    {point.value.toLocaleString()} completions
                  </text>
                  <text
                    x={tooltipX + tooltipW / 2}
                    y={tooltipY + 54}
                    textAnchor="middle"
                    fontSize="11"
                    fill={i > 0 ? (momChange >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)') : 'var(--fg-secondary)'}
                  >
                    {i > 0 ? `${momChange >= 0 ? '+' : ''}${momChange.toFixed(1)}% MoM` : '— MoM'}
                  </text>
                  <text
                    x={tooltipX + tooltipW / 2}
                    y={tooltipY + 70}
                    textAnchor="middle"
                    fontSize="11"
                    fill={yoyChange != null ? (yoyChange >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)') : 'var(--fg-secondary)'}
                  >
                    {yoyChange != null ? `${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}% YoY` : '— YoY'}
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

// Helper function for MoM calculation
function calculateMoMChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// Helper function for MoM calculation (used in chart components)
const calculateMoMChangeForChart = (current: number, previous: number): number => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

// APAP Trend Chart Component
function APAPTrendChart({
  currentAPAP,
  currentMonth,
  cohortFilter,
  agencies,
  labelsMap,
}: {
  currentAPAP: number;
  currentMonth: string | null;
  cohortFilter: { time_since_purchase_cohort?: string[]; agency_size_band?: string[] };
  agencies: Agency[];
  labelsMap: Map<string, AgencyWithLabel>;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  // Get historical APAP data for the selected cohorts
  const apapHistory = useMemo(() => {
    if (!currentMonth) return [];
    
    const history: Array<{ month: string; apap: number; label: string }> = [];
    const historicalData = getHistoricalData();
    const baseline = getBaselineData();
    const currentMonthDate = parseISO(currentMonth);
    
    // Get last 6 months including current
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(currentMonthDate, i);
      const monthKey = format(monthDate, 'yyyy-MM');
      
      if (i === 0) {
        // Current month - use current APAP
        history.push({
          month: monthKey,
          apap: currentAPAP,
          label: format(monthDate, 'MMM yyyy'),
        });
      } else {
        // Check if this is November 2025 (baseline month) - compute filtered baseline APAP
        if (monthKey === '2025-11' && baseline && baseline.baseline_apap !== undefined) {
          // If no cohort filter, use overall baseline APAP
          const hasCohortFilter = Object.keys(cohortFilter).length > 0;
          if (!hasCohortFilter) {
            history.push({
              month: monthKey,
              apap: baseline.baseline_apap, // Use overall baseline APAP (37.1%) when no filter
              label: format(monthDate, 'MMM yyyy') + ' (Baseline)',
            });
          } else {
            // Compute filtered baseline APAP for November
            // Match baseline agencies with current agencies to get cohort info and filter
            const currentAgenciesMap = new Map<string | number, Agency>();
            for (const agency of agencies.filter(a => a.cew_type === 'T10')) {
              const idStr = String(agency.agency_id);
              const idNum = Number(agency.agency_id);
              currentAgenciesMap.set(idStr, agency);
              if (!isNaN(idNum)) {
                currentAgenciesMap.set(idNum, agency);
              }
            }
            
            const baselineAgenciesWithCohorts: Array<{ baseline: BaselineAgency; current: Agency }> = [];
            for (const [agencyId, baselineAgency] of baseline.agencies.entries()) {
              const agencyIdStr = String(agencyId);
              const agencyIdNum = typeof agencyId === 'number' ? agencyId : Number(agencyId);
              const currentAgency = currentAgenciesMap.get(agencyIdStr) || 
                                    (typeof agencyIdNum === 'number' && !isNaN(agencyIdNum) ? currentAgenciesMap.get(agencyIdNum) : undefined);
              // Only include T10 agencies
              if (currentAgency && currentAgency.cew_type === 'T10') {
                baselineAgenciesWithCohorts.push({ baseline: baselineAgency, current: currentAgency });
              }
            }
            
            // Filter by cohort filters
            let filteredBaselineAgencies = baselineAgenciesWithCohorts.filter(({ current }) => {
              if (cohortFilter.time_since_purchase_cohort && cohortFilter.time_since_purchase_cohort.length > 0) {
                if (!cohortFilter.time_since_purchase_cohort.includes(current.purchase_cohort)) {
                  return false;
                }
              }
              
              if (cohortFilter.agency_size_band && cohortFilter.agency_size_band.length > 0) {
                if (!cohortFilter.agency_size_band.includes(current.agency_size_band)) {
                  return false;
                }
              }
              
              return true;
            });
            
            // All baseline agencies are eligible
            const eligibleBaselineAgencies = filteredBaselineAgencies;
            const adoptingBaselineAgencies = eligibleBaselineAgencies.filter(({ baseline: baselineAgency }) => 
              baselineAgency.is_adopting === true
            );
            
            // Use baseline officer_count (from AgencySize column)
            const eligiblePoints = eligibleBaselineAgencies.reduce((sum, { baseline }) => {
              return sum + (baseline.officer_count ?? 0);
            }, 0);
            const adoptingPoints = adoptingBaselineAgencies.reduce((sum, { baseline }) => {
              return sum + (baseline.officer_count ?? 0);
            }, 0);
            const filteredBaselineAPAP = eligiblePoints > 0 ? (adoptingPoints / eligiblePoints) * 100 : 0;
            
            history.push({
              month: monthKey,
              apap: filteredBaselineAPAP,
              label: format(monthDate, 'MMM yyyy') + ' (Baseline)',
            });
          }
        } else {
          // Historical month - try to get stored APAP or compute if we have labels
          const historicalEntry = historicalData[monthKey];
          if (historicalEntry) {
            // If we have stored APAP, use it (but it's overall, not filtered by cohorts)
            // For filtered cohorts, we'd need to recompute, but we don't have historical agencies
            // So we'll use the stored overall APAP as an approximation
            if (historicalEntry.apap !== undefined) {
              history.push({
                month: monthKey,
                apap: historicalEntry.apap, // This is overall APAP, not filtered
                label: format(monthDate, 'MMM yyyy'),
              });
            } else if (historicalEntry.agencyLabels) {
              // Fallback: try to compute from historical labels (approximation)
              const historicalLabelsMap = new Map(historicalEntry.agencyLabels);
              const filter = Object.keys(cohortFilter).length > 0 ? cohortFilter : undefined;
              const historicalAPAP = computeAPAP(agencies, historicalLabelsMap, filter);
              history.push({
                month: monthKey,
                apap: historicalAPAP.apap,
                label: format(monthDate, 'MMM yyyy'),
              });
            }
          }
        }
      }
    }
    
    return history;
  }, [currentMonth, currentAPAP, cohortFilter, agencies, labelsMap]);
  
  if (apapHistory.length === 0) {
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
  
  // Dynamic Y-axis range based on data with small padding, always including goal values
  const values = apapHistory.map(entry => entry.apap);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const highConfidenceGoal = 42;
  const hardClimbGoal = 46.2;
  
  // Include goal values in the range calculation
  const effectiveMin = Math.min(dataMin, highConfidenceGoal, hardClimbGoal);
  const effectiveMax = Math.max(dataMax, highConfidenceGoal, hardClimbGoal);
  
  // If all values are the same, add padding to create a visible range
  const paddingPercent = effectiveMax === effectiveMin 
    ? 2 // If all values are the same, use 2% padding
    : Math.max(2, (effectiveMax - effectiveMin) * 0.05); // 5% of range or minimum 2%
  const minValue = Math.max(0, effectiveMin - paddingPercent);
  const maxValue = Math.min(100, effectiveMax + paddingPercent);
  const valueRange = maxValue - minValue || 1; // Prevent division by zero
  
  const xStep = innerWidth / Math.max(1, apapHistory.length - 1);
  
  const points = apapHistory.map((entry, i) => {
    const x = padding.left + (i * xStep);
    const y = padding.top + innerHeight - ((entry.apap - minValue) / valueRange * innerHeight);
    return { x, y, ...entry };
  });

  // MoM segment colors: positive = green, negative = red
  const segments = points.map((p, i) => {
    if (i === 0) return null;
    const prev = points[i - 1];
    const momChange = p.apap - prev.apap;
    return { start: prev, end: p, momChange };
  }).filter((s): s is NonNullable<typeof s> => s !== null);
  
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
        
        {/* Y-axis labels - show dynamic min/max and goal rates (always visible) */}
        {/* Bottom label (min value) */}
        <text
          x={padding.left - 8}
          y={padding.top + innerHeight + 4}
          textAnchor="end"
          fontSize="12"
          fill="var(--fg-secondary)"
        >
          {minValue.toFixed(1)}%
        </text>
        
        {/* Top label (max value) */}
        <text
          x={padding.left - 8}
          y={padding.top + 4}
          textAnchor="end"
          fontSize="12"
          fill="var(--fg-secondary)"
        >
          {maxValue.toFixed(1)}%
        </text>
        
        {/* Y-axis label at 42% (High Confidence goal) - always visible */}
        {(() => {
          const goal42Y = padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight);
          return (
            <text
              x={padding.left - 8}
              y={goal42Y + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--fg-live)"
              fontWeight="500"
            >
              42%
            </text>
          );
        })()}
        
        {/* Y-axis label at 46.2% (Hard Climb goal) - always visible */}
        {(() => {
          const goal462Y = padding.top + innerHeight - ((hardClimbGoal - minValue) / valueRange * innerHeight);
          return (
            <text
              x={padding.left - 8}
              y={goal462Y + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--fg-action)"
              fontWeight="500"
            >
              46.2%
            </text>
          );
        })()}
        
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
        {apapHistory.length > 0 && (
          <>
            <text
              x={padding.left}
              y={chartHeight - 8}
              textAnchor="middle"
              fontSize="11"
              fill="var(--fg-secondary)"
            >
              {apapHistory[0].label.split(' ')[0]}
            </text>
            {apapHistory.length > 1 && (
              <text
                x={padding.left + innerWidth}
                y={chartHeight - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--fg-secondary)"
              >
                {apapHistory[apapHistory.length - 1].label.split(' ')[0]}
              </text>
            )}
          </>
        )}
        
        {/* Goal lines - distinct from trend (purple HC, blue Hard Climb) */}
        {/* High Confidence goal line (42%) */}
        <g>
          <line
            x1={padding.left}
            y1={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight)}
            x2={padding.left + innerWidth}
            y2={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight)}
            stroke="var(--fg-live)"
            strokeWidth="2"
            strokeDasharray="6 4"
            opacity="0.85"
          />
          <text
            x={padding.left + innerWidth + 5}
            y={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight) + 4}
            fontSize="10"
            fill="var(--fg-live)"
            fontWeight="600"
          >
            High Confidence (42%)
          </text>
        </g>
        
        {/* Hard Climb goal line (46.2%) - blue to differentiate from purple and trend */}
        <g>
          <line
            x1={padding.left}
            y1={padding.top + innerHeight - ((hardClimbGoal - minValue) / valueRange * innerHeight)}
            x2={padding.left + innerWidth}
            y2={padding.top + innerHeight - ((hardClimbGoal - minValue) / valueRange * innerHeight)}
            stroke="var(--fg-action)"
            strokeWidth="2"
            strokeDasharray="4 6"
            opacity="0.9"
          />
          <text
            x={padding.left + innerWidth + 5}
            y={padding.top + innerHeight - ((hardClimbGoal - minValue) / valueRange * innerHeight) + 4}
            fontSize="10"
            fill="var(--fg-action)"
            fontWeight="600"
          >
            Hard Climb (46.2%)
          </text>
        </g>
        
        {/* Trend line segments: green = positive MoM, red = negative MoM */}
        {segments.map((seg, i) => (
          <line
            key={`seg-${i}-${seg.start.month}-${seg.end.month}`}
            x1={seg.start.x}
            y1={seg.start.y}
            x2={seg.end.x}
            y2={seg.end.y}
            stroke={seg.momChange >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)'}
            strokeWidth="3"
            strokeLinecap="round"
          />
        ))}
        
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

// APAP Goal Progress trend: cohort slice, red/green MoM segments, cohort-specific goal lines, hover with rate + MoM + variance to goals
function APAPGoalProgressTrendChart({
  history,
  goalRates,
}: {
  history: Array<{ month: string; apap: number; label: string }>;
  goalRates: { highConfidencePct: number; hardClimbPct: number };
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  if (history.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--fg-secondary)', fontSize: 'var(--text-body2-size)' }}>
        No trend data for this cohort slice
      </div>
    );
  }
  const chartHeight = 260;
  const chartWidth = 520;
  const padding = { top: 15, right: 95, bottom: 40, left: 50 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const highConfidenceGoal = goalRates.highConfidencePct;
  const hardClimbGoal = goalRates.hardClimbPct;
  const values = history.map(h => h.apap);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const effectiveMin = Math.min(dataMin, highConfidenceGoal, hardClimbGoal);
  const effectiveMax = Math.max(dataMax, highConfidenceGoal, hardClimbGoal);
  const paddingPercent = effectiveMax === effectiveMin ? 2 : Math.max(2, (effectiveMax - effectiveMin) * 0.05);
  const minValue = Math.max(0, effectiveMin - paddingPercent);
  const maxValue = Math.min(100, effectiveMax + paddingPercent);
  const valueRange = maxValue - minValue || 1;
  const xStep = innerWidth / Math.max(1, history.length - 1);
  const points = history.map((entry, i) => {
    const x = padding.left + (i * xStep);
    const y = padding.top + innerHeight - ((entry.apap - minValue) / valueRange * innerHeight);
    const momChange = i > 0 ? entry.apap - history[i - 1].apap : null;
    return { x, y, ...entry, momChange };
  });
  const segments = points.map((p, i) => {
    if (i === 0) return null;
    const prev = points[i - 1];
    return { start: prev, end: p, momChange: p.apap - prev.apap };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div style={{ position: 'relative', overflow: 'visible' }}>
      <div style={{ fontSize: 'var(--text-body2-size)', fontWeight: 'var(--text-subtitle-weight)', color: 'var(--fg-primary)', marginBottom: '0.5rem', textAlign: 'center' }}>
        Progress to High Confidence and Hard Climb goals
      </div>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: chartHeight, overflow: 'visible' }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + innerHeight} stroke="var(--border-color)" strokeWidth="1" />
        <text x={padding.left - 8} y={padding.top + innerHeight + 4} textAnchor="end" fontSize="11" fill="var(--fg-secondary)">{minValue.toFixed(1)}%</text>
        <text x={padding.left - 8} y={padding.top + 4} textAnchor="end" fontSize="11" fill="var(--fg-secondary)">{maxValue.toFixed(1)}%</text>
        {/* Goal lines — cohort-specific; combine into one line/label when HC and Hard Climb are the same */}
        {Math.abs(highConfidenceGoal - hardClimbGoal) < 0.01 ? (
          <g>
            <line
              x1={padding.left}
              y1={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight)}
              x2={padding.left + innerWidth}
              y2={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight)}
              stroke="var(--fg-live)"
              strokeWidth="2"
              strokeDasharray="6 4"
              opacity={0.9}
            />
            <text x={padding.left + innerWidth + 8} y={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight) + 4} fontSize="10" fill="var(--fg-live)" fontWeight="600">
              High Confidence &amp; Hard Climb {highConfidenceGoal.toFixed(1)}%
            </text>
          </g>
        ) : (
          <>
            <line
              x1={padding.left}
              y1={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight)}
              x2={padding.left + innerWidth}
              y2={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight)}
              stroke="var(--fg-live)"
              strokeWidth="2"
              strokeDasharray="6 4"
              opacity={0.85}
            />
            <text x={padding.left + innerWidth + 8} y={padding.top + innerHeight - ((highConfidenceGoal - minValue) / valueRange * innerHeight) + 4} fontSize="10" fill="var(--fg-live)" fontWeight="600">
              HC {highConfidenceGoal.toFixed(1)}%
            </text>
            <line
              x1={padding.left}
              y1={padding.top + innerHeight - ((hardClimbGoal - minValue) / valueRange * innerHeight)}
              x2={padding.left + innerWidth}
              y2={padding.top + innerHeight - ((hardClimbGoal - minValue) / valueRange * innerHeight)}
              stroke="var(--fg-action)"
              strokeWidth="2"
              strokeDasharray="4 6"
              opacity={0.9}
            />
            <text x={padding.left + innerWidth + 8} y={padding.top + innerHeight - ((hardClimbGoal - minValue) / valueRange * innerHeight) + 4} fontSize="10" fill="var(--fg-action)" fontWeight="600">
              Hard Climb {hardClimbGoal.toFixed(1)}%
            </text>
          </>
        )}
        {/* Trend segments: green = positive MoM, red = negative */}
        {segments.map((seg, i) => (
          <line key={`gseg-${i}`} x1={seg.start.x} y1={seg.start.y} x2={seg.end.x} y2={seg.end.y} stroke={seg.momChange >= 0 ? 'var(--fg-success)' : 'var(--fg-destructive)'} strokeWidth="3" strokeLinecap="round" />
        ))}
        {points.map((point, i) => {
          const isHovered = hoveredIndex === i;
          const momChange = point.momChange;
          const varianceHC = point.apap - highConfidenceGoal;
          const varianceHardClimb = point.apap - hardClimbGoal;
          return (
            <g key={i}>
              <circle cx={point.x} cy={point.y} r={isHovered ? 6 : 4} fill="var(--fg-action)" stroke="white" strokeWidth={isHovered ? 2 : 1} onMouseEnter={() => setHoveredIndex(i)} style={{ cursor: 'pointer' }} />
              {isHovered && (
                <g>
                  <rect x={point.x - 100} y={point.y - 88} width="200" height="84" fill="var(--surface-3)" stroke="var(--border-color)" rx="6" />
                  <text x={point.x} y={point.y - 72} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--fg-primary)">{point.label}</text>
                  <text x={point.x} y={point.y - 56} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--fg-action)">{point.apap.toFixed(1)}%</text>
                  {momChange !== null && <text x={point.x} y={point.y - 40} textAnchor="middle" fontSize="10" fill="var(--fg-secondary)">MoM {(momChange >= 0 ? '+' : '') + momChange.toFixed(1)}pp</text>}
                  <text x={point.x} y={point.y - 26} textAnchor="middle" fontSize="10" fill="var(--fg-secondary)">vs HC {(varianceHC >= 0 ? '+' : '') + varianceHC.toFixed(1)}pp</text>
                  <text x={point.x} y={point.y - 12} textAnchor="middle" fontSize="10" fill="var(--fg-secondary)">vs Hard Climb {(varianceHardClimb >= 0 ? '+' : '') + varianceHardClimb.toFixed(1)}pp</text>
                </g>
              )}
            </g>
          );
        })}
        <line x1={padding.left} y1={padding.top + innerHeight} x2={padding.left + innerWidth} y2={padding.top + innerHeight} stroke="var(--border-color)" strokeWidth="1" />
        {points.map((p, i) => (i === 0 || i === points.length - 1 ? <text key={i} x={p.x} y={chartHeight - 10} textAnchor="middle" fontSize="10" fill="var(--fg-secondary)">{p.label.split(' ')[0]}</text> : null))}
      </svg>
    </div>
  );
}
