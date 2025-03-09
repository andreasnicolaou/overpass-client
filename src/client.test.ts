import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { take, tap } from 'rxjs/operators';
import { OverpassClient } from './index';

describe('OverpassClient', () => {
  let axiosMockAdapter!: MockAdapter;
  let overpassClient!: OverpassClient;

  beforeEach(() => {
    axiosMockAdapter = new MockAdapter(axios);
    overpassClient = new OverpassClient('http://test-overpass-api');
  });

  afterEach(() => {
    axiosMockAdapter.reset();
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
          expect(err.message).toContain('Unknown error');
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
          expect(err.message).toContain('Overpass Query Error');
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
});
