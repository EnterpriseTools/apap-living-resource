# Context Library Index (APAP References)

The `context/` folder contains historical APAP artifacts used as reference for:
- the kinds of metrics and cohort cuts we’ve analyzed
- how we’ve interpreted adoption/churn risk and “what moved”
- the narrative patterns we’ve written month-to-month

IMPORTANT:
- These docs are NOT a UI template.
- Use them to understand metrics, calculations, cohort logic, and narrative structure.
- The product UI should follow our PRD/user stories (not replicate working-doc layouts).

---

## Specs and analysis (docs/)
- **ACTION_LIST_SPEC.md** — Action List categories, adoption thresholds, section names, display behavior; T6/T12 compact headers and tooltips.
- **APAP_ANALYSIS.md** — APAP rule (eligibility_cohort ≥ 6 AND T12/T6 completions per license thresholds); threshold-only everywhere; labels not used. Why December/January APAP had increased (historical); `APAP_INCLUDE_AT_RISK_IN_ADOPTING` deprecated/unused.
- **LOOKBACK_WINDOWS.md** — Authoritative T6/T12 trailing-window definition (month keys, inclusive); implementation (timeWindows, metrics); display (compact headers, tooltips, human-readable ranges in explain).
- **OPENAI_RATE_LIMITS.md** — OpenAI 429 (rate limit) and timeout handling; RPM/TPM; retry with backoff; 55s request timeout and 60s route maxDuration; Vercel Free 10s limit; payload size and compact JSON.
- **PRD.md**, **STEP_0_SPEC.md**, **DESIGN_SPEC.md** — Product and design requirements; adoption/APAP definitions and KPI layout; snapshot versioning; Settings; AI Summary per-month storage and regenerate confirmation.

---

## Folder structure (current)

- context/
  - Context/
    - '25 APAP Working Sheets/
      - Adoption_Shift_Cohorts_With_Cohorts.xlsx
      - Adoption_Shift_Cohorts_With_Names.xlsx
      - Agency_Threshold_Changes_Sep_to_Oct.xlsx
      - APAP Adoption Cohorts for VOC.html
      - April_APAP_Aggregated.xlsx
      - August_APAP_Aggregated_Updated_Overview.xlsx
      - Axon VR Adoption/ Q3 2025 Report.pdf
      - December_APAP_Overview_Final.xlsx
      - Engagement_Metrics_November_Final.xlsx
      - Feb_APAP_Aggregated.xlsx
      - July_APAP_Analysis_With_Changes.xlsx
      - July_APAP_Full_Segmented_Overview.xlsx
      - June_APAP_Aggregated_ActiveOnly.xlsx
      - March - Final_Aggregated_Agency_Data.xlsm
      - May_APAP_Aggregated_With_Complete_Overview.xlsx
      - November_APAP_Complete_Overview.xlsx
      - October_APAP_Usage_Analysis.xlsx
      - Q3 Adoption Report Graphs.xlsx
      - September_APAP_Aggregated_Overview.xlsx
      - VR APAP Update - August 2025 (Working Doc).html
      - VR APAP Update - July 2025 (Working Doc).html
      - VR APAP Update - Nov 2025 (Working Doc).html
      - VR APAP Update - Oct 2025 (Working Doc).html
      - VR APAP Update - Sept 2025 (Working Doc).html
    - 2026 APAP Analysis.xlsx
    - 2026 VR APAP Metric and Goals.pdf
    - 2026 VR APAP Threshold Modeling.xlsx

---

## How to use these references

### 1) Spreadsheets (working models / calculations)
Use these to learn:
- how adoption is calculated month-over-month
- how cohorts are defined and rolled up
- how trends are compared and summarized

Most useful:
- 2026 APAP Analysis.xlsx
- November_APAP_Complete_Overview.xlsx
- December_APAP_Overview_Final.xlsx
- 2026 VR APAP Threshold Modeling.xlsx
- Engagement_Metrics_November_Final.xlsx
- Monthly aggregated/overview workbooks:
  - April_APAP_Aggregated.xlsx
  - May_APAP_Aggregated_With_Complete_Overview.xlsx
  - June_APAP_Aggregated_ActiveOnly.xlsx
  - July_APAP_Full_Segmented_Overview.xlsx
  - August_APAP_Aggregated_Updated_Overview.xlsx
  - September_APAP_Aggregated_Overview.xlsx
  - October_APAP_Usage_Analysis.xlsx

### 2) HTML writeups (narrative patterns)
Use these to mirror:
- the types of insights we call out (what moved, why, so what)
- risk/opportunity framing
- what an “executive friendly” summary looks like

Most useful:
- VR APAP Update - July 2025 (Working Doc).html
- VR APAP Update - August 2025 (Working Doc).html
- VR APAP Update - Sept 2025 (Working Doc).html
- VR APAP Update - Oct 2025 (Working Doc).html
- VR APAP Update - Nov 2025 (Working Doc).html
- APAP Adoption Cohorts for VOC.html

### 3) PDFs (definitions / goal framing / executive reporting)
Use these to anchor:
- APAP definitions and eligibility logic (if documented)
- how goals/targets are framed and communicated

Most useful:
- 2026 VR APAP Metric and Goals.pdf
- Axon VR Adoption/ Q3 2025 Report.pdf

---

## “Do not do”
- Do not reproduce the HTML writeup layout as the UI.
- Do not treat spreadsheet tab layouts as product requirements.
- Do not invent metrics not defined in docs/STEP_0_SPEC.md or docs/PRD.md.