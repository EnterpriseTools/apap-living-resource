import type { Agency, AgencyMetrics, Label, SimTelemetryMonthly } from './schema';
import { projectNextMonthMetrics, projectNextQuarterMetrics } from './compute';
import { toMonthKey } from './timeWindows';
import { getT6RangeLabel, getT12RangeLabel } from './lookbackLabels';
import { format } from 'date-fns';
import { isAdoptingFromMetrics } from './domain';
import { ADOPTION_R6_THRESHOLD, ADOPTION_R12_THRESHOLD } from '@/config/domain_constants';

/**
 * Generate "why" explanation bullets for a label
 */
export function generateWhyBullets(
  agency: Agency,
  label: Label,
  metrics: AgencyMetrics | null,
  lastAdoptingMonth: Date | null = null,
  simTelemetry?: SimTelemetryMonthly[]
): string[] {
  const bullets: string[] = [];

  if (!metrics) {
    if (label === 'Unknown (No license count)') {
      bullets.push('Missing or invalid vr_licenses (required for adoption calculation)');
      bullets.push('Cannot compute adoption metrics without a valid license count');
    } else {
      bullets.push('No telemetry data available for this agency');
      bullets.push('Cannot compute adoption metrics without usage data');
    }
    return bullets;
  }

  const asOfMonthKey = toMonthKey(metrics.as_of_month);
  const t6Range = getT6RangeLabel(asOfMonthKey);
  const t12Range = getT12RangeLabel(asOfMonthKey);
  const t6Label = t6Range ? `T6 (${t6Range})` : 'T6';
  const t12Label = t12Range ? `T12 (${t12Range})` : 'T12';

  if (label === 'Adopting') {
    const r12 = metrics.R12 ?? 0;
    const r6 = metrics.R6 ?? 0;
    if (metrics.R12 != null && metrics.R12 >= ADOPTION_R12_THRESHOLD) {
      bullets.push(`${t12Label} Completions PP = ${r12.toFixed(2)} (meets threshold of ${ADOPTION_R12_THRESHOLD})`);
    }
    if (metrics.R6 != null && metrics.R6 >= ADOPTION_R6_THRESHOLD) {
      bullets.push(`${t6Label} Completions PP = ${r6.toFixed(2)} (meets threshold of ${ADOPTION_R6_THRESHOLD})`);
    }
    bullets.push(`${t12Label} Completions = ${(metrics.C12 ?? 0).toFixed(0)}`);
    bullets.push(`${t6Label} Completions = ${(metrics.C6 ?? 0).toFixed(0)}`);
  }

  if (label === 'Not Adopting') {
    if (lastAdoptingMonth) {
      bullets.push(`Previously met adoption thresholds; last met threshold in ${format(lastAdoptingMonth, 'MMMM yyyy')}`);
    }
    bullets.push(`${t12Label} Completions PP = ${(metrics.R12 ?? 0).toFixed(2)} (below threshold of ${ADOPTION_R12_THRESHOLD})`);
    bullets.push(`${t6Label} Completions PP = ${(metrics.R6 ?? 0).toFixed(2)} (below threshold of ${ADOPTION_R6_THRESHOLD})`);
    bullets.push(`${t12Label} Completions = ${(metrics.C12 ?? 0).toFixed(0)}`);
    bullets.push(`${t6Label} Completions = ${(metrics.C6 ?? 0).toFixed(0)}`);
  }

  if (label === 'Churned Out') {
    bullets.push('Previously met adoption thresholds but no longer does');
    if (lastAdoptingMonth) {
      bullets.push(`Last met threshold in ${format(lastAdoptingMonth, 'MMMM yyyy')}`);
    }
    bullets.push(`${t12Label} Completions PP = ${(metrics.R12 ?? 0).toFixed(2)} (below threshold of ${ADOPTION_R12_THRESHOLD})`);
    bullets.push(`${t6Label} Completions PP = ${(metrics.R6 ?? 0).toFixed(2)} (below threshold of ${ADOPTION_R6_THRESHOLD})`);
    bullets.push(`${t12Label} Completions = ${(metrics.C12 ?? 0).toFixed(0)} (down from previous levels)`);
  }

  if (label === 'At Risk (Next Month)') {
    const projection = projectNextMonthMetrics(metrics, agency.agency_id, simTelemetry);
    bullets.push('Currently adopting but projected to fall below thresholds next month');
    bullets.push(`Current ${t12Label} Completions PP = ${(metrics.R12 ?? 0).toFixed(2)}, projected = ${projection.R12_next.toFixed(2)}`);
    bullets.push(`Current ${t6Label} Completions PP = ${(metrics.R6 ?? 0).toFixed(2)}, projected = ${projection.R6_next.toFixed(2)}`);
    const avg3 = Array.isArray(metrics.last3Months) && metrics.last3Months.length >= 3
      ? (metrics.last3Months.reduce((a, b) => a + b, 0) / 3).toFixed(0)
      : '—';
    bullets.push(`Last 3 months average: ${avg3} completions/month`);
  }

  if (label === 'At Risk (Next Quarter)') {
    projectNextQuarterMetrics(metrics, agency.agency_id, simTelemetry);
    bullets.push('Currently adopting but projected to fall below thresholds within 3 months');
    const avg3 = Array.isArray(metrics.last3Months) && metrics.last3Months.length >= 3
      ? (metrics.last3Months.reduce((a, b) => a + b, 0) / 3).toFixed(0)
      : '—';
    bullets.push(`Last 3 months average: ${avg3} completions/month`);
    bullets.push('Trend suggests declining usage pattern');
  }

  if (label === 'Top Performer') {
    const r12 = metrics.R12 ?? 0;
    const r6 = metrics.R6 ?? 0;
    if (metrics.R12 != null && metrics.R12 >= 3.0) {
      bullets.push(`${t12Label} Completions PP = ${r12.toFixed(2)} (exceeds excellent threshold of 3.0)`);
    }
    if (metrics.R6 != null && metrics.R6 >= 1.25) {
      bullets.push(`${t6Label} Completions PP = ${r6.toFixed(2)} (exceeds excellent threshold of 1.25)`);
    }
    bullets.push(`${t12Label} Completions = ${(metrics.C12 ?? 0).toFixed(0)}`);
    bullets.push(`${t6Label} Completions = ${(metrics.C6 ?? 0).toFixed(0)}`);
  }

  if (label === 'Ineligible (0–5 months)') {
    bullets.push(`Months since purchase: ${agency.months_since_purchase} (must be 6+ months for adoption assessment)`);
  }


  return bullets;
}

/**
 * Get recommended action based on label
 */
export function getRecommendedAction(label: Label): string {
  switch (label) {
    case 'Top Performer':
      return 'VOC / Champion story collection';
    case 'At Risk (Next Month)':
      return 'Urgent enablement outreach';
    case 'At Risk (Next Quarter)':
      return 'Proactive enablement outreach';
    case 'Churned Out':
      return 'Winback campaign';
    case 'Adopting':
      return 'Monitor and maintain engagement';
    case 'Not Adopting':
      return 'Enablement and training support';
    case 'Ineligible (0–5 months)':
      return 'Early engagement and onboarding';
    default:
      return 'Review data quality';
  }
}

