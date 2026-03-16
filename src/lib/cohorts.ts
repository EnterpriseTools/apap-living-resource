import type { Agency } from './schema';
import { computeMonthsSincePurchase } from './compute';
import { getLineSizeBand } from './domain';

/**
 * Get Purchase Cohort label from eligibility_cohort value
 * 
 * eligibility_cohort represents months since purchase (0-100, or null/undefined)
 * 
 * Mapping:
 * - null/undefined = "No Purchase"
 * - 0-5 = "Ineligible"
 * - 6-12 = "Year 1"
 * - 13-24 = "Year 2"
 * - 25-36 = "Year 3"
 * - 37-48 = "Year 4"
 * - etc. (continues in 12-month increments)
 */
export function getPurchaseCohort(eligibilityCohort: number | null | undefined): string {
  if (eligibilityCohort === null || eligibilityCohort === undefined) {
    return 'No Purchase';
  }

  // Validate eligibility_cohort is reasonable (0-100 months)
  if (eligibilityCohort < 0 || eligibilityCohort > 100) {
    console.warn(`Invalid eligibility_cohort value: ${eligibilityCohort}. Expected 0-100 months.`);
    return 'No Purchase';
  }

  if (eligibilityCohort <= 5) {
    return 'Ineligible';
  } else if (eligibilityCohort <= 12) {
    return 'Year 1';
  } else if (eligibilityCohort <= 24) {
    return 'Year 2';
  } else if (eligibilityCohort <= 36) {
    return 'Year 3';
  } else if (eligibilityCohort <= 48) {
    return 'Year 4';
  } else {
    // Continue in 12-month increments
    const year = Math.floor((eligibilityCohort - 1) / 12) + 1;
    return `Year ${year}`;
  }
}

/**
 * Enrich agency with derived fields
 */
export function enrichAgency(
  agency: import('./schema').AgencyRow,
  asOfMonth: Date | null
): Agency {
  // Use eligibility_cohort directly (it's already months since purchase)
  // If not available, try to compute from purchase_date as fallback
  let monthsSincePurchase: number | null = null;
  
  if (agency.eligibility_cohort !== undefined && agency.eligibility_cohort !== null) {
    // Coerce to number if it's a string
    let cohortValue: number | null = null;
    if (typeof agency.eligibility_cohort === 'string') {
      const parsed = parseFloat(agency.eligibility_cohort);
      if (isNaN(parsed)) {
        console.warn(`eligibility_cohort is a non-numeric string: "${agency.eligibility_cohort}" for agency ${agency.agency_id}`);
        cohortValue = null;
      } else {
        cohortValue = parsed;
      }
    } else {
      cohortValue = agency.eligibility_cohort;
    }
    
    if (cohortValue !== null && cohortValue !== undefined) {
      // Validate eligibility_cohort is reasonable (0-100 months)
      if (cohortValue >= 0 && cohortValue <= 100) {
        monthsSincePurchase = cohortValue;
      } else {
        console.warn(`Invalid eligibility_cohort value: ${cohortValue} for agency ${agency.agency_id}. Expected 0-100 months.`);
        monthsSincePurchase = null;
      }
    }
  } else if (agency.purchase_date && asOfMonth) {
    // Fall back to computing from purchase_date if eligibility_cohort is not available
    monthsSincePurchase = computeMonthsSincePurchase(agency.purchase_date, asOfMonth);
  }

  const purchaseCohort = getPurchaseCohort(monthsSincePurchase);
  const agencySizeBand = getLineSizeBand(agency.officer_count) ?? 'Unknown (No officer count)';

  return {
    ...agency,
    agency_size_band: agencySizeBand,
    months_since_purchase: monthsSincePurchase,
    purchase_cohort: purchaseCohort,
    as_of_month: asOfMonth,
  };
}

/**
 * Check if agency is near eligible (months_since_purchase == 4 or 5)
 */
export function isNearEligible(agency: Agency): boolean {
  return agency.months_since_purchase === 4 || agency.months_since_purchase === 5;
}

/**
 * Check if agency is ineligible (months_since_purchase 0–5), i.e. purchased but not yet in the
 * 6-month eligibility window. Agencies with null months_since_purchase are excluded.
 */
export function isIneligible(agency: Agency): boolean {
  return agency.months_since_purchase !== null && agency.months_since_purchase >= 0 && agency.months_since_purchase <= 5;
}
