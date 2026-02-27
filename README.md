# VR APAP Dashboard

A web application for analyzing agency adoption, churn, and risk metrics from telemetry data. Tracks progress toward adoption goals from November 2025 baseline (37.1%) to targets (45.1% high confidence, 49.1% hard climb).

## Setup

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Baseline Setup

The dashboard uses a baseline from November 2025 to track adoption changes. The baseline file (`docs/2026 VR APAP Threshold Modeling.xlsx`) should be included in the project repository. See `docs/BASELINE_SETUP.md` for details.

## Usage

### Upload Data

1. Navigate to `/upload`
2. Upload `Agencies.xlsx` (optional - will use previous month's data if not provided)
3. Upload one or more telemetry `.xlsx` files
4. Click "Process Files" to validate and process the data
5. Review the data quality report
6. Navigate to any page to see results

### Agency List

The `/action-list` page shows:
- **Agency List Table**: All agencies with their labels, metrics, and recommended actions
- **Baseline Status Column**: Shows adoption status changes compared to November 2025 baseline
  - "Newly Adopting": agencies that weren't adopting in baseline but are now
  - "No Longer Adopting": agencies that were adopting in baseline but aren't now
- **Near Eligible Section**: Agencies that will become eligible in 1-2 months
- **Expandable Details**: Click any row to see "Why" bullets, key metrics, and training dates
- **CSV Export**: Export the agency list to CSV

### Goal Tracking

The home page (`/`) shows:
- Current APAP vs baseline (37.1%) with month-over-month change
- Progress toward 45.1% (high confidence) and 49.1% (hard climb) goals
- Cohort progress tracking against target adoption rates from baseline

## Project Structure

- `src/lib/` - Core pipeline modules:
  - `schema.ts` - Zod schemas and TypeScript types
  - `ingest.ts` - Excel file parsing and normalization
  - `compute.ts` - Metric calculations (C6, C12, R6, R12, projections)
  - `labels.ts` - Label computation logic
  - `cohorts.ts` - Cohort assignment (time since purchase, size bands)
  - `explain.ts` - "Why" bullets and recommended actions
  - `pipeline.ts` - Main processing pipeline
- `src/app/` - Next.js pages:
  - `upload/` - File upload and validation
  - `action-list/` - Action list table and Near Eligible section
- `src/styles/` - CSS tokens and global styles
- `tests/` - Unit tests for label logic

## Testing

Run unit tests:
```bash
npm test
```

## Data Requirements

### Agencies.xlsx
Required columns:
- `agency_id` (string)
- `agency_name` (string)
- `purchase_date` (date)
- `vr_licenses` (number, positive)
- `officer_count` (number, non-negative)
- `cew_type` (T10 or T7)

Optional columns:
- `region`, `csm_owner`, `notes`
- `latest_cew_training_date`, `next_cew_training_date`

### Telemetry Files
Required columns:
- `month` (date or YYYY-MM)
- `agency_id` (string)
- `product` (string, must include "Simulator Training")
- `completions` (number, non-negative)

Optional columns:
- `platform`, `license_type`

## Labels

Labels are computed using **Simulator Training telemetry only**:

- **Adopting**: R12 >= 2.0 OR R6 >= 0.75
- **Top Performer**: Adopting AND (R12 >= 3.0 OR R6 >= 1.25)
- **Churned Out**: Previously adopting but no longer adopting (not ineligible)
- **At Risk (Next Month)**: Currently adopting but projected to fall below thresholds next month
- **At Risk (Next Quarter)**: Currently adopting but projected to fall below thresholds within 3 months
- **Ineligible (0–5 months)**: Less than 6 months since purchase
- **Insufficient history**: Less than 3 months of SIM telemetry
- **Unknown (No license count)**: Missing or invalid vr_licenses

## AI Summary Feature

The `/summary` page generates AI-powered executive summaries of your metrics. 

**Important for Enterprise Users**: To ensure your confidential data is processed through your enterprise OpenAI account, see [Enterprise OpenAI Setup Guide](docs/ENTERPRISE_OPENAI_SETUP.md).

Quick setup:
1. Create a `.env.local` file in the project root
2. Add your enterprise OpenAI API key: `OPENAI_API_KEY=sk-your-key-here`
3. (Optional) Add organization ID if required: `OPENAI_ORGANIZATION_ID=org-xxxxx`
4. Restart the development server

## Development

This project uses:
- Next.js 14 (App Router)
- TypeScript
- Zod for schema validation
- xlsx for Excel file parsing
- date-fns for date manipulation

All UI components use semantic tokens from `src/styles/tokens.css` - no hard-coded colors.

