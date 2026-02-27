import {
  formatMonthKeyRange,
  getT6RangeLabel,
  getT12RangeLabel,
  getT6Tooltip,
  getT12Tooltip,
  getLookbackRangeLabel,
} from "@/lib/lookbackLabels";

test("formatMonthKeyRange returns human-readable range with en dash", () => {
  expect(formatMonthKeyRange(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"])).toBe(
    "Aug 2025–Jan 2026"
  );
  expect(formatMonthKeyRange(["2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"])).toBe(
    "Feb 2025–Jan 2026"
  );
});

test("getT6RangeLabel and getT12RangeLabel for asOfMonthKey 2026-01 (regression)", () => {
  expect(getT6RangeLabel("2026-01")).toBe("Aug 2025–Jan 2026");
  expect(getT12RangeLabel("2026-01")).toBe("Feb 2025–Jan 2026");
});

test("getT6Tooltip and getT12Tooltip include inclusive wording", () => {
  expect(getT6Tooltip("2026-01")).toBe("Trailing 6 months (inclusive): Aug 2025–Jan 2026");
  expect(getT12Tooltip("2026-01")).toBe("Trailing 12 months (inclusive): Feb 2025–Jan 2026");
});

test("getLookbackRangeLabel(asOfMonthKey, n) returns human-readable range", () => {
  expect(getLookbackRangeLabel("2026-01", 6)).toBe("Aug 2025–Jan 2026");
  expect(getLookbackRangeLabel("2026-01", 12)).toBe("Feb 2025–Jan 2026");
});
