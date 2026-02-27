# GOAL_MODEL_CONFIG_SPEC.md
## Goal Model Config + Progress Tracking (v1)

### Goal
Track monthly progress vs two scenarios (High Confidence / Hard Climb) without parsing the Excel model.

We will store a canonical “Goal Model Config” in source control and compute:
1) Structural cohort progress: actual vs target APAP% by (line size × eligibility bucket)
2) Driver cohort progress: actual vs assumed rates by driver × line size

---

## 1) Definitions

### 1.1 Line size (computed per month from agency data)
- Major: officer_count >= 501
- T1200: 100 <= officer_count <= 500
- Other (Direct): officer_count < 100
- officer_count == 0 is treated as Other (Direct)
- missing/invalid officer_count => Unknown (excluded from goal computations; counted in data quality)

### 1.2 Eligibility buckets (computed per month from eligibility_cohort)
- 6–12  => bucket `6_12`
- 13–18 => bucket `13_18`
- 19–24 => bucket `19_24`
- 25+   => bucket `25_plus`
- 0–5 => ineligible (excluded from APAP denominators)

### 1.3 Adoption state
Adopting is SIM-only based on app’s deterministic thresholds (unchanged).

---

## 2) Scenario configuration

### 2.1 Months
- baselineMonth = "2025-11"
- goalMonth = "2026-11"
- newCustomerPurchaseWindow = ["2025-12", "2026-05"]

### 2.2 Driver assumptions (by line size)
Drivers:
- retention (baseline eligible adopters)
- conversion (baseline eligible non-adopters)
- baseline_ineligible (baseline ineligible 0–5)
- new_customer (purchase within window)

Each scenario defines assumed rates by line size.

### 2.3 Structural targets (by line size × eligibility bucket)
Each scenario defines target APAP% for Nov 2026 by:
- line size: Major / T1200 / Other
- eligibility bucket: 6_12, 13_18, 19_24, 25_plus

These targets are the “hard numbers” you listed, and must be treated as source of truth.

We also store overall goal totals for reference:
- High Confidence: 42.0% (100,359 / 239,200)
- Hard Climb: 46.2% (110,454 / 239,200)

---

## 3) Monthly computations

### 3.1 Structural cohort variance
For a selected month m:
- compute actual APAP% and points for each (line_size × eligibility_bucket)
- compare to scenario target APAP%
- compute:
  - variancePp
  - pointsGap = (targetRate * eligiblePointsActual) - adoptingPointsActual
  - gapSharePct among cohorts with positive pointsGap

### 3.2 Driver progress
Requires baselineMonth to exist in stored history.
Compute monthly actual rates by line size:
- retentionRate(m)
- conversionRate(m)
- baselineIneligibleAdoptionRate(m) (among baseline-ineligible that are now eligible at m)
- newCustomerAdoptionRate(m) (among new customers that are eligible at m)

Compare each to assumed rate.

---

## 4) UI requirements
Add “Goal Progress” section:
- Scenario selector
- Panel A: Structural targets table (variance + points gap)
- Panel B: Driver progress table (actual vs assumed + variance)
- Always show data quality exclusions.

---

## 5) Storage
Persist per-month snapshots of:
- structural progress (top gaps, totals)
- driver progress (rates + denominators)