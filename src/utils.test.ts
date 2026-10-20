import { escapeQL, hasRemark, parseRetryAfter } from './utils';

describe('escapeQL', () => {
  test('should escape double quotes and backslashes', () => {
    expect(escapeQL('Joe"s \\ Bar')).toBe('Joe\\"s \\\\ Bar');
  });

  test('should escape backslashes before quotes so escapes are not doubled', () => {
    expect(escapeQL('\\"')).toBe('\\\\\\"');
  });

  test('should leave other characters, including unicode, untouched', () => {
    expect(escapeQL("Café 'Ü' : -")).toBe("Café 'Ü' : -");
  });
});

describe('parseRetryAfter', () => {
  test('should parse delay-seconds', () => {
    expect(parseRetryAfter('45')).toBe(45_000);
    expect(parseRetryAfter(' 2 ')).toBe(2_000);
    expect(parseRetryAfter(0)).toBe(0);
  });

  test('should parse an HTTP date relative to now', () => {
    jest.useFakeTimers({ now: new Date('2026-10-21T12:00:00Z') });
    try {
      expect(parseRetryAfter('Wed, 21 Oct 2026 12:01:00 GMT')).toBe(60_000);
      expect(parseRetryAfter('Wed, 21 Oct 2026 11:59:00 GMT')).toBe(0); // past dates mean "now"
    } finally {
      jest.useRealTimers();
    }
  });

  test('should clamp negative delays to zero', () => {
    expect(parseRetryAfter('-5')).toBe(0);
  });

  test('should return null for missing or invalid headers', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('hasRemark', () => {
  test('should detect a remark in JSON responses', () => {
    expect(hasRemark({ elements: [], remark: 'runtime error: Query timed out' })).toBe(true);
    expect(hasRemark({ elements: [] })).toBe(false);
    expect(hasRemark({ elements: [], remark: '' })).toBe(false);
  });

  test('should detect a remark in XML responses', () => {
    expect(hasRemark('<osm><remark> runtime error: Query timed out </remark></osm>')).toBe(true);
    expect(hasRemark('<osm><node id="1"/></osm>')).toBe(false);
  });

  test('should treat empty responses as having no remark', () => {
    expect(hasRemark(undefined)).toBe(false);
    expect(hasRemark(null)).toBe(false);
  });
});
