import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Observable, defer, retry, delay, of, tap, throwError, timer } from 'rxjs';
import { LRUCache } from 'lru-cache';
import { OverpassError } from './errors';

const matchAll = (regex: RegExp, string: string): string[] => {
  let match: RegExpExecArray | null;
  const matches: string[] = [];
  while ((match = regex.exec(string))) {
    matches.push(match[1]);
  }
  return matches;
};

export type ElementType = 'node' | 'way' | 'relation';

export type OverpassNode = {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

export type OverpassWay = {
  type: 'way';
  id: number;
  center: {
    lat: number;
    lon: number;
  };
  nodes: number[];
  tags: Record<string, string>;
};

export type OverpassRelation = {
  type: 'relation';
  id: number;
  center: {
    lat: number;
    lon: number;
  };
  members: { type: ElementType; ref: number; role: string }[];
  tags: Record<string, string>;
};

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export type OverpassResponse = {
  generator: string;
  version: string;
  osm3s: {
    timestamp_osm_base: string;
    copyright: string;
  };
  elements: OverpassElement[];
};

/**
 * A client for querying the Overpass API, supporting caching, retries, and various query types.
 * @class OverpassClient
 * @author Andreas Nicolaou <anicolaou66@gmail.com>
 */
export class OverpassClient {
  private readonly axiosInstance!: AxiosInstance;
  private readonly endpoint!: string;
  private readonly format!: 'json' | 'xml';
  private readonly lruCache: LRUCache<string, OverpassResponse> = new LRUCache({
    max: 500,
    ttl: 5 * 60 * 1000, // 5 minutes
  });
  private readonly maxRetries!: number;
  private readonly timeout!: number;

  /**
   * Creates a new instance of the Overpass API client.
   * @param endpoint - The Overpass API endpoint to use (default: 'https://overpass-api.de/api/interpreter'). More info at https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
   * @param format - The response format ('json' or 'xml', default: 'json').
   * @param timeout - Query timeout in seconds (default: 60). If set to `0`, the timeout will not be included in the Overpass query.
   * @param maxRetries - Number of automatic retries for failed requests (default: 3).
   * @param lruCache - An optional LRU cache instance for storing query results.
   * @memberof OverpassClient
   */
  constructor(
    endpoint: string = 'https://overpass-api.de/api/interpreter',
    format: 'json' | 'xml' = 'json',
    timeout = 60,
    maxRetries: number = 3,
    lruCache?: LRUCache<string, OverpassResponse>
  ) {
    this.lruCache =
      lruCache ||
      new LRUCache({
        max: 500,
        ttl: 5 * 60 * 1000, // 5 minutes
      });
    this.endpoint = endpoint;
    this.maxRetries = maxRetries;
    this.format = format;
    this.timeout = timeout;

    this.axiosInstance = axios.create({
      baseURL: this.endpoint,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
   * @param outputFormat - The Overpass QL output format (default: 'out center;').
   * @returns Observable emitting the query result.
   * @memberof OverpassClient
   */
  public getElement(type: ElementType, id: number, outputFormat: string = 'out;'): Observable<OverpassResponse> {
    const key = `${type}-${id}`;
    const cached = this.lruCache.get(key);
    if (cached) {
      return of(cached).pipe(delay(200));
    }
    return this.query(`${type}(${id}); ${outputFormat}`, key);
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
  ): Observable<OverpassResponse> {
    const key = `bbox-${JSON.stringify(tags)}-${bbox.join('-')}-${elements.join('-')}`;
    const cached = this.lruCache.get(key);
    if (cached) {
      return of(cached).pipe(delay(200));
    }
    const [minLat, minLon, maxLat, maxLon] = bbox;
    const tagFilters = Object.entries(tags)
      .flatMap(([tag, values]) =>
        values.map((value) => {
          const elementsQuery = elements
            .map((element) => `${element}["${tag}"="${value}"](${minLat},${minLon},${maxLat},${maxLon});`)
            .join(' ');

          return `(${elementsQuery});`;
        })
      )
      .join(' ');
    return this.query(`${tagFilters} ${outputFormat}`, key);
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
  ): Observable<OverpassResponse> {
    const key = `radius-${JSON.stringify(tags)}-${lat}-${lon}-${radius}-${elements.join('-')}`;
    const cached = this.lruCache.get(key);
    if (cached) {
      return of(cached).pipe(delay(200));
    }
    const tagFilters = Object.entries(tags)
      .flatMap(([tag, values]) =>
        values.map((value) => {
          const elementsQuery = elements
            .map((element) => `${element}(around:${radius},${lat},${lon})["${tag}"="${value}"];`)
            .join(' ');

          return `(${elementsQuery});`;
        })
      )
      .join(' ');
    return this.query(`${tagFilters} ${outputFormat}`, key);
  }

  /**
   * Executes an Overpass QL query with automatic retries using RxJS Observables.
   * @param query - The Overpass QL query string.
   * @param cachedKey - The cache key for storing the query result.
   * @returns Observable emitting the query result.
   * @memberof OverpassClient
   */
  private query(query: string, cachedKey: string): Observable<OverpassResponse> {
    const timeoutEnabled = this.timeout !== 0 ? `[timeout:${this.timeout}]` : '';
    const fullQuery = `[out:${this.format}]${timeoutEnabled};${query}`;
    return defer(() =>
      this.axiosInstance
        .post<OverpassResponse, AxiosResponse<OverpassResponse>, string>('', `data=${encodeURIComponent(fullQuery)}`)
        .then((response) => response.data)
    ).pipe(
      tap((data) => this.lruCache.set(cachedKey, data)),
      retry({
        count: this.maxRetries,
        delay: (error, attempt) => {
          if (axios.isAxiosError(error)) {
            this.lruCache.delete(cachedKey);
            if (attempt >= this.maxRetries) {
              return throwError(
                () =>
                  new OverpassError(
                    `Max retries exceeded. Request failed ${error.response?.statusText ?? ''}`,
                    undefined,
                    query
                  )
              );
            }
            const response = error.response;
            if (response) {
              switch (response.status) {
                case 400: {
                  const errors = matchAll(/<\/strong>: ([^<]+) <\/p>/g, response.data).map((err) =>
                    err.replace(/&quot;/g, '"')
                  );
                  return throwError(() => new OverpassError(`Bad Request Error`, errors, query));
                }
                case 429: {
                  // Too Many Requests (Rate Limit)
                  const retryAfter = response.headers?.['retry-after']
                    ? parseInt(response.headers['retry-after'], 10) * 1000
                    : null;
                  return this.retryAfter(attempt, retryAfter);
                }
                case 500: // Internal Server Error
                case 502: // Bad Gateway
                case 503: // Service Unavailable
                case 504: {
                  return this.retryAfter(attempt);
                }
                default: {
                  const status = response.status ? `[${response.status}] - ` : '';
                  return throwError(
                    () => new OverpassError(`${status}${response.statusText ?? 'Unknown error occured'}`)
                  );
                }
              }
            } else {
              return throwError(() => new OverpassError('Something went wrong', undefined, query));
            }
          }
          // Non-retryable error: propagate immediately
          return throwError(() => new OverpassError('Unknown error occurred', undefined, query));
        },
      })
    );
  }

  /**
   * Calculates the retry delay using exponential backoff with jitter.
   * If a `retryAfterMs` value is provided (for 429 errors), it is used directly.
   * @param attempt
   * @param [retryAfterMs]
   * @returns after
   */
  private retryAfter(attempt: number, retryAfterMs: number | null = null): Observable<number> {
    if (retryAfterMs !== null) {
      console.warn(`Overpass API rate limit reached! Retrying in ${retryAfterMs / 1000} seconds...`);
      return timer(retryAfterMs);
    }
    const baseDelay = Math.pow(2, attempt) * 1000;
    const retryAfter = Math.random() * baseDelay; // Exponential backoff with jitter
    console.warn(`Transient error encountered. Retrying in ${retryAfter / 1000} seconds...`);
    return timer(retryAfter);
  }
}
