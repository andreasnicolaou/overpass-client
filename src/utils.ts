import type { OverpassResponse } from './types';

/** Escapes a value for use inside a double-quoted Overpass QL string. */
export const escapeQL = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Parses a `Retry-After` header (delay-seconds or HTTP date) into milliseconds, or `null` if invalid. */
export const parseRetryAfter = (header: unknown): number | null => {
  if (header == null || String(header).trim() === '') {
    return null;
  }
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(header)) - Date.now();
  return Number.isNaN(ms) ? null : Math.max(0, ms);
};

/** Whether Overpass flagged a runtime error (e.g. a timeout) inside an HTTP 200 response. */
export const hasRemark = (data: unknown): boolean =>
  typeof data === 'string' ? data.includes('<remark>') : !!(data as OverpassResponse | undefined)?.remark;
