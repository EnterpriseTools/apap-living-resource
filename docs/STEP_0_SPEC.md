# Step 0 Spec v1 — APAP Living Resource (Telemetry → Cohorts → Action Engine + AI Writeup)

## Goal (MVP)
Build a working web app that:
1) uploads **.xlsx** files for agency/account master data and product telemetry,
2) normalizes + joins them on `agency_id`,
3) computes **SIM-only adoption/churn/risk labels** deterministically,
4) provides **high-level usage trends** (total + per-product) with interactive tooltips and record highlighting,
5) provides **cohort analysis** and a weekly **Action List**,
6) generates an **AI narrative summary** that only describes computed metrics (no invented numbers),
7) surfaces agencies **Near Eligible** (ineligible now, eligible in 1–2 months),
8) calculates and displays **APAP (Adoption Percentage)** metrics with cohort filtering and period-over-period comparisons.

### Non-negotiable constraint
- **Adoption / churn / at-risk / top performer labels consider Simulator Training telemetry ONLY.**
- Other products may be uploaded and viewed, but they must not affect labels.

---

## Inputs (Uploads)

### 1) Agencies.xlsx (required master)
**Important**: Only T10 agencies should be included in this file. Non-T10 agencies will be automatically filtered out during processing.

**Required columns**
- `agency_id` (string; join key)
- `agency_name` (string)
- `vr_licenses` (number; Simulator Training licenses purchased; denominator for adoption thresholds)
- `officer_count` (number; used for size cohort)
- **Date column (one required)**:
  - `purchase_date` (date; used for time-since-purchase cohorting) OR
  - `eligibility_cohort` (number; months since purchase, month-specific snapshot)

**Optional columns**
- `cew_type` (string: `T10` or `T7`) - If missing, agency is treated as T10. If present and not "T10", agency is filtered out.
- `region` (string)
- `csm_owner` (string)
- `notes` (string)
- `latest_cew_training_date` (date)
- `next_cew_training_date` (date)

**Derived columns**
- `agency_size_band`
  - `<100` officers → `Direct`
  - `100–550` officers → `T1200`
  - `>550` officers → `Major`
- `as_of_month` (derived; see below)
- `months_since_purchase` (integer months; derived from `eligibility_cohort` if available, otherwise computed from `purchase_date` and `as_of_month`)
- `time_since_purchase_cohort` (see Time Cohort section)
- `cew_type` (set to 'T10' if missing in uploaded file)

**Eligibility Determination**:
- Eligibility is determined SOLELY by `eligibility_cohort >= 6` from the uploaded file (month-specific snapshot)
- If `eligibility_cohort` is missing or null, the agency is NOT eligible (no fallback to `months_since_purchase`)
- Each month's uploaded file contains `eligibility_cohort` values that increment by 1 from the previous month
- November baseline: Only agencies with `eligibility_cohort >= 6` in baseline file
- December current: Only agencies with `eligibility_cohort >= 6` in December uploaded file
- Future months: Only agencies with `eligibility_cohort >= 6` in that month's uploaded file
- `eligibility_cohort` from uploaded file is the authoritative source for eligibility determination

**Data quality handling**
- Missing/invalid `purchase_date` → cohort label = `Unknown (No purchase date)`
- Missing/invalid `vr_licenses` or `vr_licenses <= 0` → label = `Unknown (No license count)`
- Missing `officer_count` → size band = `Unknown (No officer count)`
- Invalid future purchase date → cohort label = `Invalid (Future purchase date)`

---

### 2) Telemetry_<Product>.xlsx (one or more telemetry files)
You may upload multiple telemetry files (one per product). The app normalizes all into a single telemetry table.

**Required columns**
- `month` (date or YYYY-MM; treat as first day of month)
- `agency_id` (string)
- `product` (string; must include `Simulator Training` as a possible value)
- `completions` (number; monthly count)

**Optional columns**
- `platform` (string)
- `license_type` (string)

**Normalization**
- Coerce `month` to canonical month date (first day of month).
- Coerce `completions` to numeric (nulls invalid; handle via validation).
- Standardize `product` naming so “Simulator Training” matches exactly after normalization.

---

## "Now" and Historical Data

### As-of month
- `as_of_month` = the **latest** `month` present in telemetry across any uploaded product.

### Historical Data Storage
The system stores historical uploads in localStorage to enable trend analysis:
- Each upload is stored keyed by `as_of_month` (YYYY-MM format)
- Stores SIM telemetry data and cohort summaries for each upload
- Keeps up to 24 months of historical data
- When processing new uploads, merges current telemetry with historical data to ensure full 12+ month lookback windows
- **Snapshot versioning** (`src/config/snapshotVersion.ts`): `SNAPSHOT_SCHEMA_VERSION = 1`, `COMPUTE_VERSION = 2` (increment when compute rules change). When saving a snapshot, persist metadata: `asOfMonthKey`, `createdAt` (ISO), `snapshotSchemaVersion`, `computeVersion`, `t6RangeLabel`, `t12RangeLabel`. When loading, use `getProcessedDataParsed(month)`; if `computeVersion !== COMPUTE_VERSION`, show banner "Snapshot computed with older logic — re-upload to refresh" and do not silently fall back to other months.

**Viewing month consistency**: All pages load their main data using `getProcessedData(getCurrentMonth() ?? undefined)` (or `getProcessedDataParsed` where stale snapshot check is needed) so the selected "View month" in the nav bar determines which month’s latest stored data is shown. Pages that need a specific month (e.g. baseline November) still call `getProcessedData('YYYY-MM')` where appropriate.

**Rules**
- Labels are computed **as of `as_of_month`** using trailing 6/12 month windows (below).
- Historical data is automatically merged to ensure complete 12-month windows even when new uploads only contain the last 12 months.
- Trend analysis compares current metrics to previous month (MoM) and previous quarter (QoQ) using stored historical summaries.

---

## Joining & Canonical Tables

### Join rule
- `telemetry.agency_id = agencies.agency_id`

### Canonical outputs
- `agencies` (from Agencies.xlsx + derived fields)
- `telemetry_monthly` (union of all telemetry uploads, normalized)
- `telemetry_joined` (telemetry + agency metadata)
- `sim_telemetry_monthly` (filter where `product == "Simulator Training"`)
- `all_products_rollups` (aggregations across all products)
- `sim_rollups` (rolling windows + labels computed using Simulator Training only)

### Required data quality reports
- Telemetry rows with `agency_id` not found in agencies → “Unmatched IDs”
- Agencies with no telemetry → “No telemetry”
- Agencies missing purchase_date/license counts → “Insufficient master data”

---

## Cohorts (Filters and Group-bys)

### Time since purchase cohorts
Compute `months_since_purchase` and assign:

- `Ineligible (0–5 months)` : 0–5
- `Year 1 (6–12 months)` : 6–12
- `Year 2 (13–24 months)` : 13–24
- `Year 3 (25–36 months)` : 25–36
- `Year 4 (37–48 months)` : 37–48
- Continue in 12-month increments for out years.
- Missing purchase_date → `Unknown (No purchase date)`
- months < 0 → `Invalid (Future purchase date)`

### Agency size cohorts
- `<100` → `Direct`
- `100–550` → `T1200`
- `>550` → `Major`

### CEW type
- `T10` vs `T7`

---

## Simulator Training Adoption / Churn / Risk Rules (Labels)
All labels below are computed using only `product == "Simulator Training"` telemetry.

### Definitions
Let:
- `L` = `vr_licenses`
- `C6` = sum of SIM completions over last 6 months ending at `as_of_month` (inclusive). Use **month keys** (YYYY-MM) per `docs/LOOKBACK_WINDOWS.md`; implementation uses `getTrailingMonthKeys(asOfMonthKey, 6)` and `sumAgencyCompletionsByMonthKeys`.
- `C12` = sum of SIM completions over last 12 months ending at `as_of_month` (inclusive); same month-key semantics (n=12).

Rates:
- `R6 = C6 / L` (total completions per license over 6 months)
- `R12 = C12 / L` (total completions per license over 12 months)

**Note**: Rates are total completions per license, NOT monthly averages. The thresholds `R12 >= 2.0` and `R6 >= 0.75` are designed to work with these formulas.

### Data sufficiency defaults
- If `L <= 0` or missing → label = `Unknown (No license count)`
- If `time_since_purchase_cohort == "Ineligible (0–5 months)"`:
  - still compute metrics for visibility, but do not assign `Churned Out`
- Agencies without sufficient telemetry data will compute metrics (which may be null) and receive "Not Adopting" label if they don't meet thresholds

### APAP rule (single source of truth)
An agency contributes to APAP (adopting points) if and only if:
- **eligibility_cohort ≥ 6** AND **(T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75)**  
- T12 = trailing 12‑month completions / VR licenses (R12). T6 = trailing 6‑month completions / VR licenses (R6).

### 1) Adopting (current)
Adopting if (either metric; implementation is null-safe):
- `R12 >= 2.0` OR `R6 >= 0.75`
- In code: `(R6 != null && R6 >= 0.75) || (R12 != null && R12 >= 2.0)` so one metric above threshold is sufficient even when the other is missing.

### 2) Previously Adopting
Compute `Adopting(m)` for each month in history using the same trailing-window rules ending at month `m`.
- `PreviouslyAdopting = True` if any prior month had `Adopting(m) = True`.

### 3) Churned Out
Churned Out if:
- `PreviouslyAdopting = True` AND `Adopting(as_of_month) = False`
- and not in `Ineligible (0–5 months)`

### 4) At Risk (Next Month / Next Quarter)
Projection:
- Let `c1,c2,c3` be SIM completions for the last 3 months ending at `as_of_month`.
- `ProjectedNextMonthCompletions = average(c1,c2,c3)`
- Get actual completions from oldest month that will drop out:
  - For C6: `droppedFromC6 = completions_from_month_(as_of_month - 6)`
  - For C12: `droppedFromC12 = completions_from_month_(as_of_month - 12)`

Simulate next month:
- `C6_next = C6 - droppedFromC6 + ProjectedNextMonthCompletions`
- `C12_next = C12 - droppedFromC12 + ProjectedNextMonthCompletions`
- `R6_next = C6_next / L` (total completions per license, NOT monthly average)
- `R12_next = C12_next / L` (total completions per license, NOT monthly average)
- `Adopting_next = (R12_next >= 2.0) OR (R6_next >= 0.75)`

At Risk (Next Month) if:
- `Adopting(as_of_month) = True` AND
- `ProjectedNextMonthCompletions < droppedFromC12` OR `ProjectedNextMonthCompletions < droppedFromC6` (performance declining) AND
- `Adopting_next = False` (threshold violation)

At Risk (Next Quarter):
- Repeat the simulation 3 times forward (month by month)
- For each month, check if projected < dropped month AND that causes threshold violation
- At risk if adopting now but projected to fall below thresholds within 3 months

### 5) Top Performer (cohort-relative)
Top Performer if:
- Agency is currently Adopting or At Risk (not Churned Out)
- Agency is in the top 15 agencies within their line size (agency_size_band) based on total T12 completions (C12)
- Sorted by C12 descending, top 15 per line size are marked as Top Performer

---

## Multi-product Views (Display Requirements)

### Total usage (All Products)
The app must support showing:
- total completions across all products (trend over time)
- full-width responsive charts that fill the screen
- interactive tooltips on hover showing:
  - Month name
  - Total completions for that month
  - Month-over-Month (MoM) percentage change
- visual highlighting of all-time record months (highest completions)
- comparison lines for period-over-period analysis

### Per-product usage
The app must support showing:
- all products displayed simultaneously as separate trend lines
- color-coded legend showing all products
- interactive tooltips per product showing:
  - Month name
  - Product name
  - Completions for that product/month
  - MoM percentage change
- record month highlighting per product (all-time high for that product)
- full-width responsive charts

### Critical separation
- Multi-product views are for understanding overall footprint.
- Labels are SIM-only.

---

## Near Eligible (New Requirement)
Surface agencies that are currently ineligible but will become eligible soon:
- `months_since_purchase == 5` → eligible in ~1 month
- `months_since_purchase == 4` → eligible in ~2 months

For each Near Eligible agency, show:
- SIM early usage signals (last 1–3 months completions/license)
- suggested outreach recommendation
- include `next_cew_training_date` / `latest_cew_training_date` if present to guide timing

---

## Required UI Outputs (MVP)

### Page: Upload & Validate (`/upload`)
- Upload Agencies.xlsx (optional - will use previous month's data if not provided)
- Upload multiple Telemetry_<Product>.xlsx files (required)
- Validation output:
  - missing required columns
  - row counts loaded
  - matched vs unmatched telemetry rows
  - agencies with no telemetry
  - agencies missing licenses/purchase dates
- If Agencies.xlsx not provided, automatically loads previous month's agency data from sessionStorage

### 404 and route handling
- Redirects: `/analysis` and `/cohorts` redirect to `/overview` (for old bookmarks or links).
- Custom not-found page: Any other missing route shows a not-found page with links back to Home, Analysis, and Agency List.

### Page: Analysis (`/overview`)
**Note**: The page route remains `/overview` but is displayed as "Analysis" in the navigation.

Purpose: "Product trends and APAP adoption across cohorts with detailed cohort analysis"

Must include:
- **APAP (Adoption Percentage) Section**:
  - Prominent APAP percentage display that updates based on cohort filters
  - Adopting points, eligible points, adopting count, eligible count
  - Month-over-month comparison (pp change vs Last Month/Last Quarter/Last Year)
  - **Baseline Comparison**:
    - November 2025 baseline APAP (37.1%) used for comparison when comparing to last month
    - Only T10 customers included in baseline comparison
    - Baseline agencies matched with current T10 agencies for accurate comparison
    - Eligible count changes reflect agencies that became eligible in December (eligibility_cohort 5 → 6)
  - **APAP Trend Chart**:
    - Line chart showing APAP over last 6 months
    - When cohort filters are applied, November baseline APAP is computed using same filters
    - When no filters selected, uses overall baseline APAP (37.1%)
  - Cohort filtering with checkbox-based multi-select:
    - Filter by Time Since Purchase, Agency Size
    - All checkboxes start as checked (all cohorts selected by default)
    - If no checkboxes selected, APAP displays as 0% (no agencies match)
- **Simulator Training (T10) Chart**: Single usage trend on Analysis; T10-only Simulator Training, uses latest stored data for the current viewing month (same definition as Home SIM Engagement).

**Note**: Cohort Analysis functionality has been integrated into the Analysis page. The standalone `/cohorts` page has been removed. The Analysis page now includes all cohort analysis features below.

**High-Level Trends Section**:
- **Period Comparison Selector**: Compare current metrics to previous periods (last month, last quarter, this time last year)
- **APAP (Adoption Percentage) Total**:
  - **APAP rule:** eligibility_cohort ≥ 6 AND (T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75). T12 = trailing 12‑month completions / VR licenses; T6 = trailing 6‑month completions / VR licenses.
  - Weighted adoption percentage: (Adopting Points / Eligible Points) × 100. Adopting Points = sum of `officer_count` for agencies that satisfy the rule; Eligible Points = sum for agencies with cohort ≥ 6. No labels (At Risk, etc.) are used.
  - Cohort filtering with checkbox-based multi-select: Filter by Time Since Purchase, Agency Size, or CEW Type
  - Support multiple selections across dimensions (e.g., Direct AND Major on Year 2 AND Year 3)
  - Comparison support: Shows change vs previous period
  - Displays adopting count, eligible count, and percentage breakdown
- **SIM headline KPI cards** (with period comparisons):
  - Adopting count
  - At Risk (Next Month) count
  - At Risk (Next Quarter) count
  - Churned Out count
  - Ineligible count
  - (Unknown/Insufficient card has been removed from the Analysis page.)
  - Each KPI shows current value, change vs comparison period, and percentage change
- **Single usage chart on Analysis**: Only the **Simulator Training (T10)** chart is shown (same logic as Home SIM Engagement; uses latest stored data for the current viewing month). Total Usage Trend and Per-Product Usage Trend charts were removed to avoid conflicting numbers for the same product.
- **APAP Goal Progress section** (Analysis): Primary metric **"Overall APAP (same as Home)"** — uses computeAPAP with no filter so it matches Home. When all eligibility cohorts and all agency sizes are selected, the trend chart uses **overall APAP** per month so the chart and the big metric match; when filters are applied, the chart shows slice APAP (same APAP rule). Dedicated cohort filters (Eligibility Cohort, Agency Size); cohort-specific goal lines and red/green MoM segments.
- **KPI metrics** (Analysis, between APAP Goal Progress and Biggest Movers): Top row — Adopting, Eligible, Ineligible; bottom row — At Risk (Next Month), At Risk (Next Quarter), Churned Out, Close to Adopting. Each card shows agency count and points; MoM for count and points when stored. See CHANGELOG for full details.
- **Chart hover tooltips**: Sized to fit content; chart containers use overflow visible so tooltips may extend outside the chart area. Home page does not include Upload Data or Agency List as clickable boxes (navigation only).

**Cohort Breakdown Section**:
- **Filters**:
  - Cohort dimension selector (time since purchase cohort, agency size band, CEW type)
  - Filters for other cohort fields (when not the selected dimension)
- **Cohort Summary Table**:
  - agency count
  - total officer count (sum of officer_count for all agencies in cohort)
  - % adopting (SIM)
  - % adopting MoM (month-over-month change)
  - % adopting QoQ (quarter-over-quarter change)
  - % churned out (SIM)
  - % at risk next month (SIM)
  - % at risk next quarter (SIM)
- Trend data computed by comparing current cohort summaries with historical summaries from previous month and previous quarter

### Page: Agency List (`/action-list`)
Ranked table with:
- **T10 Customer Filtering**: Only T10 customers are displayed
- **Label filter**: "All Labels", **"Adopting (meeting APAP)"** (all agencies meeting APAP rule: eligible + R6/R12 threshold, including Top Performer and At Risk), "At Risk (Next Month)", "At Risk (Next Quarter)", "Churned Out", "Top Performer", "Adopting", "Not Adopting". **Eligibility requirement:** Adopting, Adopting (meeting APAP), and Top Performer filters show only **eligible** agencies (eligibility_cohort ≥ 6).
- label (Top Performer / At Risk / Churned Out / Adopting / Not Adopting / Unknown / Ineligible)
- Top Performer excludes agencies with "Unknown (No officer count)"
- columns: Agency Name, Agency ID, Line Size (color-coded), Agency Size (officer_count), VR Licenses, Label, Baseline Status, Time As Customer (purchase cohort), CEW Type
- Metrics & Progress: T6 and T12 completions needed (or "Meeting both thresholds" if adopting)
- visual status indicators: color-coded rows and borders for agency status
- sortable columns: click column headers to sort by any column
- default sort: Agency Size (officer_count) descending
- "Why" bullets (threshold comparisons + projection shortfall + previous adopting evidence)
- recommended action (VOC / enablement / winback / monitor)
- **CSV export**: Columns include Adopting (APAP) (Y/N), T6 Completions, T12 Completions, T6 Completions PP, T12 Completions PP, plus Agency ID, Name, Line Size, VR Licenses, Label, Time As Customer, T6/T12 Completions Needed, Adopting in 2025 baseline
- **T6/T12 display**: Table headers use compact labels ("T6 Completions PP", "T12 Completions PP"); the trailing date range is shown only in a tooltip (human-readable, e.g. "Aug 2025–Jan 2026"). "Why" bullets use the same human-readable ranges. See `docs/LOOKBACK_WINDOWS.md` § Display (UI).
- Expanded view includes:
  - Purchase month (calculated from eligibility cohort)
  - Key metrics with color-coded completion per license rates (green if meeting threshold, red if not)
  - Training dates if present
  - For Churned Out agencies: last adopting month, months adopting before churn, which threshold(s) they were meeting, recent usage
- Baseline Status: Shows "New 2026 Agency" only for agencies not in November 2025 baseline; otherwise shows status change (Newly Adopting, No Longer Adopting, Still Adopting, Still Not Adopting)
- **Baseline Comparison Accuracy**:
  - Only T10 customers are included in baseline comparison calculations
  - Baseline agencies are matched with current T10 agencies before being included in comparison
  - Ensures baseline comparison reflects only T10 customer base, matching current data filtering
  - November eligible count = baseline agencies (all have `eligibility_cohort >= 6` in November)
  - December eligible count = current agencies with `eligibility_cohort >= 6` in December
  - Agencies with `eligibility_cohort = 5` in November become `eligibility_cohort = 6` in December and are counted as newly eligible
  - December data file must contain updated `eligibility_cohort` values (incremented by 1 from November)

### Page: Near Eligible (`/near-eligible`)
Dedicated page for agencies that will become eligible soon:
- **T10 Customer Filtering**: Only T10 customers are displayed
- Columns: Agency Name, Agency ID, Line Size, Agency Size (officer_count), VR Licenses, Purchase Cohort, Cohorts, Early Usage Signals, Action
- Early Usage Signals shows: # Completions (all available data from 12-month window)
- T6 and T12 completions needed (or "Meeting both thresholds" if adopting)
- Sortable columns
- Default sort: Agency Size (officer_count) descending
- CSV export
- Search functionality

---

### Page: Home (`/`)
Purpose: "How are we tracking toward our goals?"

Must include:
- **APAP (Adoption Percentage) Section**:
  - Current APAP percentage prominently displayed
  - Adopting points / eligible points breakdown
  - Adopting agencies / eligible agencies counts
  - **Detailed Metrics with Monthly Changes**:
    - Eligible agencies: [count] ([MoM change in parentheses])
    - Adopting agencies: [count] ([MoM change in parentheses])
    - Eligible points: [count] ([MoM change in parentheses])
    - Adopting points: [count] ([MoM change in parentheses])
    - All changes color-coded (green for positive, red for negative)
    - Changes always displayed (even if 0) for clear month-over-month visibility
  - Baseline comparison indicator showing change vs November 2025
  - **No cohort filter options** (simplified view for home page)
- **APAP Growth Chart**:
  - Month-over-month line chart showing APAP trends
  - Baseline (November 2025, 37.1%) and all subsequent months
  - **Condensed y-axis range: 30% to 50%** for better visualization of marginal basis point changes
  - **Dynamic color gradients**: Line segments colored based on MoM change direction
    - Green gradient for positive MoM changes (darker = larger increase)
    - Red gradient for negative MoM changes (darker = larger decrease)
    - Gradient intensity scales with change magnitude
  - Horizontal goal lines at 42% (High Confidence) and 46.2% (Hard Climb) with labels
  - Interactive tooltips on data points

---

## Definition of Done (MVP Acceptance Criteria)
- Uploads and validation work for Agencies.xlsx + multiple telemetry files
- Excel parsing handles edge cases: empty cells, "N/A" text, numeric IDs, invalid values
- SIM-only labels computed exactly per above rules (no "Insufficient history" label)
- **T10 Customer Filtering**: Only T10 customers included in all pages, metrics, and calculations
  - `cew_type` column is optional in uploaded files
  - If `cew_type` is missing, agencies are treated as T10
  - Only T10 agencies should be included in uploaded files (non-T10 are filtered out)
- **Eligibility Determination**: Uses `eligibility_cohort >= 6` from uploaded file (month-specific)
  - Each month's `eligibility_cohort` value is independent and increments by 1 each month
  - Baseline filters for `eligibility_cohort >= 6` from baseline file
  - Current data uses `eligibility_cohort >= 6` from uploaded file
- APAP metrics calculated and displayed with cohort filtering (T10 only, eligible agencies only)
- Multi-product total + per-product usage trends are visible with interactive tooltips
- Charts are full-width responsive and highlight record months
- Period-over-period comparisons work for all metrics (KPIs and APAP)
- Cohorts page with dimension selector, filters, and summary table with MoM/QoQ trends (T10 only)
- Historical data storage enables trend analysis across uploads (optimized to prevent quota errors)
- Telemetry merge correctly preserves all agency data (composite keys)
- Cohorts filters work and reconcile with action list totals
- Action List is explainable and exportable (T10 only, default sort by Agency Size descending)
- Near Eligible list works (months_since_purchase 4–5, T10 only, default sort by Agency Size descending)
- AI Summary (when implemented) is generated from structured metrics only
- Baseline file loads correctly from public folder with proper path encoding
- Baseline APAP correctly parsed from Excel (handles percentage format conversion)
- APAP Growth chart displays baseline and current month data correctly
- Date parsing correctly handles YYYY-MM format strings (e.g., '2025-12') for all months
- localStorage quota errors handled gracefully with automatic cleanup
- **Goal progress (structural + driver)**: Computed from config only. Source of truth: `docs/GOAL_MODEL_CONFIG_SPEC.md`, `src/config/goal_model_config.ts`. Computations in `src/lib/goalProgressFromConfig.ts`. No runtime Excel parsing for the goal model; Overview and Summary use config-based structural variance and driver progress only.
- Top Performer excludes agencies with "Unknown (No officer count)"
- Line Sizes are color-coded for visual distinction
- Completion per license rates are color-coded (green if meeting threshold, red if not)
- Purchase month displayed in expanded agency view
- Churn explanation includes last adopting month, months adopting before churn, and which threshold(s) were being met