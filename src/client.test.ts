import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { take, tap } from 'rxjs/operators';
import { OverpassClient } from './index';

describe('OverpassClient', () => {
  let axiosMockAdapter!: MockAdapter;
  let overpassClient!: OverpassClient;

  beforeEach(() => {
    axiosMockAdapter = new MockAdapter(axios);
    overpassClient = new OverpassClient('http://test-overpass-api', 'json', 60, 2);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    jest.spyOn(console, 'warn').mockImplementation(() => {}); // Disable console warnings
  });

  afterEach(() => {
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

  test('should retry on failure with exponential backoff', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    const spy = jest.fn();
    axiosMockAdapter.onPost('').replyOnce(429);
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
          expect(err.message).toContain('Unknown error occured');
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
          expect(err.message).toContain('Something went wrong');
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

  test('should handle 429 Rate Limit with retry-after header', (done: jest.DoneCallback) => {
    const mockData = { elements: [{ id: 123, type: 'node', lat: 48.85, lon: 2.35 }] };
    axiosMockAdapter.onPost('').replyOnce(429, '', { 'retry-after': '1' });
    axiosMockAdapter.onPost('').reply(200, mockData);

    const consoleWarnSpy = jest.spyOn(console, 'warn');

    overpassClient
      .getElement('node', 123)
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          expect(data).toEqual(mockData);
          expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('rate limit reached'));
          done();
        },
        error: done.fail,
      });
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
});
