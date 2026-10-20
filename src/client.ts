import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Observable, catchError, defer, delay, finalize, of, retry, share, tap, throwError, timer } from 'rxjs';
import { LRUCache } from 'lru-cache';
import {
  CLIENT_TIMEOUT_GRACE_SECONDS,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_ENDPOINT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  DEFAULT_USER_AGENT,
  IS_BROWSER,
  RATE_LIMIT_MIN_DELAY_MS,
  RETRYABLE_STATUSES,
  RETRY_AFTER_MAX_MS,
} from './constants';
import { OverpassError } from './errors';
import type {
  ElementType,
  OverpassBaseOptions,
  OverpassClientOptions,
  OverpassFormat,
  OverpassLogger,
  OverpassResult,
} from './types';
import { escapeQL, hasRemark, parseRetryAfter } from './utils';

/**
 * A client for querying the Overpass API, supporting caching, retries, and various query types.
 * @class OverpassClient
 * @author Andreas Nicolaou <anicolaou66@gmail.com>
 */
export class OverpassClient<F extends OverpassFormat = 'json'> {
  private readonly axiosInstance: AxiosInstance;
  private readonly endpoint: string;
  private readonly format: F;
  /** Requests currently running, so identical concurrent queries share one HTTP request. */
  private readonly inFlight = new Map<string, Observable<OverpassResult<F>>>();
  private readonly logger: OverpassLogger;
  private readonly lruCache: LRUCache<string, OverpassResult<F>>;
  private readonly maxRetries: number;
  private readonly timeout: number;

  /**
   * Creates a new instance of the Overpass API client.
   * @param options - Client options; see {@link OverpassClientOptions}. All are optional, except `format`
   * when the client is explicitly typed with a non-JSON format, e.g. `new OverpassClient<'xml'>({ format: 'xml' })`.
   * @memberof OverpassClient
   */
  constructor(...args: 'json' extends F ? [options?: OverpassClientOptions<F>] : [options: OverpassClientOptions<F>]);
  /**
   * Creates a new instance of the Overpass API client from positional arguments.
   * Each argument matches the {@link OverpassClientOptions} field of the same name, and `format`
   * is required when the client is explicitly typed with a non-JSON format.
   * @memberof OverpassClient
   */
  constructor(
    ...args: 'json' extends F
      ? [
          endpoint?: string,
          format?: F,
          timeout?: number,
          maxRetries?: number,
          lruCache?: LRUCache<string, OverpassResult<F>>,
          userAgent?: string,
        ]
      : [
          endpoint: string | undefined,
          format: F,
          timeout?: number,
          maxRetries?: number,
          lruCache?: LRUCache<string, OverpassResult<F>>,
          userAgent?: string,
        ]
  );
  constructor(
    endpointOrOptions?: string | OverpassClientOptions<F>,
    format?: F,
    timeout?: number,
    maxRetries?: number,
    lruCache?: LRUCache<string, OverpassResult<F>>,
    userAgent?: string
  ) {
    const options: OverpassBaseOptions<F> & { format?: F } =
      typeof endpointOrOptions === 'object' && endpointOrOptions !== null
        ? endpointOrOptions
        : { endpoint: endpointOrOptions, format, timeout, maxRetries, lruCache, userAgent };

    this.lruCache =
      options.lruCache ||
      new LRUCache({
        max: DEFAULT_CACHE_MAX_ENTRIES,
        ttl: DEFAULT_CACHE_TTL_MS,
      });
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.format = options.format ?? ('json' as F);
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.logger = options.logger ?? console;

    this.axiosInstance = axios.create({
      baseURL: this.endpoint,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(IS_BROWSER ? {} : { 'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT }),
      },
      timeout: this.timeout > 0 ? (this.timeout + CLIENT_TIMEOUT_GRACE_SECONDS) * 1000 : 0,
      responseType: this.format === 'xml' ? 'text' : 'json',
    });
  }

  /**
   * Clears cache entirely
   * @memberof OverpassClient
   */
  public clearCache(): void {
    this.lruCache.clear();
  }

  /**
   * Fetches a specific element (node, way, or relation) by its ID.
   * @param type - The type of element (node, way, or relation).
   * @param id - The ID of the element.
   * @param outputFormat - The Overpass QL output format (default: 'out;').
   * @returns Observable emitting the query result.
   * @memberof OverpassClient
   */
  public getElement(type: ElementType, id: number, outputFormat: string = 'out;'): Observable<OverpassResult<F>> {
    return this.query(`${type}(${id}); ${outputFormat}`);
  }

  /**
   * Fetches elements with specified tags within a given bounding box.
   * @param tags - A dictionary of tag types and their possible values. Example: { amenity: ['cafe', 'restaurant'], tourism: ['museum'] }
   * @param bbox - Bounding box coordinates in the format [minLat, minLon, maxLat, maxLon].
   * @param elements - List of element types to include in the query (node, way, relation). Defaults to all elements.
   * @param outputFormat - The Overpass QL output format (default: 'out center;').
   * @returns Observable emitting the query result.
   * @memberof OverpassClient
   */
  public getElementsByBoundingBox(
    tags: Record<string, string[]>,
    bbox: [number, number, number, number],
    elements: ElementType[] = ['node', 'way', 'relation'],
    outputFormat: string = 'out center;'
  ): Observable<OverpassResult<F>> {
    const [minLat, minLon, maxLat, maxLon] = bbox;
    const union = this.buildUnion(
      tags,
      elements,
      (element, tagFilter) => `${element}${tagFilter}(${minLat},${minLon},${maxLat},${maxLon});`
    );
    return this.query(`${union} ${outputFormat}`);
  }

  /**
   * Fetches elements with specified tags within a given radius from a point.
   * @param tags - A dictionary of tag types and their possible values. Example: { amenity: ['cafe', 'restaurant'], tourism: ['museum'] }
   * @param lat - Latitude of the center point.
   * @param lon - Longitude of the center point.
   * @param radius - Search radius in meters.
   * @param elements - List of element types to include in the query (node, way, relation). Defaults to all elements.
   * @param outputFormat - The Overpass QL output format (default: 'out center;').
   * @returns Observable emitting the query result.
   * @memberof OverpassClient
   */
  public getElementsByRadius(
    tags: Record<string, string[]>,
    lat: number,
    lon: number,
    radius: number,
    elements: ElementType[] = ['node', 'way', 'relation'],
    outputFormat: string = 'out center;'
  ): Observable<OverpassResult<F>> {
    const union = this.buildUnion(
      tags,
      elements,
      (element, tagFilter) => `${element}(around:${radius},${lat},${lon})${tagFilter};`
    );
    return this.query(`${union} ${outputFormat}`);
  }

  /**
   * Builds one union of a statement per element type and tag value. It must be a single union,
   * because each top-level statement overwrites the default set that `out` prints.
   * @memberof OverpassClient
   */
  private buildUnion(
    tags: Record<string, string[]>,
    elements: ElementType[],
    statement: (element: ElementType, tagFilter: string) => string
  ): string {
    const statements = Object.entries(tags).flatMap(([tag, values]) =>
      values.flatMap((value) =>
        elements.map((element) => statement(element, `["${escapeQL(tag)}"="${escapeQL(value)}"]`))
      )
    );
    return `(${statements.join(' ')});`;
  }

  /**
   * Whether a failed request is worth retrying: rate limits, server errors, and network failures.
   * @memberof OverpassClient
   */
  private isRetryable(error: unknown): boolean {
    if (!axios.isAxiosError(error) || axios.isCancel(error)) {
      return false;
    }
    return error.response ? RETRYABLE_STATUSES.has(error.response.status) : true;
  }

  /**
   * Executes an Overpass QL query with automatic retries using RxJS Observables.
   * The cache is checked on subscription, keyed by the endpoint and the full query, and
   * identical queries made while one is already running share its HTTP request.
   * @param query - The Overpass QL query string.
   * @returns Observable emitting the query result.
   * @memberof OverpassClient
   */
  private query(query: string): Observable<OverpassResult<F>> {
    const timeoutEnabled = this.timeout !== 0 ? `[timeout:${this.timeout}]` : '';
    const fullQuery = `[out:${this.format}]${timeoutEnabled};${query}`;
    const cacheKey = `${this.endpoint}|${fullQuery}`;
    const request$ = defer(() =>
      this.axiosInstance
        .post<OverpassResult<F>, AxiosResponse<OverpassResult<F>>, string>('', `data=${encodeURIComponent(fullQuery)}`)
        .then((response) => response.data)
    );
    return defer(() => {
      const cached = this.lruCache.get(cacheKey);
      if (cached) {
        return of(cached).pipe(delay(200));
      }
      const running$ = this.inFlight.get(cacheKey);
      if (running$) {
        return running$;
      }
      const shared$: Observable<OverpassResult<F>> = request$.pipe(
        retry({
          count: this.maxRetries,
          delay: (error, attempt) =>
            this.isRetryable(error) ? this.retryDelay(error, attempt, query) : throwError(() => error),
        }),
        catchError((error) => throwError(() => this.toOverpassError(error, query))),
        tap((data) => {
          // Responses with a remark (e.g. a runtime timeout) may be partial, so they are not cached.
          if (!hasRemark(data)) {
            this.lruCache.set(cacheKey, data);
          }
        }),
        finalize(() => {
          if (this.inFlight.get(cacheKey) === shared$) {
            this.inFlight.delete(cacheKey);
          }
        }),
        // Stay connected when every subscriber leaves: the HTTP request can't be aborted anyway, and
        // disconnecting would let the next subscriber send a duplicate request or skip a 429 wait.
        share({ resetOnRefCountZero: false })
      );
      this.inFlight.set(cacheKey, shared$);
      return shared$;
    });
  }

  /**
   * Calculates the retry delay using exponential backoff with jitter.
   * For 429 responses, waits for the `Retry-After` header if present, but never less than 30 seconds,
   * and fails instead if the header asks for more than 5 minutes.
   * @memberof OverpassClient
   */
  private retryDelay(error: unknown, attempt: number, query: string): Observable<number> {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const requestedMs = parseRetryAfter(error.response.headers?.['retry-after']);
      if (requestedMs !== null && requestedMs > RETRY_AFTER_MAX_MS) {
        const message =
          `Rate limited: server asked to retry in ${Math.ceil(requestedMs / 1000)} seconds, ` +
          `longer than the ${RETRY_AFTER_MAX_MS / 1000} second maximum`;
        return throwError(() => new OverpassError(message, undefined, query, error));
      }
      const retryAfterMs = Math.max(requestedMs ?? 0, RATE_LIMIT_MIN_DELAY_MS);
      this.logger.warn(`Overpass API rate limit reached! Retrying in ${retryAfterMs / 1000} seconds...`);
      return timer(retryAfterMs);
    }
    const baseDelay = Math.pow(2, attempt) * 1000;
    const retryAfter = Math.random() * baseDelay; // Exponential backoff with jitter
    this.logger.warn(`Transient error encountered. Retrying in ${retryAfter / 1000} seconds...`);
    return timer(retryAfter);
  }

  /**
   * Converts any request error into an `OverpassError`, keeping the original as `cause`.
   * @memberof OverpassClient
   */
  private toOverpassError(error: unknown, query: string): OverpassError {
    if (error instanceof OverpassError) {
      return error;
    }
    if (!axios.isAxiosError(error)) {
      return new OverpassError('Unknown error occurred', undefined, query, error);
    }
    const response = error.response;
    if (this.isRetryable(error)) {
      const reason = response ? `[${response.status}] ${response.statusText || ''}`.trim() : error.message;
      return new OverpassError(`Max retries exceeded. Request failed: ${reason}`, undefined, query, error);
    }
    if (!response) {
      return new OverpassError(`Request failed: ${error.message}`, undefined, query, error);
    }
    if (response.status === 400) {
      const errors =
        typeof response.data === 'string'
          ? Array.from(response.data.matchAll(/<\/strong>: ([^<]+) <\/p>/g), (match) =>
              match[1].replace(/&quot;/g, '"')
            )
          : [];
      return new OverpassError('Bad Request Error', errors, query, error);
    }
    return new OverpassError(
      `[${response.status}] - ${response.statusText || 'Unknown error occurred'}`,
      undefined,
      query,
      error
    );
  }
}
