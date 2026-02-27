# APAP increase analysis (December / January)

After aligning adoption and Action List logic, APAP totals for December and January increased. This doc explains why and how the app was updated so APAP stays correct and comparable.

---

## Current APAP definition (threshold-only)

**APAP rule:** eligibility_cohort ≥ 6 AND (T12 completions per license ≥ 2 OR T6 completions per license ≥ 0.75). T12 = trailing 12‑month completions / VR license (R12); T6 = trailing 6‑month completions / VR license (R6).

**APAP does not use labels.** It uses only:

1. **Eligibility:** eligibility_cohort ≥ 6 for the current month (from uploaded agency data).
2. **Adoption threshold:** (R6 ≥ 0.75) OR (R12 ≥ 2.0), where R6 and R12 are computed from the current month’s telemetry (trailing 6- and 12-month completions per VR license).

So: **Adopting points** = sum of officer_count for agencies that are eligible and meet at least one rate threshold. **APAP** = (adopting points / eligible points) × 100.

Labels (At Risk, Churned, etc.) are derived from these same thresholds and eligibility; they are separate outputs and do not feed back into APAP. That keeps APAP stable when cohort or label definitions change.

**Where in code:** `src/lib/history.ts` — `computeAPAP` determines adopting by `(R6 != null && R6 >= 0.75) || (R12 != null && R12 >= 2.0)` from each agency’s metrics; it does not use label strings.

---

## What previously affected APAP (historical context)

### 1. **At Risk agencies counted in APAP** (main driver of the increase)

**Before (threshold-only):** The APAP numerator included only agencies that met threshold (R6 ≥ 0.75 or R12 ≥ 2.0). In practice we had filtered by labels “Adopting” and “Top Performer” only.

**Interim change:** We included **At Risk (Next Month)** and **At Risk (Next Quarter)** in the adopting count (they still meet threshold; they’re only projected to drop later). That increased APAP.

**Current:** APAP is again **threshold-only**. We no longer use labels for APAP; we use R6/R12 from metrics. So At Risk agencies are counted in APAP only because they meet the threshold, not because of their label. The implementation no longer depends on label names, so changing label or cohort definitions won’t change APAP.

---

### 2. **Null-safe adoption in labels** (smaller or zero effect)

**Before:** `metrics.R12 >= 2.0 || metrics.R6 >= 0.75` (could be wrong when one of R6/R12 was null).

**After:** `(metrics.R6 != null && metrics.R6 >= 0.75) || (metrics.R12 != null && metrics.R12 >= 2.0)`.

**Effect:**  
- If one metric is null and the other is above threshold, the agency was already treated as adopting (e.g. `R12 >= 2.0` is true regardless of R6). So in those cases behavior is unchanged.  
- Only edge case: one metric null, the other below threshold — we do not count as adopting. So null-safety can only **reduce** adopting in rare edge cases, not increase it.

So the December/January APAP increase was **not** explained by null-safety; it was from **including At Risk in the adopting count** when we used label-based adopting.

---

## Goal progress and slice APAP (threshold-only)

**APAP** and **goal progress** (structural slices, driver rates) now use the **same** adopting definition: threshold-only (R6 ≥ 0.75 or R12 ≥ 2.0 from metrics). Implemented via `meetsAPAPThreshold` in `src/lib/goalProgress.ts` and `src/lib/goalProgressFromConfig.ts`.

**`APAP_INCLUDE_AT_RISK_IN_ADOPTING`** in `src/config/apap_config.ts` is **deprecated/unused**. Adopting is always threshold-based everywhere.

---

## How to confirm (historical)

1. **Count At Risk in December/January**  
   On the Analysis page, the KPI cards show “At Risk (Next Month)” and “At Risk (Next Quarter)” agency and point counts. The extra adopting points in APAP are exactly those At Risk points.

2. **Compare APAP with and without At Risk**  
   We can add a toggle or config so that:
   - **Current (inclusive):** adopting = Adopting + Top Performer + At Risk (Next Month) + At Risk (Next Quarter).
   - **Stable only:** adopting = Adopting + Top Performer only.

   Then you can compare December/January APAP under both definitions and see how much of the increase comes from At Risk.

---

## Design choice: should At Risk count in APAP?

- **Include At Risk (current):**  
  APAP = “% of eligible points that are meeting threshold this month.”  
  Matches “currently meeting threshold” and aligns with baseline/history “was adopting.”

- **Exclude At Risk:**  
  APAP = “% of eligible points that are stably adopting (not at risk).”  
  Lower number; may better match an internal definition of “adopted” that only counts Adopting + Top Performer.

If you want the app to show the pre-change, lower APAP for December/January, we can switch `computeAPAP` (and goal progress) back to adopting = **Adopting + Top Performer only** and document that as “APAP (stable adopting).”  
**To restore the pre-change (lower) APAP:** Set `APAP_INCLUDE_AT_RISK_IN_ADOPTING = false` in `src/config/apap_config.ts`. That makes adopting = Adopting + Top Performer only everywhere (APAP and goal progress), so December/January totals drop back to the previous definition.
