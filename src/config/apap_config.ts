/**
 * APAP (Adoption Percentage) config.
 * APAP and goal progress now use threshold-only adopting everywhere: eligible (cohort >= 6) + (R6 >= 0.75 or R12 >= 2).
 * See computeAPAP in history.ts and meetsAPAPThreshold in goalProgressFromConfig.ts.
 *
 * @deprecated Unused. Kept for reference; adopting is always threshold-based (no label-based flag).
 */
export const APAP_INCLUDE_AT_RISK_IN_ADOPTING = false;
