// src/config/goal_model_config.ts

export type Scenario = "high_confidence" | "hard_climb";
export type LineSize = "Major" | "T1200" | "Direct";
export type EligBucket = "6_12" | "13_18" | "19_24" | "25_plus";
export type Driver = "retention" | "conversion" | "baseline_ineligible" | "new_customer";

/** November 2025 baseline cohort keys from 2026 Baseline table: 6-12, 12-24, 24+. 13_18 and 19_24 map to 12_24. */
export type CohortBaselineKey = "6_12" | "12_24" | "25_plus";
/** November 2025 cohort baseline: adopting and eligible points per (CohortBaselineKey × LineSize). */
export type CohortBaselineNovember = Record<CohortBaselineKey, Record<LineSize, { adoptingPoints: number; eligiblePoints: number }>>;

export type GoalModelConfig = {
  baselineMonth: string; // YYYY-MM
  goalMonth: string;     // YYYY-MM
  newCustomerPurchaseWindow: { start: string; end: string }; // YYYY-MM inclusive

  /** November 2025 baseline by cohort × line size (2026 Baseline table). Used for APAP Goal Progress trend. */
  cohortBaselineNovember?: CohortBaselineNovember;

  overall: Record<Scenario, {
    overallTargetApapPct: number;
    projectedEligiblePoints: number;
    projectedAdoptingPoints: number;
  }>;

  driverAssumptions: Record<Scenario, Record<Driver, Record<LineSize, number>>>; // rates 0..1

  structuralTargets: Record<Scenario, Record<LineSize, Record<EligBucket, number>>>; // APAP% rates 0..1
};

export const GOAL_MODEL_CONFIG: GoalModelConfig = {
  baselineMonth: "2025-11",
  goalMonth: "2026-11",
  newCustomerPurchaseWindow: { start: "2025-12", end: "2026-05" },

  // November 2025 cohort baselines from 2026 Baseline table (6-12, 12-24, 24+ × Major, T1200, Direct)
  cohortBaselineNovember: {
    "6_12": {
      Major: { adoptingPoints: 16795, eligiblePoints: 37708 },
      T1200: { adoptingPoints: 8016, eligiblePoints: 20937 },
      Direct: { adoptingPoints: 5326, eligiblePoints: 8092 },
    },
    "12_24": {
      Major: { adoptingPoints: 4884, eligiblePoints: 19245 },
      T1200: { adoptingPoints: 5668, eligiblePoints: 14130 },
      Direct: { adoptingPoints: 1921, eligiblePoints: 3894 },
    },
    "25_plus": {
      Major: { adoptingPoints: 6204, eligiblePoints: 25493 },
      T1200: { adoptingPoints: 4619, eligiblePoints: 15609 },
      Direct: { adoptingPoints: 1297, eligiblePoints: 2478 },
    },
  },

  overall: {
    high_confidence: {
      overallTargetApapPct: 42.0,
      projectedEligiblePoints: 239200,
      projectedAdoptingPoints: 100359,
    },
    hard_climb: {
      overallTargetApapPct: 46.2,
      projectedEligiblePoints: 239200,
      projectedAdoptingPoints: 110454,
    },
  },

  driverAssumptions: {
    high_confidence: {
      retention: { Major: 0.80, T1200: 0.80, Direct: 0.80 },
      conversion: { Major: 0.10, T1200: 0.25, Direct: 0.25 },
      baseline_ineligible: { Major: 0.35, T1200: 0.55, Direct: 0.66 },
      new_customer: { Major: 0.35, T1200: 0.55, Direct: 0.66 },
    },
    hard_climb: {
      retention: { Major: 0.90, T1200: 0.90, Direct: 0.90 },
      conversion: { Major: 0.10, T1200: 0.25, Direct: 0.25 },
      baseline_ineligible: { Major: 0.40, T1200: 0.60, Direct: 0.66 },
      new_customer: { Major: 0.42, T1200: 0.55, Direct: 0.66 },
    },
  },

  // Targets for Nov 2026 by eligibility bucket (as-of Nov 2026) × line size
  // Values below are APAP% expressed as rates (e.g., 35.2% => 0.352).
  structuralTargets: {
    high_confidence: {
      Major: { "6_12": 0.35,  "13_18": 0.352, "19_24": 0.412, "25_plus": 0.273 },
      T1200: { "6_12": 0.55,  "13_18": 0.58,  "19_24": 0.461, "25_plus": 0.44  },
      Direct: { "6_12": 0.66,  "13_18": 0.646, "19_24": 0.612, "25_plus": 0.528 },
    },
    hard_climb: {
      Major: { "6_12": 0.42,  "13_18": 0.424, "19_24": 0.456, "25_plus": 0.298 },
      T1200: { "6_12": 0.55,  "13_18": 0.655, "19_24": 0.499, "25_plus": 0.475 },
      Direct: { "6_12": 0.66,  "13_18": 0.696, "19_24": 0.678, "25_plus": 0.578 },
    },
  },
};