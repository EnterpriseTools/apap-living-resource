# DEPRECATED — DO NOT IMPLEMENT
This spec has been replaced by docs/GOAL_MODEL_CONFIG_SPEC.md and src/config/goal_model_config.ts.
Do not parse Excel for goal progress.

# GOAL_PROGRESS_SPEC.md
## Goal Progress & Cohort Driver Tracking (v1)

### Purpose
Add a **Goal Progress** capability that lets us:
1) Load a **goal model** (assumptions + target cohort rates) from **`2026 VR APAP Threshold Modeling.xlsx`**
2) Each month, compute **actual adoption/APAP** outcomes for the same cohort structures
3) Show **variance to goal** (pp + APAP points gap) and highlight the **largest opportunities**
4) Track (month-over-month) whether we are on pace for:
   - **High Confidence** scenario
   - **Hard Climb** scenario

This should live primarily on the **Analysis** page (or a dedicated “Goal Progress” page/section).

---

## 1) Scope and non-negotiables

### 1.1 SIM-only adoption / labels
- **Adopting / churned out / at risk** labels are computed using **Simulator Training telemetry only**.
- Multi-product telemetry may be uploaded and displayed for footprint context, but **must not** affect adoption/APAP labels.

### 1.2 APAP definition (for progress tracking)
For any slice/cohort:
- **Eligible Points** = sum(`officer_count`) for agencies that are **eligible** (see below)
- **Adopting Points** = sum(`officer_count`) for eligible agencies that are **Adopting**
- **APAP%** = (Adopting Points / Eligible Points) * 100

### 1.3 Eligibility
- Agency is **eligible** if `eligibility_cohort >= 6` (months since purchase, computed as-of the selected month).
- Ineligible agencies (0–5 months) are excluded from APAP denominators (but may be displayed elsewhere).

### 1.4 Line size mapping (authoritative)
Line size buckets:
- **Major**: `officer_count >= 550`
- **T1200**: `100 <= officer_count < 550`
- **Other (Direct)**: `officer_count < 100`

Clarifications:
- `officer_count == 0` is treated as **Other (Direct)**.
- If `officer_count` is missing / null / non-numeric: set `line_size = Unknown` and exclude from goal progress computations (count separately under Data Quality).

---

## 2) Goal model workbook (source of truth)
Workbook: **`2026 VR APAP Threshold Modeling.xlsx`**  
Sheet: **`Goal Model (Final)`**

We will parse two scenario regions using **hard-coded ranges** (cell locations are stable):

### 2.1 High Confidence scenario ranges
1) **Driver assumptions (Retention / Conversion / Currently Ineligible / New Customer)**
- Range: **M29:N45**

2) **Target APAP by line size × eligibility bucket**
- Range: **C28:H46**

### 2.2 Hard Climb scenario ranges
1) **Driver assumptions (Retention / Conversion / Currently Ineligible / New Customer)**
- Range: **M50:N67**

2) **Target APAP by line size × eligibility bucket**
- Range: **C50:H68**

Notes:
- Within the driver ranges, parse by headers (“Retention Rate”, etc.) so the app maps rows to the correct driver deterministically.

---

## 3) Cohort systems we track

There are **two related cohort systems**.

### 3.1 Structural cohorts (variance-to-goal tables)
- **Line size × Eligibility bucket**
- Eligibility buckets:
  - **6–12 months**
  - **12–18 months**
  - **18–24 months**
  - **24+ months**

Used to compute each month:
- actual APAP% and APAP points by cohort
- target APAP% by cohort (from workbook)
- variance (pp) and APAP points gap
- gap share and impact

### 3.2 Driver cohorts (goal-model levers, by line size)
Drivers (by **line size only**) that roll up into the structural cohort targets:
1) **Retention rate**: baseline adopters who remain adopters by goal month
2) **Conversion rate**: baseline non-adopters who become adopters by goal month
3) **Currently ineligible adoption rate**: baseline ineligible cohort eventual adoption
4) **New customer adoption rate**: new purchasers in a defined window

Used to compute month-over-month:
- actual observed rates
- variance vs scenario assumed rates
- “on pace” indicators

---

## 4) Baseline and goal months (for driver tracking)
Config (defaults):
- `baseline_month = 2025-11`
- `goal_month = 2026-11`

Notes:
- Retention and conversion require baseline cohort membership at `baseline_month`.
- If baseline month is not present in app history, show **Insufficient baseline** and instruct the user to upload that month.

---

## 5) Parsing spec: driver assumptions (Ranges M:N)

### 5.1 What is in the driver range
Within each driver range (High Confidence M29:N45, Hard Climb M50:N67), the sheet contains four assumption sections:
- Retention Rate
- Conversion Rate
- Currently Ineligible Adoption Rate
- New Customer Adoption Rate

Each section includes three line-size rows:
- Major
- T1200
- Other

Column meanings:
- **Column M**: label (either section header or line size)
- **Column N**: assumed rate (number)

### 5.2 Parsing approach (hard-coded range, header-driven within)
Even though ranges are fixed, parse within the range as follows:
1) Scan rows in the range top→bottom.
2) When `M` cell matches one of:
   - "Retention Rate"
   - "Conversion Rate"
   - "Currently Ineligible Adoption Rate"
   - "New Customer Adoption Rate"
   set `current_driver` accordingly.
3) For subsequent rows where `M` is one of {Major, T1200, Other}:
   - read `N` as `assumed_rate`
   - store under `scenario` + `current_driver` + `line_size`
4) Continue until end of range.

### 5.3 Rate normalization
Assumed rate in column N may appear as:
- fraction (0–1)
- percent (1–100)

Normalize:
- if `assumed_rate > 1`, divide by 100.

### 5.4 Output structure (canonical)
```ts
type Scenario = "high_confidence" | "hard_climb";
type Driver = "retention" | "conversion" | "baseline_ineligible" | "new_customer";
type LineSize = "Major" | "T1200" | "Other";

type DriverAssumption = {
  scenario: Scenario;
  driver: Driver;
  lineSize: LineSize;
  assumedRate: number; // 0..1
  sourceCell: string;  // e.g., "N31"
};

type GoalModelDrivers = {
  assumptions: DriverAssumption[];
  source: {
    workbookFile: string;
    sheetName: string;
    ranges: Record<Scenario, { drivers: string; structural: string }>;
    parsedAtIso: string;
  };
};

6) Parsing spec: structural target table (Ranges C:H)

6.1 What is in the structural range

Within each structural range:
	•	High Confidence: C28:H46
	•	Hard Climb: C50:H68

The sheet contains a table that provides target APAP% segmented by:
	•	eligibility buckets (6–12, 12–18, 18–24, 24+)
	•	line sizes (Major, T1200, Other)

The range may also include headers and other calculated values. We only need the target APAP% by cohort.

6.2 Parsing approach (hard-coded range, label-driven within)

Algorithm:
	1.	Read the range into a 2D grid (rows, columns).
	2.	Identify the header row within the range containing the eligibility bucket labels by finding cells containing:
	•	“6 to 12”
	•	“12 to 18”
	•	“18 to 24”
	•	“24” or “24+”
	3.	Map those header columns to canonical bucket keys:
	•	6_12
	•	12_18
	•	18_24
	•	24_plus
	4.	Identify data rows for line sizes by scanning for row labels containing:
	•	“Major”
	•	“T1200”
	•	“Other”
	5.	For each (lineSizeRow, eligBucketCol) cell:
	•	parse as a percent or fraction
	•	normalize to a fraction 0..1

Normalization rules:
	•	if value <= 1, treat as fraction
	•	if value > 1, treat as percent and divide by 100

6.3 Output structure (canonical)
type Scenario = "high_confidence" | "hard_climb";
type LineSize = "Major" | "T1200" | "Other";
type EligBucket = "6_12" | "12_18" | "18_24" | "24_plus";

type StructuralTarget = {
  scenario: Scenario;
  lineSize: LineSize;
  eligBucket: EligBucket;
  targetApapRate: number; // 0..1
  sourceCell: string;     // e.g. "E34"
};

type GoalModelStructuralTargets = {
  targets: StructuralTarget[];
};

7) Monthly computations: structural variance-to-goal

For the selected month t (from the app’s month switcher / as-of month), compute actual outcomes by (line_size × elig_bucket), and compare to targets for the selected scenario.

7.1 Actual cohort assignment rules

For each agency at month t:
	•	Determine line_size per section 1.4
	•	Determine eligibility bucket based on eligibility_cohort (months since purchase):
	•	6–12  → 6_12
	•	13–18 → 12_18
	•	19–24 → 18_24
	•	25+   → 24_plus
	•	0–5   → excluded from structural target table (ineligible)
	•	missing/invalid → excluded from structural computations (data quality)

7.2 Actual metrics per cohort

For each cohort key (line_size, elig_bucket):
	•	eligiblePointsActual
	•	adoptingPointsActual
	•	apapActualRate = adoptingPointsActual / eligiblePointsActual (0..1)
	•	apapActualPct = apapActualRate * 100
	•	counts:
	•	eligibleAgencyCount
	•	adoptingAgencyCount

7.3 Target metrics per cohort

From parsed structural targets:
	•	targetApapRate (0..1)
	•	targetApapPct = targetApapRate * 100

7.4 Variance and points gap

For each cohort:
	•	variancePp = (apapActualRate - targetApapRate) * 100
	•	requiredAdoptingPoints = targetApapRate * eligiblePointsActual
	•	pointsGap = requiredAdoptingPoints - adoptingPointsActual
	•	positive → behind target
	•	negative → ahead of target

Across cohorts:
	•	totalEligiblePoints = sum(eligiblePointsActual)
	•	totalAdoptingPoints = sum(adoptingPointsActual)
	•	overallApapActualRate = totalAdoptingPoints / totalEligiblePoints
	•	overallPointsGap = sum(max(pointsGap, 0)) (remaining positive gap)
	•	ppImpactIfClosed = (pointsGap / totalEligiblePoints) * 100

Gap share:
	•	gapSharePct = pointsGap / sum(max(pointsGap, 0)) among behind-target cohorts only.

⸻

8) Monthly computations: driver progress (retention/conversion/etc.)

Driver progress compares actual observed driver metrics to the assumed rates in M:N ranges.

8.1 Shared definitions
	•	Adopting(t, agency) uses the existing SIM-only deterministic adoption rule at month t.
	•	Driver progress is computed by line size (Major/T1200/Other).

8.2 Driver 1 — Retention of baseline adopters

Baseline adopter cohort:
	•	Agencies eligible at baseline_month with Adopting(baseline_month) = true

At month t:
	•	baselineAdopterCount
	•	retainedCount(t) = # baseline adopters still adopting at t
	•	retentionRate(t) = retainedCount(t) / baselineAdopterCount

Compare to:
	•	assumedRetentionRate from workbook for scenario + line size

8.3 Driver 2 — Conversion of baseline non-adopters

Baseline non-adopter cohort:
	•	Agencies eligible at baseline_month with Adopting(baseline_month) = false

At month t:
	•	baselineNonAdopterCount
	•	convertedCount(t) = # baseline non-adopters adopting at t
	•	conversionRate(t) = convertedCount(t) / baselineNonAdopterCount

Compare to:
	•	assumedConversionRate from workbook for scenario + line size

8.4 Driver 3 — Baseline currently-ineligible adoption

Baseline ineligible cohort:
	•	Agencies with eligibility_cohort 0–5 at baseline_month

At month t:
	•	consider only baseline-ineligible agencies that are now eligible (eligibility_cohort >= 6 at t)
	•	nowEligibleCount(t)
	•	adoptingCount(t) among those now eligible
	•	baselineIneligibleAdoptionRate(t) = adoptingCount(t) / nowEligibleCount(t)

Compare to:
	•	assumedBaselineIneligibleRate from workbook for scenario + line size

8.5 Driver 4 — New customer adoption (Dec 2025–May 2026 purchases)

New customer cohort definition:
	•	agencies with purchase_month ∈ [2025-12, 2026-05]

At month t, among those now eligible (eligibility_cohort >= 6 at t):
	•	newEligibleCount(t)
	•	newAdoptingCount(t)
	•	newCustomerAdoptionRate(t) = newAdoptingCount(t) / newEligibleCount(t)

Compare to:
	•	assumedNewCustomerRate from workbook for scenario + line size

8.6 Baseline availability requirement

If baseline month is not available in app history:
	•	Retention and Conversion driver rows must show:
	•	status = "insufficient_baseline"
	•	instruction: “Upload baseline month (2025-11) to unlock retention/conversion tracking.”

⸻

9) UI requirements (Analysis page)

Add a “Goal Progress” section (or sub-tab) with two panels.

9.1 Panel A — Structural Variance to Goal (Line Size × Eligibility)

Controls:
	•	Scenario selector: High Confidence / Hard Climb
	•	Month selector (existing)
	•	Toggle: “Show only cohorts behind target” (optional)

Summary header:
	•	Overall APAP% (actual)
	•	Total points gap (sum of positive pointsGap)
	•	Top 3 contributing cohorts by pointsGap

Table (rows = line size × elig bucket):
	•	Line size
	•	Eligibility bucket
	•	Eligible points (actual)
	•	APAP% actual
	•	APAP% target
	•	Variance (pp)
	•	Points gap
	•	Gap share %
	•	PP impact if closed

Default sort:
	•	Points gap desc (largest behind-target first)

9.2 Panel B — Driver Progress (Retention / Conversion / Ineligible / New)

Controls:
	•	Scenario selector (same)
	•	Month selector (same)

Table (rows = driver × line size):
	•	Driver (Retention / Conversion / Baseline Ineligible / New Customers)
	•	Line size
	•	Actual rate (as-of selected month)
	•	Assumed rate (from workbook)
	•	Variance (pp)
	•	Denominator counts (baseline adopters, baseline non-adopters, now eligible, new eligible)
	•	Status (OK / insufficient baseline / insufficient data)

Optional callouts:
	•	“Largest driver gap” (biggest negative variance)
	•	“Bright spot” (most positive variance)

9.3 Data quality disclosure

Always show:
	•	count of agencies excluded due to unknown line size (missing officer_count)
	•	count excluded due to missing purchase_date / eligibility_cohort

⸻

10) Persistence & history (month-over-month tracking)

For each processed month, store a snapshot:

10.1 Structural goal progress history

goalProgressStructural[scenario][month]:
	•	overallApapActualRate
	•	totalEligiblePoints
	•	totalAdoptingPoints
	•	overallPointsGap
	•	topCohortGaps (top 3 cohorts by pointsGap)

10.2 Driver progress history

goalProgressDrivers[scenario][month]:
	•	actual rates and denominators for each driver × line size
	•	baseline availability status

Store alongside existing processed month history (localStorage/sessionStorage strategy consistent with current app).

⸻

11) Implementation guidance (modules)

11.1 src/lib/goalModel.ts
	•	parseGoalModel(workbookBuffer): { drivers, structuralTargets }
	•	Uses fixed ranges:
	•	High Confidence drivers: M29:N45
	•	High Confidence structural: C28:H46
	•	Hard Climb drivers: M50:N67
	•	Hard Climb structural: C50:H68
	•	Cache output in localStorage (e.g., goalModel_v1)

11.2 src/lib/goalProgress.ts
	•	computeStructuralVariance(processedMonthData, goalModel, scenario): StructuralVarianceResult
	•	computeDriverProgress(historyData, goalModel, scenario, baselineMonth, goalMonth): DriverProgressResult

11.3 src/lib/summaryBundle.ts (AI writeup integration)

Include in the metrics bundle:
	•	selected scenario
	•	overall APAP actual + points gap
	•	top 3 structural cohort gaps
	•	biggest driver variances (top 2 negative, top 1 positive)

AI guardrail:
	•	summary must only cite values present in the metrics bundle and must mention SIM-only labels.

⸻

12) Acceptance criteria
	1.	Workbook parsing succeeds and yields:
	•	Driver assumptions for all 4 drivers × 3 line sizes × 2 scenarios
	•	Structural targets for 3 line sizes × 4 eligibility buckets × 2 scenarios
	2.	Structural variance table matches deterministic APAP math and updates by month
	3.	Driver progress tables populate when baseline month exists; otherwise show “insufficient baseline”
	4.	“Other” line size maps to Direct (<100) and includes officer_count=0
	5.	No change to underlying SIM-only adoption label rules