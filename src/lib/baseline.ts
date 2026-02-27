import * as XLSX from 'xlsx';
import type { Agency } from './schema';

export type BaselineAgency = {
  agency_id: string; // From AgencySlug column A
  adopting_points: number; // From Column P "No Qualifier Adopting Points"
  is_adopting: boolean; // true if adopting_points > 0
  // Additional fields from Data sheet for eligibility and cohort matching
  officer_count?: number; // For computing points
  eligibility_cohort?: number; // Months since purchase (for structural slice filtering)
  purchase_cohort?: string; // Time since purchase cohort
  agency_size_band?: string; // Agency size band
  months_since_purchase?: number; // Months since purchase (for eligibility)
  is_eligible?: boolean; // Whether agency was eligible in November (6+ months)
};

export type BaselineData = {
  baseline_apap: number; // 37.1% from Goal Model (Final) H24
  baseline_date: string; // November 2025
  agencies: Map<string, BaselineAgency>; // agency_id -> BaselineAgency
  goal_high_confidence: number; // 42%
  goal_hard_climb: number; // 46.2%
  cohort_targets: Array<{
    cohort_name: string; // From column M
    target_adoption_rate: number; // From column N
    sub_cohorts?: Array<{
      sub_cohort_name: string;
      target_adoption_rate: number;
    }>;
  }>;
};

const BASELINE_STORAGE_KEY = 'apap_baseline_data';
const BASELINE_FILE_PATH = '/2026 VR APAP Threshold Modeling.xlsx';

/**
 * Load baseline data from a URL (e.g., from public folder)
 */
export async function loadBaselineFromUrl(url: string = BASELINE_FILE_PATH): Promise<BaselineData> {
  try {
    // URL encode the path to handle spaces
    const encodedUrl = url.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const response = await fetch(encodedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch baseline file: ${response.statusText} (tried: ${encodedUrl})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    return parseBaselineData(data);
  } catch (err) {
    throw new Error(`Failed to load baseline from URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * Parse baseline data from Excel array buffer
 */
function parseBaselineData(data: Uint8Array): BaselineData {
  const workbook = XLSX.read(data, { type: 'array' });

  // Read Goal Model (Final) sheet
  const goalSheet = workbook.Sheets['Goal Model (Final)'];
  if (!goalSheet) {
    throw new Error('Goal Model (Final) sheet not found');
  }

  // Get baseline APAP from H24
  // Excel stores percentages as decimals (37.1% = 0.371), so we need to check the format
  const h24Cell = goalSheet['H24'];
  let baselineAPAP = h24Cell?.v || 0;
  
  console.log(`🔍 Raw H24 cell value:`, h24Cell);
  console.log(`🔍 Raw baselineAPAP value:`, baselineAPAP);
  console.log(`🔍 Cell type:`, h24Cell?.t, `Cell format:`, h24Cell?.z);
  
  if (typeof baselineAPAP !== 'number') {
    throw new Error('Baseline APAP (H24) must be a number');
  }
  
  // Check if the value is likely a percentage (between 0 and 1)
  // If it's less than 1, it's probably stored as a decimal percentage (0.371 = 37.1%)
  // If it's already a percentage (37.1), use it as-is
  if (baselineAPAP > 0 && baselineAPAP < 1) {
    // Convert from decimal to percentage (0.371 -> 37.1)
    const originalValue = baselineAPAP;
    baselineAPAP = baselineAPAP * 100;
    console.log(`📊 Converted baseline APAP from decimal ${originalValue} to percentage ${baselineAPAP.toFixed(1)}%`);
  } else if (baselineAPAP >= 1 && baselineAPAP <= 100) {
    // Already a percentage, use as-is
    console.log(`📊 Baseline APAP read as percentage: ${baselineAPAP.toFixed(1)}%`);
  } else if (baselineAPAP > 100) {
    // Value is > 100, might be stored as 3710 for 37.1% (unlikely but possible)
    console.warn(`⚠️ Baseline APAP value is > 100: ${baselineAPAP}. This seems unusual.`);
  } else {
    console.warn(`⚠️ Baseline APAP value seems unusual: ${baselineAPAP}. Expected 0-1 (decimal) or 1-100 (percentage)`);
  }
  
  // Final validation - baseline should be around 37.1%
  if (baselineAPAP < 30 || baselineAPAP > 50) {
    console.warn(`⚠️ Baseline APAP (${baselineAPAP.toFixed(1)}%) seems outside expected range (30-50%). Expected ~37.1%`);
  }

  // Read Data sheet
  const dataSheet = workbook.Sheets['Data'];
  if (!dataSheet) {
    throw new Error('Data sheet not found');
  }

  const dataRows = XLSX.utils.sheet_to_json(dataSheet, { raw: true, defval: null });
  
  // Debug: log first few rows to see what columns are available
  if (dataRows.length > 0) {
    console.log('🔍 Baseline Data sheet - Total rows:', dataRows.length);
    console.log('🔍 Baseline Data sheet columns:', Object.keys(dataRows[0] as Record<string, unknown>));
    // Log a few sample rows to see the data structure
    const sampleRows = dataRows.slice(0, 5).map((row: any) => ({
      AgencySlug: row['AgencySlug'],
      AgencySize: row['AgencySize'],
      'No Qualifier Adopting Points': row['No Qualifier Adopting Points'],
      Eligibility_Cohort: row['Eligibility_Cohort'] ?? row['eligibility_cohort'] ?? row['Eligibility Cohort'],
    }));
    console.log('🔍 Sample baseline rows (first 5):', sampleRows);
  }
  
  // Parse agencies from Data sheet
  const agencies = new Map<string, BaselineAgency>();
  let skippedRows = 0;
  let skippedReasons: Record<string, number> = {};
  
  for (const row of dataRows as any[]) {
    // Use the exact column name from the sheet
    const agencySlug = row['AgencySlug'];
    const adoptingPoints = row['No Qualifier Adopting Points'];
    // AgencySize column contains officer_count (eligible points)
    const agencySize = row['AgencySize'];
    // Eligibility_Cohort column - filter to only include agencies with eligibility_cohort >= 6
    const eligibilityCohort = row['Eligibility_Cohort'] ?? row['eligibility_cohort'] ?? row['Eligibility Cohort'];
    
    // Check if row has valid agency ID
    if (!agencySlug) {
      skippedRows++;
      skippedReasons['no_agency_slug'] = (skippedReasons['no_agency_slug'] || 0) + 1;
      continue;
    }
    
    // Convert to string and check if it's not empty
    const agencyId = String(agencySlug).trim();
    if (agencyId === '' || agencyId === 'undefined' || agencyId === 'null') {
      skippedRows++;
      skippedReasons['empty_agency_slug'] = (skippedReasons['empty_agency_slug'] || 0) + 1;
      continue;
    }
    
    // FILTER: Only include agencies with eligibility_cohort >= 6
    if (eligibilityCohort !== undefined && eligibilityCohort !== null) {
      const cohortValue = typeof eligibilityCohort === 'number' 
        ? eligibilityCohort 
        : (typeof eligibilityCohort === 'string' ? parseFloat(String(eligibilityCohort)) : NaN);
      
      if (!isNaN(cohortValue) && cohortValue < 6) {
        skippedRows++;
        skippedReasons['ineligible_cohort'] = (skippedReasons['ineligible_cohort'] || 0) + 1;
        continue; // Skip agencies with eligibility_cohort < 6
      }
    }
    
    // Parse adopting points
    const points = typeof adoptingPoints === 'number' 
      ? adoptingPoints 
      : (adoptingPoints ? parseFloat(String(adoptingPoints)) : 0) || 0;
    
    // Parse eligible points (officer_count) from AgencySize column
    const eligible = typeof agencySize === 'number'
      ? agencySize
      : (agencySize ? parseFloat(String(agencySize)) : 0) || 0;
    
    const cohortNum = typeof eligibilityCohort === 'number'
      ? eligibilityCohort
      : (eligibilityCohort != null && eligibilityCohort !== '' ? parseFloat(String(eligibilityCohort)) : undefined);
    agencies.set(agencyId, {
      agency_id: agencyId,
      adopting_points: points,
      is_adopting: points > 0,
      officer_count: eligible > 0 ? eligible : undefined,
      eligibility_cohort: cohortNum != null && !Number.isNaN(cohortNum) ? cohortNum : undefined,
    });
  }
  
  console.log('🔍 Baseline parsing summary:', {
    totalRows: dataRows.length,
    agenciesParsed: agencies.size,
    skippedRows,
    skippedReasons,
    note: 'Only agencies with Eligibility_Cohort >= 6 are included in baseline',
  });

  // Parse cohort targets from Goal Model (Final) sheet
  // Columns M (cohort name), N (target adoption rate), O (description)
  // Merged cells (e.g., M-N 30) are main cohorts, cells below are sub-cohorts
  const cohortTargets: BaselineData['cohort_targets'] = [];
  
  // Read rows to find cohort definitions
  // Look for merged cells and sub-cohorts starting around row 30
  const goalRows = XLSX.utils.sheet_to_json(goalSheet, { header: 1, raw: true, defval: null });
  
  // Find the range where cohorts are defined (typically around rows 30+)
  // We'll look for patterns in columns M, N, O
  let currentCohort: { cohort_name: string; target_adoption_rate: number; sub_cohorts: any[] } | null = null;
  
  for (let i = 29; i < Math.min(goalRows.length, 100); i++) { // Start from row 30 (0-indexed = 29)
    const row = goalRows[i] as any[];
    if (!row || row.length < 15) continue;
    
    const mVal = row[12]; // Column M (0-indexed, M is column 13 = index 12)
    const nVal = row[13]; // Column N
    
    // Check if this is a main cohort (has value in M and N)
    if (mVal && typeof mVal === 'string' && mVal.trim() && mVal.trim() !== '') {
      const targetRate = typeof nVal === 'number' ? nVal : (typeof nVal === 'string' ? parseFloat(nVal) : 0) || 0;
      
      // Check if this looks like a main cohort (not a sub-cohort name like "Major", "T1200", "Other")
      const isSubCohortName = ['Major', 'T1200', 'Other', 'Small', 'Direct'].includes(mVal.trim());
      
      if (!isSubCohortName && targetRate > 0) {
        // If we have a previous cohort, save it
        if (currentCohort) {
          cohortTargets.push({
            cohort_name: currentCohort.cohort_name,
            target_adoption_rate: currentCohort.target_adoption_rate,
            sub_cohorts: currentCohort.sub_cohorts.length > 0 ? currentCohort.sub_cohorts : undefined,
          });
        }
        
        // Start new cohort
        currentCohort = {
          cohort_name: mVal.trim(),
          target_adoption_rate: targetRate,
          sub_cohorts: [],
        };
      } else if (currentCohort && isSubCohortName && targetRate > 0) {
        // This is a sub-cohort
        currentCohort.sub_cohorts.push({
          sub_cohort_name: mVal.trim(),
          target_adoption_rate: targetRate,
        });
      }
    }
  }
  
  // Add the last cohort
  if (currentCohort) {
    cohortTargets.push({
      cohort_name: currentCohort.cohort_name,
      target_adoption_rate: currentCohort.target_adoption_rate,
      sub_cohorts: currentCohort.sub_cohorts.length > 0 ? currentCohort.sub_cohorts : undefined,
    });
  }

  const baselineData: BaselineData = {
    baseline_apap: baselineAPAP,
    baseline_date: '2025-11',
    agencies,
    goal_high_confidence: 42,
    goal_hard_climb: 46.2,
    cohort_targets: cohortTargets,
  };

  // Save to localStorage
  localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselineData, (key, value) => {
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    return value;
  }));

  return baselineData;
}

/**
 * Load baseline data from the Excel file
 * This should be called once to initialize the baseline
 */
export async function loadBaselineFromFile(file: File): Promise<BaselineData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const baselineData = parseBaselineData(data);
        resolve(baselineData);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Get baseline data from localStorage
 */
export function getBaselineData(): BaselineData | null {
  try {
    const stored = localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    
    // Check if baseline_apap seems incorrect (likely a decimal that wasn't converted)
    // If it's less than 1, it's probably a decimal percentage that needs conversion
    if (parsed.baseline_apap !== undefined && parsed.baseline_apap < 1 && parsed.baseline_apap > 0) {
      console.warn('⚠️ Baseline APAP appears to be a decimal percentage. Clearing cache to force reload.');
      localStorage.removeItem(BASELINE_STORAGE_KEY);
      return null; // Force reload from file
    }
    
    // Convert agencies Map from array format
    if (parsed.agencies && Array.isArray(parsed.agencies)) {
      parsed.agencies = new Map(parsed.agencies);
    } else if (parsed.agencies && typeof parsed.agencies === 'object' && !(parsed.agencies instanceof Map)) {
      parsed.agencies = new Map(Object.entries(parsed.agencies));
    }
    return parsed as BaselineData;
  } catch (err) {
    console.error('Failed to load baseline data:', err);
    return null;
  }
}

/**
 * Initialize baseline data - tries to load from localStorage first, then from URL if not found
 * This should be called on app startup
 */
export async function initializeBaseline(): Promise<BaselineData | null> {
  // First, try to get from localStorage
  const stored = getBaselineData();
  if (stored) {
    return stored;
  }

  // If not in localStorage, try to load from public folder
  try {
    const baselineData = await loadBaselineFromUrl();
    // Save to localStorage for future use
    if (baselineData) {
      try {
        localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselineData, (key, value) => {
          if (value instanceof Map) {
            return Array.from(value.entries());
          }
          return value;
        }));
      } catch (err) {
        console.error('Failed to save baseline to localStorage:', err);
      }
    }
    return baselineData;
  } catch (err) {
    console.warn('Baseline file not found or failed to load:', err);
    return null;
  }
}

/**
 * Compare current agency status with baseline
 */
export type BaselineComparison = {
  agency_id: string;
  agency_name: string;
  baseline_status: 'adopting' | 'not_adopting';
  current_status: 'adopting' | 'not_adopting';
  status_change: 'newly_adopting' | 'newly_not_adopting' | 'unchanged';
  baseline_adopting_points: number;
};

export function compareAgenciesToBaseline(
  currentAgencies: Agency[],
  currentLabels: Map<string, { label: string; agency_name: string }>,
  baseline: BaselineData
): BaselineComparison[] {
  const comparisons: BaselineComparison[] = [];

  for (const agency of currentAgencies) {
    const baselineAgency = baseline.agencies.get(agency.agency_id);
    if (!baselineAgency) continue; // Skip agencies not in baseline

    const currentLabel = currentLabels.get(agency.agency_id);
    const isCurrentlyAdopting = currentLabel && 
      (currentLabel.label === 'Adopting' || currentLabel.label === 'Top Performer');

    const baselineStatus: 'adopting' | 'not_adopting' = baselineAgency.is_adopting ? 'adopting' : 'not_adopting';
    const currentStatus: 'adopting' | 'not_adopting' = isCurrentlyAdopting ? 'adopting' : 'not_adopting';

    let statusChange: 'newly_adopting' | 'newly_not_adopting' | 'unchanged' = 'unchanged';
    if (baselineStatus === 'adopting' && currentStatus === 'not_adopting') {
      statusChange = 'newly_not_adopting';
    } else if (baselineStatus === 'not_adopting' && currentStatus === 'adopting') {
      statusChange = 'newly_adopting';
    }

    comparisons.push({
      agency_id: agency.agency_id,
      agency_name: currentLabel?.agency_name || agency.agency_name,
      baseline_status: baselineStatus,
      current_status: currentStatus,
      status_change: statusChange,
      baseline_adopting_points: baselineAgency.adopting_points,
    });
  }

  return comparisons;
}

/**
 * Find agencies that were in baseline but are no longer in current data
 */
export function findMissingBaselineAgencies(
  currentAgencies: Agency[],
  baseline: BaselineData
): Array<{ agency_id: string; baseline_adopting_points: number; was_adopting: boolean }> {
  const currentAgencyIds = new Set(currentAgencies.map(a => a.agency_id));
  const missing: Array<{ agency_id: string; baseline_adopting_points: number; was_adopting: boolean }> = [];

  for (const [agencyId, baselineAgency] of baseline.agencies.entries()) {
    if (!currentAgencyIds.has(agencyId)) {
      missing.push({
        agency_id: agencyId,
        baseline_adopting_points: baselineAgency.adopting_points,
        was_adopting: baselineAgency.is_adopting,
      });
    }
  }

  return missing;
}
