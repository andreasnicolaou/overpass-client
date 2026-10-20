import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { Observable, firstValueFrom, lastValueFrom } from 'rxjs';
import { take, tap } from 'rxjs/operators';
import { OverpassClient, OverpassError, type OverpassResponse } from './index';

describe('OverpassClient', () => {
  let axiosMockAdapter!: MockAdapter;
  let overpassClient!: OverpassClient;

  beforeEach(() => {
    axiosMockAdapter = new MockAdapter(axios);
    overpassClient = new OverpassClient('http://test-overpass-api', 'json', 60, 2);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    jest.spyOn(console, 'warn').mockImplementation(() => {}); // Disable console warnings
    jest.spyOn(Math, 'random').mockReturnValue(0); // Zero backoff jitter so retries are immediate
  });

  /** The decoded Overpass QL query sent in the n-th POST request. */
  const sentQuery = (index = 0): string | null =>
    new URLSearchParams(axiosMockAdapter.history.post[index].data).get('data');

  afterEach(() => {
    jest.useRealTimers();
    axiosMockAdapter.reset();
    jest.restoreAllMocks();
  });

  test('should successfully fetch a node', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').reply(200, mockData);
    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle API failure and retry', (done: jest.DoneCallback) => {
    axiosMockAdapter.onPost('').reply(500);
    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: () => done.fail(new Error('Expected an error, but got success')),
        error: (err) => {
          expect(err).toBeDefined();
          expect(err.message).toContain('Max retries exceeded');
          done();
        },
      });
  });

  test('should fetch cafe amenities by bounding box', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 1, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'cafe' } }] };
    axiosMockAdapter.onPost('').reply(200, mockData);
    overpassClient
      .getElementsByBoundingBox({ amenity: ['cafe'] }, [48.85, 2.29, 48.87, 2.35])
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should fetch restaurant amenities by radius', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 2, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'restaurant' } }] };
    axiosMockAdapter.onPost('').reply(200, mockData);
    overpassClient
      .getElementsByRadius({ amenity: ['restaurant'] }, 48.85, 2.35, 500)
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should successfully fetch a way', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 456, type: 'way', nodes: [1, 2, 3] }] };
    axiosMockAdapter.onPost('').reply(200, mockData);
    overpassClient
      .getElement('way', 456)
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle invalid query format (400)', (done: jest.DoneCallback) => {
    axiosMockAdapter.onPost('').reply(400, { error: 'Bad query format' });
    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: () => done.fail(new Error('Expected an error, but got success')),
        error: (err) => {
          expect(err).toBeDefined();
          expect(err.message).toContain('Overpass Error');
          done();
        },
      });
  });

  test('should not retry on success', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    const spy = jest.fn();
    axiosMockAdapter.onPost('').reply(200, mockData);
    overpassClient
      .getElement('node', 123)
      .pipe(take(1), tap(spy))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          expect(spy).toHaveBeenCalledTimes(1);
          done();
        },
        error: done.fail,
      });
  });

  test('should wait at least 30 seconds before retrying a 429 without Retry-After', async () => {
    jest.useFakeTimers();
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').replyOnce(429);
    axiosMockAdapter.onPost('').reply(200, mockData);

    const result = lastValueFrom(overpassClient.getElement('node', 123));
    await jest.advanceTimersByTimeAsync(29_999);
    expect(axiosMockAdapter.history.post).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual(mockData);
    expect(axiosMockAdapter.history.post).toHaveLength(2);
  });

  test('should return cached data for repeated requests', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').reply(200, mockData);
    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: () => {
          overpassClient
            .getElement('node', 123)
            .pipe(take(1))
            .subscribe({
              next: (cachedData) => {
                expect(cachedData).toEqual(mockData);
                done();
              },
              error: done.fail,
            });
        },
        error: done.fail,
      });
  });

  test('should clear cache', () => {
    // First make a request to populate cache
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient.getElement('node', 123).pipe(take(1)).subscribe();

    // Clear the cache
    overpassClient.clearCache();

    // Verify cache is cleared by checking the internal state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((overpassClient as any).lruCache.size).toBe(0);
  });

  test('should return cached data for repeated bounding box requests', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 1, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'cafe' } }] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElementsByBoundingBox({ amenity: ['cafe'] }, [48.85, 2.29, 48.87, 2.35])
      .pipe(take(1))
      .subscribe({
        next: () => {
          // Second request should hit cache
          overpassClient
            .getElementsByBoundingBox({ amenity: ['cafe'] }, [48.85, 2.29, 48.87, 2.35])
            .pipe(take(1))
            .subscribe({
              next: (cachedData) => {
                expect(cachedData).toEqual(mockData);
                done();
              },
              error: done.fail,
            });
        },
        error: done.fail,
      });
  });

  test('should return cached data for repeated radius requests', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 2, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'restaurant' } }] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElementsByRadius({ amenity: ['restaurant'] }, 48.85, 2.35, 500)
      .pipe(take(1))
      .subscribe({
        next: () => {
          // Second request should hit cache
          overpassClient
            .getElementsByRadius({ amenity: ['restaurant'] }, 48.85, 2.35, 500)
            .pipe(take(1))
            .subscribe({
              next: (cachedData) => {
                expect(cachedData).toEqual(mockData);
                done();
              },
              error: done.fail,
            });
        },
        error: done.fail,
      });
  });

  test('should handle 503 Service Unavailable errors with retry', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').replyOnce(503);
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle 504 Gateway Timeout errors with retry', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').replyOnce(504);
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle unknown HTTP status codes', (done: jest.DoneCallback) => {
    axiosMockAdapter.onPost('').reply(418, 'I am a teapot', { status: 418, statusText: 'I am a teapot' });

    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: () => done.fail(new Error('Expected an error, but got success')),
        error: (err) => {
          expect(err).toBeDefined();
          expect(err.message).toContain('[418]');
          expect(err.message).toContain('Unknown error occurred');
          done();
        },
      });
  });

  test('should handle network errors without response', (done: jest.DoneCallback) => {
    axiosMockAdapter.onPost('').networkError();

    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: () => done.fail(new Error('Expected an error, but got success')),
        error: (err) => {
          expect(err).toBeDefined();
          expect(err.message).toContain('Max retries exceeded');
          expect(err.message).toContain('Network Error');
          expect(axiosMockAdapter.history.post).toHaveLength(3);
          done();
        },
      });
  });

  test('should handle 400 errors with detailed error parsing', (done: jest.DoneCallback) => {
    const errorHtml = '<p><strong>Error</strong>: Invalid syntax &quot;test&quot; </p>';
    axiosMockAdapter.onPost('').reply(400, errorHtml);

    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: () => done.fail(new Error('Expected an error, but got success')),
        error: (err) => {
          expect(err).toBeDefined();
          expect(err.message).toContain('Bad Request Error');
          expect(err.message).toContain('Invalid syntax "test"');
          done();
        },
      });
  });

  test('should raise a short Retry-After on a 429 to the 30 second minimum', async () => {
    jest.useFakeTimers();
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').replyOnce(429, '', { 'retry-after': '1' });
    axiosMockAdapter.onPost('').reply(200, mockData);
    const consoleWarnSpy = jest.spyOn(console, 'warn');

    const result = lastValueFrom(overpassClient.getElement('node', 123));
    await jest.advanceTimersByTimeAsync(30_000);

    await expect(result).resolves.toEqual(mockData);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('rate limit reached! Retrying in 30 seconds'));
  });

  test('should honour a Retry-After longer than 30 seconds', async () => {
    jest.useFakeTimers();
    const mockData = { elements: [] };
    axiosMockAdapter.onPost('').replyOnce(429, '', { 'retry-after': '45' });
    axiosMockAdapter.onPost('').reply(200, mockData);

    const result = lastValueFrom(overpassClient.getElement('node', 123));
    await jest.advanceTimersByTimeAsync(44_999);
    expect(axiosMockAdapter.history.post).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual(mockData);
  });

  test('should handle relation element type', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 789, type: 'relation', members: [] }] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElement('relation', 789)
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle multiple element types in bounding box query', (done: jest.DoneCallback) => {
    const mockData = {
      elements: [
        { id: 1, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'cafe' } },
        { id: 2, type: 'way', nodes: [1, 2, 3], tags: { amenity: 'cafe' } },
      ],
    };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElementsByBoundingBox({ amenity: ['cafe'] }, [48.85, 2.29, 48.87, 2.35], ['node', 'way'])
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle multiple element types in radius query', (done: jest.DoneCallback) => {
    const mockData = {
      elements: [
        { id: 1, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'restaurant' } },
        { id: 2, type: 'way', nodes: [1, 2, 3], tags: { amenity: 'restaurant' } },
      ],
    };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElementsByRadius({ amenity: ['restaurant'] }, 48.85, 2.35, 500, ['node', 'way'])
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle custom output format', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElement('node', 123, 'out geom;')
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle bounding box query with custom output format', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 1, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'cafe' } }] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElementsByBoundingBox({ amenity: ['cafe'] }, [48.85, 2.29, 48.87, 2.35], ['node'], 'out meta;')
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should handle radius query with custom output format', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 2, type: 'node', lat: 48.85, lon: 2.35, tags: { amenity: 'restaurant' } }] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    overpassClient
      .getElementsByRadius({ amenity: ['restaurant'] }, 48.85, 2.35, 500, ['node'], 'out meta;')
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          done();
        },
        error: done.fail,
      });
  });

  test('should combine all tags and element types into a single union for bounding box queries', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });

    await firstValueFrom(
      overpassClient.getElementsByBoundingBox({ amenity: ['cafe', 'bar'] }, [1, 2, 3, 4], ['node', 'way'])
    );

    expect(sentQuery()).toBe(
      '[out:json][timeout:60];(node["amenity"="cafe"](1,2,3,4); way["amenity"="cafe"](1,2,3,4); ' +
        'node["amenity"="bar"](1,2,3,4); way["amenity"="bar"](1,2,3,4);); out center;'
    );
  });

  test('should combine all tags into a single union for radius queries', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });

    await firstValueFrom(
      overpassClient.getElementsByRadius({ amenity: ['cafe'], tourism: ['museum'] }, 48.85, 2.35, 500, ['node'])
    );

    expect(sentQuery()).toBe(
      '[out:json][timeout:60];(node(around:500,48.85,2.35)["amenity"="cafe"]; ' +
        'node(around:500,48.85,2.35)["tourism"="museum"];); out center;'
    );
  });

  test('should escape quotes and backslashes in tag keys and values', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });

    await firstValueFrom(overpassClient.getElementsByRadius({ 'na"me': ['Joe"s \\ Bar'] }, 1, 2, 3, ['node']));

    expect(sentQuery()).toContain('["na\\"me"="Joe\\"s \\\\ Bar"]');
  });

  test('should not share cache entries between different output formats', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });

    await firstValueFrom(overpassClient.getElement('node', 1, 'out;'));
    await firstValueFrom(overpassClient.getElement('node', 1, 'out meta;'));

    expect(axiosMockAdapter.history.post).toHaveLength(2);
  });

  test('should not share cache entries between clients with different endpoints', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedCache = (overpassClient as any).lruCache;
    const otherClient = new OverpassClient('http://other-overpass-api', 'json', 60, 2, sharedCache);

    await firstValueFrom(overpassClient.getElement('node', 1));
    await firstValueFrom(otherClient.getElement('node', 1));

    expect(axiosMockAdapter.history.post).toHaveLength(2);
  });

  test('should check the cache when subscribed, not when created', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });
    const later$ = overpassClient.getElement('node', 1);

    await firstValueFrom(overpassClient.getElement('node', 1));
    await firstValueFrom(later$);

    expect(axiosMockAdapter.history.post).toHaveLength(1);
  });

  test('should not cache responses with a remark', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [], remark: 'runtime error: Query timed out' });

    await firstValueFrom(overpassClient.getElement('node', 1));
    await firstValueFrom(overpassClient.getElement('node', 1));

    expect(axiosMockAdapter.history.post).toHaveLength(2);
  });

  test('should retry exactly maxRetries times before failing', async () => {
    axiosMockAdapter.onPost('').reply(500);

    const error = await lastValueFrom(overpassClient.getElement('node', 1)).catch((err) => err);

    expect(error).toBeInstanceOf(OverpassError);
    expect(error.message).toContain('Max retries exceeded');
    expect(error.message).toContain('[500]');
    expect(axiosMockAdapter.history.post).toHaveLength(3); // initial attempt + 2 retries
  });

  test('should emit an OverpassError when retries are disabled', async () => {
    axiosMockAdapter.onPost('').reply(500);
    const client = new OverpassClient('http://test-overpass-api', 'json', 60, 0);

    const error = await lastValueFrom(client.getElement('node', 1)).catch((err) => err);

    expect(error).toBeInstanceOf(OverpassError);
    expect(axiosMockAdapter.history.post).toHaveLength(1);
  });

  test('should report 400 details without retrying, regardless of maxRetries', async () => {
    axiosMockAdapter.onPost('').reply(400, '<p><strong>Error</strong>: bad syntax </p>');
    const client = new OverpassClient('http://test-overpass-api', 'json', 60, 1);

    const error = await lastValueFrom(client.getElement('node', 1)).catch((err) => err);

    expect(error.message).toContain('Bad Request Error');
    expect(error.message).toContain('bad syntax');
    expect(axiosMockAdapter.history.post).toHaveLength(1);
  });

  test('should retry network errors', async () => {
    const mockData = { elements: [] };
    axiosMockAdapter.onPost('').networkErrorOnce();
    axiosMockAdapter.onPost('').reply(200, mockData);

    await expect(lastValueFrom(overpassClient.getElement('node', 1))).resolves.toEqual(mockData);
    expect(axiosMockAdapter.history.post).toHaveLength(2);
  });

  test('should honour a Retry-After header given as an HTTP date', async () => {
    jest.useFakeTimers();
    const mockData = { elements: [] };
    const retryAt = new Date(Date.now() + 60_000).toUTCString(); // second precision, so ~59-60s away
    axiosMockAdapter.onPost('').replyOnce(429, '', { 'retry-after': retryAt });
    axiosMockAdapter.onPost('').reply(200, mockData);

    const result = lastValueFrom(overpassClient.getElement('node', 1));
    await jest.advanceTimersByTimeAsync(58_000);
    expect(axiosMockAdapter.history.post).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toEqual(mockData);
  });

  test('should attach the original error as the cause', async () => {
    axiosMockAdapter.onPost('').reply(418);

    const error = await lastValueFrom(overpassClient.getElement('node', 1)).catch((err) => err);

    expect(error).toBeInstanceOf(OverpassError);
    expect(axios.isAxiosError(error.cause)).toBe(true);
    expect(error.message).toContain('node(1); out;');
  });

  test('should set a client-side timeout derived from the query timeout', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeoutOf = (client: OverpassClient): number => (client as any).axiosInstance.defaults.timeout;

    expect(timeoutOf(overpassClient)).toBe(90_000);
    expect(timeoutOf(new OverpassClient('http://test-overpass-api', 'json', 0))).toBe(0);
  });

  test('should send an identifying User-Agent outside browsers', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });
    const client = new OverpassClient('http://test-overpass-api', 'json', 60, 2, undefined, 'my-app/1.0');

    await firstValueFrom(overpassClient.getElement('node', 1));
    await firstValueFrom(client.getElement('node', 2));

    expect(axiosMockAdapter.history.post[0].headers?.['User-Agent']).toContain('@andreasnicolaou/overpass-client');
    expect(axiosMockAdapter.history.post[1].headers?.['User-Agent']).toBe('my-app/1.0');
  });

  test('should not set User-Agent in browsers', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {};
    try {
      await jest.isolateModulesAsync(async () => {
        // Isolated modules get their own axios, so it needs its own mock
        const { default: isolatedAxios } = await import('axios');
        const isolatedMock = new MockAdapter(isolatedAxios);
        isolatedMock.onPost('').reply(200, { elements: [] });
        const { OverpassClient: BrowserClient } = await import('./client');
        const client = new BrowserClient('http://test-overpass-api');

        await firstValueFrom(client.getElement('node', 1));

        expect(isolatedMock.history.post[0].headers?.['User-Agent']).toBeUndefined();
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window;
    }
  });

  test('should share one HTTP request between identical concurrent queries', async () => {
    const mockData = { elements: [] };
    axiosMockAdapter.onPost('').reply(200, mockData);

    const results = await Promise.all([
      lastValueFrom(overpassClient.getElement('node', 1)),
      lastValueFrom(overpassClient.getElement('node', 1)),
      lastValueFrom(overpassClient.getElement('node', 2)),
    ]);

    expect(results).toEqual([mockData, mockData, mockData]);
    expect(axiosMockAdapter.history.post).toHaveLength(2); // node 1 once, node 2 once
  });

  test('should share a failure between concurrent queries, then send a fresh request', async () => {
    axiosMockAdapter.onPost('').replyOnce(400);
    axiosMockAdapter.onPost('').reply(200, { elements: [] });

    const errors = await Promise.all([
      lastValueFrom(overpassClient.getElement('node', 1)).catch((err) => err),
      lastValueFrom(overpassClient.getElement('node', 1)).catch((err) => err),
    ]);
    const retried = await lastValueFrom(overpassClient.getElement('node', 1));

    expect(errors[0]).toBeInstanceOf(OverpassError);
    expect(errors[1]).toBe(errors[0]);
    expect(retried).toEqual({ elements: [] });
    expect(axiosMockAdapter.history.post).toHaveLength(2);
  });

  test('should emit raw XML in xml format and cache it', async () => {
    const xml = '<?xml version="1.0"?><osm><node id="1" lat="1" lon="2"/></osm>';
    axiosMockAdapter.onPost('').reply(200, xml);
    const client = new OverpassClient('http://test-overpass-api', 'xml');

    const first = await lastValueFrom(client.getElement('node', 1));
    const second = await lastValueFrom(client.getElement('node', 1));

    expect(first).toBe(xml);
    expect(second).toBe(xml);
    expect(sentQuery()).toMatch(/^\[out:xml\]/);
    expect(axiosMockAdapter.history.post).toHaveLength(1);
  });

  test('should not cache XML responses with a remark', async () => {
    const xml = '<osm><remark> runtime error: Query timed out in "query" at line 1 after 60 seconds. </remark></osm>';
    axiosMockAdapter.onPost('').reply(200, xml);
    const client = new OverpassClient('http://test-overpass-api', 'xml');

    await lastValueFrom(client.getElement('node', 1));
    await lastValueFrom(client.getElement('node', 1));

    expect(axiosMockAdapter.history.post).toHaveLength(2);
  });

  test('should type results by format', () => {
    // Compile-time only: checked by `tsc`, never run against the network
    const typeCheck = (): void => {
      const json: Observable<OverpassResponse> = new OverpassClient().getElement('node', 1);
      const xml: Observable<string> = new OverpassClient(undefined, 'xml').getElement('node', 1);
      // @ts-expect-error XML clients emit strings, not parsed responses
      const wrong: Observable<OverpassResponse> = new OverpassClient(undefined, 'xml').getElement('node', 1);
      void [json, xml, wrong];
    };
    expect(typeCheck).toBeInstanceOf(Function);
  });

  test('should fail instead of waiting when Retry-After exceeds 5 minutes', async () => {
    axiosMockAdapter.onPost('').replyOnce(429, '', { 'retry-after': '600' });
    axiosMockAdapter.onPost('').reply(200, { elements: [] });

    const error = await lastValueFrom(overpassClient.getElement('node', 1)).catch((err) => err);

    expect(error).toBeInstanceOf(OverpassError);
    expect(error.message).toContain('retry in 600 seconds, longer than the 300 second maximum');
    expect(axios.isAxiosError(error.cause)).toBe(true);
    expect(axiosMockAdapter.history.post).toHaveLength(1);
  });

  test('should accept an options object equivalent to positional arguments', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });
    const positional = new OverpassClient('http://test-overpass-api', 'xml', 25, 1, undefined, 'my-app/1.0');
    const options = new OverpassClient({
      endpoint: 'http://test-overpass-api',
      format: 'xml',
      timeout: 25,
      maxRetries: 1,
      userAgent: 'my-app/1.0',
    });

    await lastValueFrom(positional.getElement('node', 1));
    await lastValueFrom(options.getElement('node', 2));

    const [first, second] = axiosMockAdapter.history.post;
    expect(sentQuery(0)).toBe('[out:xml][timeout:25];node(1); out;');
    expect(sentQuery(1)).toBe('[out:xml][timeout:25];node(2); out;');
    expect(second.headers?.['User-Agent']).toBe(first.headers?.['User-Agent']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((options as any).maxRetries).toBe(1);
  });

  test('should use defaults for options left out', async () => {
    axiosMockAdapter.onPost('').reply(200, { elements: [] });

    await lastValueFrom(new OverpassClient({}).getElement('node', 1));

    expect(axiosMockAdapter.history.post[0].baseURL).toBe('https://overpass-api.de/api/interpreter');
    expect(sentQuery()).toBe('[out:json][timeout:60];node(1); out;');
  });

  test('should send retry notices to a custom logger', async () => {
    const logger = { warn: jest.fn() };
    const consoleWarnSpy = jest.spyOn(console, 'warn');
    axiosMockAdapter.onPost('').replyOnce(500);
    axiosMockAdapter.onPost('').reply(200, { elements: [] });
    const client = new OverpassClient({ endpoint: 'http://test-overpass-api', logger });

    await lastValueFrom(client.getElement('node', 1));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Transient error encountered'));
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('should infer the result type from the format option', () => {
    // Compile-time only: checked by `tsc`, never run against the network
    const typeCheck = (): void => {
      const json: Observable<OverpassResponse> = new OverpassClient({}).getElement('node', 1);
      const xml: Observable<string> = new OverpassClient({ format: 'xml' }).getElement('node', 1);
      // @ts-expect-error XML clients emit strings, not parsed responses
      const wrong: Observable<OverpassResponse> = new OverpassClient({ format: 'xml' }).getElement('node', 1);
      void [json, xml, wrong];
    };
    expect(typeCheck).toBeInstanceOf(Function);
  });
});
