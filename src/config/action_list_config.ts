/**
 * Action List config — constants for buildActionList (ACTION_LIST_SPEC.md).
 * Line size: Direct < 100 (incl. 0), T1200 100..500, Major >= 501 (domain_constants).
 */

import { getLineSizeBand, type LineSizeBand } from '@/lib/domain';

export const ACTION_LIST_CONFIG = {
  baselineMonth: '2025-11',
  closeToEligibleMonths: [4, 5] as const,
  lowEngagementR6Threshold: 0.2,
  closeToAdoptR6Threshold: 0.5,
  closeToAdoptR12Threshold: 1.5,
  notAdoptingStreakTagMinMonths: 2,
} as const;

export type LineSize = LineSizeBand;

/** Derive line size from officer_count (canonical getLineSizeBand). 0 => Direct. */
export function getLineSizeFromOfficerCount(officerCount: number | undefined | null): LineSize | 'Unknown' {
  const band = getLineSizeBand(officerCount);
  return band ?? 'Unknown';
}
