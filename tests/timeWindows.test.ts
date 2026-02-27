import { getTrailingMonthKeys } from "@/lib/timeWindows";

test("T6 includes asOf month", () => {
  expect(getTrailingMonthKeys("2026-01", 6)).toEqual([
    "2025-08","2025-09","2025-10","2025-11","2025-12","2026-01"
  ]);
});

test("T6 for Jan 2026 is exactly 6 months and does NOT include 2025-07", () => {
  const t6Keys = getTrailingMonthKeys("2026-01", 6);
  expect(t6Keys).toHaveLength(6);
  expect(t6Keys).toEqual(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
  expect(t6Keys).not.toContain("2025-07");
});

test("T12 includes asOf month", () => {
  const keys = getTrailingMonthKeys("2026-01", 12);
  expect(keys[0]).toBe("2025-02");
  expect(keys[keys.length - 1]).toBe("2026-01");
  expect(keys.length).toBe(12);
});