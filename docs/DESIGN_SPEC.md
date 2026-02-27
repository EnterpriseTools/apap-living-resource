# Design Spec — APAP Living Resource (MVP, Spark 2–aligned)

This spec defines the UI patterns and token usage for the APAP app.
Context artifacts in `context/` inform metrics + narrative patterns ONLY (not UI layout).

---

## 1) UI goals
1) **Decision-first**: answer “what moved?” and “who do we contact this week?”
2) **Trust-building**: every label shows deterministic “why” bullets (threshold + projection)
3) **Cohorts everywhere**: consistent filters + cohort buckets across pages
4) **Low friction**: upload → results in minutes; strong validation + data quality states
5) **Spark 2 consistency**: use semantic tokens (Action/Alert/Success/Destructive, etc.)

---

## 2) IA (pages)
- `/upload` — Upload & Validate (includes "Save this upload as dataset for month" and expected agency column order hint)
- `/overview` — **Analysis**: Simulator Training (T10) usage trend (latest stored data) + SIM headline + **APAP Goal Progress** with **Overall APAP (same as Home)** as primary metric; when all cohorts selected the chart uses overall APAP so chart and metric match + **KPI metrics** (between APAP Goal Progress and Biggest Movers): top row Adopting, Eligible, Ineligible; bottom row At Risk (Next Month), At Risk (Next Quarter), Churned Out, Close to Adopting — each card shows agency count and points, with MoM when stored + cohort summary + **Biggest movers (month over month)** (top 3 positive/negative) + goal progress (structural + driver) from config; driver labels and line size "Direct" per CHANGELOG. See `docs/GOAL_MODEL_CONFIG_SPEC.md`.
- `/action-list` — **Agency List**: Full universe with baseline comparison, search, filters (including "Adopting (meeting APAP)"; Adopting/Top Performer filters are eligibility-restricted), sort, expandable detail drawer. Export CSV includes Adopting (APAP), T6/T12 Completions, T6/T12 Completions PP. T6/T12 column and body labels are compact ("T6", "T12"); no raw date ranges in headers.
- `/actions` — **Action List**: CSM burn-down list; curated agencies with action reasons, filters (line size, action reason), search, sort, expandable detail; see `docs/ACTION_LIST_SPEC.md`. T6/T12 column headers are compact ("T6 Completions PP", "T12 Completions PP") with a **tooltip** on the label (dotted underline) showing the trailing range (e.g. "Trailing 6 months (inclusive): Aug 2025–Jan 2026") from the selected as-of month; use `TooltipHeader` and `src/lib/lookbackLabels.ts`.
- `/near-eligible` — Near Eligible (1–2 months to eligibility)
- `/summary` — AI writeup (guardrailed). No auto-generate on page load; saved summary for the current viewing month is loaded if available. Button: "Generate summary" when no saved summary for this month, "Regenerate summary" when one exists; regenerate shows confirmation ("This will overwrite the existing summary for MMM YYYY. Continue?") before calling the API. Subtitle shows "Summary for MMM yyyy".
- `/settings` — Settings: Cached snapshots list + "Clear cached snapshots" button (clears all `processedData_*` keys; redirects to Home).
- **Global**: "Viewing: [Month ▼]" in nav bar; selecting month reloads app with that month's stored data. All pages load main data via `getProcessedData(getCurrentMonth() ?? undefined)` (or `getProcessedDataParsed` where stale snapshot check is needed) for viewing-month consistency.
- **404**: `/analysis` and `/cohorts` redirect to `/overview`. Any other missing route shows a custom not-found page with links to Home, Analysis, Agency List, and Action List.

---

## 3) Spark 2 tokens we will use (from design system screenshots)

### 3.1 Surface colors (containers: pages/cards/drawers)
Light surfaces:
- Surface 1: #EBEBEB (Gray10)
- Surface 2: #F5F5F5 (Gray05)
- Surface 3: #FFFFFF
- Surface 4: #FFFFFF

Dark surfaces:
- Surface 1: #111111 (Gray95)
- Surface 2: #222222 (Gray90)
- Surface 3: #323232 (Gray80)
- Surface 4: #404040 (Gray70)

### 3.2 Foreground semantic colors (text/icons)
Light theme:
- Action: #045DD2 (Blue60)
- Destructive: #D03541 (Red60)
- Alert: #AB4307 (Orange70)
- Success: #007057 (Green70)
- Live Stream: #5030BB (Purple70)
- Primary: #222222 (Gray90)
- Secondary: #5C5C5C (Gray60)
- Disabled: #A8A8A8 (Gray40)

### 3.3 Background semantic colors (banners/toasts/primary buttons)
Light theme:
- Action: #045DD2 (Blue60)
- Alert: #FC912C (Orange50)
- Destructive: #D03541 (Red60)
- Live Stream: #5030BB (Purple70)
- Success: #007057 (Green70)

### 3.4 Brand colors (guidance)
- Axon Yellow: #FFD700 — **do not use yellow for UI**
- Brand primary neutral: #222222
- Grey70: #404040

### 3.5 Color usage rules (semantic intent)
- Blues: primary actions/connectivity state
- Reds: errors/destructive/high priority/critical
- Oranges: warnings/medium priority
- Greens: success/positive/lower priority
- Purples: live streaming (we can repurpose sparingly for “special highlight”)
- Yellows: brand moments, avoid for UI

---

## 4) Typography (Spark 2)
### 4.1 Typefaces
- Primary: Roboto
- Monospace: Roboto Mono
- Non-Latin: Noto Sans

### 4.2 Text styles (use these as the canonical ramp)
Station:
- Headline: 24/28 Medium
- Title: 16/24 Medium
- Subtitle: 14/20 Medium
- Body 1: 14/20 Regular
- Body 2: 12/16 Regular
- Button: 12/16 Medium — letter spacing 0.5 — ALL CAPS
- Label: 10/12 Medium — letter spacing 0.5 — ALL CAPS
- Caption: 10/12 Medium

Mobile:
- Headline: 24/28 Medium
- Title: 20/28 Medium
- Subtitle: 16/24 Medium
- Body 1: 16/24 Regular
- Body 2: 14/20 Regular
- Button: 14/20 Medium — letter spacing 0.5 — ALL CAPS
- Label: 12/16 Medium — letter spacing 0.5 — ALL CAPS
- Caption: 12/16 Medium

Motor:
- Headline: 32/36 Regular
- Title: 24/32 Medium
- Subtitle: 18/24 Medium
- Body 1: 18/24 Regular
- Body 2: 16/24 Regular
- Button: 16/24 Medium — letter spacing 0.5 — ALL CAPS
- Label: 14/20 Regular — letter spacing 0.5 — ALL CAPS
- Caption: 14/20 Regular

---

## 5) Core UI patterns (MVP)

### 5.1 Global filter bar (persistent pattern)
Controls:
- Time filter: trailing 6 / 12 / 18 / 24 months + custom month range
- Cohorts: time since purchase, agency size, CEW type
- Optional: region, CSM owner
- Product selector for usage views (labels always SIM-only)

Behavior:
- Changing filters updates charts/tables on the page
- Show active filter chips + “Reset”
- Persist filters in URL query string

### 5.2 KPI cards
KPI set (SIM-only):
- Adopting
- At Risk (next month)
- At Risk (next quarter)
- Churned Out
- Ineligible
(Unknown/Insufficient card was removed from the Analysis page.)

Visual:
- Card surface uses Surface 3 on light / Surface 2-3 on dark
- KPI accent uses semantic foreground colors:
  - Adopting: Success
  - At Risk: Alert
  - Churned Out: Destructive
  - Top Performer: Action (or Live Stream sparingly)

### 5.3 Data quality banner + detail drawer
Compact banner with counts (unmatched IDs, missing licenses, missing purchase dates, no telemetry).
Use Alert color for warnings; Destructive for hard errors.
Provide expandable drawer with details table + export.

### 5.4 Action List table + details drawer (highest-priority UX)
**Two list pages**: **Agency List** (`/action-list`) = full universe with baseline comparison; **Action List** (`/actions`) = curated CSM burn-down per `docs/ACTION_LIST_SPEC.md` (filters: line size, action reason; same table/drawer patterns).

Table must support:
- search, sort (clickable column headers), filters
- row click opens details drawer
- sortable columns: Agency Name, Agency ID, Line Size, Agency Size, VR Licenses, Label, Time As Customer, and metrics
- visual status indicators: color-coded row backgrounds and left borders

Table columns:
- Agency Name, Agency ID, Line Size (agency_size_band), Agency Size (officer_count), VR Licenses, Label, Time As Customer (purchase_cohort), CEW Type, Metrics & Progress, Action

Metrics & Progress column:
- Shows T6 and T12 completions needed for non-adopting agencies
- Shows "Meeting both T6 and T12 thresholds" for adopting agencies
- Calculates exact completions needed accounting for rolling window

Label badges (semantic mapping):
- Top Performer → Action (blue)
- Adopting → Success (green)
- At Risk → Alert (orange)
- Churned Out → Destructive (red)
- Ineligible / Insufficient history / Unknown → neutral (Secondary/Disabled)

Row visual indicators:
- Actively adopting: Light green background, green left border
- At Risk: Light orange background, orange left border
- Recently churned: Light red background, red left border
- Unengaged: Light gray background, gray left border
- Close to adopting: Light blue background, blue left border

Details drawer sections:
1) Label + one-sentence summary
2) Key metrics (L, C6, C12, R6, R12, projections)
3) SIM trend (last 12–18 months)
4) "Why flagged" bullets (must reference computed values; use human-readable T6/T12 ranges e.g. "T6 (Aug 2025–Jan 2026) Completions PP = 0.75" via `lookbackLabels`)
5) Recommended action
6) Training dates (latest/next) if present
7) Data caveats if applicable

### 5.5 Charts and KPI metrics (minimal, high signal)
Overview (Analysis page):
- APAP trend chart: dynamic Y-axis (min/max + padding); goal lines 42% and 46.2% always visible; trend segments colored by MoM (green positive, red negative); goal lines distinct (purple HC, blue Hard Climb).
- APAP Goal Progress section: cohort filters (Eligibility Cohort, Agency Size), trend chart with cohort-specific goal lines and red/green MoM segments.
- **KPI metrics** (between APAP Goal Progress and Biggest Movers): Two rows — **Top row**: Adopting, Eligible, Ineligible; **Bottom row**: At Risk (Next Month), At Risk (Next Quarter), Churned Out, Close to Adopting. Each card shows agency count and points; MoM shows count change and points change vs comparison period when stored (history stores `kpiCountsAndPoints` on upload).
- Simulator Training (T10) chart: monthly completions, uses latest stored data for viewing month; matches Home SIM Engagement.
- **Hover tooltips**: Tooltips are sized to fit content (no squishing or overlap). Chart containers use `overflow: visible` so tooltips may extend outside the chart area when needed.
Cohorts:
- Bar: % adopting by cohort
- Line: median R6 trend by cohort (limit to <=6 series)

Chart rules:
- avoid >6 lines; require cohort selection if needed
- always include time range and as_of_month note
- show no-data state

### 5.6 Home page high-level blocks
- High-level APAP metrics: current APAP, MoM (pp), bps below 42% and 46.2%
- APAP section: two comparison lines (vs baseline, vs last month); Changes vs Previous Month with stored-count priority
- SIM Engagement – VR (T10): T12 completions, MoM, progress to 290K goal, YoY, bar chart with YoY visuals
- Agencies that dropped out of eligibility: table (Agency ID, name, footprint, reason) when viewing a month with previous-month comparison

---

## 6) States (must-have)
- Loading: skeletons for cards/tables
- Empty: “No telemetry in selected range”
- Validation error: missing required columns (explicit)
- Partial data: missing licenses/purchase_date warnings
- Export confirmation

---

## 7) Accessibility baseline
- visible focus states
- keyboard-friendly filters/table/drawer
- don’t rely on color alone (badge + label text)
- tooltips/popovers accessible

---

## 8) Implementation guidance (tokens-first)
- Implement theme tokens as CSS variables
- Map all component colors to semantic tokens (no hard-coded colors in components)
- Support light and dark via `[data-theme="light|dark"]` (or prefers-color-scheme)

Definition of done (design):
- all pages use token vars for surfaces + semantic colors
- typography uses the ramp styles
- status colors are consistent across KPIs, badges, and banners