# PRD — VR APAP Dashboard (Telemetry → Cohorts → Action Engine + AI Writeup)

## 1) Overview
Build a web app that ingests agency/account master data and product telemetry (via `.xlsx` uploads), joins them, computes adoption/churn/risk deterministically, and outputs:
- high-level usage trends (total + per-product),
- cohort-sliced views,
- a weekly Agency List (top performers, at risk, churned out, near eligible) with baseline comparison,
- goal tracking against baseline (37.1%) and targets (45.1%, 49.1%),
- an AI-generated narrative summary that ONLY describes computed metrics.

**Important**: The system only considers T10 customers (`cew_type === 'T10'`) for all adoption metrics, APAP calculations, and agency listings. Non-T10 customers are excluded from all analysis.

This replaces a manual spreadsheet + monthly writeup workflow with a living, repeatable analysis system.

---

## 2) Principles / Guardrails
1) **Deterministic metrics, explainable labels**  
   No LLM-driven calculations. LLM is summary-only.
2) **Context docs are reference, not UI**  
   `context/` artifacts exist to understand historical metrics and narrative patterns, not to copy layouts.
3) **Fast to insight**  
   Upload → valid outputs in minutes.
4) **Trust-building UX**  
   Always show “why” for flags and include a data quality panel (unmatched IDs, missing denominators).

---

## 3) Users / Jobs-to-be-done

### Analyst (primary)
- Upload latest data, see what moved, and identify where to focus to drive adoption/APAP.
- Track progress toward adoption goals (45.1% high confidence, 49.1% hard climb) from baseline (37.1%).
- Identify agencies that changed adoption status compared to November 2025 baseline.
- Monitor cohort progress against target adoption rates.
- Generate a shareable narrative summary in CUSH style.

### CSM / Field (secondary)
- Identify accounts to contact this week, understand why, and take targeted action.

---

## 4) Key Definitions (Business Logic)

### 4.1 As-of month
- `as_of_month` = latest month present in uploaded telemetry.

### 4.2 Historical Data and Trend Analysis
The system stores historical uploads to enable trend analysis:
- Each upload is saved to localStorage keyed by month: `processedData_YYYY-MM` (compressed with lz-string), with a cap of 24 months.
- `processedData_currentMonth` in localStorage tracks the month the user is currently viewing.
- Historical data includes SIM telemetry, cohort summaries, and **APAP snapshot per month**: `apapEligibleCount`, `apapEligiblePoints`, `apapAdoptingCount`, `apapAdoptingPoints` so "Changes vs Previous Month" uses that month's eligible/adopting counts when available.
- **Snapshot versioning** (`src/config/snapshotVersion.ts`): `SNAPSHOT_SCHEMA_VERSION = 1`, `COMPUTE_VERSION = 2` (increment when compute rules change). When saving a snapshot, persist metadata: `asOfMonthKey`, `createdAt` (ISO), `snapshotSchemaVersion`, `computeVersion`, `t6RangeLabel`, `t12RangeLabel`. When loading, use `getProcessedDataParsed(month)`; if `computeVersion !== COMPUTE_VERSION`, show banner "Snapshot computed with older logic — re-upload to refresh" and do not silently fall back to other months.
- System merges current telemetry with historical data to ensure complete 12+ month lookback windows.
- Trend analysis compares current metrics to previous periods:
  - **MoM (Month-over-Month)**: Compares current cohort summaries to previous month's summaries
  - **QoQ (Quarter-over-Quarter)**: Compares current cohort summaries to 3 months ago summaries

Rules:
- Adoption/churn/risk labels are computed as-of `as_of_month`, using trailing windows (6/12 months) as defined below.
- Historical data is automatically merged when processing new uploads to ensure complete data windows.

### 4.3 Simulator Training-only for labels (non-negotiable)
All adoption/churn/risk labels are computed using **Simulator Training telemetry only**.
Other products may be uploaded and displayed (total + per-product views), but do not affect adopting/churn/risk classification.

### 4.4 APAP rule and adoption thresholds (single source of truth)
**APAP rule:** An agency contributes to APAP (adopting points) if and only if:
- **eligibility_cohort ≥ 6** AND **(T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75)**  
- T12 = trailing 12‑month completions / VR licenses (R12). T6 = trailing 6‑month completions / VR licenses (R6).

Let:
- `L = vr_licenses` (Simulator Training licenses purchased)
- `C6 = sum(completions in last 6 months ending at as_of_month, inclusive)` — use month keys per `docs/LOOKBACK_WINDOWS.md`; implementation uses `getTrailingMonthKeys(asOfMonthKey, 6)` and `sumAgencyCompletionsByMonthKeys`.
- `C12 = sum(completions in last 12 months ending at as_of_month, inclusive)` — same month-key semantics (n=12).
- `R6 = C6 / L` (T6 completions per license)
- `R12 = C12 / L` (T12 completions per license)

**UI display**: Table headers use compact labels ("T6 Completions PP", "T12 Completions PP"); the lookback date range is shown only in a tooltip (human-readable, e.g. "Aug 2025–Jan 2026"). "Why" bullets use the same human-readable ranges. See `docs/LOOKBACK_WINDOWS.md` § Display (UI).

**Adopting** if (either metric; null-safe in code):
- `R12 >= 2.0` OR `R6 >= 0.75`
- In code: `(R6 != null && R6 >= 0.75) || (R12 != null && R12 >= 2.0)` so one metric above threshold is sufficient even when the other is missing.

**Churned Out** if:
- agency was adopting in at least one prior month, but is not adopting at `as_of_month`.

**At Risk** if:
- agency is adopting now, AND
- projected month completions (average of last 3 months) < dropped month completions (performance declining), AND
- that decline causes threshold violation (projected `R12_next < 2.0` or `R6_next < 0.75`)
- Projection method: Uses average of last 3 months for next month, drops oldest month from rolling window (6 months ago for C6, 12 months ago for C12)
- At Risk (Next Quarter): Projects 3 months forward using same logic

**Top Performer**
- Top 15 agencies per line size (agency_size_band) based on total T12 completions (C12)
- Only applies to agencies that are currently Adopting or At Risk (not Churned Out)
- Ensures top performers are distributed across all line sizes

### 4.5 Eligibility / maturity handling
- **Eligibility Determination**: 
  - Eligibility is determined SOLELY by `eligibility_cohort >= 6` from the uploaded file
  - If `eligibility_cohort` is missing or null, the agency is NOT eligible (no fallback)
  - Each month's uploaded file contains `eligibility_cohort` values that increment by 1 from the previous month
  - `eligibility_cohort` from uploaded file is the authoritative source for eligibility
- **Ineligible Agencies**:
  - Time since purchase cohorts include an **Ineligible (0–5 months)** bucket
  - Agencies ineligible can still be displayed and monitored, but "churned out" should not apply to them
  - Ineligible agencies do not contribute to APAP calculations

### 4.6 Baseline and Goal Tracking
- **Baseline**: November 2025 APAP of 37.1% (from `docs/2026 VR APAP Threshold Modeling.xlsx`)
- **Goals**: 42% (high confidence), 46.2% (hard climb)
- **Goal progress (structural + driver)**: Computed from a hard-coded config, not from parsing the Excel goal model at runtime. Source of truth: `docs/GOAL_MODEL_CONFIG_SPEC.md`, `src/config/goal_model_config.ts`. Structural variance and driver progress are computed in `src/lib/goalProgressFromConfig.ts`. Overview and Summary pages use these config-based computations only; the former Excel-based goal-model API and parsing are no longer used at runtime.
- **APAP adopting definition**: APAP rule (see §4.4): eligibility_cohort ≥ 6 AND (T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75). Labels (At Risk, Churned, etc.) are not used for APAP; they are separate. Goal progress and slice APAP use the same threshold definition (meetsAPAPThreshold). `APAP_INCLUDE_AT_RISK_IN_ADOPTING` is deprecated/unused.
- **Baseline Agencies**: All agencies eligible in November 2025 (`eligibility_cohort >= 6`) with their adoption status
  - Only T10 customers are included in baseline comparison calculations
  - Baseline parser filters for `eligibility_cohort >= 6` from the baseline file
  - Baseline agencies are matched with current T10 agencies to ensure accurate comparison
- **Agency Tracking**: Compare current adoption status to baseline to identify:
  - Newly adopting agencies (weren't adopting in baseline, now are)
  - No longer adopting agencies (were adopting in baseline, now aren't)
- **Month-Specific Eligibility**:
  - Each month's `eligibility_cohort` value is independent and increments by 1 each month
  - November eligible count = baseline agencies (all have `eligibility_cohort >= 6` in November baseline file)
  - December eligible count = current agencies with `eligibility_cohort >= 6` in December uploaded file
  - January eligible count = agencies with `eligibility_cohort >= 6` in January uploaded file (when available)
  - Agencies with `eligibility_cohort = 5` in November become `eligibility_cohort = 6` in December and are counted as newly eligible
  - Each month's uploaded file must contain updated `eligibility_cohort` values (incremented by 1 from previous month)
  - `eligibility_cohort` from uploaded file is the authoritative source for eligibility determination
- **Filtered Baseline APAP**: When cohort filters are applied, baseline APAP for November is computed using the same filters to ensure accurate trend visualization
- **Cohort Targets**: Track progress for each cohort identified in baseline file (columns M, N) against target adoption rates
- "Near Eligible" identifies agencies that will become eligible soon (see below).

---

## 5) Goals & Success Metrics (prototype)
- Time from upload → Action List: < 60 seconds on demo data
- Actionability: each flagged agency has >= 2 concrete “why” bullets
- Trust: manual spot-check of 10 agencies matches expected label logic

---

## 6) Inputs (Uploads) & Data Contract (MVP)

### 6.1 Agencies.xlsx (optional)
**Note**: If not provided, system will use previous month's agency data from sessionStorage.

**Important**: Only T10 agencies should be included in this file. Non-T10 agencies will be automatically filtered out during processing.

Required columns:
- `agency_id` (string)
- `agency_name` (string)
- `vr_licenses` (number; Simulator Training licenses)
- `officer_count` (number)
- **Date column (one required)**:
  - `purchase_date` (date) OR
  - `eligibility_cohort` (number; months since purchase, month-specific snapshot)

Optional columns:
- `cew_type` (T10/T7) - If missing, agency is treated as T10. If present and not "T10", agency is filtered out.
- `region` (string)
- `csm_owner` (string)
- `notes` (string)
- `latest_cew_training_date` (date)
- `next_cew_training_date` (date)

Derived:
- `agency_size_band`:
  - <100 → Direct
  - 100–550 → T1200
  - 550+ → Major
- `months_since_purchase` (derived from `eligibility_cohort` if available, otherwise computed from `purchase_date`)
- `time_since_purchase_cohort`:
  - Ineligible (0–5 months)
  - Year 1 (6–12)
  - Year 2 (13–24)
  - Year 3 (25–36) … etc
- `cew_type` (set to 'T10' if missing in uploaded file)

**Eligibility Determination**:
- Eligibility is determined by `eligibility_cohort >= 6` from the uploaded file (month-specific snapshot)
- Each month's uploaded file contains `eligibility_cohort` values that increment by 1 from the previous month
- November baseline: Only agencies with `eligibility_cohort >= 6` in baseline file
- December current: Only agencies with `eligibility_cohort >= 6` in December uploaded file
- Future months: Only agencies with `eligibility_cohort >= 6` in that month's uploaded file

### 6.2 Telemetry_<Product>.xlsx (one or more)
Required columns:
- `month` (YYYY-MM or date)
- `agency_id`
- `product`
- `completions` (number)

Normalization:
- normalize `month` to canonical month
- normalize product naming (ensure Simulator Training is consistently detected)
- numeric coercion for completions

---

## 7) MVP Experience (Pages + Key UX)

### 7.1 Upload & Validate (`/upload`)
Purpose: load data safely and explain what's usable.

Must include:
- Upload Agencies.xlsx (optional - will use previous month's data if not provided)
- Upload multiple telemetry files (required)
- **Save this upload as dataset for month**: Dropdown defaulting to "Auto (from telemetry)" or manual month selection; used as key for localStorage (`processedData_YYYY-MM`), allowing overwriting of a specific month's data. If a snapshot for that month already exists, overwrite it and show "Replaced existing snapshot for MMM YYYY".
- Validation results:
  - missing required columns
  - row counts loaded
  - unmatched `agency_id` rows (telemetry not found in agencies)
  - agencies missing `vr_licenses` or `purchase_date`
  - agencies with no telemetry
- If Agencies.xlsx not provided, automatically loads previous month's agency data from sessionStorage
- **Agency file expected column order** (documented in `src/lib/ingest.ts` as `EXPECTED_AGENCY_COLUMN_ORDER`): Upload page and error messages may list expected column order as a hint; parsing matches columns by name, not position.

### 7.2 Analysis (`/overview`)
**Note**: The page route remains `/overview` but is displayed as "Analysis" in the navigation.

Purpose: "Product trends and APAP adoption across cohorts with detailed cohort analysis"

Must include:
- **APAP (Adoption Percentage) Section**:
  - Prominent APAP percentage display that updates based on cohort filters
  - Adopting points, eligible points, adopting count, eligible count
  - Month-over-month comparison (pp change vs Last Month/Last Quarter/Last Year)
  - Cohort Changes vs Last Month section showing:
    - Eligible agencies count and change
    - Adopting agencies count and change
    - Eligible points and change
    - Adopting points and change
  - **Baseline Comparison**:
    - November 2025 baseline APAP (37.1%) used for comparison when comparing to last month
    - Only T10 customers included in baseline comparison
    - Baseline agencies matched with current T10 agencies for accurate comparison
    - Eligible count changes reflect agencies that became eligible in December (eligibility_cohort 5 → 6)
  - **APAP Trend Chart**:
    - Line chart showing APAP over last 6 months
    - **Dynamic Y-axis**: Min/max from displayed APAP data with padding (5% of range, minimum 2%); **goal lines** (42% High Confidence, 46.2% Hard Climb) and labels are always visible—Y-axis expands to encompass them when they fall outside the data range.
    - When cohort filters are applied, November baseline APAP is computed using same filters
    - When no filters selected, uses overall baseline APAP (37.1%)
    - Ensures trend visualization accurately reflects cohort-specific historical data
  - **Simulator Training (T10) Chart** (single usage trend on Analysis):
    - Monthly completions for T10-only Simulator Training, using same logic as Home page SIM Engagement (`computeSimT10Usage`). Uses latest stored data for the current viewing month; caption states it matches Home page SIM Engagement — T10 agencies only, Simulator Training product.
  - **Data sync**: All pages load their main data using the selected viewing month: `getProcessedData(getCurrentMonth() ?? undefined)` so the same month’s latest stored data is shown everywhere. Navigating to Analysis (or any page) reloads data from storage for the currently selected viewing month.
  - Cohort filtering with checkbox-based multi-select:
    - Filter by Time Since Purchase, Agency Size
    - All checkboxes start as checked (all cohorts selected by default)
    - Support multiple selections across dimensions (e.g., Direct AND Major on Year 2 AND Year 3)
    - "Select All" button to restore all selections
    - If no checkboxes selected, APAP displays as 0% (no agencies match)
- **Navigation month switcher**: "Viewing: [Month ▼]" in nav bar; selecting a month sets `currentMonth` in localStorage and triggers full page reload so all pages reflect that month's data. Syncs with `getStoredMonths()` and `getCurrentMonth()` on pathname change.

**Note**: Cohort Analysis functionality has been integrated into the Analysis page. The standalone `/cohorts` page has been removed.

**Current Analysis page structure (see CHANGELOG for details):**
- **APAP Goal Progress** section: **Primary metric "Overall APAP (same as Home)"** — uses `computeAPAP(agencies, labelsMap)` with no filter so the number matches the Home page. MoM comparison uses the same period logic as Home. When **all** eligibility cohorts and all agency sizes are selected, the trend chart uses **overall APAP** per month so the chart and the big metric match; when filters are applied, the chart shows slice APAP (same APAP rule). Dedicated filters (Eligibility Cohort: 6–12, 13–18, 19–24 Months, 2+ Years; Agency Size: Major, T1200, Direct); cohort-specific goal lines and red/green MoM segments.
- **KPI metrics** (between APAP Goal Progress and Biggest Movers): **Top row** — Adopting, Eligible, Ineligible; **Bottom row** — At Risk (Next Month), At Risk (Next Quarter), Churned Out, Close to Adopting. Each KPI card shows **agency count** and **points** (officer_count sum), with MoM change for both count and points when comparison data is stored. **Eligible** = T10 with eligibility_cohort ≥ 6; **Close to Adopting** = Action List definition (eligible, not adopting, R6 ≥ 0.5 or R12 ≥ 1.5).
- **Biggest movers (month over month)**: Section showing top 3 positive and top 3 negative movers (cohort adoption and driver rates). Variance states whether vs High Confidence or Hard Climb goal; switches to Hard Climb when current metric already meets or exceeds High Confidence.
- **Driver rate labels** (display): 2025 Adopting Retention Rate, 2025 Unadopting Conversion Rate, H2 2025 Customers' Adoption Rate, H1 2026 New Customers' Adoption Rate. **Line size**: "Other" is displayed as "Direct" (e.g. in filters and tables).
- **Hover tooltips**: Sized to fit content; chart containers use overflow visible so tooltips may extend outside chart area. **Home page**: Upload Data and Agency List are not clickable boxes on Home; users reach them via the nav bar.

The Analysis page (`/overview`) now includes all cohort analysis features:
- **Cohort Dimension Selector**: Choose dimension for cohort breakdown (time since purchase cohort, agency size band, CEW type)
- **Other Cohort Filters**: Filter by other cohort fields when not the selected dimension
- **Cohort Summary Table**: 
  - **T10 Customer Filtering**: Only T10 customers are included in cohort summaries
  - Columns: agency count, total officer count, % adopting, % adopting MoM, % adopting QoQ, % churned out, % at risk (next month), % at risk (next quarter)

### 7.4 Home Page (`/`)
Purpose: "How are we tracking toward our goals?"

**Note**: The Home page does not include Upload Data or Agency List as clickable boxes; users reach Upload and Agency List via the navigation bar.

Must include:
- **High-level APAP metrics** (top of page):
  - Current month's APAP (e.g. 38.7%)
  - MoM change in APAP with arrow and percentage points (e.g. +0.9pp)
  - Basis points (bps) below High Confidence (42%) and below Hard Climb (46.2%)
- **APAP (Adoption Percentage) Section**:
  - Current APAP percentage prominently displayed
  - Adopting points / eligible points breakdown
  - Adopting agencies / eligible agencies counts
  - **Two separate comparison lines**:
    - "X.Xpp vs Baseline (Nov 2025)" (current vs baseline APAP)
    - "X.Xpp vs Last Month (e.g. Dec 2025)" (current vs previous month APAP)
  - **Changes vs Previous Month** panel: Uses stored previous-month counts (`apapEligibleCount`, `apapEligiblePoints`, `apapAdoptingCount`, `apapAdoptingPoints`) from history when available; otherwise falls back to re-computation. Header clarifies comparison (e.g. "Changes vs Previous Month (Dec 2025) — eligible = cohort ≥6 from that month's upload").
  - **Detailed Metrics with Monthly Changes**:
    - Eligible agencies: [count] ([MoM change in parentheses])
    - Adopting agencies: [count] ([MoM change in parentheses])
    - Eligible points: [count] ([MoM change in parentheses])
    - Adopting points: [count] ([MoM change in parentheses])
    - All changes color-coded (green for positive, red for negative)
    - Changes always displayed (even if 0) for clear month-over-month visibility
  - Baseline comparison indicator showing change vs November 2025
  - **No cohort filter options** (simplified view for home page)
- **SIM Engagement – VR (T10) Section**:
  - T10-only Simulator Training metrics: T12 completions (trailing 12 months), MoM change vs prior T12, progress to goal (290K by Nov'26 from 180K Nov'25), this month vs same month last year (YoY), Dec 2024 baseline (7,262) when comparing Dec 2025 vs Dec 2024; monthly SIM completions bar chart (last 12 months) with most recent month highlighted, YoY visuals (prior-year value/label) where prior-year data exists (history or Dec 2024 baseline); caption shows most recent month completions (T10).
- **Agencies that dropped out of eligibility** (when viewing a month with previous-month comparison):
  - Compares previous and current month's processed data to find agencies eligible (cohort ≥6) in previous month but not in current. Table: Agency ID, Agency name, Footprint/Officer count, Reason (e.g. "Not in current month's upload" or "Cohort in YYYY-MM: N (was 6)"). If none dropped, show message with note to check data consistency if summary still shows a decrease.

- **APAP Growth Chart**:
  - Month-over-month line chart showing APAP trends
  - Includes baseline (November 2025, 37.1%) and all subsequent months
  - Automatically adds each month's results as data is uploaded
  - **Condensed y-axis range: 30% to 50%** for better visualization of marginal basis point changes
  - **Segment colors by MoM**: Green for positive MoM, red for negative MoM (distinct from goal lines)
  - Goal lines at 42% (High Confidence) and 46.2% (Hard Climb) with labels
  - Interactive tooltips on hover (sized to fit content); chart containers use overflow visible so tooltips are not clipped
  - Baseline month highlighted differently
  - Correctly parses all month formats including YYYY-MM strings (e.g., '2025-12')
  - Historical data storage optimized to prevent browser quota errors
- Cohort progress tracking:
  - Current APAP for each cohort target from baseline
  - Comparison to target adoption rates (from columns M, N in baseline file)
  - Sub-cohort breakdowns (Major, T1200, Other/Direct) where applicable
  - Gap analysis (percentage points above/below target)

Outputs:
- cohort summary table:
  - agency count
  - total officer count (sum of officer_count for all agencies in cohort)
  - % adopting (SIM-only)
  - % adopting MoM (month-over-month change from previous upload)
  - % adopting QoQ (quarter-over-quarter change from 3 months ago)
  - % churned out (SIM-only)
  - % at risk (next month, SIM-only)
  - % at risk (next quarter, SIM-only)
- Trend indicators show positive changes in green and negative changes in red
- MoM/QoQ data shows "N/A" when historical data is not available

### 7.5 Agency List (`/action-list`)
Purpose: "Who should we focus on in the next 1–2 weeks, and how have agencies changed since baseline?" (Full universe with baseline comparison; distinct from the curated Action List at `/actions`.)

Must include:
- **T10 Customer Filtering**: Only T10 customers are displayed and included in all metrics
- **Label filter**: "All Labels", **"Adopting (meeting APAP)"** (all agencies that meet APAP rule: eligible + R6/R12 threshold, including Top Performer and At Risk), "At Risk (Next Month)", "At Risk (Next Quarter)", "Churned Out", "Top Performer", "Adopting", "Not Adopting". **Eligibility requirement:** Adopting, Adopting (meeting APAP), and Top Performer filters show only **eligible** agencies (eligibility_cohort ≥ 6).
- **Export CSV**: Columns include Agency ID, Agency Name, Line Size, Agency Size, VR Licenses, Label, **Adopting (APAP)** (Y/N: eligible + meeting threshold), **T6 Completions**, **T12 Completions**, **T6 Completions PP**, **T12 Completions PP**, Time As Customer, T6/T12 Completions Needed, Adopting in 2025 baseline. CSV escaping for commas/quotes.
- Baseline comparison column:
  - "Newly Adopting": agencies that weren't adopting in November 2025 baseline but are now
  - "No Longer Adopting": agencies that were adopting in baseline but aren't now
  - "Still Adopting" / "Still Not Adopting": agencies with unchanged status
  - "New 2026 Agency": only for agencies that weren't in November 2025 baseline (missing or ineligible)
  - Visual indicators (arrows, colors) for status changes
  - Only shows baseline comparison for agencies that were in the baseline (November 2025 eligible agencies)

Buckets:
1) At Risk next month (highest urgency)
2) At Risk next quarter
3) Recently churned out
4) Near threshold / high leverage (close to adopting)
5) Top performers (VOC / champion stories) - excludes agencies with "Unknown (No officer count)"

**Note**: Ineligible agencies (0–5 months) are not shown in filter options as they don't contribute to APAP calculations.

Table columns:
- Agency Name, Agency ID
- Line Size (agency_size_band: Direct, T1200, Major) - color-coded badges
- Agency Size (officer_count)
- VR Licenses (vr_licenses)
- Label (with color-coded badge)
- Baseline Status (status change from November 2025 baseline)
- Time As Customer (purchase_cohort)
- CEW Type (T10 only)
- Metrics & Progress (T6 and T12 completions needed, or "Meeting both thresholds" if adopting)
- Recommended action
- Default sort: Agency Size (officer_count) descending

Expanded view includes:
- Purchase month (calculated from eligibility cohort)
- Key metrics with color-coded completion per license rates (green if meeting threshold, red if not)
- Training dates if present
- For Churned Out agencies:
  - Last adopting month
  - Months adopting before churn
  - Which threshold(s) they were meeting (T6, T12, or both)
  - Recent usage (last 3 months of completions)

Features:
- Sortable columns: click any column header to sort
- Visual status indicators: color-coded row backgrounds and left borders
  - Actively adopting: green
  - At Risk: orange
  - Recently churned: red
  - Unengaged: gray
  - Close to adopting: blue
- Expandable details with "Why" bullets, full metrics, and training dates
- CSV export
- Search and filter by label

### 7.6 Action List (`/actions`)
Purpose: "CSM burn-down list" — a curated, explainable list of agencies that require outreach to drive adoption/APAP or prevent churn. See `docs/ACTION_LIST_SPEC.md` for membership rules, action reasons, and tags.

Must include:
- Same processed dataset and viewing month as Agency List; no new uploads required.
- **Count consistency with Analysis**: Action List includes agencies with unknown line size or missing VR licenses (displayed as "Unknown" / "—") so churned/at-risk/close-to-adopting counts match the Analysis KPI cards.
- **Line size filter**: Default = all line sizes (Major, T1200, Direct, Unknown). Filters: line size (Major, T1200, Direct, Unknown), action reason (per spec categories).
- Search, sortable columns, expandable row detail with "why" bullets and recommended actions.
- Banner when baseline data is unavailable (e.g. November 2025 not loaded).
- Deterministic "why" bullets; SIM-only adoption rules unchanged.

### 7.7 Near Eligible (1–2 months) (`/near-eligible` or section on Action List)
Purpose: anticipate agencies about to become eligible.

- **T10 Customer Filtering**: Only T10 customers are displayed

Definition:
- `months_since_purchase == 4` (eligible in ~2 months)
- `months_since_purchase == 5` (eligible in ~1 month)

Table columns:
- Agency Name, Agency ID
- Line Size (agency_size_band)
- Agency Size (officer_count)
- Default sort: Agency Size (officer_count) descending
- VR Licenses (vr_licenses)
- Purchase Cohort
- Cohorts
- Early Usage Signals: # Completions (all available data from 12-month window)
- T6 and T12 completions needed (or "Meeting both thresholds" if adopting)
- Suggested outreach recommendation

Features:
- Sortable columns
- CSV export
- Search functionality
- Expandable details with training dates if present

### 7.8 AI Summary (`/summary`)
Purpose: generate a writeup like our monthly narrative.

MVP requirements:
- create a structured **metrics bundle JSON** from computed tables
- LLM produces:
  1) Exec summary bullets
  2) Cohort trends (biggest movers)
  3) Risks (at-risk patterns)
  4) Opportunities (high leverage + near eligible)
  5) Next 2 weeks focus list (top 10 with reasons)
  6) Data caveats (coverage issues)

**Per-month storage**: Summaries are saved per month (`summary_YYYY-MM` in localStorage via `getSummaryForMonth` / `setSummaryForMonth`). When the user opens the Summary page, the saved summary for the current viewing month is loaded if available; no auto-generate on page load (avoids unexpected API calls and rate limits). When the user switches "Viewing: [Month]", that month's saved summary is shown if any. User must click "Generate summary" to call the API. After a successful generate, the markdown is saved for that month.

**Regenerate**: If a summary already exists for the current month, the button shows "Regenerate summary". Clicking it shows confirmation: "This will overwrite the existing summary for MMM YYYY. Continue?" before calling the API.

**OpenAI**: Retry on 429/503 with backoff; 55s request timeout and 60s route `maxDuration`; 504/429 user messages. See `docs/OPENAI_RATE_LIMITS.md`.

Guardrails:
- prompt forbids inventing numbers
- summary must only reference values present in the metrics bundle
- always include `as_of_month` + selected time filter context

### 7.9 Settings (`/settings`)
Purpose: manage cached data.

Must include:
- **Cached snapshots**: List of months with stored snapshots; "Clear cached snapshots" button that removes all `processedData_*` keys (via `clearAllSnapshots()`) and redirects to Home. Does not clear current month selection or AI summaries.

---

## 8) Non-functional requirements
- Local-first prototype: runs on laptop; processed data persisted in localStorage keyed by month (`processedData_YYYY-MM`), compressed with lz-string to avoid quota errors; cap 24 months. Helper module `src/lib/storage.ts`: `getProcessedData`, `setProcessedData`, `getProcessedDataParsed` (with stale snapshot check), `getStoredMonths`, `getCurrentMonth`, `setCurrentMonth`, `clearAllSnapshots`; AI summaries per month: `getSummaryForMonth`, `setSummaryForMonth` (`summary_YYYY-MM`).
- **OpenAI rate limits and timeouts**: See `docs/OPENAI_RATE_LIMITS.md`. Summary and chat routes use `fetchWithRetry` (retry 429/503, 55s timeout), `maxDuration = 60`; 504 on timeout, 429 message on rate limit.
- **Viewing-month consistency**: Every page (Home, Analysis, Agency List, Near Eligible, Summary, Upload) loads its main dataset with `getProcessedData(getCurrentMonth() ?? undefined)` so the selected "View month" in the nav bar drives which month’s data is shown. Pages that need a specific month (e.g. baseline November) still call `getProcessedData('YYYY-MM')` where appropriate.
- **404 handling**: Old or bookmarked routes are redirected: `/analysis` and `/cohorts` redirect to `/overview`. Any other missing route shows a custom not-found page with links to Home, Analysis, Agency List, and Action List.
- Handles a few thousand agencies and 24–36 months telemetry
- Deterministic outputs (same inputs → same labels)
- Clear error messages and data quality panel

---

## 9) Delivery plan (build slices)
Slice 1: ingestion + labels + Action List + Near Eligible ✅  
Slice 2: cohorts (tables + historical data storage + MoM/QoQ trends) ✅  
Slice 3: overview (total + per-product trends + SIM headline metrics) ✅  
Slice 4: AI summary from metrics bundle (guardrailed) ✅  
Slice 5: baseline tracking and goal progress ✅  
Slice 6: page consolidation and goal tracking UI improvements ✅  
Slice 7: T10 customer filtering and Agency List enhancements ✅  
Slice 8: month-keyed persistence, SIM T10 engagement, APAP accuracy, dropouts ✅  

Stop/Go: do not proceed to AI summary until metrics are reconciled for sample agencies.

---

## 10) Definition of Done (MVP)
- Uploads and validation work (Agencies + multiple telemetry)
- SIM-only labels computed correctly (adopting/churn/at-risk/top performer)
- Cohorts page supports key filters, displays summary table with MoM/QoQ trends, and reconciles with action list totals
- Historical data storage enables trend analysis across uploads
- Overview shows total + per-product trends (when implemented)
- Action List is ranked, explainable, exportable
- Near Eligible list works
- AI summary generates a credible writeup without hallucinating metrics (when implemented)