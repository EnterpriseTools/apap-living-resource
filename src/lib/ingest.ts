import * as XLSX from 'xlsx';
import { AgencyRowSchema, TelemetryRowSchema, type AgencyRow, type TelemetryRow, type TelemetryMonthly, type DataQualityReport } from './schema';
import { normalizeMonth, normalizeProduct } from './compute';

/**
 * Expected column order for the agency info sheet (not required; columns are matched by name).
 * Use for documentation and UI hints only.
 */
export const EXPECTED_AGENCY_COLUMN_ORDER = [
  'agency_id',
  'agency_name',
  'officer_count',
  'vr_licenses',
  'eligibility_cohort',
] as const;

/**
 * Parse Agencies.xlsx file
 */
export function parseAgenciesFile(file: File): Promise<AgencyRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // Read with raw: true to preserve numeric values (numbers stay as numbers, not strings)
        const rows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: null });

        // Debug: Log first row to see what columns are actually present
        if (rows.length > 0) {
          console.log('=== Excel File Debug ===');
          const firstRow: any = rows[0];
          console.log('First row keys:', Object.keys(firstRow));
          console.log('First row sample:', firstRow);
          // Check for case variations
          const possibleLicenseKeys = Object.keys(firstRow).filter(k => 
            k.toLowerCase().includes('license') || k.toLowerCase().includes('vr')
          );
          console.log('Possible license-related columns:', possibleLicenseKeys);
          if (possibleLicenseKeys.length > 0) {
            console.log('Sample license values:', possibleLicenseKeys.map(k => ({ key: k, value: firstRow[k] })));
          }
        }

        const agencies: AgencyRow[] = [];
        for (const row of rows) {
          try {
            // Pre-process row to handle empty strings and "N/A" values for numeric fields
            const processedRow: any = {};
            Object.assign(processedRow, row);
            
            // Normalize column names (handle case sensitivity and spaces)
            const normalizeKey = (key: string): string => {
              return key.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            };
            
            // Create a normalized mapping
            const normalizedRow: any = {};
            
            // Map all columns, trying exact match first, then normalized match
            for (const [key, value] of Object.entries(processedRow)) {
              const normalizedKey = normalizeKey(key);
              
              // Map to expected field names (case-insensitive, space-insensitive)
              if (normalizedKey === 'vr_licenses' || normalizedKey === 'vrlicenses' || normalizedKey === 'vr_license' || normalizedKey === 'vrlicense') {
                normalizedRow.vr_licenses = value;
              } else if (normalizedKey === 'officer_count' || normalizedKey === 'officercount' || normalizedKey === 'officers') {
                normalizedRow.officer_count = value;
              } else if (normalizedKey === 'agency_id' || normalizedKey === 'agencyid' || (normalizedKey === 'agency' && !normalizedRow.agency_id)) {
                // Convert agency_id to string (Excel may read it as a number)
                normalizedRow.agency_id = value != null ? String(value) : value;
              } else if (normalizedKey === 'agency_name' || normalizedKey === 'agencyname' || (normalizedKey === 'name' && !normalizedRow.agency_name)) {
                // Convert agency_name to string
                normalizedRow.agency_name = value != null ? String(value) : value;
              } else if (normalizedKey === 'purchase_date' || normalizedKey === 'purchasedate') {
                normalizedRow.purchase_date = value;
              } else if (normalizedKey === 'eligibility_cohort' || normalizedKey === 'eligibilitycohort') {
                normalizedRow.eligibility_cohort = value;
              } else if (normalizedKey === 'cew_type' || normalizedKey === 'cewtype') {
                // Convert cew_type to string and normalize (trim, uppercase)
                if (value != null) {
                  const normalized = String(value).trim().toUpperCase();
                  // Map common variations to T10/T7
                  if (normalized === 'T10' || normalized === 'T-10' || normalized === '10') {
                    normalizedRow.cew_type = 'T10';
                  } else if (normalized === 'T7' || normalized === 'T-7' || normalized === '7') {
                    normalizedRow.cew_type = 'T7';
                  } else {
                    // Invalid value - will be filtered out, but keep it for logging
                    normalizedRow.cew_type = undefined;
                  }
                } else {
                  normalizedRow.cew_type = value;
                }
              } else {
                // Keep original key for other fields (region, csm_owner, notes, etc.)
                normalizedRow[key] = value;
              }
            }
            
            // Debug: Log first few rows to see what's happening
            if (rows.indexOf(row) < 3) {
              const hasVrLicenses = normalizedRow.vr_licenses !== undefined && normalizedRow.vr_licenses !== null && normalizedRow.vr_licenses !== '';
              if (!hasVrLicenses) {
                console.log(`Row ${rows.indexOf(row) + 1} - Missing vr_licenses. Original keys:`, Object.keys(processedRow));
                console.log(`Row ${rows.indexOf(row) + 1} - vr_licenses value:`, normalizedRow.vr_licenses);
                console.log(`Row ${rows.indexOf(row) + 1} - All normalized values:`, {
                  vr_licenses: normalizedRow.vr_licenses,
                  agency_id: normalizedRow.agency_id,
                  agency_name: normalizedRow.agency_name?.substring(0, 30)
                });
              }
            }
            
            // Convert empty strings, "N/A", "n/a", null, undefined, 0, or negative to undefined for optional numeric fields
            const numericFields = ['vr_licenses', 'officer_count', 'eligibility_cohort'];
            for (const field of numericFields) {
              const value = normalizedRow[field];
              if (value === '' || value === 'N/A' || value === 'n/a' || value === null || value === undefined) {
                normalizedRow[field] = undefined;
              } else if (typeof value === 'string') {
                // Try to parse string numbers
                const parsed = parseFloat(value);
                if (isNaN(parsed)) {
                  normalizedRow[field] = undefined;
                } else if (field === 'vr_licenses' && parsed <= 0) {
                  // vr_licenses must be > 0, so 0 or negative = undefined
                  normalizedRow[field] = undefined;
                } else if (field === 'officer_count' && parsed < 0) {
                  // officer_count can be 0, but not negative
                  normalizedRow[field] = undefined;
                } else {
                  normalizedRow[field] = parsed;
                }
              } else if (typeof value === 'number') {
                // Handle numeric values directly
                if (field === 'vr_licenses' && value <= 0) {
                  // vr_licenses must be > 0
                  normalizedRow[field] = undefined;
                } else if (field === 'officer_count' && value < 0) {
                  // officer_count can be 0, but not negative
                  normalizedRow[field] = undefined;
                }
                // Otherwise keep the number as-is
              }
            }
            
            const parsed = AgencyRowSchema.parse(normalizedRow);
            agencies.push(parsed);
          } catch (err) {
            console.warn('Failed to parse agency row:', row, err);
            // Log the row that failed for debugging
            if (rows.indexOf(row) < 3) {
              console.warn('Failed row data:', row);
            }
          }
        }
        
        // Log cew_type distribution before filtering
        const cewTypeDistribution = new Map<string, number>();
        agencies.forEach(a => {
          const cewType = a.cew_type || '(missing - assumed T10)';
          cewTypeDistribution.set(cewType, (cewTypeDistribution.get(cewType) || 0) + 1);
        });
        
        // FILTER: Only include T10 agencies
        // If cew_type is missing/undefined, set it to 'T10' (since requirement is that only T10 agencies should be uploaded)
        // Only filter out agencies that explicitly have a non-T10 value (like "T7")
        const t10Agencies = agencies
          .map(a => {
            // If cew_type is missing, set it to 'T10' explicitly
            if (!a.cew_type) {
              return { ...a, cew_type: 'T10' as const };
            }
            return a;
          })
          .filter(a => a.cew_type === 'T10');
        const filteredCount = agencies.length - t10Agencies.length;
        
        // Log detailed information about what was parsed
        console.log(`=== Agency File Parsing Summary ===`);
        console.log(`Total rows parsed: ${agencies.length}`);
        console.log(`CEW Type distribution:`, Object.fromEntries(cewTypeDistribution));
        console.log(`T10 agencies: ${t10Agencies.length}`);
        console.log(`Non-T10 agencies filtered out: ${filteredCount}`);
        
        if (agencies.length === 0) {
          console.warn('⚠️ No agencies were successfully parsed from the file. Check column names and data format.');
        } else if (t10Agencies.length === 0) {
          console.warn(`⚠️ ${agencies.length} agencies were parsed, but all were filtered out (non-T10 cew_type values found).`);
          console.warn('⚠️ CEW Type values found:', Array.from(cewTypeDistribution.keys()));
          console.warn('⚠️ Only T10 agencies should be included in the file. Agencies with cew_type="T7" or other values will be filtered out.');
        }
        
        if (filteredCount > 0) {
          console.log(`Filtered out ${filteredCount} non-T10 agencies. Only T10 agencies are processed.`);
        }
        
        // Debug: Check how many agencies have licenses after parsing
        const withLicenses = t10Agencies.filter(a => a.vr_licenses && a.vr_licenses > 0).length;
        console.log(`Parsed ${t10Agencies.length} T10 agencies, ${withLicenses} have vr_licenses > 0`);

        resolve(t10Agencies);
      } catch (err) {
        reject(new Error(`Failed to parse agency file: ${err}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse a telemetry .xlsx file
 */
export function parseTelemetryFile(file: File): Promise<TelemetryRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { raw: false });

        const telemetry: TelemetryRow[] = [];
        let dec2025Count = 0;
        let dec2025Errors = 0;
        
        for (const row of rows) {
          try {
            // Check if this row might be December 2025 before parsing
            const rowAny = row as any;
            const monthValue = rowAny.month || rowAny.Month || rowAny.MONTH;
            const isDec2025Candidate = monthValue && (
              String(monthValue).includes('2025-12') || 
              String(monthValue).includes('12/2025') ||
              String(monthValue).includes('Dec 2025') ||
              String(monthValue).includes('December 2025')
            );
            
            if (isDec2025Candidate) {
              dec2025Count++;
              console.log(`🔍 Found potential Dec 2025 row ${dec2025Count}:`, {
                rawMonth: monthValue,
                monthType: typeof monthValue,
                row: row
              });
            }
            
            const parsed = TelemetryRowSchema.parse(row);
            
            // Check if parsed month is December 2025
            if (parsed.month) {
              const monthStr = parsed.month instanceof Date 
                ? `${parsed.month.getFullYear()}-${String(parsed.month.getMonth() + 1).padStart(2, '0')}`
                : String(parsed.month);
              if (monthStr === '2025-12') {
                console.log(`✅ Successfully parsed Dec 2025 row:`, {
                  month: parsed.month,
                  monthFormatted: monthStr,
                  agency_id: parsed.agency_id
                });
              }
            }
            
            telemetry.push(parsed);
          } catch (err) {
            // Check if this was a December 2025 row that failed
            const monthValue = (row as any).month || (row as any).Month || (row as any).MONTH;
            const isDec2025Candidate = monthValue && (
              String(monthValue).includes('2025-12') || 
              String(monthValue).includes('12/2025') ||
              String(monthValue).includes('Dec 2025')
            );
            
            if (isDec2025Candidate) {
              dec2025Errors++;
              console.error(`❌ Failed to parse Dec 2025 row:`, {
                rawMonth: monthValue,
                row: row,
                error: err
              });
            } else {
              console.warn('Failed to parse telemetry row:', row, err);
            }
          }
        }
        
        console.log(`📊 December 2025 parsing summary: ${dec2025Count} candidates found, ${dec2025Errors} failed to parse`);
        console.log(`📊 Total telemetry rows parsed: ${telemetry.length}`);

        resolve(telemetry);
      } catch (err) {
        reject(new Error(`Failed to parse telemetry file: ${err}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Normalize telemetry rows (normalize month and product)
 */
export function normalizeTelemetry(rows: TelemetryRow[]): TelemetryMonthly[] {
  let dec2025Before = 0;
  let dec2025After = 0;
  let sampleDecRow: TelemetryRow | null = null;
  
  console.log(`🔍 normalizeTelemetry: Processing ${rows.length} rows`);
  
  const normalized = rows.map((row, index) => {
    // Check if this row is December 2025 before normalization
    const originalMonth = row.month;
    let isDec2025Before = false;
    
    if (originalMonth instanceof Date) {
      const year = originalMonth.getFullYear();
      const month = originalMonth.getMonth() + 1;
      if (year === 2025 && month === 12) {
        dec2025Before++;
        isDec2025Before = true;
        if (!sampleDecRow) {
          sampleDecRow = row;
        }
      }
    }
    
    const normalizedMonth = normalizeMonth(row.month);
    
    // Check if normalized month is still December 2025
    if (normalizedMonth instanceof Date) {
      const year = normalizedMonth.getFullYear();
      const month = normalizedMonth.getMonth() + 1;
      if (year === 2025 && month === 12) {
        dec2025After++;
        if (isDec2025Before && index < 5) {
          // Log first few December rows
          console.log(`✅ Dec 2025 row ${index + 1}:`, {
            original: originalMonth,
            originalType: typeof originalMonth,
            normalized: normalizedMonth.toISOString(),
            normalizedYear: year,
            normalizedMonthNum: month,
          });
        }
      } else if (isDec2025Before) {
        // December row got converted to something else
        console.error(`❌ Dec 2025 row converted to ${year}-${month}:`, {
          original: originalMonth,
          originalType: typeof originalMonth,
          normalized: normalizedMonth.toISOString(),
          normalizedYear: year,
          normalizedMonthNum: month,
        });
      }
    }
    
    return {
      month: normalizedMonth,
      agency_id: row.agency_id,
      product: normalizeProduct(row.product),
      completions: row.completions,
      platform: row.platform,
      license_type: row.license_type,
    };
  });
  
  console.log(`📊 December 2025 normalization: ${dec2025Before} before, ${dec2025After} after`);
  
  if (dec2025Before > 0 && dec2025After === 0) {
    console.error(`❌ All December 2025 rows were lost during normalization!`);
    if (sampleDecRow) {
      const row = sampleDecRow as TelemetryRow;
      const normalizedSample = normalizeMonth(row.month);
      console.error(`❌ Sample conversion:`, {
        original: row.month,
        originalType: typeof row.month,
        normalized: normalizedSample.toISOString(),
        normalizedYear: normalizedSample.getFullYear(),
        normalizedMonth: normalizedSample.getMonth() + 1,
      });
    }
  }
  
  // Also check the final normalized array
  const finalDec2025 = normalized.filter(t => {
    const year = t.month.getFullYear();
    const month = t.month.getMonth() + 1;
    return year === 2025 && month === 12;
  });
  console.log(`📊 Final normalized array has ${finalDec2025.length} December 2025 rows`);
  
  return normalized;
}

/**
 * Generate data quality report
 */
export function generateDataQualityReport(
  agencies: AgencyRow[],
  telemetry: TelemetryMonthly[]
): DataQualityReport {
  const agencyIds = new Set(agencies.map((a) => a.agency_id));
  const telemetryAgencyIds = new Set(telemetry.map((t) => t.agency_id));

  const unmatched = Array.from(telemetryAgencyIds).filter((id) => !agencyIds.has(id));
  const noTelemetry = Array.from(agencyIds).filter((id) => !telemetryAgencyIds.has(id));
  const missingLicenses = agencies
    .filter((a) => !a.vr_licenses || a.vr_licenses <= 0)
    .map((a) => a.agency_id);
  const missingPurchaseDate = agencies
    .filter((a) => !a.purchase_date && (a.eligibility_cohort === undefined || a.eligibility_cohort === null))
    .map((a) => a.agency_id);

  const simTelemetry = telemetry.filter((t) => t.product === 'Simulator Training');

  return {
    unmatched_telemetry_ids: unmatched,
    agencies_with_no_telemetry: noTelemetry,
    agencies_missing_licenses: missingLicenses,
    agencies_missing_purchase_date: missingPurchaseDate,
    row_counts: {
      agencies: agencies.length,
      telemetry_rows: telemetry.length,
      sim_telemetry_rows: simTelemetry.length,
    },
  };
}

