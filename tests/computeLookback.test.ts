// tests/computeLookback.test.ts
import { getTrailingMonthKeys, parseMonthKey } from "@/lib/timeWindows";
import { sumAgencyCompletionsByMonthKeys } from "@/lib/metrics";
import { computeAgencyMetrics } from "@/lib/compute";
import type { SimTelemetryMonthly } from "@/lib/schema";

type Telemetry = {
  agency_id: string;
  month: string; // "YYYY-MM"
  completions: number;
  product?: string;
};

function makeTelemetry(agencyId: string, months: string[], value: number): Telemetry[] {
  return months.map((m) => ({
    agency_id: agencyId,
    month: m,
    completions: value,
    product: "Simulator Training",
  }));
}

function makeSimTelemetry(agencyId: string, months: string[], value: number): SimTelemetryMonthly[] {
  return months.map((m) => ({
    agency_id: agencyId,
    month: parseMonthKey(m),
    completions: value,
    product: "Simulator Training" as const,
  }));
}

test("C6 sums exactly the 6 months inclusive of asOf month", () => {
  const asOf = "2026-01";
  const t6 = getTrailingMonthKeys(asOf, 6); // Aug 2025..Jan 2026

  const agency = "A1";

  // Put 10 completions in each of the 6 months
  const telem = makeTelemetry(agency, t6, 10);

  // Add an extra month that should NOT be included if logic is correct:
  telem.push({ agency_id: agency, month: "2025-07", completions: 999, product: "Simulator Training" });

  const sum = sumAgencyCompletionsByMonthKeys(telem, agency, new Set(t6));
  expect(sum).toBe(60); // 6 * 10
});

test("C12 sums exactly the 12 months inclusive of asOf month", () => {
  const asOf = "2026-01";
  const t12 = getTrailingMonthKeys(asOf, 12); // Feb 2025..Jan 2026

  const agency = "A1";

  // Put 5 completions in each of the 12 months
  const telem = makeTelemetry(agency, t12, 5);

  // Add a month outside the window that buggy logic might accidentally include:
  telem.push({ agency_id: agency, month: "2025-01", completions: 999, product: "Simulator Training" });

  const sum = sumAgencyCompletionsByMonthKeys(telem, agency, new Set(t12));
  expect(sum).toBe(60); // 12 * 5
});

test("computeAgencyMetrics C6 uses exactly 6 months (exclude Jul 2025)", () => {
  const asOf = new Date(2026, 0, 1); // Jan 2026
  const t6 = getTrailingMonthKeys("2026-01", 6); // Aug 2025..Jan 2026
  const agency = "A1";
  const simTelemetry = makeSimTelemetry(agency, t6, 10);
  simTelemetry.push({
    agency_id: agency,
    month: parseMonthKey("2025-07"),
    completions: 999,
    product: "Simulator Training",
  });
  const metrics = computeAgencyMetrics(agency, simTelemetry, asOf, 100);
  expect(metrics).not.toBeNull();
  expect(metrics!.C6).toBe(60); // 6 * 10, not 60 + 999
});

test("computeAgencyMetrics C12 uses exactly 12 months (exclude Jan 2025)", () => {
  const asOf = new Date(2026, 0, 1); // Jan 2026
  const t12 = getTrailingMonthKeys("2026-01", 12); // Feb 2025..Jan 2026
  const agency = "A1";
  const simTelemetry = makeSimTelemetry(agency, t12, 5);
  simTelemetry.push({
    agency_id: agency,
    month: parseMonthKey("2025-01"),
    completions: 999,
    product: "Simulator Training",
  });
  const metrics = computeAgencyMetrics(agency, simTelemetry, asOf, 100);
  expect(metrics).not.toBeNull();
  expect(metrics!.C12).toBe(60); // 12 * 5, not 60 + 999
});