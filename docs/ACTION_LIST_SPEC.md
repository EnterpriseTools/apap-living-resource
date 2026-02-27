# ACTION_LIST_SPEC.md
## CSM Action List Page (v1)

### Purpose
Add a new **Action List** tab/page that serves as a **CSM burn-down list**: a curated, explainable list of agencies that require outreach to drive adoption/APAP or prevent churn.

This page is intentionally a “culmination” view:
- Homepage + Analysis = macro trends + goal progress
- Agency List = full universe with deep details
- Near Eligible = ineligible subset
- **Action List (new)** = prioritized subset with clear “why now” reasons + recommended actions

---

## 1) Scope and dependencies

### 1.1 Data inputs (no new uploads required)
Action List uses the same processed dataset already powering:
- Agency List (all agencies)
- Near Eligible
- Adoption labels (SIM-only)
- MoM history (month selector / stored history)

### 1.2 SIM-only adoption rules remain unchanged
All “adopting”, “at risk”, “churned out”, “close to adopting” signals are computed using **Simulator Training telemetry only**, consistent with existing app rules.

### 1.3 Intended audience
Primary: CSMs and internal GTM partners who need a weekly/monthly “who to contact” list.  
Secondary: Product/Training leadership checking focus areas.

---

## 2) Page placement and routing
- Add a new nav tab: **Action List**
- Route: **`/actions`** (implemented; `/action-list` is reserved for Agency List)
- Page should respect:
  - current selected month (“as_of_month”) and optionally allow month selection
  - scenario selector (optional, if you want to tie to Goal Progress, but not required for v1)

---

## 3) Key concepts

### 3.1 Line size (same mapping as elsewhere)
Line size derived from Axon footprint/officer_count:
- Major: `>= 501`
- T1200: `100..500` inclusive
- Direct/Other: `< 100` (including 0)

### 3.2 Eligibility bucket (for “close to eligible” logic)
Eligibility cohort computed as-of the selected month:
- Ineligible: `0..5`
- Eligible: `>= 6`
- Bucket definitions:
  - 6–12 inclusive
  - 13–18
  - 19–24
  - 25+

### 3.3 APAP rule and adoption thresholds (SIM-only, per license)
**APAP rule:** eligibility_cohort ≥ 6 AND (T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75). T12 = R12; T6 = R6.

Adoption = meeting **at least one** of these (either, not both required):
- **R6** (T6 Completions PP) **≥ 0.75**
- **R12** (T12 Completions PP) **≥ 2.0**

All adoption, at-risk, and churn logic uses these thresholds. “Adopting” in baseline/history and for APAP is threshold-only: an agency contributes to adopting points if eligible (cohort ≥ 6) and (R6 ≥ 0.75 or R12 ≥ 2.0); labels are not used. Baseline/history "was adopting" for Action List uses labels (Adopting, Top Performer, At Risk) so agencies meeting threshold in a past month count as adopting that month for churn/baseline logic.

### 3.4 Agency List (`/action-list`) — filters and export
- **Filter "Adopting (meeting APAP)"**: Shows all agencies that meet the APAP rule (eligible + R6/R12 threshold), including Top Performer and At Risk.
- **Eligibility requirement:** Adopting, Adopting (meeting APAP), and Top Performer filters show only **eligible** agencies (eligibility_cohort ≥ 6).
- **Export CSV**: Columns include Adopting (APAP) (Y/N), T6 Completions, T12 Completions, T6 Completions PP, T12 Completions PP, plus Agency ID, Name, Line Size, VR Licenses, Label, Time As Customer, T6/T12 Completions Needed, Adopting in 2025 baseline.

### 3.5 T6/T12 display (Action List and Agency List)
- **Table headers**: Use compact labels only: "T6 Completions PP", "T12 Completions PP" (no raw date ranges in the header text).
- **Tooltips**: On the column label (e.g. dotted underline), show the trailing range for the selected as-of month in human-readable form (e.g. "Trailing 6 months (inclusive): Aug 2025–Jan 2026"). Implement with `src/components/TooltipHeader.tsx` and `src/lib/lookbackLabels.ts`.
- **Explain / "why" bullets**: Use human-readable ranges (e.g. "T6 (Aug 2025–Jan 2026) Completions PP = 0.75"); no YYYY-MM strings in the UI.

---

## 4) Action List membership rules (who appears on the page)

An agency appears if it matches **at least one** Action Reason category below.  
If an agency matches multiple categories, we assign:
- **Primary Reason** = highest priority match (priority order below)
- **Secondary Reasons** = remaining matched reasons (display as tags)

### 4.1 Action Reason categories (v1)
Priority order (highest → lowest):

#### A) BASELINE_ADOPTER_CHURNED — 2025 Agencies Churned (highest priority)
“Agency was adopting in Nov 2025 baseline and is no longer adopting now.”
- Baseline month: `2025-11` (config constant)
- Membership set: agencies that were **eligible (>=6)** AND **adopting** in baseline month. “Adopting” in baseline = label Adopting, Top Performer, At Risk (Next Month), or At Risk (Next Quarter).
- Trigger: agency is **not adopting** as-of selected month.
- Sub-tags:
  - `CHURNED_OUT` if previously met adopting threshold and now no longer meets any.
  - `NOT_ADOPTING_STREAK` if not adopting for N consecutive months (see 4.2). Streak is computed only over months where we have history data.

Why: This impacts the modeled retention assumption (80%/90%) and is high leverage.

#### B) NEW_ADOPTER_CHURNED_2026 — 2026 Agencies Churned
“Agency was eligible in Nov 2025, was NOT meeting threshold that month, has since met at least one threshold for at least one month, and no longer is meeting threshold.”
- Conditions:
  - **Eligible in November 2025** (in baseline dataset with eligibility_cohort >= 6).
  - **Not adopting in November 2025** (not in baseline adopter set).
  - **Had at least one month post-baseline** where adopting (or “Churned Out” label implies they were once adopting).
  - **Not adopting** as-of selected month.
- Ensures 2026 churned are only agencies we had in the Nov 2025 eligible set who later adopted then churned.

#### C) AT_RISK_NEXT_MONTH
“Agency projected to fall below adoption threshold next month.”
- Uses existing risk logic (already in app):
  - Determine if recent usage is insufficient to keep adopting next month.
- Must include “why” explanation (projection inputs).

#### D) AT_RISK_NEXT_QUARTER
“Agency projected to fall below adoption threshold within next quarter.”
- Similar to above but projected on 3-month horizon.

#### E) CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT (Majors/T1200 only)
“Large agency is ineligible but about to become eligible and showing low usage.”
- Eligibility cohort is **4 or 5** (eligible in 1–2 months).
- Line size must be Major or T1200.
- Engagement threshold (SIM-only):
  - trailing 6-month completions per license (or per person—see note) is **< 0.2**
- Purpose: early intervention before they enter eligible denominator.

Note: Define explicitly which denominator is used:
- Preferred: completions per VR license over trailing 6 months (consistent with adoption metric style)
- If using “per person” (officer_count), define that formula clearly.
Pick one in implementation; default to per license unless business wants per officer.

#### F) CLOSE_TO_ADOPTING (opportunity)
“Agency is not adopting yet but is close to meeting thresholds.”
Include if:
- Not currently adopting, AND not already in a higher-priority category above, AND
- Either:
  - T6 Completions PP (R6) **≥ 0.50** (trailing 6-month completions per license), OR
  - T12 Completions PP (R12) **≥ 1.50** (trailing 12-month completions per license)

Target to reach adopting: **R6 ≥ 0.75** or **R12 ≥ 2.0** (display as “need 0.75” / “need 2” in UI).

---

## 4.2 Additional supporting flags
These flags can apply to any agency (display as tags, not necessarily membership rules):

- `NOT_ADOPTING_STREAK_N`:
  - count consecutive months up to selected month where `Adopting=false`
  - N default = 2+ months triggers a tag; 3+ months adds emphasis
- `RECENT_DROP`:
  - adopting last month but not adopting this month
- `USAGE_NEAR_ZERO`:
  - trailing 6-month rate < 0.05 (optional)

---

## 5) Output fields (table columns)

Action List table shows one row per agency with:

### 5.1 Required columns
- Agency Name
- Agency ID
- Line Size (Major / T1200 / Direct)
- Officer Count (Axon footprint)
- VR Licenses
- Time as customer (months since purchase) + eligibility cohort
- Current Adoption Status (Adopting / Not adopting / Ineligible)
- Primary Action Reason (one label)
- Secondary Reason Tags (chips)
- Key metrics:
  - T6 Completions PP (R6), T12 Completions PP (R12)
  - last month completions (optional)
- Baseline status (Nov 2025):
  - Baseline Eligible? (Y/N)
  - Baseline Adopting? (Y/N)
- Completions Needed This Month (to become adopting, or to stay adopting for At Risk)
- Owner fields (if available): CSM name, region (optional)

Removed in current implementation: Recommendation column, Tags column (secondary reasons shown as chips only).

### 5.2 Row click detail drawer
Reuse the same detail drawer pattern as Agency List:
- Label breakdown
- Trend chart (SIM usage by month)
- Adoption labels over time
- “Why flagged” bullets (deterministic)
- Notes fields / training dates (if available)
- Export / copy info

---

## 6) UX requirements

### 6.1 Filtering
Must support:
- Line size filter: All / Major / T1200 / Direct
- Action Reason filter: multi-select of categories A–F
- Search box (name or ID)
- Optional: show/hide ineligible

### 6.2 Sorting
Default sort:
1) Priority of Primary Reason (A → F)
2) Within reason: descending Points Impact proxy:
   - Officer count (descending) OR eligible points (descending) for eligible agencies
   - For ineligible: officer count descending

User can sort by:
- officer_count
- VR licenses
- R6 / R12
- eligibility cohort
- adoption streak length

### 6.3 “Burn down” workflow enhancements (optional v1.1)
- Mark row as “Engaged” (local-only state in browser)
- Notes field per agency (local-only)
- Export to CSV of currently filtered list

---

## 7) Deterministic “Why flagged” rules (required)
Each row must include a `why` object used both for inline tooltip and drawer.

For example:

- BASELINE_ADOPTER_CHURNED:
  - “Adopting in 2025-11 baseline (eligible & met threshold).”
  - “Not adopting in {as_of_month}; R6={x}, R12={y}.”
  - “Not adopting for {n} consecutive months.”

- CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT:
  - “Eligibility cohort={4/5} (eligible in 1–2 months).”
  - “Line size={Major/T1200}.”
  - “R6={x} < 0.2 threshold.”

- CLOSE_TO_ADOPTING:
  - “Not adopting now; close thresholds: R6={x} (>=0.5) or R12={y} (>=1.5).”

These must be computed from real metrics (no AI inference).

---

## 8) Implementation requirements

### 8.1 New compute module
Add:
- `src/lib/actionList.ts`

Exports:
- `buildActionList(processedData, historyData, config): ActionListResult`

Where `ActionListResult` includes:
- `rows: ActionListRow[]`
- counts by reason
- data quality exclusions
- baseline availability status

### 8.2 Baseline cohort membership
Baseline month config:
- `baselineMonth = "2025-11"`

The app must:
- use stored history for baseline month if available
- if not available, show a banner:
  - “Upload baseline month (2025-11) to unlock baseline churn tracking.”
- When baseline not available, category A is disabled.

### 8.3 MoM adoption history usage
To compute:
- new adopter churn (category B)
- streak lengths / recent drop tags

The app must rely on stored monthly history (existing month persistence pattern).

### 8.4 Denominator for “per person” vs “per license”
For v1, standardize on:
- completions per **VR license** (consistent with existing adoption thresholds)

If you still want “per person” for the close-to-eligible low engagement screen:
- add `R6_perOfficer = completions_6mo / officer_count` (only if officer_count>0)
- but keep primary thresholds in per-license unless explicitly changed.

---

## 9) Data quality & exclusions
Action List must surface:
- agencies excluded due to missing purchase date / eligibility cohort (cannot compute eligibility buckets).

**Current implementation (count consistency with Analysis):** Agencies with unknown line size (missing/invalid officer_count) or missing VR licenses are **included** in the list so that churned/at-risk/close-to-adopting counts match the Analysis KPI cards. They are displayed with line size "Unknown" and VR licenses "—"; completions-needed is not computed when licenses are missing. The data-quality banner shows exclusion counts (e.g. 0 for unknown line size / missing licenses when all such agencies are included).

---

## 10) Acceptance criteria (Definition of Done)
1) New Action List tab appears and loads from existing processed data.
2) Action Reason categories A–F are computed deterministically and reproducibly.
3) Baseline adopter churn works when baseline month data exists; shows “insufficient baseline” when not.
4) Filters (line size, reason, search) work and combine properly.
5) Sorting works and default sort prioritizes the most urgent cohorts.
6) Clicking an agency shows full details consistent with Agency List drawer.
7) CSV export respects current filters and includes primary + secondary reasons and key metrics.

---

## 11) Suggested config constants (for easy tweaking)
Place in `src/config/action_list_config.ts`:

- `baselineMonth = "2025-11"`
- `closeToEligibleMonths = [4,5]`
- `lowEngagementR6Threshold = 0.2`
- `closeToAdoptR6Threshold = 0.5` (below adoption 0.75 so “close but not yet” agencies appear)
- `closeToAdoptR12Threshold = 1.5` (below adoption 2.0)
- `notAdoptingStreakTagMinMonths = 2`

Adoption thresholds (used in compute/labels/actionList; not in config):
- Adopting: **R6 ≥ 0.75** or **R12 ≥ 2.0** (either, not both required).

### Display and behavior (current implementation)
- Section names: **At Risk** (AT_RISK_NEXT_MONTH + AT_RISK_NEXT_QUARTER), **2025 Agencies Churned** (BASELINE_ADOPTER_CHURNED), **2026 Agencies Churned** (NEW_ADOPTER_CHURNED_2026), **Close to Adopting** (CLOSE_TO_ADOPTING).
- Action List includes only **eligible** agencies (eligibility_cohort ≥ 6). CLOSE_TO_ELIGIBLE_LOW_ENGAGEMENT agencies are excluded from the list.
- Default sort per table: officer_count descending. Column-header sorting per table.
- “Completions Needed This Month”: for Close to Adopting / Churned = completions to *become* adopting; for At Risk (Next Month) = to *stay* adopting next month; for At Risk (Next Quarter) = average per month over next 3 months to *stay* adopting.