import { z } from 'zod';

// Agency master data schema
export const AgencyRowSchema = z.object({
  agency_id: z.string(),
  agency_name: z.string(),
  purchase_date: z.coerce.date().optional(), // Legacy support
  eligibility_cohort: z.coerce.number().nonnegative().optional(), // Months since purchase
  vr_licenses: z.coerce.number().positive().optional(),
  officer_count: z.coerce.number().nonnegative().optional(),
  cew_type: z.enum(['T10', 'T7']).optional(),
  region: z.string().optional(),
  csm_owner: z.string().optional(),
  notes: z.string().optional(),
  latest_cew_training_date: z.coerce.date().optional(),
  next_cew_training_date: z.coerce.date().optional(),
});

export type AgencyRow = z.infer<typeof AgencyRowSchema>;

// Telemetry row schema
export const TelemetryRowSchema = z.object({
  month: z.preprocess((val) => {
    if (typeof val === 'string') {
      const parts = val.split('-');
      if (parts.length === 2) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        return new Date(year, month - 1, 1);
      }
    }
    return val;
  }, z.coerce.date()),
  agency_id: z.string(),
  product: z.string(),
  completions: z.coerce.number().nonnegative(),
  platform: z.string().optional(),
  license_type: z.string().optional(),
});

export type TelemetryRow = z.infer<typeof TelemetryRowSchema>;

// Normalized telemetry (month normalized to first day)
export type TelemetryMonthly = {
  month: Date; // First day of month
  agency_id: string;
  product: string;
  completions: number;
  platform?: string;
  license_type?: string;
};

// Agency with derived fields
export type Agency = AgencyRow & {
  agency_size_band: 'Direct' | 'T1200' | 'Major' | 'Unknown (No officer count)';
  months_since_purchase: number | null;
  purchase_cohort: string;
  as_of_month: Date | null;
};

// Joined telemetry with agency metadata
export type TelemetryJoined = TelemetryMonthly & {
  agency_name: string;
  vr_licenses?: number;
  purchase_date?: Date;
  agency_size_band: string;
  purchase_cohort: string;
};

// SIM-only telemetry
export type SimTelemetryMonthly = TelemetryMonthly & {
  product: 'Simulator Training';
};

// Metrics computed for an agency
export type AgencyMetrics = {
  agency_id: string;
  L: number; // vr_licenses
  C6: number; // sum of completions over last 6 months
  C12: number; // sum of completions over last 12 months
  R6: number; // (C6 / 6) / L
  R12: number; // (C12 / 12) / L
  last3Months: number[]; // completions for last 3 months [oldest, middle, newest]
  as_of_month: Date;
  /** Raw monthly completions for the trailing 12-month window, oldest → newest. */
  monthlyCompletions: { monthKey: string; completions: number }[];
};

// Label types
export type Label =
  | 'Adopting'
  | 'PreviouslyAdopting'
  | 'Churned Out'
  | 'At Risk (Next Month)'
  | 'At Risk (Next Quarter)'
  | 'Top Performer'
  | 'Unknown (No license count)'
  | 'Ineligible (0–5 months)'
  | 'Not Adopting';

// Agency with label and explanation
export type AgencyWithLabel = {
  agency_id: string;
  agency_name: string;
  label: Label;
  metrics: AgencyMetrics | null;
  cohorts: {
    purchase_cohort: string;
    agency_size_band: string;
    cew_type?: string;
  };
  why: string[]; // Explanation bullets
  recommended_action: string;
  csm_owner?: string;
  region?: string;
  training_dates?: {
    latest_cew_training_date?: Date;
    next_cew_training_date?: Date;
  };
};

// Data quality report
export type DataQualityReport = {
  unmatched_telemetry_ids: string[];
  agencies_with_no_telemetry: string[];
  agencies_missing_licenses: string[];
  agencies_missing_purchase_date: string[];
  row_counts: {
    agencies: number;
    telemetry_rows: number;
    sim_telemetry_rows: number;
  };
};

