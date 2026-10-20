import type { LRUCache } from 'lru-cache';

export type ElementType = 'node' | 'way' | 'relation';

export type OverpassFormat = 'json' | 'xml';

export type OverpassNode = {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  /** Omitted by Overpass for untagged elements. */
  tags?: Record<string, string>;
};

export type OverpassWay = {
  type: 'way';
  id: number;
  /** Only present when queried with `out center`. */
  center?: {
    lat: number;
    lon: number;
  };
  nodes: number[];
  /** Omitted by Overpass for untagged elements. */
  tags?: Record<string, string>;
};

export type OverpassRelation = {
  type: 'relation';
  id: number;
  /** Only present when queried with `out center`. */
  center?: {
    lat: number;
    lon: number;
  };
  members: { type: ElementType; ref: number; role: string }[];
  /** Omitted by Overpass for untagged elements. */
  tags?: Record<string, string>;
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
  /** Set by Overpass when the query hit a runtime error (e.g. timeout); `elements` may then be incomplete. */
  remark?: string;
};

/** What a query emits for each format: the parsed JSON response, or the raw XML document. */
export type OverpassResult<F extends OverpassFormat> = F extends 'xml' ? string : OverpassResponse;

/** Receives the client's retry notices. Pass `{ warn: () => {} }` to silence them. */
export type OverpassLogger = { warn: (message: string) => void };

export type OverpassClientOptions<F extends OverpassFormat = 'json'> = {
  /** The Overpass API endpoint to use (default: 'https://overpass-api.de/api/interpreter'). More info at https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances */
  endpoint?: string;
  /** The response format ('json' or 'xml', default: 'json'). With 'xml', queries emit the raw XML string. */
  format?: F;
  /** Query timeout in seconds (default: 60). The HTTP request is aborted 30 seconds after this. If set to `0`, no timeout is sent to Overpass and the HTTP request has no timeout. */
  timeout?: number;
  /** Number of automatic retries for failed requests, not counting the initial attempt (default: 3). */
  maxRetries?: number;
  /** An optional LRU cache instance for storing query results (default: 500 entries, 5 minute TTL). */
  lruCache?: LRUCache<string, OverpassResult<F>>;
  /** The `User-Agent` sent outside browsers, as the Overpass usage policy asks clients to identify themselves. Ideally names your app, e.g. 'my-app/1.0 (contact@example.com)'. */
  userAgent?: string;
  /** Receives retry notices (default: `console`). */
  logger?: OverpassLogger;
};
