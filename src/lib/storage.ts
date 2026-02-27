import LZString from 'lz-string';
import { COMPUTE_VERSION } from '@/config/snapshotVersion';

const PROCESSED_DATA_KEY = 'processedData';
const PROCESSED_DATA_PREFIX = 'processedData_';
const CURRENT_MONTH_KEY = 'processedData_currentMonth';
const SUMMARY_PREFIX = 'summary_';
const COMPRESSED_PREFIX = 'lz:';
const MAX_STORED_MONTHS = 24;

export type ProcessedDataResult = { data: Record<string, unknown>; isStale: boolean };

function decompress(raw: string): string | null {
  if (!raw) return null;
  if (raw.startsWith(COMPRESSED_PREFIX)) {
    const decompressed = LZString.decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length));
    return decompressed;
  }
  return raw;
}

function compress(json: string): string {
  const compressed = LZString.compressToUTF16(json);
  if (compressed === undefined) return json;
  return COMPRESSED_PREFIX + compressed;
}

/**
 * Get processed data. If month is provided, load that month from localStorage.
 * Otherwise: try sessionStorage (current session), then localStorage for current month.
 * Handles both compressed (lz:) and legacy uncompressed JSON.
 */
export function getProcessedData(month?: string): string | null {
  if (typeof window === 'undefined') return null;

  if (month) {
    const raw = localStorage.getItem(PROCESSED_DATA_PREFIX + month);
    return raw ? decompress(raw) : null;
  }

  const sessionRaw = sessionStorage.getItem(PROCESSED_DATA_KEY);
  if (sessionRaw) return decompress(sessionRaw);

  const currentMonth = localStorage.getItem(CURRENT_MONTH_KEY);
  if (currentMonth) {
    const raw = localStorage.getItem(PROCESSED_DATA_PREFIX + currentMonth);
    return raw ? decompress(raw) : null;
  }

  return null;
}

/**
 * Load and parse processed data for a month, with stale snapshot check.
 * Returns null if no data or parse error. isStale true when computeVersion !== current COMPUTE_VERSION.
 */
export function getProcessedDataParsed(month?: string): ProcessedDataResult | null {
  const raw = getProcessedData(month);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const isStale = data?.computeVersion !== COMPUTE_VERSION;
    return { data, isStale };
  } catch {
    return null;
  }
}

/**
 * Save processed data for a given month (YYYY-MM). Persists in localStorage so it
 * survives tab close. Also writes to sessionStorage for current session.
 * Re-uploading the same month overwrites that month's dataset.
 */
export function setProcessedData(data: unknown, month: string): void {
  setProcessedDataForMonth(data, month, { select: true });
}

/**
 * Save processed data for a month, optionally selecting it as “current”.
 * Use select=false when prefetching other months, so the UI keeps showing the user’s chosen month.
 */
export function setProcessedDataForMonth(
  data: unknown,
  month: string,
  opts: { select: boolean } = { select: true }
): void {
  if (typeof window === 'undefined') return;
  const json = JSON.stringify(data);
  const payload = compress(json);
  const key = PROCESSED_DATA_PREFIX + month;
  try {
    localStorage.setItem(key, payload);
    if (opts.select) {
      localStorage.setItem(CURRENT_MONTH_KEY, month);
      sessionStorage.setItem(PROCESSED_DATA_KEY, payload);
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'QuotaExceededError') {
      pruneOldestMonths(month);
      try {
        localStorage.setItem(key, payload);
        if (opts.select) {
          localStorage.setItem(CURRENT_MONTH_KEY, month);
          sessionStorage.setItem(PROCESSED_DATA_KEY, payload);
        }
      } catch (e2) {
        throw e2;
      }
    } else {
      throw e;
    }
  }
}

function pruneOldestMonths(keepMonth: string): void {
  const months = getStoredMonths();
  if (months.length <= MAX_STORED_MONTHS) return;
  const keepSet = new Set([keepMonth, ...months.slice(0, MAX_STORED_MONTHS - 1)]);
  const toRemove = months.filter((m) => !keepSet.has(m));
  toRemove.forEach((m) => localStorage.removeItem(PROCESSED_DATA_PREFIX + m));
}

/**
 * List of months (YYYY-MM) that have stored datasets, newest first.
 */
export function getStoredMonths(): string[] {
  if (typeof window === 'undefined') return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PROCESSED_DATA_PREFIX) && k !== CURRENT_MONTH_KEY)
      keys.push(k.slice(PROCESSED_DATA_PREFIX.length));
  }
  return keys.sort().reverse();
}

/**
 * Which month is currently selected for viewing (YYYY-MM). Used when loading data
 * so the app shows that month's analysis without re-uploading.
 */
export function getCurrentMonth(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CURRENT_MONTH_KEY);
}

/**
 * Switch the app to view a different month's dataset. Call after user picks a month;
 * then refresh or re-fetch so getProcessedData() returns that month's data.
 */
export function setCurrentMonth(month: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CURRENT_MONTH_KEY, month);
  const raw = localStorage.getItem(PROCESSED_DATA_PREFIX + month);
  if (raw) sessionStorage.setItem(PROCESSED_DATA_KEY, raw);
}

/**
 * Clear all cached snapshots (processedData_* keys). Does not clear current month selection.
 * Call after user confirms "Clear cached snapshots".
 */
export function clearAllSnapshots(): void {
  if (typeof window === 'undefined') return;
  const months = getStoredMonths();
  months.forEach((m) => localStorage.removeItem(PROCESSED_DATA_PREFIX + m));
  sessionStorage.removeItem(PROCESSED_DATA_KEY);
}

/** Month key for summary storage (YYYY-MM). */
export type SummaryStored = { markdown: string; createdAt: string };

/**
 * Get saved AI summary for a month (YYYY-MM). Returns null if none.
 */
export function getSummaryForMonth(monthKey: string): SummaryStored | null {
  if (typeof window === 'undefined' || !monthKey) return null;
  const raw = localStorage.getItem(SUMMARY_PREFIX + monthKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SummaryStored;
    if (parsed?.markdown != null) return { markdown: parsed.markdown, createdAt: parsed.createdAt || '' };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Save AI summary for a month (YYYY-MM). Overwrites any existing summary for that month.
 */
export function setSummaryForMonth(monthKey: string, markdown: string): void {
  if (typeof window === 'undefined' || !monthKey) return;
  const payload: SummaryStored = { markdown, createdAt: new Date().toISOString() };
  localStorage.setItem(SUMMARY_PREFIX + monthKey, JSON.stringify(payload));
}
