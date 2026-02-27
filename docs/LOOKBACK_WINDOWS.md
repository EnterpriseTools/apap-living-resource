# LOOKBACK_WINDOWS.md

## Authoritative lookback window definition

**Rule:** Trailing windows are always **inclusive** of the selected (asOf) month.

Given `asOfMonth` (YYYY-MM):

- **T6** = asOf month + previous 5 months → exactly 6 months
- **T12** = asOf month + previous 11 months → exactly 12 months

Example: `asOf = 2026-01`

- T6 = Aug 2025–Jan 2026 (6 months)
- T12 = Feb 2025–Jan 2026 (12 months)

## Implementation

- Use **month keys** (YYYY-MM) and match telemetry by month key.
- Do **not** use date comparisons like `>= asOf - 6 months`; that can include 7 months for T6 or 13 for T12.
- Use `getTrailingMonthKeys(asOfMonthKey, n)` from `src/lib/timeWindows.ts` to get the exact set of month keys for T6 (n=6) and T12 (n=12).
- Completions are summed via `sumAgencyCompletionsByMonthKeys` in `src/lib/metrics.ts` using the same month-key set.

## Display (UI)

- **Table headers**: Use compact labels only (e.g. "T6 Completions PP", "T12 Completions PP"). Do not show raw date ranges in headers.
- **Tooltips**: Show the lookback range in a tooltip on the column label, formatted as a human-readable month range (e.g. "Trailing 6 months (inclusive): Aug 2025–Jan 2026"). Use `src/lib/lookbackLabels.ts` (`getT6RangeLabel`, `getT12RangeLabel`, `getT6Tooltip`, `getT12Tooltip`) and `src/components/TooltipHeader.tsx`.
- **Explain bullets**: "Why" bullets use human-readable ranges (e.g. "T6 (Aug 2025–Jan 2026) Completions PP = 0.75") via `lookbackLabels`; no raw YYYY-MM strings in the UI.