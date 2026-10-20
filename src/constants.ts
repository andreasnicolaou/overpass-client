export const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** Query timeout in seconds. */
export const DEFAULT_TIMEOUT = 60;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_CACHE_MAX_ENTRIES = 500;
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_USER_AGENT =
  '@andreasnicolaou/overpass-client (+https://github.com/andreasnicolaou/overpass-client)';

/**
 * Extra time given to the HTTP request on top of the Overpass server-side timeout. Overpass may
 * queue a request for up to 15 seconds before running it, so this must comfortably exceed that.
 */
export const CLIENT_TIMEOUT_GRACE_SECONDS = 30;
export const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
/** The Overpass usage policy asks clients to pause for 30 seconds after a 429. */
export const RATE_LIMIT_MIN_DELAY_MS = 30 * 1000;
/** A longer `Retry-After` fails fast instead of silently waiting, as it likely comes from a misbehaving server. */
export const RETRY_AFTER_MAX_MS = 5 * 60 * 1000;

/** Browsers forbid setting `User-Agent` (and send `Referer` instead), so it is only set elsewhere. */
export const IS_BROWSER = typeof window !== 'undefined' || typeof self !== 'undefined';
