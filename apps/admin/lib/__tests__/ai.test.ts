import { describe, expect, it } from 'vitest';
import { isValidStagedEndpoint } from '../ai';

describe('isValidStagedEndpoint', () => {
  it('accepts a bare /api/v1/... relative path', () => {
    expect(isValidStagedEndpoint('/api/v1/expenses')).toBe(true);
    expect(isValidStagedEndpoint('/api/v1/journal-entries/abc-123/reverse')).toBe(true);
  });

  it('rejects an absolute URL to another host (SSRF)', () => {
    expect(isValidStagedEndpoint('https://evil.example.com/api/v1/expenses')).toBe(false);
    expect(isValidStagedEndpoint('//evil.example.com/api/v1/expenses')).toBe(false);
  });

  it('rejects a path outside /api/v1', () => {
    expect(isValidStagedEndpoint('/api/v2/expenses')).toBe(false);
    expect(isValidStagedEndpoint('/admin/secret')).toBe(false);
  });

  it('rejects a path carrying a query string or fragment', () => {
    expect(isValidStagedEndpoint('/api/v1/expenses?foo=bar')).toBe(false);
    expect(isValidStagedEndpoint('/api/v1/expenses#frag')).toBe(false);
  });
});
