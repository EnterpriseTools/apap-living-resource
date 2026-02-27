# MVP Build Plan — APAP Living Resource (Telemetry → Cohorts → Action Engine + AI Writeup)

## North Star
Deliver an MVP that provides:
- Upload + data quality validation
- SIM-only adoption/churn/risk labels (deterministic)
- Multi-product trends (total + per product) for understanding overall usage
- Cohort slicing (time since purchase, agency size, CEW type)
- Weekly Action List + Near Eligible list
- AI narrative summary that only describes computed metrics (no hallucinated numbers)

## Source of truth
- docs/STEP_0_SPEC.md
- docs/PRD.md
- docs/CONTEXT_INDEX.md + context/ (metrics + narrative patterns; NOT UI templates)

## Build approach
Build in slices. Each slice must be demoable before moving on.

### Slice order
1) Slice 1 — Ingest/validate/join + SIM labels + Agency List + Near Eligible (no charts) ✅
2) Slice 2 — Cohorts view (tables + historical data storage + MoM/QoQ trends) ✅
3) Slice 3 — Overview trends (total usage + per-product usage + SIM headline metrics + APAP with cohort filters) ✅
4) Slice 4 — AI summary (guardrailed; summarization only) ✅
5) Slice 5 — Baseline tracking and goal progress ✅
6) Slice 6 — Page consolidation and goal tracking UI improvements ✅
7) Slice 7 — T10 Customer Filtering and Agency List Enhancements ✅
8) Slice 8 — Month-keyed persistence, SIM T10 engagement, APAP accuracy, dropouts ✅
9) Slice 9 — Viewing-month consistency, 404 handling, Analysis single chart, goal progress from config ✅

---

## Current state (post-session)

### Snapshot versioning and stale snapshot protection
- **Constants** (`src/config/snapshotVersion.ts`): SNAPSHOT_SCHEMA_VERSION = 1, COMPUTE_VERSION = 2. Save metadata on snapshot save; load via getProcessedDataParsed; stale banner when computeVersion mismatch; no silent fallback. Upload: "Replaced existing snapshot for MMM YYYY" when overwriting.
- **Settings** (`/settings`): "Clear cached snapshots" button; clearAllSnapshots(); redirect to Home.

### AI Summary: per-month storage and OpenAI handling
- **Per-month storage**: getSummaryForMonth / setSummaryForMonth (summary_YYYY-MM). Load saved summary on Summary page when data available; no auto-generate on page load. Save after successful generate. Regenerate shows confirmation before overwriting; button "Generate summary" vs "Regenerate summary".
- **OpenAI**: fetchWithRetry (retry 429/503, 55s timeout); maxDuration 60 on summary and chat routes; 504 on timeout, 429 message on rate limit; compact JSON; no background request. See docs/OPENAI_RATE_LIMITS.md.

### Trailing windows and T6/T12 display
- **Month-key windows**: T6/T12 use exactly 6/12 month keys inclusive of as-of month; `getTrailingMonthKeys` + `sumAgencyCompletionsByMonthKeys`; no date comparisons. See `docs/LOOKBACK_WINDOWS.md`.
- **UI**: Table headers compact ("T6 Completions PP", "T12 Completions PP"); range only in tooltip (e.g. "Trailing 6 months (inclusive): Aug 2025–Jan 2026"). `src/lib/lookbackLabels.ts`, `src/components/TooltipHeader.tsx`; explain bullets use human-readable ranges.

### APAP rule (single source of truth)
- **APAP rule:** eligibility_cohort ≥ 6 AND (T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75). T12 = trailing 12‑month completions / VR license (R12); T6 = trailing 6‑month completions / VR license (R6). Documented in STEP_0_SPEC, history.ts, goalProgress.ts, goalProgressFromConfig.ts.

### APAP and goal progress: threshold-only everywhere
- computeAPAP (history.ts): adopting = eligible + (R6 ≥ 0.75 or R12 ≥ 2.0) from metrics only; no labels.
- computeAPAPForStructuralSlice and goalProgress: use meetsAPAPThreshold (R6/R12 from metrics) instead of label-based isAdopting. Slice APAP and overall APAP use the same definition.
- APAP_INCLUDE_AT_RISK_IN_ADOPTING: deprecated/unused.

### Analysis page
- Primary metric "Overall APAP (same as Home)" in APAP Goal Progress; uses computeAPAP with no filter so it matches Home.
- When all eligibility cohorts and all agency sizes are selected, the trend chart uses overall APAP per month so the chart and the big metric match.
- MoM comparison for overall APAP uses the same period logic as Home.

### Agency List (`/action-list`)
- Filter "Adopting (meeting APAP)" includes all agencies meeting APAP (eligible + R6/R12 threshold), including Top Performer and At Risk. Adopting, Adopting (meeting APAP), and Top Performer filters show only eligible agencies (eligibility_cohort ≥ 6).
- Export CSV: Adopting (APAP), T6 Completions, T12 Completions, T6 Completions PP, T12 Completions PP, plus existing columns.

### Specs and docs
- STEP_0_SPEC: APAP rule subsection; APAP Total uses exact rule wording.
- PRD: §4.4 APAP rule; §7.5 Agency List filter/export; Analysis overall APAP; deprecated config.
- ACTION_LIST_SPEC: §3.3 APAP rule; §3.4 Agency List filters and export.
- DESIGN_SPEC: Agency List export/filters; Analysis overall APAP and chart alignment.
- APAP_ANALYSIS.md, CONTEXT_INDEX: threshold-only; config deprecated.
- CHANGELOG: [Latest] entry for this session.

---

## Slice 1 — Data pipeline + labels + Action List + Near Eligible

### Goal
Upload files and immediately get correct labels + an actionable focus list.

### Tasks
- Upload Agencies.xlsx and multiple telemetry files
- Validate required columns and normalize month/product names
- Compute as_of_month
- Join on agency_id and show data quality reports:
  - unmatched telemetry IDs
  - agencies with no telemetry
  - missing licenses/purchase dates
- Compute SIM-only metrics and labels:
  - C6/C12, R6/R12 (R6 = C6/L, R12 = C12/L - total completions per license, NOT monthly averages)
  - Adopting, PreviouslyAdopting, Churned Out
  - At Risk next month / next quarter (requires both: projected < dropped AND threshold violation)
  - Top Performer
  - Unknown / Ineligible / Insufficient history
- Generate explainability:
  - “Why” bullets for each label
  - recommended action
- Implement `/action-list`:
  - filter + search
  - details drawer includes training dates (latest/next) when present
  - CSV export
- Implement Near Eligible list (months_since_purchase == 4 or 5)

### Acceptance criteria
- Labels match docs/STEP_0_SPEC.md rules
- Adoption rates use correct formulas (R6 = C6/L, R12 = C12/L)
- At Risk logic checks both performance decline AND threshold violation
- Eligibility uses only `eligibility_cohort >= 6` from uploaded file (no fallback)
- Near eligible list is correct and useful
- Explanations cite thresholds + projections
- CSV export works

---

## Slice 2 — Cohorts (tables + historical data + trends) ✅

### Goal
Cohort breakdowns answer "where are we winning/losing?" with trend analysis across uploads.

### Tasks
- Implement `/cohorts` with filters:
  - cohort dimension selector (time since purchase, agency size, CEW type)
  - filters for other cohort fields (when not the selected dimension)
- Historical data storage system:
  - Save uploads to localStorage keyed by asOfMonth (YYYY-MM format)
  - Store SIM telemetry and cohort summaries for each upload
  - Keep up to 24 months of historical data
  - Merge current telemetry with historical data to ensure complete 12+ month lookback windows
- Cohort summary table:
  - agency count
  - total officer count (sum of officer_count for all agencies in cohort)
  - % adopting (SIM)
  - % adopting MoM (month-over-month change from previous upload)
  - % adopting QoQ (quarter-over-quarter change from 3 months ago)
  - % churned out (SIM)
  - % at risk (next month, SIM)
  - % at risk (next quarter, SIM)
- Trend computation:
  - Compare current cohort summaries with previous month's summaries (MoM)
  - Compare current cohort summaries with 3 months ago summaries (QoQ)
  - Display trends with color coding (green for positive, red for negative)
  - Show "N/A" when historical data unavailable

### Acceptance criteria
- Cohort numbers reconcile with action list aggregates
- Historical data is automatically saved on each upload
- MoM and QoQ trends display correctly when historical data is available
- Table columns match between headers and data cells

---

## Slice 3 — Overview (multi-product trends + SIM headline metrics) ✅

### Goal
Answer “what moved overall” with time filter controls.

### Tasks
- Implement `/overview`:
  - time filter control
  - SIM headline counts: adopting / churned / at-risk next month/quarter
  - **Single usage chart**: Only Simulator Training (T10) chart (same logic as Home SIM Engagement; uses latest stored data for viewing month). Total usage and per-product usage charts were removed in Slice 9 to avoid conflicting numbers for the same product.
- Ensure totals and trends reconcile with underlying rollups

### Acceptance criteria
- Time filter works predictably
- Multi-product views do not affect SIM label logic

---

## Slice 4 — AI Summary (guardrailed narrative) ✅

### Goal
Generate a CUSH-style writeup like historical APAP narratives, summarizing computed facts only.

### Tasks
- Build a structured "metrics bundle" JSON from computed outputs:
  - overall headline metrics
  - APAP month-over-month changes
  - drivers (new adopting agencies)
  - shakers (newly churned/unadopting agencies)
  - top cohort movers
  - risk counts and most common drivers
  - near eligible counts and early signals
  - top 10 action agencies + reasons
  - data caveats (coverage issues)
- Implement `/summary`:
  - Auto-generates summary on page load
  - CUSH narrative style focusing on APAP MoM, drivers, shakers, trends, path to goals
  - Interactive chat interface for asking questions
  - Summary displays directly (not as export)
- Guardrails:
  - prompt forbids inventing numbers
  - must only reference fields in metrics bundle
  - always include as_of_month + selected time filter context
  - must include "Labels are based on Simulator Training only" disclaimer

### Acceptance criteria
- No hallucinated metrics
- Clear, useful CUSH-style narrative aligned to user stories
- Chat interface works and respects guardrails

---

## Slice 5 — Baseline Tracking and Goal Progress ✅

### Goal
Track agencies against November 2025 baseline and monitor progress toward adoption goals.

### Tasks
- Baseline system (`src/lib/baseline.ts`):
  - Load baseline from `docs/2026 VR APAP Threshold Modeling.xlsx`
  - Parse baseline APAP (37.1% from Goal Model (Final) H24)
  - Load agencies from Data sheet (AgencySlug → agency_id, adopting points from column P)
  - Parse cohort targets (columns M, N, O)
  - Store in localStorage for persistence
- Agency List baseline comparison:
  - Compare current agency status to baseline
  - Identify newly adopting and no longer adopting agencies
  - Display baseline status column with visual indicators
- Home page goal tracking:
  - Current APAP vs baseline with MoM change
  - Progress toward 45.1% (high confidence) and 49.1% (hard climb) goals
  - Cohort progress tracking against target adoption rates
  - Visual progress bars and gap calculations
- Overview page cohort filters:
  - Replace dropdowns with checkbox-based multi-select
  - Support multiple selections across dimensions
  - Fix field name mismatches and empty data issues
- Baseline comparison accuracy fixes:
  - Only count T10 agencies in baseline comparison calculations
  - Match baseline agencies with current T10 agencies before including in comparison
  - Compute filtered baseline APAP for November when cohort filters are applied in trend chart
  - Correctly handle eligible agency count changes (agencies with eligibility_cohort 5 → 6 in December)
  - Ensure December data file contains updated eligibility_cohort values (incremented by 1 from November)
  - Eligibility determination uses ONLY `eligibility_cohort >= 6` from uploaded file (no fallback to months_since_purchase)
  - Eligible agency count must match exactly what's in uploaded file with `eligibility_cohort >= 6`

### Acceptance criteria
- Baseline loads correctly from Excel file
- Agency List shows accurate baseline comparisons
- Home page displays goal progress correctly
- Cohort filters work with multiple selections
- Baseline file documented in project repo
- Baseline comparison only includes T10 customers
- Trend chart shows filtered baseline APAP when cohort filters are applied
- Eligible agency count correctly reflects agencies that became eligible in December
- Eligibility count matches exactly what's in uploaded file (only `eligibility_cohort >= 6`, no fallback)

---

## Slice 7 — T10 Customer Filtering and Agency List Enhancements ✅

### Goal
Focus all metrics and analysis on T10 customers only, and enhance Agency List with better visualizations and churn insights.

### Tasks
- T10 customer filtering:
  - Filter agencies to only include T10 customers (`cew_type === 'T10'`) at pipeline level
  - Apply T10 filter to all page displays (Agency List, Near Eligible, Cohort Analysis)
  - Filter T10 customers in APAP calculations and cohort aggregations
  - Ensure non-T10 customers are completely excluded from all metrics
- Top Performer fixes:
  - Exclude agencies with "Unknown (No officer count)" from Top Performer consideration
  - Add final pass to remove Top Performer label from these agencies
- Agency List enhancements:
  - Color code Line Sizes (Direct, T1200, Major) similar to Labels
  - Color code completion per license rates (green if meeting threshold, red if not)
  - Add purchase month display in expanded view
  - Enhance churn explanation for Churned Out agencies:
    - Show last adopting month
    - Calculate and display months adopting before churn
    - Show which threshold(s) they were meeting (T6, T12, or both)
    - Show recent usage (last 3 months)
- Baseline status display fix:
  - Only show "New 2026 Agency" for agencies not in November 2025 baseline
  - Correctly display status changes for agencies in baseline
- Default sorting:
  - Set default sort to Agency Size (officer_count) descending for Agency List and Near Eligible pages
- UI fixes:
  - Fix expanded row background color to extend full width

### Acceptance criteria
- Only T10 customers appear in all pages and calculations
- Top Performer excludes "Unknown (No officer count)" agencies
- Line Sizes are color-coded
- Completion per license rates are color-coded in expanded view
- Purchase month is displayed in expanded view
- Churn explanation shows last adopting month, months adopting, and threshold(s) met
- Baseline status correctly shows "New 2026 Agency" only for new agencies
- Default sort is Agency Size descending
- Expanded row color extends full width

## Slice 6 — Page Consolidation and Goal Tracking UI Improvements ✅

### Goal
Simplify navigation and improve goal tracking UX with interactive progress visualization.

### Tasks
- Merge Overview and Cohorts pages:
  - Combine `/overview` and `/cohorts` into single `/cohorts` page renamed to "Cohort Analysis"
  - Preserve all functionality from both pages
  - Remove duplicate features
  - Update navigation to show single "Cohort Analysis" link
  - Delete `/overview/page.tsx`
- Simplify home page goal tracking:
  - Replace three separate progress bars with single interactive progress bar
  - Add hover interactions on markers (baseline, current, goals) to show detailed information
  - Add link to Cohort Analysis page beneath progress bar
  - Fix buggy conditional rendering text
- Add APAP Growth Chart:
  - Month-over-month line chart below progress bar
  - Shows baseline (November 2025, 37.1%) and all subsequent months
  - Fixed y-axis range (25%-60%) with goal lines at 45.1% and 49.1%
  - Interactive tooltips and proper data collection logic
- Fix baseline loading:
  - Ensure baseline file is in `public/` folder
  - Fix file path encoding for spaces
  - Ensure baseline loads and saves to localStorage correctly
- Fix baseline APAP parsing:
  - Handle Excel percentage format (decimal 0.371 = 37.1%)
  - Auto-detect and convert decimal percentages to percentage values
  - Clear incorrect cached baseline values
- Fix date parsing for YYYY-MM format:
  - Update `TelemetryRowSchema` to use `z.preprocess` for YYYY-MM strings
  - Ensure all months (including December 2025) are correctly parsed and displayed
- Optimize localStorage storage:
  - Reduce storage footprint by not storing full telemetry data
  - Only store essential data: APAP, cohort summaries, usage rollups
  - Handle quota errors gracefully with automatic cleanup

### Acceptance criteria
- Single "Cohort Analysis" page contains all features from both previous pages
- Navigation updated correctly
- Home page goal tracking uses single interactive progress bar with hover details
- APAP Growth chart displays correctly with baseline and current month data
- Baseline loads successfully from public folder
- Baseline APAP correctly shows 37.1% (not 0.4%)
- All months in telemetry files are correctly parsed and displayed (including December 2025)
- No localStorage quota errors when saving historical data
- All functionality preserved
- No duplicate features

---

## Slice 8 — Month-keyed persistence, SIM T10 engagement, APAP accuracy, dropouts ✅

### Goal
Persist processed data by month, improve APAP display accuracy, add SIM Engagement (T10) and agencies that dropped out of eligibility.

### Tasks
- **Storage** (`src/lib/storage.ts`): `getProcessedData`, `setProcessedData`, `getStoredMonths`, `getCurrentMonth`, `setCurrentMonth`. Processed data keyed by `processedData_YYYY-MM` in localStorage (compressed with lz-string), cap 24 months; `processedData_currentMonth` tracks viewing month.
- **Upload page**: "Save this upload as dataset for month" dropdown (Auto from telemetry or manual month); used as key for localStorage.
- **Navigation**: "Viewing: [Month ▼]" dropdown; selecting month sets currentMonth and reloads; sync with storage on pathname change.
- **History** (`src/lib/history.ts`): Store per month `apapEligibleCount`, `apapEligiblePoints`, `apapAdoptingCount`, `apapAdoptingPoints`; "Changes vs Previous Month" uses stored previous-month counts when available.
- **Home APAP section**: Two lines—"X.Xpp vs Baseline (Nov 2025)" and "X.Xpp vs Last Month"; high-level block: current APAP, MoM (pp), bps below 42% and 46.2%.
- **SIM Engagement – VR (T10)**: T12 completions (trailing 12), MoM vs prior T12, progress to 290K goal, YoY, Dec 2024 baseline (7,262); bar chart last 12 months with YoY visuals; caption with most recent month completions.
- **Agencies that dropped out of eligibility**: Compare previous/current month processed data; table: Agency ID, name, footprint, reason; show when viewing month with previous-month comparison.
- **Analysis (Overview)**: APAP trend chart—dynamic Y-axis (min/max + padding), goal lines 42% and 46.2% always visible; Simulator Training (T10) chart (same logic as Home); data sync on pathname.
- **Agency file**: `EXPECTED_AGENCY_COLUMN_ORDER` in ingest; upload UI/errors list expected column order as hint (parsing by name).

### Acceptance criteria
- Month switcher persists and reloads correct month data
- APAP vs baseline and vs last month displayed separately
- Changes vs Previous Month uses stored counts when available
- SIM T10 section and chart match between Home and Analysis
- Dropouts table shows agencies that lost eligibility
- APAP trend Y-axis and goal lines always visible
- No localStorage quota errors (compression)

---

## Slice 9 — Viewing-month consistency, 404 handling, Analysis single chart, goal progress from config ✅

### Goal
Ensure all pages use the selected viewing month’s data, handle old/missing routes gracefully, keep one usage chart on Analysis, and compute goal progress from config only (no runtime Excel parsing).

### Tasks
- **Viewing-month consistency**: All pages (Home, Analysis, Agency List, Near Eligible, Summary, Upload) load their main data with `getProcessedData(getCurrentMonth() ?? undefined)` so the selected "View month" in the nav bar drives which month’s data is shown.
- **404 handling**: Add redirects in `next.config.js`: `/analysis` → `/overview`, `/cohorts` → `/overview`. Add custom `src/app/not-found.tsx` with links to Home, Analysis, and Agency List for any other missing route.
- **Analysis page**: Keep only the Simulator Training (T10) chart; remove Total Usage Trend and Per-Product Usage Trend charts to avoid conflicting numbers for the same product. Fix "Rendered more hooks" error by moving all `useMemo` and callback hooks to the top of the component (before any conditional rendering).
- **Goal progress from config**: Remove runtime Excel parsing for the goal model. Source of truth: `docs/GOAL_MODEL_CONFIG_SPEC.md`, `src/config/goal_model_config.ts`. Add `src/lib/goalProgressFromConfig.ts` for structural variance and driver progress. Overview and Summary use `computeStructuralVarianceFromConfig` and `computeDriverProgressFromConfig` only. Remove `src/app/api/goal-model/route.ts`. Legacy `goalModel.ts` and `goalProgress.ts` may remain in codebase but are not used at runtime.

### Acceptance criteria
- Changing "View month" and navigating between pages shows the same month’s data everywhere it’s expected.
- Visiting `/analysis` or `/cohorts` redirects to `/overview`.
- Visiting any other non-existent route shows the custom not-found page.
- Analysis page has one usage chart (Simulator Training T10) and no hooks-order runtime error.
- Goal progress (structural + driver) is computed from config only; no goal-model API or Excel parsing at runtime.
- Unit tests cover config-based line size, eligibility bucket, pointsGap, and variancePp logic.

---

## Stop/Go gates
- Don’t leave Slice 1 until labels reconcile for a small sample of known agencies.
- Don’t build AI Summary until metrics bundle is stable and trusted.