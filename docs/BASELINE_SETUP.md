# Baseline Setup

## Overview

The VR APAP Dashboard uses a baseline from November 2025 to track adoption changes and goal progress. The baseline file should be included in the project repository and will be automatically loaded when the application starts.

## Baseline File

**File**: `public/2026 VR APAP Threshold Modeling.xlsx`

This file contains:
- **Goal Model (Final) sheet**: Baseline APAP (37.1% in cell H24), goal targets (45.1% and 49.1%), and cohort targets (columns M, N, O)
- **Data sheet**: All agencies eligible in November 2025 with their adoption status (AgencySlug in column A, adopting points in column P)

## How It Works

1. The baseline file must be placed in the `public/` directory for automatic loading
2. On application startup, the `BaselineLoader` component automatically fetches the file from the public folder
3. The system first attempts to load baseline data from localStorage (for performance)
4. If baseline data is not found in localStorage, it fetches and parses the Excel file from `public/`
5. Once loaded, baseline data is stored in localStorage and persists across sessions
6. The file path is URL-encoded to handle spaces in the filename

## Baseline Data Structure

- **Baseline APAP**: 37.1% (from Goal Model (Final) H24)
- **Goal Targets**: 45.1% (high confidence), 49.1% (hard climb)
- **Agencies**: Map of agency_id → baseline adoption status and adopting points
- **Cohort Targets**: Array of cohorts with target adoption rates and sub-cohorts

## Usage

The baseline is used to:
- Track agencies that changed adoption status (newly adopting, no longer adopting)
- Compare current APAP to baseline and goals
- Track cohort progress against target adoption rates
- Display baseline comparison in Agency List page

## Note for Developers

If you need to update the baseline file:
1. Replace `public/2026 VR APAP Threshold Modeling.xlsx` with the new file
2. The baseline loader (`src/lib/baseline.ts`) will automatically parse the new structure
3. Clear localStorage to force reload: `localStorage.removeItem('apap_baseline_data')`
4. Restart the Next.js development server to ensure the new file is accessible

## Troubleshooting

If the baseline file is not loading:
- Verify the file exists at `public/2026 VR APAP Threshold Modeling.xlsx`
- Check browser console for 404 errors
- Ensure the Next.js dev server is running (files in `public/` are served at runtime)
- Clear localStorage and refresh the page to force a reload: `localStorage.removeItem('apap_baseline_data')`

If baseline APAP shows incorrect value (e.g., 0.4% instead of 37.1%):
- Excel stores percentages as decimals (37.1% = 0.371)
- The system automatically detects and converts decimal percentages
- If you see an incorrect value, clear the cached baseline: `localStorage.removeItem('apap_baseline_data')` and refresh
- The system will automatically detect and fix incorrect cached values on next load
