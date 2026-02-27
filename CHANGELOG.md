# Changelog — VR APAP Dashboard Implementation

## [Latest] - Snapshot versioning, AI Summary storage, OpenAI retry/timeout, Settings, bug fixes

### Snapshot versioning and stale snapshot protection
- **Constants** (`src/config/snapshotVersion.ts`): `SNAPSHOT_SCHEMA_VERSION = 1`, `COMPUTE_VERSION = 2` (increment when compute rules change).
- **Save metadata**: When saving a snapshot (upload flow), persist `asOfMonthKey`, `createdAt` (ISO), `snapshotSchemaVersion`, `computeVersion`, `t6RangeLabel`, `t12RangeLabel` (via `getLookbackRangeLabel`).
- **Load validation**: Use `getProcessedDataParsed(month)`; if `computeVersion !== COMPUTE_VERSION`, show banner "Snapshot computed with older logic — re-upload to refresh" and do not silently fall back to other months.
- **Upload messaging**: If snapshot for that month already exists, overwrite and show "Replaced existing snapshot for MMM YYYY".
- **Settings** (`/settings`): "Clear cached snapshots" button calls `clearAllSnapshots()` (removes all `processedData_*` keys); redirects to Home after clear.

### AI Summary: per-month storage and regenerate confirmation
- **Storage** (`src/lib/storage.ts`): `getSummaryForMonth(monthKey)`, `setSummaryForMonth(monthKey, markdown)`; summaries stored as `summary_YYYY-MM` with `{ markdown, createdAt }`.
- **Load on page**: Summary page loads saved summary for the current viewing month when data is available; no auto-generate on page load (avoids unexpected API calls and rate limits).
- **Save after generate**: After successful API response, save markdown for the bundle's `as_of_month`.
- **Other months**: When user switches "Viewing: [Month]", Summary page shows that month's saved summary if any; otherwise "Generate summary" to create one.
- **Regenerate**: Button shows "Generate summary" when no saved summary for this month, "Regenerate summary" when one exists. Clicking Regenerate shows confirmation: "This will overwrite the existing summary for MMM YYYY. Continue?" before calling the API.

### OpenAI: retry, timeout, and rate-limit handling
- **Retry** (`src/lib/openaiRetry.ts`): `fetchWithRetry` retries on 429 and 503 with exponential backoff (2s, 4s, 8s); max 3 attempts.
- **Timeout**: AbortController timeout (55s) so the route can return a clear error before platform kills the request; `TIMEOUT_MESSAGE`: "Request timed out. Summary generation can take 30–60 seconds. Try again."; API returns 504 on timeout.
- **Route maxDuration**: `export const maxDuration = 60` on `/api/summary` and `/api/summary/chat` so serverless can run up to 60s (Vercel Free remains 10s; Pro gets 60s).
- **Rate limit**: On 429 after retries, return `RATE_LIMIT_MESSAGE`: "Too many requests. Please wait a minute and try again."
- **Payload**: Bundle sent as compact JSON (no pretty-print) to reduce input tokens.
- **No background request**: Summary page does not auto-generate on load; user must click "Generate summary".
- **Docs**: `docs/OPENAI_RATE_LIMITS.md` — rate limits (RPM/TPM), timeouts, Vercel Free 10s limit, payload size.

### Bug fixes
- **Action-list** (`src/app/action-list/page.tsx`): Added missing `try {` so `catch` has a matching `try` when parsing stored data.
- **Near-eligible** (`src/app/near-eligible/page.tsx`): Fixed "Rendered more hooks than during the previous render" — moved all `useMemo` hooks (nearEligibleWithLabels, filtered, sorted) before the `if (!data)` early return so hook order is consistent every render.

### Doc and spec updates (this session)
- **PRD.md**: Snapshot versioning (§4.2); Settings page (§7); AI Summary per-month storage and regenerate confirmation (§7.8); summary storage and OPENAI_RATE_LIMITS (§8).
- **DESIGN_SPEC.md**: `/settings` in IA; `/summary` behavior (saved per month, no auto-generate, Generate vs Regenerate with confirmation).
- **STEP_0_SPEC.md**: Snapshot metadata and stale check in Historical Data Storage.
- **CONTEXT_INDEX.md**: OPENAI_RATE_LIMITS.md in specs list.
- **MVP_BUILD_PLAN.md**: Current state — snapshot versioning, AI Summary storage, OpenAI retry/timeout, Settings.

### Files modified/created (this session)
- `src/config/snapshotVersion.ts` — SNAPSHOT_SCHEMA_VERSION, COMPUTE_VERSION
- `src/lib/storage.ts` — getProcessedDataParsed, clearAllSnapshots, getSummaryForMonth, setSummaryForMonth, SUMMARY_PREFIX
- `src/lib/openaiRetry.ts` — fetchWithRetry (retry 429/503, AbortController timeout), RATE_LIMIT_MESSAGE, TIMEOUT_MESSAGE
- `src/app/upload/page.tsx` — metadata on save; replaced-month message
- `src/app/page.tsx` — getProcessedDataParsed, stale snapshot banner
- `src/app/action-list/page.tsx` — try/catch fix; getProcessedDataParsed, stale banner
- `src/app/near-eligible/page.tsx` — hooks moved before early return
- `src/app/summary/page.tsx` — no auto-generate; load/save summary per month; regenerate confirmation; button label
- `src/app/settings/page.tsx` — **New**: Clear cached snapshots
- `src/app/api/summary/route.ts` — fetchWithRetry, compact JSON, maxDuration 60, 504/429 handling
- `src/app/api/summary/chat/route.ts` — fetchWithRetry, maxDuration 60, 504/429 handling
- `src/components/Navigation.tsx` — Settings link
- `docs/OPENAI_RATE_LIMITS.md` — rate limits and timeouts
- CHANGELOG.md, docs/PRD.md, docs/DESIGN_SPEC.md, docs/STEP_0_SPEC.md, docs/CONTEXT_INDEX.md, docs/MVP_BUILD_PLAN.md — updated as above

---

## [Previous] - Trailing window fix (month keys), compact T6/T12 headers and tooltips

### Trailing window calculation (authoritative)
- **Month-key windows**: T6 and T12 are defined as exactly 6 and 12 month keys **inclusive** of the as-of month. Use `getTrailingMonthKeys(asOfMonthKey, n)` from `src/lib/timeWindows.ts`; do not use date comparisons (which can cause off-by-one and 7/13-month windows). Documented in `docs/LOOKBACK_WINDOWS.md`.
- **Compute**: `src/lib/compute.ts` refactored to use `getTrailingMonthKeys` and `sumAgencyCompletionsByMonthKeys` from `src/lib/metrics.ts` for C6/C12; all R6/R12, projections, and completions-needed use the same semantics.
- **timeWindows**: `toMonthKey` now handles `Date | string` and invalid dates safely (returns `"invalid"` instead of throwing). Removed `getTrailingWindowLabel` (replaced by `src/lib/lookbackLabels.ts`).

### UI: compact T6/T12 labels and tooltips
- **Table headers**: Removed bulky date ranges from headers (e.g. "T6 (2025-08–2026-01)"). Headers are now compact: "T6 Completions PP", "T12 Completions PP".
- **Tooltips**: Column labels use `TooltipHeader` with a dotted underline; hover shows the range (e.g. "Trailing 6 months (inclusive): Aug 2025–Jan 2026") from the selected as-of month. Implemented on Action List (`/actions`) for R6/R12 columns; Agency List and Near Eligible use compact "T6"/"T12" in body text.
- **lookbackLabels** (`src/lib/lookbackLabels.ts`): `formatMonthKeyRange`, `getT6RangeLabel`, `getT12RangeLabel`, `getT6Tooltip`, `getT12Tooltip` — human-readable ranges (e.g. "Aug 2025–Jan 2026") and full tooltip text.
- **TooltipHeader** (`src/components/TooltipHeader.tsx`): Reusable component: `label` + `tooltip`; dotted underline, native `title` for accessibility.
- **Explain bullets**: `src/lib/explain.ts` uses human-readable ranges in "why" bullets (e.g. "T6 (Aug 2025–Jan 2026) Completions PP = 0.75"); no raw YYYY-MM in UI.

### Tests
- **timeWindows.test.ts**: Removed `getTrailingWindowLabel` test; T6/T12 month-key tests unchanged.
- **lookbackLabels.test.ts**: New tests for `formatMonthKeyRange`, `getT6RangeLabel`, `getT12RangeLabel`, tooltips; regression for asOfMonthKey `"2026-01"` (T6: Aug 2025–Jan 2026, T12: Feb 2025–Jan 2026).
- **computeLookback.test.ts**: Synthetic telemetry and `sumAgencyCompletionsByMonthKeys` verify C6/C12 sum exactly 6/12 months.
- **labels.test.ts**, **actionList.test.ts**, **goalProgressFromConfig.test.ts**, **goalProgress.test.ts**: Fixtures updated for authoritative trailing-window logic; `makeSimTelemetryForTrailingMonths` in `tests/helpers/makeTelemetry.ts`.

### Doc and spec updates (this session)
- **LOOKBACK_WINDOWS.md**: Implementation note (metrics.ts); new "Display (UI)" section (compact headers, tooltips, explain bullets).
- **PRD.md**: Reference to LOOKBACK_WINDOWS and UI display (compact labels + tooltips).
- **DESIGN_SPEC.md**: T6/T12 headers compact with tooltips; TooltipHeader; explain human-readable ranges.
- **ACTION_LIST_SPEC.md**: T6/T12 column headers use compact labels + tooltips.
- **STEP_0_SPEC.md**: Trailing windows reference LOOKBACK_WINDOWS.md; display uses human-readable ranges.
- **CONTEXT_INDEX.md**: LOOKBACK_WINDOWS.md in specs list.
- **MVP_BUILD_PLAN.md**: Current state — trailing window fix and UI labels/tooltips.

### Files modified/created (this session)
- `src/lib/timeWindows.ts` — toMonthKey robust to Date/string/invalid; removed getTrailingWindowLabel
- `src/lib/lookbackLabels.ts` — **New**: formatMonthKeyRange, getT6RangeLabel, getT12RangeLabel, getT6Tooltip, getT12Tooltip
- `src/components/TooltipHeader.tsx` — **New**: label + tooltip, dotted underline
- `src/lib/explain.ts` — human-readable ranges in bullets (lookbackLabels)
- `src/app/actions/page.tsx` — compact R6/R12 headers with TooltipHeader
- `src/app/action-list/page.tsx`, `src/app/near-eligible/page.tsx` — compact T6/T12 labels (no getTrailingWindowLabel)
- `tests/timeWindows.test.ts` — removed getTrailingWindowLabel test
- `tests/lookbackLabels.test.ts` — **New**: formatters and regression tests
- `docs/LOOKBACK_WINDOWS.md`, `docs/PRD.md`, `docs/DESIGN_SPEC.md`, `docs/ACTION_LIST_SPEC.md`, `docs/STEP_0_SPEC.md`, `docs/CONTEXT_INDEX.md`, `docs/MVP_BUILD_PLAN.md` — updated as above

---

## [Previous] - APAP rule canonical, threshold-only everywhere, Analysis/Home alignment, Agency List filter/export

### APAP rule (single source of truth)
- **APAP rule:** eligibility_cohort ≥ 6 AND (T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75). T12 = trailing 12‑month completions / VR licenses (R12); T6 = trailing 6‑month completions / VR licenses (R6). Documented in `docs/STEP_0_SPEC.md`, `src/lib/history.ts`, and referenced in `goalProgress.ts` / `goalProgressFromConfig.ts`.

### APAP and goal progress: threshold-only everywhere
- **computeAPAP** (`src/lib/history.ts`): Adopting = eligible (cohort ≥ 6) + (R6 ≥ 0.75 or R12 ≥ 2.0) from metrics only; no labels.
- **computeAPAPForStructuralSlice** and **goalProgress** (`src/lib/goalProgressFromConfig.ts`, `src/lib/goalProgress.ts`): Replaced label-based `isAdopting(label)` with **meetsAPAPThreshold(label)** (R6/R12 from metrics) so slice APAP and goal progress use the same definition as overall APAP.
- **APAP_INCLUDE_AT_RISK_IN_ADOPTING** (`src/config/apap_config.ts`): **Deprecated/unused**. Adopting is always threshold-based everywhere.

### Analysis page: overall APAP matches Home; chart matches metric
- **Primary metric:** "Overall APAP (same as Home)" in APAP Goal Progress section; uses `computeAPAP(agencies, labelsMap)` with no filter so it matches Home.
- **Chart:** When all eligibility cohorts and all agency sizes are selected, the APAP Goal Progress chart uses **overall APAP** per month so the chart and the big metric match. When filters are applied, the chart shows slice APAP (same threshold definition).
- **overallComparisonAPAP:** MoM comparison for overall APAP uses the same period logic as Home.

### Agency List (action-list page)
- **Filter "Adopting (meeting APAP)"**: Includes all agencies that meet APAP (eligible + R6/R12 threshold), including Top Performer and At Risk; uses both metrics and label fallback. **Eligibility requirement:** Adopting, Adopting (meeting APAP), and Top Performer filters show only **eligible** agencies (eligibility_cohort ≥ 6).
- **Export CSV:** Added columns: **Adopting (APAP)** (Y/N, eligible + meeting threshold), **T6 Completions**, **T12 Completions**, **T6 Completions PP**, **T12 Completions PP**. CSV escaping for commas/quotes.

### Spec and doc updates (this session)
- **STEP_0_SPEC.md**: APAP rule subsection; APAP Total section uses exact rule wording.
- **PRD.md**: APAP rule; Agency List filter/export; Analysis overall APAP; deprecated config.
- **ACTION_LIST_SPEC.md**: APAP rule; Agency List (action-list) filter and eligibility; export columns.
- **DESIGN_SPEC.md**: Agency List export and filters; Analysis overall APAP and chart alignment.
- **APAP_ANALYSIS.md**: Threshold-only definition; config deprecated.
- **CONTEXT_INDEX.md**: APAP_ANALYSIS note; config deprecated.
- **MVP_BUILD_PLAN.md**: Current state and recent developments section.

### Files modified (this session)
- `src/lib/history.ts` — APAP rule comment; computeAPAP threshold-only
- `src/lib/goalProgressFromConfig.ts` — meetsAPAPThreshold (replaces isAdopting); no APAP_INCLUDE_AT_RISK_IN_ADOPTING
- `src/lib/goalProgress.ts` — meetsAPAPThreshold (replaces isAdopting)
- `src/app/overview/page.tsx` — overallAPAP, overallComparisonAPAP; chart uses overall when all cohorts selected; primary metric "Overall APAP (same as Home)"
- `src/app/action-list/page.tsx` — meetsAPAP, isEligible; filter "Adopting (meeting APAP)"; eligibility for Adopting/Top Performer filters; export columns T6/T12 completions and PP, Adopting (APAP)
- `src/config/apap_config.ts` — deprecated comment

---

## [Previous] - Adoption/APAP alignment, Analysis KPI rework, Action List consistency, APAP threshold-only

### Adoption and APAP logic alignment
- **Adoption definition (single source of truth)**: Adopting = meeting **at least one** threshold: R6 ≥ 0.75 **or** R12 ≥ 2.0 (either metric; null-safe in labels and compute). Applied in `src/lib/labels.ts`, `src/lib/compute.ts`, `src/lib/actionList.ts`, and UI (action-list, near-eligible, actions pages).
- **Baseline/history “was adopting”**: Includes At Risk (Next Month) and At Risk (Next Quarter) so that agencies labeled At Risk in a given month count as adopting that month for baseline churn and 2026 churned logic. See `docs/ACTION_LIST_SPEC.md` §3.3 and §4.1.
- **APAP is threshold-only**: APAP no longer uses labels (At Risk, Churned, etc.). Adopting for APAP = eligible (cohort ≥ 6) and (R6 ≥ 0.75 or R12 ≥ 2.0) from current month's telemetry. Implemented in `computeAPAP` in `src/lib/history.ts` using metrics (R6/R12) only. This keeps APAP stable when cohort or label definitions change. Goal progress "adopting" count is still configurable via `APAP_INCLUDE_AT_RISK_IN_ADOPTING` in `src/config/apap_config.ts` (default `false`); that flag does not affect the APAP percentage. See `docs/APAP_ANALYSIS.md`.

### Analysis page: KPI metrics rework
- **Placement**: KPI metrics block moved **between** APAP Goal Progress (chart + filters) and Biggest Movers.
- **Layout**: Two rows — **Top row**: Adopting, Eligible, Ineligible; **Bottom row**: At Risk (Next Month), At Risk (Next Quarter), Churned Out, Close to Adopting.
- **Per metric**: Each card shows **agency count** and **points** (officer_count sum). MoM comparison shows **count change** and **points change** vs comparison period when stored (history now stores `kpiCountsAndPoints` on upload).
- **Eligible**: New metric = T10 agencies with eligibility_cohort ≥ 6 (count + points).
- **Close to Adopting**: Action List definition — eligible, not adopting, and (R6 ≥ 0.5 or R12 ≥ 1.5). Implemented in `computeKPICountsAndPoints` and `computeKPICounts` in `src/lib/history.ts`.

### Action List and overview count consistency
- **Same churned/at-risk/close/ineligible counts on both pages**: Overview KPI and Action List now use the same population — we **include** agencies with unknown line size or missing VR licenses (previously excluded from Action List). Action List shows them with line size "Unknown" and VR licenses "—" so totals match the Analysis KPI cards (e.g. 69 churned on both when applicable).
- **Action List default line size filter**: Default is now **all** line sizes (empty set) so the list is not pre-filtered to Major + T1200; "Unknown" added as a line size filter option. See `src/app/actions/page.tsx`.

### APAP increase analysis and config
- **`docs/APAP_ANALYSIS.md`**: Current APAP definition (threshold-only); historical context for December/January increase; goal progress config.
- **`src/config/apap_config.ts`**: Flag `APAP_INCLUDE_AT_RISK_IN_ADOPTING` affects only goal progress "adopting" count (default `false`). APAP percentage does not use this flag.

### Spec and doc updates
- **`docs/ACTION_LIST_SPEC.md`**: §3.3 adoption thresholds; §4.1 baseline adopting includes At Risk; §5.1 columns (no Recommendation/Tags, Completions Needed This Month); §11 config and display behavior (section names, default sort, completions-needed behavior).
- **`docs/APAP_ANALYSIS.md`**: New; APAP increase analysis and config usage.

### Files modified/created
- `src/lib/history.ts` — `computeKPICountsAndPoints`, KPI points in history; `computeAPAP` uses metrics-only (R6/R12) for adopting, no label dependency
- `src/lib/labels.ts` — null-safe adoption; `findLastAdoptingMonth` / `computeLabelsForAgencies` adoption check
- `src/lib/actionList.ts` — include unknown line size / missing licenses (display Unknown/—); `isAdoptingLabel` includes At Risk
- `src/lib/goalProgress.ts`, `src/lib/goalProgressFromConfig.ts` — `isAdopting` uses `APAP_INCLUDE_AT_RISK_IN_ADOPTING`
- `src/lib/explain.ts` — null-safe metrics in “why” bullets
- `src/app/overview/page.tsx` — KPI block between APAP Goal Progress and Biggest Movers; two rows; count + points; MoM count and points
- `src/app/actions/page.tsx` — line size default all; Unknown option; `getLineSizeColor` for Unknown
- `src/app/upload/page.tsx` — save `kpiCountsAndPoints` to history
- `src/config/apap_config.ts` — **New**
- `docs/APAP_ANALYSIS.md` — **New**
- `docs/ACTION_LIST_SPEC.md` — updated

---

## [Previous] - Biggest Movers, driver/line labels, Action List page, Agency List restored

### Analysis page: Biggest Movers section
- **New section**: "Biggest movers (month over month)" on Analysis page shows top 3 positive and top 3 negative movers, derived from cohort adoption percentages and driver rates.
- **Dynamic goal referencing**: Variance in Biggest Movers explicitly states whether it is vs "High Confidence" or "Hard Climb" goal; switches to "Hard Climb" when current metric already meets or exceeds High Confidence target.

### Analysis page: Driver rate and line size relabeling
- **Driver rate labels** (display only): "Retention rate" → "2025 Adopting Retention Rate"; "Conversion rate" → "2025 Unadopting Conversion Rate"; "Currently ineligible adoption rate" → "H2 2025 Customers' Adoption Rate"; "New customer adoption rate" → "H1 2026 New Customers' Adoption Rate".
- **Line size**: "Other" displayed as "Direct" in Analysis (and elsewhere where applicable).

### Action List vs Agency List (two distinct pages)
- **Agency List restored at `/action-list`**: The page at `/action-list` was reverted to its original "Agency List" content and behavior (baseline comparison, search, filters, sort, expandable detail drawer). No longer conflated with the spec-driven Action List.
- **New Action List at `/actions`**: New page per `docs/ACTION_LIST_SPEC.md`:
  - **Config**: `src/config/action_list_config.ts` (baseline month, eligibility buckets, line size bands).
  - **Compute**: `src/lib/actionList.ts` — `buildActionList()` implements action reason categories (BASELINE_ADOPTER_CHURNED, NEW_ADOPTER_CHURNED_2026, AT_RISK_NEXT_MONTH, AT_RISK_NEXT_QUARTER, CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT, CLOSE_TO_ADOPTING), supporting tags (NOT_ADOPTING_STREAK_N, RECENT_DROP), and "why" bullets.
  - **UI**: Filters (line size, action reason), search, sortable columns, expandable row detail drawer; banner when baseline data is unavailable.
- **Navigation**: Nav bar has two tabs — "Agency List" (ListChecks, `/action-list`) and "Action List" (Target, `/actions`).
- **404 and Upload**: `src/app/not-found.tsx` and `src/app/upload/page.tsx` link to both Agency List and Action List where appropriate.

### Files modified/created
- `src/app/overview/page.tsx` — Biggest Movers section, dynamic goal display, driver and line size labels
- `src/app/action-list/page.tsx` — Restored to Agency List (reverted overwrite)
- `src/app/actions/page.tsx` — **New**: Action List page (spec)
- `src/config/action_list_config.ts` — **New**: Action List config
- `src/lib/actionList.ts` — **New**: Action List build logic
- `src/components/Navigation.tsx` — Agency List + Action List tabs
- `src/app/not-found.tsx` — Links to Agency List and Action List
- `src/app/upload/page.tsx` — Link to Action List

---

## [Previous] - APAP Goal Progress v1, Analysis/Home UI refinements, hover tooltips, KPI and Home cleanup

### APAP alignment (Analysis vs Home)
- **Analysis page main APAP**: When no cohort filters are selected for the main APAP area, the Analysis page now computes and displays **overall APAP** (matching the Home page) instead of 0%. Comparison APAP also uses overall historical APAP when no filters are selected.

### APAP trend chart enhancements (Home and Analysis)
- **Trend line by MoM**: Trend segments are drawn segment-by-segment; each segment uses red (`var(--fg-destructive)`) for negative month-over-month change and green (`var(--fg-success)`) for positive MoM.
- **Goal lines distinct from trend**: High Confidence (42%) uses purple (`var(--fg-live)`) with dash pattern `6 4`; Hard Climb (46.2%) uses blue (`var(--fg-action)`) with dash pattern `4 6`. Labels match colors for clear differentiation.

### APAP Goal Progress section (Analysis page)
- **New section**: "APAP Goal Progress" added to Analysis page with dedicated cohort filters (Eligibility Cohort: 6–12 Months, 13–18 Months, 19–24 Months, 2+ Years; Agency Size: Major, T1200, Direct). "Select All" for these filters; deselect-all is prevented (re-selects all if last option unchecked).
- **Metrics**: Current and comparison APAP for the selected slice computed via `computeAPAPForStructuralSlice`; goal rates (High Confidence, Hard Climb) for the slice via `getGoalRatesForSlice` from `src/config/goal_model_config.ts` and `src/lib/goalProgressFromConfig.ts`.
- **Trend chart**: Red/green MoM segments; cohort-specific goal lines (purple HC, blue Hard Climb); when HC and Hard Climb rates are equal, a single combined goal line and label is shown. Hover tooltip shows rate, MoM (pp), variance to HC, and variance to Hard Climb.
- **November baseline for slice**: `getNovemberBaselineAPAPForSlice` and `cohortBaselineNovember` in config support baseline APAP for the selected cohort slice. Baseline parser stores `eligibility_cohort` for filtering (`src/lib/baseline.ts`).

### Removal of old APAP Total section (Analysis)
- The previous "APAP (Adoption Percentage)" section and its "Filter by Cohort" block (Time Since Purchase, Agency Size) were removed from the Analysis page. Restore from git history if needed.

### Hover tooltips (all pages)
- **Chart containers**: Chart wrapper divs and SVGs use `overflow: 'visible'` so tooltips are not clipped; tooltips may extend outside the chart area when needed.
- **Tooltip sizing**: Usage trend (Analysis): 220×84 with spaced text lines; APAP Goal Progress trend: 200×84, variance split into two lines (vs HC, vs Hard Climb); APAP trend (Analysis/Home): 104×36; APAP Growth (Home): 140×48. Text is no longer squished or overlapping.

### Analysis page cleanup
- **Unknown/Insufficient KPI card removed**: The "Unknown/Insufficient" card was removed from the KPI grid. KPI cards shown: Adopting, At Risk (Next Month), At Risk (Next Quarter), Churned Out, Ineligible.

### Home page cleanup
- **Upload and Agency List boxes removed**: The two clickable cards ("Upload Data" and "Agency List") were removed from the Home page. Users reach Upload and Agency List via the navigation bar. Unused imports (`Link`, `Upload`, `ListChecks`) removed from `src/app/page.tsx`.

### Files modified
- `src/app/overview/page.tsx` — APAP Goal Progress section, filters, trend chart; KPI array without Unknown/Insufficient; Usage/APAP trend tooltips and overflow
- `src/app/page.tsx` — Removed Upload/Agency List cards and unused imports; APAP trend and APAP Growth tooltips and overflow
- `src/lib/goalProgressFromConfig.ts` — `computeAPAPForStructuralSlice`, `getGoalRatesForSlice`, `getNovemberBaselineAPAPForSlice`
- `src/config/goal_model_config.ts` — `cohortBaselineNovember`, `CohortBaselineKey`
- `src/lib/baseline.ts` — `eligibility_cohort` on baseline agencies for filtering

---

## [Previous Session] - Viewing-month consistency, 404 handling, goal progress from config

### Viewing-month consistency
- **All pages load data for the selected viewing month**: Home, Analysis, Agency List, Near Eligible, Summary, and Upload now load their main dataset with `getProcessedData(getCurrentMonth() ?? undefined)` so the "View month" selected in the nav bar drives which month’s latest stored data is shown. Pages that need a specific month (e.g. baseline November) still call `getProcessedData('YYYY-MM')` where appropriate.

### 404 handling
- **Redirects**: `/analysis` and `/cohorts` redirect to `/overview` in `next.config.js` so old bookmarks or links land on the Analysis page.
- **Custom not-found page**: Added `src/app/not-found.tsx` for any other missing route; shows a clear message and links back to Home, Analysis, and Agency List.

### Analysis page hooks fix
- **"Rendered more hooks than during the previous render"**: Fixed by moving all `useMemo` hooks (`baselineMonthData`, `currentMonthData`, `structuralResult`, `driverResult`) and the `handleGoalModelFile` callback to the top of `src/app/overview/page.tsx`, before any conditional rendering, so hooks run in the same order on every render.

### Goal progress from config (no runtime Excel parsing)
- **Config as source of truth**: Goal progress (structural variance and driver progress) is now computed from `src/config/goal_model_config.ts` and `docs/GOAL_MODEL_CONFIG_SPEC.md`. New compute module `src/lib/goalProgressFromConfig.ts` implements structural variance and driver progress using that config.
- **Line size and eligibility buckets**: Definitions match spec: Major ≥501, T1200 100–500, Other under 100 (officer_count 0 → Other); eligibility 6–12→6_12, 13–18→13_18, 19–24→19_24, 25+→25_plus.
- **Runtime changes**: Overview and Summary pages use `computeStructuralVarianceFromConfig` and `computeDriverProgressFromConfig` only. Removed `src/app/api/goal-model/route.ts`. `src/lib/goalModel.ts` and `src/lib/goalProgress.ts` remain in the codebase but are not used at runtime.
- **Tests**: Added `tests/goalProgressFromConfig.test.ts` for line size, eligibility bucket, pointsGap, and variancePp logic; all tests pass.

### Files modified/created
- `src/app/page.tsx`, `src/app/overview/page.tsx`, `src/app/action-list/page.tsx`, `src/app/near-eligible/page.tsx`, `src/app/summary/page.tsx`, `src/app/upload/page.tsx` — load main data via `getProcessedData(getCurrentMonth() ?? undefined)`
- `next.config.js` — redirects for `/analysis`, `/cohorts` → `/overview`
- `src/app/not-found.tsx` — **New**: custom 404 page with links
- `src/app/overview/page.tsx` — hooks moved before conditionals; uses config-based goal progress
- `src/app/summary/page.tsx` — uses config-based goal progress
- `src/lib/goalProgressFromConfig.ts` — **New**: config-based structural + driver computations
- `src/config/goal_model_config.ts` — source of truth for goal model (existing)
- `tests/goalProgressFromConfig.test.ts` — **New**: unit tests for config-based logic
- **Deleted**: `src/app/api/goal-model/route.ts`
- `docs/PRD.md`, `docs/STEP_0_SPEC.md`, `docs/DESIGN_SPEC.md`, `docs/MVP_BUILD_PLAN.md` — updated for viewing-month, 404, single Analysis chart, goal-from-config

---

## [Previous Session] - Month-keyed persistence, SIM T10 engagement, APAP accuracy, dropouts

### Analysis page: single usage chart (Simulator Training T10)
- **Removed Total Usage Trend and Per-Product Usage Trend charts** from Analysis page to avoid conflicting numbers for the same product. Those charts used rollup data that could be out of date for the current viewing month.
- **Kept only Simulator Training (T10) chart**, which uses latest stored data for the current viewing month (same definition as Home SIM Engagement). PRD, DESIGN_SPEC, and STEP_0_SPEC updated to describe the single usage trend.

### Month-keyed persistence and storage
- **Storage module** (`src/lib/storage.ts`): `getProcessedData`, `setProcessedData`, `getStoredMonths`, `getCurrentMonth`, `setCurrentMonth`. Processed data stored in localStorage keyed by `processedData_YYYY-MM` (compressed with lz-string), cap 24 months; `processedData_currentMonth` tracks the month the user is viewing.
- **Upload page**: "Save this upload as dataset for month" dropdown (default "Auto (from telemetry)" or manual month); used as key for localStorage so a specific month's data can be overwritten.
- **Navigation**: "Viewing: [Month ▼]" dropdown in nav bar; selecting a month sets `currentMonth` in localStorage and triggers full page reload so all pages reflect that month's data. Navigation syncs with `getStoredMonths()` and `getCurrentMonth()` whenever the URL pathname changes.
- **Session/localStorage quota**: lz-string compression for processed data to avoid quota exceeded errors.

### APAP display and comparison accuracy
- **Home high-level APAP metrics**: New block at top showing current month's APAP, MoM change (pp with arrow), and basis points below High Confidence (42%) and Hard Climb (46.2%).
- **APAP section (Home)**: Two separate comparison lines—"X.Xpp vs Baseline (Nov 2025)" and "X.Xpp vs Last Month (e.g. Dec 2025)"—so baseline vs last-month changes are clearly distinguished.
- **Changes vs Previous Month**: History now stores per month `apapEligibleCount`, `apapEligiblePoints`, `apapAdoptingCount`, `apapAdoptingPoints`. The panel uses stored previous-month counts when available; otherwise falls back to re-computation. Header clarifies comparison (e.g. "Changes vs Previous Month (Dec 2025) — eligible = cohort ≥6 from that month's upload").
- **Analysis (Overview) APAP trend chart**: Dynamic Y-axis based on min/max APAP in displayed data (5% padding, min 2%). Goal lines (42%, 46.2%) and labels are always visible—Y-axis expands to include them when outside the data range.
- **Analysis data sync**: Data-loading `useEffect` depends on pathname so navigating to Analysis reloads data from storage for the currently selected viewing month.

### SIM Engagement – VR (T10)
- **Home SIM Engagement section**: T10-only Simulator Training metrics: T12 completions (trailing 12 months), MoM vs prior T12, progress to 290K goal (Nov'26 from 180K Nov'25), this month vs same month last year (YoY), Dec 2024 baseline (7,262) when comparing Dec 2025 vs Dec 2024. Bar chart of monthly SIM completions (last 12 months) with most recent month highlighted; YoY visuals (prior-year value/label) where prior-year data exists (history or Dec 2024 baseline). Caption shows most recent month completions (T10).
- **Analysis page**: New "Simulator Training (T10)" chart before Total Usage Trend; uses same logic (`computeSimT10Usage`) as Home SIM Engagement; caption states it matches Home page — T10 agencies only, Simulator Training product.
- **Jan 2025 data**: System correctly retrieves Jan 2025 data (e.g. from a later upload's telemetry) for YoY comparisons.

### Agencies that dropped out of eligibility
- When viewing a month with a "Changes vs Previous Month" comparison, the app loads and compares previous and current month's processed data to find agencies that were eligible (cohort ≥6) in the previous month but not in the current.
- Table columns: Agency ID, Agency name, Footprint/Officer count, Reason (e.g. "Not in current month's upload" or "Cohort in YYYY-MM: N (was 6)").
- If no agencies dropped, a message is shown with a note to check data consistency if the summary still shows a decrease.

### Upload and ingest
- **Agency file expected column order**: `src/lib/ingest.ts` defines `EXPECTED_AGENCY_COLUMN_ORDER` for documentation; upload page UI and error messages list this expected column order as a hint; parsing remains by column name, not position.

### Files modified/created
- `src/app/overview/page.tsx` — APAP trend dynamic Y-axis, Simulator Training (T10) chart, data sync
- `src/app/page.tsx` — High-level APAP block, APAP section fixes, SIM Engagement T10, dropouts section
- `src/app/upload/page.tsx` — Month selector, expected column order hint
- `src/components/Navigation.tsx` — Viewing month dropdown, sync on pathname
- `src/lib/history.ts` — Store apapEligibleCount, apapEligiblePoints, apapAdoptingCount, apapAdoptingPoints per month
- `src/lib/ingest.ts` — EXPECTED_AGENCY_COLUMN_ORDER
- `src/lib/storage.ts` — **New**: getProcessedData, setProcessedData, getStoredMonths, getCurrentMonth, setCurrentMonth
- `src/lib/usageRollups.ts` — T10 SIM usage and YoY logic
- `package.json` — Added lz-string

---

## [Previous Session] - Adoption Calculation Fix, At Risk Logic Update, and Eligibility Strictness

### Adoption Calculation Fix
- **Corrected Rate Formulas**:
  - Fixed adoption rate calculations to use total completions per license (not monthly averages)
  - `R6 = C6 / L` (total completions per license over 6 months)
  - `R12 = C12 / L` (total completions per license over 12 months)
  - Previous incorrect implementation was dividing by 6/12, making thresholds too easy to meet
  - Thresholds `R12 >= 2.0` and `R6 >= 0.75` are designed to work with these formulas
  - Updated both current adoption calculation and At Risk projection calculations to use consistent formulas

### At Risk Logic Enhancement
- **Two-Condition Check for At Risk**:
  - At Risk (Next Month) now requires BOTH conditions:
    1. Projected month completions (avg of last 3 months) < dropped month completions (performance declining)
    2. AND that decline causes threshold violation (`R12_next < 2.0` or `R6_next < 0.75`)
  - At Risk (Next Quarter) uses same logic but projects 3 months forward
  - Prevents false positives where agencies would remain adopting despite projected decline
  - More accurate identification of agencies truly at risk of falling below adoption thresholds

### Eligibility Logic Strictness
- **Removed Fallback Logic**:
  - Eligibility determination now ONLY uses `eligibility_cohort >= 6` from uploaded file
  - Removed fallback to `months_since_purchase >= 6` when `eligibility_cohort` is missing
  - If `eligibility_cohort` is missing or null, agency is NOT counted as eligible
  - Ensures eligibility count matches exactly what's in uploaded file
  - Fixed discrepancy where dashboard showed more eligible agencies than uploaded file had with `eligibility_cohort >= 6`

## [Previous Session] - Agency Upload Requirements and Eligibility Logic Updates

### Agency File Upload Changes
- **T10-Only Requirement**:
  - Only T10 agencies should be included in uploaded agency files
  - Non-T10 agencies are automatically filtered out during processing
  - Clear warning message displayed to users about T10-only requirement
  - `cew_type` column is now **optional** (no longer required)
  - If `cew_type` is missing, agencies are automatically treated as T10
  - If `cew_type` is present but not "T10", agencies are filtered out

- **Error Message Improvements**:
  - Error messages now use actual uploaded filename instead of hardcoded "Agencies.xlsx"
  - More informative error messages showing what was found vs. what was expected
  - Better logging for debugging file parsing issues

- **Upload Page UI Updates**:
  - Removed `cew_type` from required columns list
  - Added prominent warning that only T10 agencies should be included
  - Moved `cew_type` to optional columns list
  - Updated help text to clarify T10-only requirement

### Eligibility Logic Changes
- **Month-Specific Eligibility**:
  - Eligibility is now determined by `eligibility_cohort >= 6` from each month's uploaded file
  - Each month's `eligibility_cohort` value is independent (increments by 1 each month)
  - November baseline: Only agencies with `eligibility_cohort >= 6` in baseline file
  - December current: Only agencies with `eligibility_cohort >= 6` in December uploaded file
  - Future months: Will use `eligibility_cohort >= 6` from each month's uploaded file
  - Replaced previous logic that used `months_since_purchase >= 6` (computed value)
  - `eligibility_cohort` from uploaded file is now the authoritative source for eligibility

- **Baseline Filtering**:
  - Baseline parser now reads `Eligibility_Cohort` column from baseline file
  - Only includes agencies with `eligibility_cohort >= 6` in baseline
  - Ensures accurate month-over-month comparisons

- **APAP Calculation Updates**:
  - `computeAPAP` function now uses `eligibility_cohort >= 6` from uploaded data
  - Falls back to `months_since_purchase >= 6` only if `eligibility_cohort` is not available
  - All eligibility checks updated throughout codebase

### UI Improvements
- **Action List Filter Updates**:
  - Removed "Ineligible (0–5 months)" from label filter dropdown
  - Ineligible agencies don't contribute to APAP, so filtering removed from UI
  - Filter options now: All Labels, At Risk (Next Month), At Risk (Next Quarter), Churned Out, Top Performer, Adopting, Not Adopting

### Technical Fixes
- Fixed TypeScript compilation errors that were causing 404 errors
- Fixed agency data storage/loading issues with proper date conversion
- Improved error handling and logging throughout upload process
- Added comprehensive debug logging for agency parsing and filtering

## [Previous Session] - Page Consolidation, APAP Goal Updates, and Home Page Redesign

### Page Consolidation and Navigation Updates
- **Moved Cohort Analysis to Analysis Page**:
  - Integrated all Cohort Analysis functionality into the Overview page (renamed to "Analysis" in UI)
  - Analysis page now includes:
    - APAP (Adoption Percentage) section with cohort filters
    - Cohort dimension selector and filters
    - Cohort Summary Table with all metrics (Agency Count, Total Officer Count, % Adopting with MoM/QoQ, % Churned Out, % At Risk)
  - Removed standalone `/cohorts` page entirely
  - Updated navigation to reflect "Analysis" instead of "Overview" and removed "Cohort Analysis" link

- **APAP Trend Chart Size Adjustments**:
  - Increased chart size on Analysis page (chartWidth: 500, chartHeight: 200)
  - Reduced left-side metrics font size to accommodate larger chart
  - Improved visual balance between metrics and trend visualization

### APAP Goal Updates
- **Updated Goal Thresholds**:
  - High Confidence goal: 45.1% → **42%**
  - Hard Climb goal: 49.1% → **46.2%**
  - Updated all instances across:
    - Baseline data (`src/lib/baseline.ts`)
    - Summary bundle (`src/lib/summaryBundle.ts`)
    - API summary prompt (`src/app/api/summary/route.ts`)
    - All charts and visualizations

### Home Page Redesign
- **Removed Goal Tracking Section**:
  - Removed interactive progress bar with baseline/current/goal markers
  - Removed goal progress tracking UI

- **Added APAP Section to Home Page**:
  - New APAP (Adoption Percentage) section similar to Analysis page
  - Shows current APAP percentage with adopting/eligible points and counts
  - **Detailed Metrics Display** (replaces trend chart):
    - Eligible agencies: [count] ([MoM change])
    - Adopting agencies: [count] ([MoM change])
    - Eligible points: [count] ([MoM change])
    - Adopting points: [count] ([MoM change])
    - All changes displayed in parentheses with color coding (green for positive, red for negative)
    - Changes always visible (even if 0) for clear month-over-month trends
  - No cohort filter options on home page (simplified view)
  - Baseline comparison indicator showing change vs November 2025

- **APAP Growth Chart Enhancements**:
  - **Condensed Y-Axis Range**: Changed from 25-60% to **30-50%** for better visualization of marginal basis point changes
  - **Dynamic Color Gradients**:
    - Line segments colored based on month-over-month change direction
    - Green gradient for positive MoM changes (darker = larger increase)
    - Red gradient for negative MoM changes (darker = larger decrease)
    - Gradient intensity scales with change magnitude (0.1pp to 2pp+)
    - Each segment between data points uses appropriate color
  - Goal lines updated to 42% (High Confidence) and 46.2% (Hard Climb)
  - Improved visual feedback for trend direction and severity

### Technical Improvements
- **Fixed Hydration Errors**:
  - Created client-side only chart section component to prevent server/client HTML mismatches
  - Added mounting checks to ensure charts only render after client-side hydration
  - Fixed React hydration errors related to SVG rendering

- **Comparison Data Accuracy**:
  - Enhanced comparison APAP calculation to properly use historical labels
  - Improved baseline comparison logic for accurate month-over-month changes
  - Added debug logging for comparison calculations

### Files Modified
- `src/app/page.tsx` - Home page redesign, APAP section, chart color gradients, Y-axis adjustment
- `src/app/overview/page.tsx` - Integrated cohort analysis, renamed to Analysis, chart size adjustments
- `src/components/Navigation.tsx` - Updated navigation labels and removed Cohort Analysis link
- `src/lib/baseline.ts` - Updated goal values (42%, 46.2%)
- `src/lib/summaryBundle.ts` - Updated goal values in summary bundle
- `src/app/api/summary/route.ts` - Updated goal references in AI summary prompt
- `src/app/cohorts/page.tsx` - **DELETED** (functionality moved to Analysis page)

## [Previous Session] - Baseline Comparison Fixes and Overview Page Enhancements

### Baseline Comparison Accuracy Fixes
- **T10 Filtering in Baseline Comparison**:
  - Fixed baseline comparison calculations to only count T10 agencies when computing November eligible/adopting counts
  - Baseline agencies are now matched with current T10 agencies before being included in comparison
  - Ensures baseline comparison reflects only T10 customer base, matching current data filtering
  - Fixed issue where baseline comparison was showing incorrect negative changes due to including non-T10 agencies

- **Filtered Baseline APAP in Trend Chart**:
  - Trend chart now computes filtered baseline APAP for November when cohort filters are applied
  - Previously, November baseline always showed 37.1% (overall) regardless of selected cohorts
  - Now correctly shows filtered baseline APAP that matches the selected cohort filters
  - When no filters are selected, still uses overall baseline APAP (37.1%)
  - Ensures trend visualization accurately reflects cohort-specific historical data

- **Eligible Agency Count Month-over-Month**:
  - Verified that eligible agency count correctly reflects agencies that became eligible in December
  - Agencies with `eligibility_cohort = 5` in November become `eligibility_cohort = 6` in December and are counted as eligible
  - December data file contains updated `eligibility_cohort` values (incremented by 1 from November)
  - Baseline comparison correctly shows November eligible count (from baseline) vs December eligible count (from current data)
  - Added comprehensive debug logging to track baseline matching, new eligible agencies, and count changes

- **Baseline Agency Matching Improvements**:
  - Enhanced agency ID matching to handle both string and number IDs in baseline vs current data
  - Baseline agency IDs (from Excel) may be numbers, while current data uses strings
  - Matching logic now tries both string and number conversions for robust matching
  - Added validation to ensure baseline agencies are still T10 in current data before counting

### Overview Page Bug Fixes
- **Fixed Missing Import**:
  - Added missing `computeUsageRollups` import to fix runtime error when filtering usage charts by cohorts
  - Error occurred when cohort filters were applied to usage trend charts

- **Fixed Duplicate Variable Definition**:
  - Removed duplicate `baselineAgencyIdSet` definition that was causing build errors
  - Reused existing variable definition for consistency

### Technical Improvements
- Added comprehensive debug logging for baseline comparison calculations
- Enhanced error messages and validation for baseline data matching
- Improved code organization and variable reuse

## [Previous Session] - T10 Customer Filtering, Agency List Enhancements, and Top Performer Fixes

### T10 Customer Filtering
- **Exclusive T10 Customer Focus**:
  - All pages, metrics, and calculations now only include T10 customers (`cew_type === 'T10'`)
  - Non-T10 customers (T7, etc.) are completely excluded from:
    - Agency List page
    - Near Eligible page
    - Cohort Analysis page
    - APAP calculations
    - Cohort aggregations
    - All adoption metrics and summaries
  - Filtering applied at pipeline level (`src/lib/pipeline.ts`) and display level (all page components)
  - Ensures adoption and APAP metrics only reflect T10 customer base

### Agency List Page Enhancements
- **Baseline Status Display Fix**:
  - Fixed logic to only show "New 2026 Agency" for agencies that weren't in November 2025 baseline
  - Agencies in baseline now correctly show status changes:
    - "Newly Adopting" (wasn't adopting in baseline, now is)
    - "No Longer Adopting" (was adopting in baseline, now isn't)
    - "Still Adopting" (unchanged from baseline)
    - "Still Not Adopting" (unchanged from baseline)
  - Added debug logging to track baseline matching

- **Line Size Color Coding**:
  - Line Sizes (agency_size_band) now have color-coded badges similar to Labels:
    - Direct: Blue (`var(--fg-action)`)
    - T1200: Purple (`var(--fg-live)`)
    - Major: Green (`var(--fg-success)`)
    - Unknown: Gray

- **Completion Per License Color Coding**:
  - In expanded agency view, R6 and R12 metrics are color-coded:
    - Green with ✓ if meeting threshold (R6 >= 0.75 or R12 >= 2.0)
    - Red if not meeting threshold
  - Makes threshold status immediately visible

- **Purchase Month Display**:
  - Added purchase month calculation and display in expanded agency view
  - Calculated from `months_since_purchase` and `asOfMonth` using eligibility cohort

- **Enhanced Churn Explanation**:
  - For Churned Out agencies, expanded view now shows:
    - Last adopting month (when they last met thresholds)
    - Months adopting before churn (calculated by going back from last adopting month)
    - Which threshold(s) they were meeting (T6, T12, or both)
    - Recent usage (last 3 months of completions)
  - Helps understand churn patterns and duration of adoption

- **Default Sort**:
  - Agency List and Near Eligible pages now default to Agency Size (officer_count) descending
  - Largest agencies appear first by default

- **Expanded Row Styling**:
  - Fixed expanded row background color to extend full width
  - Expanded row now uses same background color as main row for visual consistency

### Top Performer Fixes
- **Exclude Unknown Officer Count Agencies**:
  - Agencies with "Unknown (No officer count)" are now excluded from Top Performer consideration
  - Added final pass in `computeLabelsForAgencies` to remove Top Performer label from these agencies
  - They revert to "Adopting" status instead
  - Ensures Top Performers only include agencies with known officer counts

## [Previous Session] - December 2025 Data Parsing Fix, Baseline APAP Correction, and Storage Optimization

### December 2025 Data Parsing Fix
- **Fixed Date Parsing for YYYY-MM Format**:
  - Updated `TelemetryRowSchema` to use `z.preprocess` to handle YYYY-MM format strings (e.g., `'2025-12'`) before date coercion
  - Previously, `z.coerce.date()` was incorrectly parsing these strings, causing December 2025 data to be lost
  - December 2025 rows are now correctly detected and displayed on the APAP Growth chart
  - Added comprehensive logging to track date parsing through the pipeline

### Baseline APAP Value Correction
- **Fixed Baseline Percentage Parsing**:
  - Excel stores percentages as decimals (37.1% = 0.371), but the code was reading them as-is
  - Added logic to detect decimal percentages (0-1 range) and convert to percentage values (multiply by 100)
  - Baseline now correctly shows 37.1% instead of 0.4%
  - Added validation to detect and fix incorrect cached baseline values in localStorage

### Baseline Loading Improvements
- **Fixed File Path Encoding**:
  - Updated `loadBaselineFromUrl` to properly URL-encode file paths to handle spaces in filenames
  - Baseline file now loads correctly from `public/2026 VR APAP Threshold Modeling.xlsx`
  - Added automatic cache clearing for incorrect baseline values

### Storage Optimization
- **Fixed localStorage Quota Exceeded Error**:
  - Reduced storage footprint by not storing full telemetry data (17,916+ rows) in historical data
  - Removed agency labels from historical storage (too large)
  - Now only stores essential data: APAP value, cohort summaries, and usage rollups
  - Added graceful error handling for quota errors with automatic cleanup of old data
  - Historical data now limited to 12 months (reduced from 24) to prevent quota issues

### Technical Improvements
- Added comprehensive logging throughout the data pipeline to track December 2025 rows
- Enhanced date parsing validation and error messages
- Improved error handling for localStorage operations

## [Previous Session] - APAP Growth Chart, Goal Tracking UI Improvements, and Baseline Loading Fixes

### APAP Growth Chart
- **Added Month-over-Month APAP Growth Chart**:
  - New chart on home page below the progress bar showing APAP trends over time
  - Displays baseline (November 2025, 37.1%) and all subsequent months
  - Automatically includes each month's results as data is uploaded
  - Fixed y-axis range: 25% to 60% with ticks at 5% intervals
  - Horizontal goal lines at 45.1% (High Confidence) and 49.1% (Hard Climb) with labels
  - Interactive tooltips on hover showing month and APAP value
  - Baseline month (November) highlighted differently from other months
  - Chart uses SVG with responsive design

- **Data Collection Logic**:
  - Baseline (November 2025) always shows 37.1% from baseline file, never overwritten
  - Current month data uses computed APAP from uploaded files
  - Historical months loaded from localStorage with stored APAP values
  - Prevents duplicate months and ensures baseline takes precedence

### Baseline Loading Fixes
- **Fixed Baseline File Loading**:
  - Created `public/` folder and copied baseline file from `docs/` folder
  - Updated file path handling to properly URL-encode spaces in filename
  - Home page now calls `initializeBaseline()` if baseline not in localStorage
  - Baseline automatically saves to localStorage after loading for persistence
  - Fixed 404 errors when loading baseline file

### Goal Tracking UI Improvements
- **Simplified Home Page Goal Tracking**:
  - Replaced three separate progress bars (APAP Progress, High Confidence Goal, Hard Climb Goal) with a single interactive progress bar
  - Progress bar shows baseline, current, and goal markers (45.1% and 49.1%)
  - Hover interactions on markers reveal detailed information:
    - **Baseline marker**: Shows baseline APAP (Nov 2025) on hover
    - **Current marker**: Shows current APAP, month-over-month change from baseline, and adopting/eligible points breakdown on hover
    - **High Confidence Goal marker**: Shows goal (45.1%), gap, and progress percentage on hover
    - **Hard Climb Goal marker**: Shows goal (49.1%), gap, and progress percentage on hover
  - Tooltips expand on hover with comprehensive metrics
  - Added "View detailed cohort analysis" link beneath the progress bar linking to `/cohorts`
  - Fixed buggy conditional rendering that was displaying ") : (" and "Loading goal progress..." text

### Technical Improvements
- Fixed duplicate `Link` import in `src/app/page.tsx`
- Improved type safety for `GoalProgressBar` component with explicit type definitions
- Enhanced hover tooltip positioning and styling for better UX
- Added console logging for debugging baseline and chart data collection
- Maintained all existing functionality while simplifying UI

## [Previous Session] - Page Consolidation and Goal Tracking UI Improvements

### Page Consolidation
- **Merged Overview and Cohorts Pages**:
  - Combined `/overview` and `/cohorts` into a single `/cohorts` page renamed to "Cohort Analysis"
  - Removed duplicate features while preserving all functionality
  - Updated navigation to show single "Cohort Analysis" link instead of separate Overview and Cohorts links
  - Deleted `/overview/page.tsx` as functionality is now integrated into Cohort Analysis page
  - Page now includes:
    - APAP Total section with multi-select cohort filters (checkboxes)
    - SIM-only KPI cards (Adopting, At Risk, Churned, Ineligible, Unknown)
    - Total Usage Trend chart with comparison options
    - Per-Product Usage Trend chart
    - Cohort Summary table with dimension selector and filters
    - All comparison features (MoM, QoQ) preserved

### Goal Tracking UI Improvements
- **Simplified Home Page Goal Tracking**:
  - Replaced three separate progress bars (APAP Progress, High Confidence Goal, Hard Climb Goal) with a single interactive progress bar
  - Progress bar shows baseline, current, and goal markers (45.1% and 49.1%)
  - Hover interactions on markers reveal detailed information:
    - **Baseline marker**: Shows baseline APAP (Nov 2025) on hover
    - **Current marker**: Shows current APAP, month-over-month change from baseline, and adopting/eligible points breakdown on hover
    - **High Confidence Goal marker**: Shows goal (45.1%), gap, and progress percentage on hover
    - **Hard Climb Goal marker**: Shows goal (49.1%), gap, and progress percentage on hover
  - Tooltips expand on hover with comprehensive metrics
  - Added "View detailed cohort analysis" link beneath the progress bar linking to `/cohorts`
  - Fixed buggy conditional rendering that was displaying ") : (" and "Loading goal progress..." text

### Technical Improvements
- Fixed duplicate `Link` import in `src/app/page.tsx`
- Improved type safety for `GoalProgressBar` component with explicit type definitions
- Enhanced hover tooltip positioning and styling for better UX
- Maintained all existing functionality while simplifying UI

## [Previous Session] - Baseline Tracking, Goal Progress, AI Summary Enhancements, and App Rename

### App Rename
- **Renamed to "VR APAP Dashboard"**:
  - Updated app title, navigation branding, and all page headers
  - Changed "Action List" to "Agency List" throughout the application
  - Updated metadata and branding to reflect new name

### Baseline System and Goal Tracking
- **Baseline Data System** (`src/lib/baseline.ts`):
  - Created baseline loader to parse `2026 VR APAP Threshold Modeling.xlsx`
  - Extracts baseline APAP (37.1% from Goal Model (Final) H24)
  - Loads agencies from "Data" sheet (AgencySlug → agency_id, adopting points from column P)
  - Parses cohort targets from "Goal Model (Final)" sheet (columns M, N, O)
  - Stores baseline data in localStorage for persistence
  - Baseline file should be included in project repo (see `docs/BASELINE_SETUP.md`)

- **Agency List Baseline Comparison**:
  - Added "Baseline Status" column showing adoption status changes
  - "Newly Adopting": agencies that weren't adopting in baseline but are now
  - "No Longer Adopting": agencies that were adopting in baseline but aren't now
  - "Still Adopting" / "Still Not Adopting": agencies with unchanged status
  - Visual indicators with arrows and color coding

- **Home Page Goal Tracking**:
  - Current APAP vs baseline (37.1%) with MoM change
  - Progress bars toward 45.1% (high confidence) and 49.1% (hard climb) goals
  - Gap calculations and progress percentages
  - Cohort progress tracking:
    - Computes current APAP for each cohort target from baseline
    - Shows current vs target with gap (percentage points)
    - Includes sub-cohort breakdowns (Major, T1200, Other/Direct)
    - Visual progress indicators

### Overview Page Improvements
- **Cohort Filter Enhancements**:
  - Replaced dropdown filters with checkbox-based multi-select
  - Allows selecting multiple values across dimensions (e.g., Direct AND Major on Year 2 AND Year 3)
  - Fixed field name mismatch (purchase_cohort vs time_since_purchase_cohort)
  - Fixed "All CEW types" showing 0 data issue
  - Fixed "Time Since Purchase" dropdown having no selections
  - Improved filter UI with scrollable lists, hover effects, and "Clear All Filters" button

### AI Summary Enhancements
- **CUSH Narrative Style**:
  - Updated AI prompt to match CUSH (Clear, Useful, Strategic, Honest) writing style
  - Focuses on: APAP month-over-month changes, biggest drivers (new adopting agencies), biggest shakers (newly churned/unadopting), trends, and path to goals
  - Includes specific goals: 45.1% (high confidence) and 49.1% (hard climb)

- **Enhanced Summary Bundle** (`src/lib/summaryBundle.ts`):
  - Added APAP MoM tracking (current, previous month, change, gaps to goals)
  - Added "drivers" section: new adopting agencies (adopting now but not last month)
  - Added "shakers" section: newly churned and newly unadopting agencies
  - Improved data extraction from historical comparisons

- **Summary Page Improvements**:
  - Removed metrics bundle panel (users don't need to see/edit it)
  - Summary now displays directly (not as export)
  - Auto-generates summary on page load
  - Added interactive chat interface for asking questions about the summary
  - Chat API endpoint (`/api/summary/chat`) with guardrails to prevent hallucination

- **Enterprise OpenAI Configuration**:
  - Updated API route to support enterprise accounts
  - Added support for Organization ID and Project ID headers
  - Follows OpenAI's official authentication guidelines
  - Server-side only API key handling (never exposed to client)
  - Created `docs/ENTERPRISE_OPENAI_SETUP.md` with configuration guide

## [Previous Session] - APAP Metrics, Enhanced Charts, Data Quality Fixes, and Label Simplification

### APAP (Adoption Percentage) Metrics
- **New APAP Total Section on Overview Page**:
  - Calculates weighted adoption percentage: (Adopting Points / Eligible Points) × 100
  - Adopting Points = sum of `officer_count` for agencies that are both adopting AND eligible (6+ months from purchase)
  - Eligible Points = sum of `officer_count` for all eligible agencies (6+ months from purchase)
  - Provides more accurate adoption metrics by weighting by agency size
  - Shows adopting count, eligible count, and percentage breakdown

- **Cohort Filtering for APAP**:
  - Filter APAP metrics by Time Since Purchase cohort (Year 1, Year 2, etc.)
  - Filter by Agency Size band (Direct, T1200, Major)
  - Filter by CEW Type (T10, T7)
  - "All Cohorts" option to show overall APAP
  - Real-time filtering updates all APAP metrics

- **APAP Comparison Support**:
  - Compare APAP to previous periods (last month, last quarter, last year)
  - Shows percentage point change with visual indicators
  - Enables tracking adoption trends over time

### Enhanced Overview Charts
- **Full-Width Responsive Charts**:
  - Charts now fill entire screen width using SVG viewBox with `preserveAspectRatio="none"`
  - Responsive to container size changes
  - No more arbitrary width limits

- **Per-Product Chart Improvements**:
  - Removed dropdown selector
  - Now displays all products simultaneously as separate lines
  - Color-coded legend shows all products
  - Each product gets unique color from palette

- **Interactive Tooltips**:
  - Hover over any data point to see:
    - Month name
    - Total completions for that month/product
    - Month-over-Month (MoM) percentage change
    - Color-coded: green for positive, red for negative changes
  - Tooltips positioned above data points

- **Record Month Highlighting**:
  - All-time record months (highest completions) highlighted with:
    - Larger dots in `var(--fg-live)` color
    - Subtle glow effect
    - "🏆 All-time record" badge in tooltip
  - Tracks records per product in multi-product chart

### Data Quality and Parsing Fixes
- **Removed "Insufficient History" Label**:
  - Eliminated "Insufficient history" label and all associated logic
  - Agencies without enough data now get "Not Adopting" label (more actionable)
  - Removed from label type, explain bullets, KPI counts, and UI displays
  - Simplified adoption assessment logic

- **Fixed Excel Parsing Issues**:
  - **vr_licenses handling**:
    - Now properly handles empty cells, "N/A" text, null, undefined, 0, and negative values
    - Converts invalid values to `undefined` (optional field)
    - Handles string numbers (parses them correctly)
    - Added debug logging to identify parsing issues
  - **agency_id type conversion**:
    - Excel numeric IDs now automatically converted to strings
    - Prevents "Expected string, received number" validation errors
  - **Column name normalization**:
    - Case-insensitive matching (handles "VR_Licenses", "vr_licenses", etc.)
    - Space-insensitive (handles "vr licenses")
    - Handles common variations (vrlicenses, vr_license)

- **Fixed Telemetry Merge Bug**:
  - `mergeTelemetryWithHistory()` was using month-only keys, causing data loss
  - Changed to composite keys: `agency_id|month` to preserve all agency data
  - Now correctly merges historical data without overwriting multiple agencies per month
  - Fixed issue where only 12 rows remained after processing 17,916 telemetry rows

### Technical Improvements
- **Enhanced Debug Output**:
  - Excel file parsing now logs column names and sample values
  - Shows which agencies have missing/invalid license counts
  - Helps identify data quality issues during upload

- **Improved Error Handling**:
  - Better validation error messages
  - Graceful handling of missing or invalid data
  - Clearer user feedback when data issues occur

## [Previous Session] - Enhanced List Views, Sorting, Visual Indicators, and Optional Agency Upload

### Enhanced Action List and Near Eligible Pages
- **Added Agency Size Columns**:
  - "Line Size" column showing `agency_size_band` (Direct, T1200, Major)
  - "Agency Size" column showing `officer_count` (formatted with commas)
  - Both columns are sortable

- **Added VR Licenses Column**:
  - New column displaying `vr_licenses` count for each agency
  - Sortable by license count
  - Included in CSV exports

- **Split Cohorts Column**:
  - Replaced single "Cohorts" column with two separate columns:
    - "Time As Customer" - displays purchase cohort (sortable)
    - "CEW Type" - displays CEW type (T10/T7)
  - Updated CSV exports to reflect new column structure

- **Table Sorting Functionality**:
  - All major columns are now sortable by clicking column headers
  - Visual sort indicators (up/down arrows) show current sort direction
  - Supports sorting by: agency name, agency ID, line size, agency size, VR licenses, label, purchase cohort, and metrics
  - Default sort maintains priority order (At Risk first, then Churned Out, etc.)

- **Enhanced Visual Status Indicators**:
  - Color-coded row backgrounds with left border:
    - Actively adopting (Top Performer, Adopting): Light green background, green border
    - At Risk: Light orange background, orange border
    - Recently churned: Light red background, red border
    - Unengaged (Not Adopting): Light gray background, gray border
    - Close to adopting (Ineligible 0-5 months): Light blue background, blue border
  - Status icons in label badges (TrendingUp, CheckCircle2, AlertCircle, XCircle, Clock)
  - Makes agency status immediately visible at a glance

- **Metrics & Progress Column Simplification**:
  - Removed all detailed metrics (C6, C12, R6, R12, Licenses)
  - Now only displays T6 and T12 completions needed
  - Shows "Meeting both T6 and T12 thresholds" when agency is adopting
  - Only shows completions needed for non-adopting agencies

- **Completions Needed Calculation**:
  - Fixed logic to correctly handle adopting vs non-adopting agencies
  - If agency is adopting (R12 >= 2.0 OR R6 >= 0.75): shows 0 completions needed
  - If not adopting: calculates exact completions needed this month to meet thresholds
  - Accounts for rolling window - oldest month drops off next month
  - Formula: `X >= threshold * L - current_completions + oldest_month_completions`
  - Example: 100 licenses, 175 completions over 12 months, 150 over 11 months → needs 50 completions this month

- **Early Usage Signals (Near Eligible Page)**:
  - Changed label from "Raw SIM Completions (Last 3 months)" to "# Completions"
  - Now shows all available data (C12 - 12-month completions) instead of just last 3 months
  - Removed "Last 3 months" breakdown display

### Top Performer Logic Update
- **Changed from threshold-based to cohort-relative**:
  - Previously: Top Performer if adopting AND (R12 >= 3.0 OR R6 >= 1.25)
  - Now: Top 15 agencies per line size (agency_size_band) based on total T12 completions (C12)
  - Only applies to agencies that are currently Adopting or At Risk (not Churned Out)
  - Ensures top performers are distributed across all line sizes

### Optional Agency File Upload
- **Made Agencies.xlsx optional**:
  - Users can now process monthly telemetry updates without re-uploading agency data
  - If Agencies.xlsx not provided, system uses previous month's agency data from sessionStorage
  - Improved date parsing when loading previous agency data (handles both string and Date formats)
  - Clear UI indicators:
    - Removed required asterisk from Agencies.xlsx label
    - Added note: "(optional - will use previous month's data if not provided)"
    - Warning message when no file selected
  - Updated validation to only require telemetry files
  - Button logic updated to enable processing with only telemetry files

### Files Modified
- `src/app/action-list/page.tsx` - Added columns, sorting, visual indicators, simplified metrics
- `src/app/near-eligible/page.tsx` - Added columns, sorting, updated completions display
- `src/lib/labels.ts` - Updated Top Performer logic to be cohort-relative
- `src/lib/pipeline.ts` - Updated to use computeLabelsForAgencies for Top Performer calculation
- `src/lib/compute.ts` - Added calculateCompletionsNeeded function with rolling window logic
- `src/app/upload/page.tsx` - Made agencies file optional with fallback to previous data

---

## [Previous Session] - Slice 2: Cohorts Implementation with Historical Data and Trend Analysis

### Slice 2: Cohorts Page Implementation ✅
- **Created cohort aggregation system** (`src/lib/aggregate.ts`):
  - New module for computing cohort summary tables
  - Supports three dimensions: `time_since_purchase_cohort`, `agency_size_band`, `cew_type`
  - Computes: agency count, total officer count, % adopting, % churned out, % at risk, counts for unknown/insufficient history
  - Generates summaries for all dimensions in pipeline

- **Created Cohorts page** (`src/app/cohorts/page.tsx`):
  - New route: `/cohorts`
  - Cohort dimension selector (time since purchase, agency size, CEW type)
  - Filters for other cohort fields (when not the selected dimension)
  - Cohort summary table with all metrics
  - Responsive table layout with semantic color coding
  - Handles missing data gracefully with fallback to recomputed summaries

- **Navigation update**:
  - Added "Cohorts" link to navigation bar with Users icon

### Historical Data Storage System
- **Created historical data management** (`src/lib/history.ts`):
  - Stores historical uploads in localStorage keyed by `asOfMonth` (YYYY-MM format)
  - Stores SIM telemetry data and cohort summaries for each upload
  - Keeps up to 24 months of historical data (auto-cleanup)
  - Functions to retrieve previous month and quarter summaries for trend analysis
  - Merges current telemetry with historical data to ensure complete 12+ month lookback windows

- **Updated upload page** (`src/app/upload/page.tsx`):
  - Automatically saves historical data after processing
  - Stores telemetry and cohort summaries for future trend analysis

- **Updated pipeline** (`src/lib/pipeline.ts`):
  - Merges current telemetry with historical data before computing metrics
  - Retrieves previous month and quarter cohort summaries
  - Passes historical summaries to aggregation function for trend computation

### Month-over-Month and Quarter-over-Quarter Trends
- **Enhanced cohort summaries** (`src/lib/aggregate.ts`):
  - Added trend fields to `CohortSummary` type:
    - `mom_pct_adopting`: Month-over-month change in % adopting
    - `qoq_pct_adopting`: Quarter-over-quarter change in % adopting
  - Compares current summaries with historical summaries from previous periods
  - Computes differences for matching cohorts across time periods

- **Cohort table displays trends**:
  - "% Adopting MoM" column shows change from previous month
  - "% Adopting QoQ" column shows change from previous quarter
  - Color coding: green for positive changes, red for negative changes
  - Shows "N/A" when historical data is not available

### UI Refinements
- **Removed time filter functionality**:
  - Removed time filter UI and logic from cohorts page
  - Simplified data flow to use original cohort summaries

- **Removed median metrics**:
  - Removed median R6 and R12 from cohort summaries
  - Removed median columns from cohort table
  - Removed median trend columns (MoM/QoQ for medians)

- **Added total officer count**:
  - New metric: sum of `officer_count` for all agencies in each cohort
  - Displays in cohort table with comma formatting
  - Provides better understanding of cohort size beyond just agency count

- **Removed unnecessary columns**:
  - Removed "Ineligible" column from cohort table
  - Removed "Insufficient History" column from cohort table
  - Removed "Unknown" column from cohort table
  - Streamlined table to focus on key adoption metrics

### Files Modified/Created

#### Created
- `src/lib/aggregate.ts` - Cohort aggregation and summary computation
- `src/lib/history.ts` - Historical data storage and retrieval
- `src/app/cohorts/page.tsx` - Cohorts dashboard page

#### Modified
- `src/lib/pipeline.ts` - Added cohort summaries to processed results, merged historical data
- `src/app/upload/page.tsx` - Save historical data after processing
- `src/components/Navigation.tsx` - Added Cohorts link
- `docs/STEP_0_SPEC.md` - Updated with historical data and trend requirements
- `docs/PRD.md` - Updated with cohort page specifications and trend analysis

---

## [Previous Session] - UI Improvements, Bug Fixes, and Feature Additions

### Purchase Cohort System Rewrite
- **Rewrote cohort calculation logic** (`src/lib/cohorts.ts`):
  - Now uses `eligibility_cohort` directly from Excel file (months since purchase, 0-100)
  - Simplified mapping: `null/undefined` → "No Purchase", `0-5` → "Ineligible", `6-12` → "Year 1", `13-24` → "Year 2", etc.
  - Removed complex purchase date calculation logic
  - Added string-to-number coercion for Excel values that come in as strings
  - Updated schema to use `purchase_cohort` instead of `time_since_purchase_cohort`
- **Purchase date validation**:
  - Validates `eligibility_cohort` values are between 0-100 months
  - Validates calculated purchase dates are not in the future
  - Validates purchase date years are reasonable (2000 to current year + 1)
  - Invalid values are treated as missing purchase dates

### Historical Adoption Tracking
- **Added last meeting threshold date** (`src/lib/labels.ts`, `src/lib/explain.ts`):
  - New function `findLastAdoptingMonth()` tracks when agencies last met adoption thresholds
  - For "Churned Out" and "Not Adopting" agencies, explanations now include: "Last met threshold in [Month Year]"
  - Helps identify when agencies fell off adoption track

### UI Improvements - Action List Page
- **Table structure improvements**:
  - Separated agency name and agency ID into distinct columns
  - Added total completions (C6, C12) to table display alongside per-license metrics
  - Removed technical abbreviations (R6, C6) from expanded view - replaced with descriptive labels
  - Purchase cohort now explicitly labeled and displayed in Cohorts column
- **Enhanced explanations**:
  - Improved "Insufficient history" explanation: clarifies need for 3+ months of data
  - Better N/A value explanations: shows why metrics are unavailable
  - All explanations now more user-friendly and actionable
- **Color contrast fixes**:
  - Added explicit color variables to all text elements
  - Fixed white-on-white text issues
  - Ensured proper contrast throughout interface using semantic tokens

### Near Eligible Page
- **Created dedicated page** (`src/app/near-eligible/page.tsx`):
  - New route: `/near-eligible`
  - Dedicated table view for agencies 4-5 months since purchase
  - Shows early usage signals (last 3 months completions)
  - Expandable rows with detailed explanations
  - CSV export functionality
  - Search functionality
  - Info banner explaining what "Near Eligible" means
- **Navigation update**:
  - Added "Near Eligible" link to navigation bar with Clock icon
  - Removed Near Eligible section from Action List page (now has dedicated page)

### Data Ingestion Improvements
- **Enhanced Excel parsing** (`src/lib/ingest.ts`):
  - Added string-to-number coercion for `eligibility_cohort` values
  - Better handling of Excel values that may come in as strings vs numbers
  - Improved error handling for invalid data types

---

## Session Summary
Implemented Slice 2 (Cohorts) of the APAP Living Resource application according to `docs/STEP_0_SPEC.md`, `docs/PRD.md`, and `docs/DESIGN_SPEC.md`. Built cohort aggregation system, historical data storage, and trend analysis capabilities to enable month-over-month and quarter-over-quarter comparisons.

---

## Project Setup

### Initial Configuration
- **Framework**: Next.js 14 with TypeScript
- **Dependencies**: 
  - `xlsx` (v0.18.5) for Excel file parsing
  - `zod` (v3.22.4) for schema validation
  - `date-fns` (v2.30.0) for date manipulation
  - `lucide-react` (v0.294.0) for icons
- **Testing**: Jest with ts-jest
- **Styling**: Semantic tokens from `src/styles/tokens.css` (no hard-coded colors)

### File Structure Created
```
src/
  lib/
    schema.ts          # Zod schemas and TypeScript types
    ingest.ts          # Excel file parsing and normalization
    compute.ts         # Metric calculations (C6, C12, R6, R12, projections)
    labels.ts          # Label computation logic
    cohorts.ts         # Cohort assignment (time since purchase, size bands)
    explain.ts         # "Why" bullets and recommended actions
    pipeline.ts        # Main processing pipeline
    aggregate.ts       # Cohort aggregation and summaries
    history.ts         # Historical data storage and retrieval
  app/
    layout.tsx         # Root layout with Navigation
    page.tsx           # Home page
    upload/            # File upload and validation page
    action-list/       # Action list table with details
    cohorts/           # Cohort analysis dashboard
    near-eligible/      # Near eligible agencies page
  components/
    Navigation.tsx     # Global navigation header
  styles/
    tokens.css         # Design system tokens (existing)
    globals.css        # Global styles and link/button classes
tests/
  labels.test.ts       # Unit tests for label logic
```

---

## Core Pipeline Implementation

### 1. Schema (`src/lib/schema.ts`)
- **AgencyRowSchema**: Validates agency master data
  - Required: `agency_id`, `agency_name`, `vr_licenses`, `officer_count`, `cew_type`
  - Optional: `purchase_date`, `eligibility_cohort`, `region`, `csm_owner`, `notes`, training dates
  - **Key Decision**: Supports both `purchase_date` (legacy) and `eligibility_cohort` (months since purchase)
- **TelemetryRowSchema**: Validates telemetry data
  - Required: `month`, `agency_id`, `product`, `completions`
  - Normalizes month to first day of month
  - Normalizes product names (standardizes "Simulator Training")

### 2. Ingest (`src/lib/ingest.ts`)
- **parseAgenciesFile()**: Parses Agencies.xlsx using xlsx library
- **parseTelemetryFile()**: Parses telemetry .xlsx files (supports multiple files)
- **normalizeTelemetry()**: Normalizes months and product names
- **generateDataQualityReport()**: Reports unmatched IDs, missing data, row counts

### 3. Compute (`src/lib/compute.ts`)
- **Date Range Calculations**:
  - 6 months: `subMonths(asOfMonth, 6)` (goes back 6 months from as_of_month)
  - 12 months: `subMonths(asOfMonth, 12)` (goes back 12 months from as_of_month)
  - 3 months: `subMonths(asOfMonth, 3)` (goes back 3 months from as_of_month)
  - **Note**: If January data isn't available, looks at previous 6 months up to December

- **Rate Calculations**:
  - `R6 = C6 / L` (total completions per license in 6-month period, NOT monthly average)
  - `R12 = C12 / L` (total completions per license in 12-month period, NOT monthly average)
  - **Changed from**: `R6 = (C6 / 6) / L` (was incorrectly calculating monthly average)

- **Metrics Computed**:
  - `C6`: Sum of SIM completions over last 6 months ending at `as_of_month` (inclusive)
  - `C12`: Sum of SIM completions over last 12 months ending at `as_of_month` (inclusive)
  - `R6`, `R12`: Total completions per license (not monthly averages)
  - `last3Months`: Array of completions for last 3 months (for projections)

- **Projections**:
  - `projectNextMonthMetrics()`: Projects next month using average of last 3 months
  - `projectNextQuarterMetrics()`: Projects 3 months forward

### 4. Cohorts (`src/lib/cohorts.ts`)
- **Purchase Date Calculation**:
  - If `eligibility_cohort` provided: `purchase_date = subMonths(asOfMonth, eligibilityCohort - 1)`
  - **Key**: Purchase date is calculated relative to dataset's `as_of_month`, not hardcoded
  - Example: `eligibility_cohort = 6`, `as_of_month = Dec 2025` → `purchase_date = June 2025`
  - When new data uploaded with `as_of_month = Jan 2026`, `eligibility_cohort = 7` → still `purchase_date = June 2025`
  
- **Time Since Purchase Cohorts**:
  - `Ineligible (0–5 months)`: 0–5 months
  - `Year 1 (6–12 months)`: 6–12 months
  - `Year 2 (13–24 months)`: 13–24 months
  - Continues in 12-month increments
  - Handles missing/invalid dates with appropriate labels

- **Agency Size Bands**:
  - `<100` officers → `Direct`
  - `100–550` officers → `T1200`
  - `>550` officers → `Major`

- **Near Eligible**: Agencies with `months_since_purchase == 4 or 5`

### 5. Labels (`src/lib/labels.ts`)
- **Label Types**:
  - `Adopting`: `R12 >= 2.0` OR `R6 >= 0.75`
  - `Top Performer`: Adopting AND (`R12 >= 3.0` OR `R6 >= 1.25`)
  - `Churned Out`: Previously adopting but not adopting now (not ineligible)
  - `At Risk (Next Month)`: Currently adopting but projected to fall below thresholds next month
  - `At Risk (Next Quarter)`: Currently adopting but projected to fall below thresholds within 3 months
  - `Ineligible (0–5 months)`: Less than 6 months since purchase
  - `Insufficient history`: Less than 3 months of SIM telemetry
  - `Unknown (No license count)`: Missing or invalid `vr_licenses`

- **Historical Adoption Check**:
  - `wasPreviouslyAdopting()`: Computes metrics for each historical month to determine if agency was ever adopting
  - `findLastAdoptingMonth()`: Finds the last month an agency met adoption thresholds

### 6. Explain (`src/lib/explain.ts`)
- **generateWhyBullets()**: Creates explanation bullets for each label
  - References specific thresholds and computed values
  - No hardcoded numbers
  - Includes historical context (last adopting month) when relevant
- **getRecommendedAction()**: Maps labels to action types
  - Top Performer → VOC / Champion story
  - At Risk → Enablement outreach
  - Churned Out → Winback campaign
  - etc.

### 7. Aggregate (`src/lib/aggregate.ts`) - NEW
- **aggregateCohorts()**: Groups agencies by cohort dimension and computes summary statistics
  - Computes: agency count, total officer count, % adopting, % churned out, % at risk, counts
  - Supports three dimensions: time since purchase, agency size, CEW type
- **generateCohortSummaries()**: Generates summaries for all dimensions with optional trend data
  - Compares current summaries with previous month and quarter summaries
  - Computes MoM and QoQ changes for % adopting

### 8. History (`src/lib/history.ts`) - NEW
- **saveHistoricalData()**: Saves upload data to localStorage keyed by asOfMonth
- **getHistoricalData()**: Retrieves all historical data
- **mergeTelemetryWithHistory()**: Merges current telemetry with historical data for complete lookback
- **getPreviousMonthCohortSummaries()**: Gets previous month's summaries for MoM comparison
- **getPreviousQuarterCohortSummaries()**: Gets previous quarter's summaries for QoQ comparison

---

## UI Implementation

### Navigation (`src/components/Navigation.tsx`)
- Global navigation bar on all pages
- Shows "APAP Living Resource" branding with gradient icon
- Active page highlighting
- Icons from lucide-react (Home, Upload, Users, ListChecks, Clock, TrendingUp)

### Home Page (`src/app/page.tsx`)
- Welcome message with gradient icon
- Two action cards (Upload Data, Action List) with icons
- Quick Start guide with step-by-step instructions
- Uses semantic tokens for all colors

### Upload Page (`src/app/upload/page.tsx`)
- **File Upload Sections**:
  - Agencies.xlsx upload with format requirements displayed
  - Multiple telemetry files upload
  - Visual feedback (green borders when files selected)
  - Success indicators with checkmarks

- **File Format Guidance**:
  - Required columns listed for each file type
  - Optional columns documented
  - Notes about product normalization

- **Process Button**:
  - Always visible with clear disabled state
  - Shows "Upload Files First" when files not ready
  - Gradient styling with hover effects

- **Error Handling**:
  - Specific error messages per file
  - Detailed parsing errors with file names
  - Empty file detection
  - Separate displays for parsing vs. processing errors

- **Validation Results**:
  - Row counts (agencies, telemetry, SIM telemetry)
  - Unmatched telemetry IDs
  - Agencies with no telemetry
  - Missing licenses/purchase dates
  - As of month display

- **Historical Data Storage**:
  - Automatically saves processed data to localStorage after successful upload
  - Stores telemetry and cohort summaries for trend analysis

### Action List Page (`src/app/action-list/page.tsx`)
- **Header**:
  - Icon with gradient background
  - Export CSV button with download icon
  - Clear description

- **Filters**:
  - Search input with search icon
  - Label filter dropdown with filter icon
  - Styled filter container

- **Action List Table**:
  - Sortable by priority (At Risk first, then Churned Out, etc.)
  - Label badges with icons and colored backgrounds:
    - Top Performer → TrendingUp icon, blue
    - Adopting → CheckCircle2 icon, green
    - At Risk → AlertCircle icon, orange
    - Churned Out → XCircle icon, red
  - Expandable rows with details drawer
  - Metrics displayed with clear labels (no code abbreviations)

- **Details Drawer** (expanded row):
  - "Why" bullets section
  - Key Metrics section with grid layout
  - Training dates (if present)
  - All using semantic tokens

- **CSV Export**:
  - Includes all relevant columns
  - Uses clear column headers (no code abbreviations)

### Cohorts Page (`src/app/cohorts/page.tsx`) - NEW
- **Header**:
  - Icon with gradient background
  - Clear description of purpose

- **Filters**:
  - Cohort dimension selector (time since purchase, agency size, CEW type)
  - Filters for other cohort fields (when not the selected dimension)
  - All filters use semantic tokens

- **Cohort Summary Table**:
  - Displays summaries for selected dimension
  - Columns: Cohort, Agency Count, Total Officer Count, % Adopting, % Adopting MoM, % Adopting QoQ, % Churned Out, % At Risk (Next Month), % At Risk (Next Quarter)
  - Color coding: green for positive trends, red for negative trends
  - Shows "N/A" for trends when historical data unavailable
  - Responsive table with proper alignment
  - Handles missing data gracefully

---

## Design System Implementation

### Color Tokens (`src/styles/tokens.css`)
- **Surfaces**: Gray10, Gray05, White (light theme)
- **Foreground Semantics**: Action (Blue60), Success (Green70), Alert (Orange70), Destructive (Red60)
- **Background Semantics**: Matching colors for buttons/banners
- **Typography**: Roboto font family with text ramp (Station defaults)

### Global Styles (`src/styles/globals.css`)
- Link styling: Blue with underline, hover effects
- Button link classes: `.btn-primary`, `.btn-secondary`, `.btn-link`
- Navigation link hover effects
- Focus states for accessibility

### Visual Enhancements
- Gradient backgrounds on navigation and buttons
- Icons throughout (lucide-react)
- Card-based layouts with shadows and borders
- Hover effects on interactive elements
- Color-coded status indicators

---

## Key Implementation Decisions

### 1. Purchase Date Handling
- **Primary**: Use `eligibility_cohort` if available (months since purchase)
- **Fallback**: Compute from `purchase_date` if `eligibility_cohort` not provided
- **Calculation**: `purchase_date = subMonths(asOfMonth, eligibilityCohort - 1)`
- **Rationale**: Purchase date is relative to dataset's `as_of_month`, not hardcoded. When new data is uploaded, `eligibility_cohort` changes but purchase date remains constant.

### 2. Rate Calculation
- **Formula**: `R6 = C6 / L` (NOT `(C6 / 6) / L`)
- **Rationale**: User wants total completions per license in the period, not monthly average
- **Thresholds**: Still use `R12 >= 2.0` and `R6 >= 0.75` (these now represent total rates, not monthly)

### 3. Date Range Windows
- **6 months**: Go back 6 months from `as_of_month` (if January data not available, uses previous 6 months up to December)
- **12 months**: Go back 12 months from `as_of_month`
- **Inclusive**: All windows include `as_of_month` in the calculation

### 4. Historical Data Storage
- **Storage**: localStorage with key `apap_historical_data`
- **Key Format**: YYYY-MM (e.g., "2025-01")
- **Retention**: Keeps up to 24 months of historical data
- **Auto-cleanup**: Removes oldest entries when limit exceeded
- **Merging**: Current telemetry merged with historical data to ensure complete 12+ month windows

### 5. Trend Analysis
- **MoM (Month-over-Month)**: Compares current summaries to most recent historical entry before current month
- **QoQ (Quarter-over-Quarter)**: Compares current summaries to entry from 3 months ago
- **Matching**: Trends computed by matching cohort values across time periods
- **Display**: Shows "N/A" when historical data unavailable, color-coded for positive/negative changes

### 6. Label Display
- **No Code Abbreviations**: Labels show "6 Month Completions Per License" not "6 Month Completions Per License R6"
- **Consistent**: All UI elements use full descriptive names
- **CSV Export**: Headers also use full names

### 7. SIM-Only Labels
- **Critical**: All adoption/churn/risk labels use Simulator Training telemetry ONLY
- Other products can be uploaded and displayed, but do not affect labels
- Multi-product views are for understanding overall footprint only

---

## Data Quality Handling

### Validation
- Missing required columns → Clear error messages
- Invalid data types → Warnings with row details
- Empty files → Specific error messages

### Data Quality Report
- Unmatched telemetry IDs (telemetry with agency_id not in agencies)
- Agencies with no telemetry
- Agencies missing licenses
- Agencies missing purchase date/eligibility_cohort
- Row counts for all data types

---

## Testing

### Unit Tests (`tests/labels.test.ts`)
- Tests for label logic using small inline sample data
- Covers: Unknown, Ineligible, Insufficient history, Adopting, Not Adopting, Top Performer
- Uses date-fns for date manipulation in tests

---

## Known Issues / Future Work

### Not Yet Implemented (Slice 3+)
- Overview page with time filter and trends
- AI Summary generation

### Potential Improvements
- More accurate projection logic (currently uses average of last 3 months)
- Historical adoption check could be more precise (currently checks up to 12 months back)
- Better handling of edge cases in date calculations
- Additional trend metrics beyond % adopting

---

## Important Notes for Future Sessions

1. **Purchase Date**: Always calculated from `eligibility_cohort` and `as_of_month` - never hardcoded
2. **Rate Formula**: `R6 = C6 / L` (total rate, not monthly average)
3. **Date Windows**: Go back N months from `as_of_month` (not N-1)
4. **Labels**: SIM-only telemetry for all adoption/churn/risk labels
5. **UI Colors**: Always use semantic tokens from `tokens.css` - no hard-coded colors
6. **Label Display**: Use full descriptive names, no code abbreviations like "(R6)"
7. **Historical Data**: Automatically saved on each upload, enables trend analysis
8. **Cohort Trends**: MoM and QoQ computed by comparing current summaries with historical summaries

---

## Files Modified/Created

### Created (This Session)
- `src/lib/aggregate.ts` - Cohort aggregation and summary computation
- `src/lib/history.ts` - Historical data storage and retrieval
- `src/app/cohorts/page.tsx` - Cohorts dashboard page

### Modified (This Session)
- `src/lib/pipeline.ts` - Added cohort summaries, historical data merging
- `src/app/upload/page.tsx` - Save historical data after processing
- `src/components/Navigation.tsx` - Added Cohorts link
- `docs/STEP_0_SPEC.md` - Updated with historical data and trend requirements
- `docs/PRD.md` - Updated with cohort page specifications

### Created (Previous Sessions)
- `src/lib/schema.ts`
- `src/lib/ingest.ts`
- `src/lib/compute.ts`
- `src/lib/labels.ts`
- `src/lib/cohorts.ts`
- `src/lib/explain.ts`
- `src/lib/pipeline.ts`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/upload/page.tsx`
- `src/app/action-list/page.tsx`
- `src/app/near-eligible/page.tsx`
- `src/components/Navigation.tsx`
- `src/styles/globals.css`
- `tests/labels.test.ts`
- `package.json`
- `tsconfig.json`
- `next.config.js`
- `jest.config.js`
- `jest.setup.js`
- `.gitignore`
- `README.md`
- `CHANGELOG.md` (this file)

### Modified (Previous Sessions)
- `src/styles/tokens.css` (already existed, no changes needed)

---

## Dependencies Installed
- `next@^14.0.0`
- `react@^18.2.0`
- `react-dom@^18.2.0`
- `xlsx@^0.18.5`
- `zod@^3.22.4`
- `date-fns@^2.30.0`
- `lucide-react@^0.294.0`
- `jest@^29.7.0`
- `ts-jest@^29.1.0`
- `@types/*` packages

---

## Usage

1. Install dependencies: `npm install`
2. Run dev server: `npm run dev`
3. Navigate to `/upload` to upload files
4. Process files and view results on `/action-list` and `/cohorts`
5. Historical data is automatically saved for trend analysis
6. Run tests: `npm test`

---

## References
- `docs/STEP_0_SPEC.md` - Data contract and label rules
- `docs/PRD.md` - User stories and requirements
- `docs/DESIGN_SPEC.md` - UI patterns and tokens
- `docs/MVP_BUILD_PLAN.md` - Build slices and acceptance criteria
