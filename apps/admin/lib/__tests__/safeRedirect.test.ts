import { describe, expect, it } from 'vitest';
import { isSafeNextPath, safeNextPathOr } from '../safeRedirect';

// Real open-redirect gap found and fixed (WORKLOG.md this date): auth/callback/route.ts built
// `new URL(next, origin)` with no validation at all -- an absolute-URL `next` overrides `origin`
// entirely in that constructor. These pin every bypass shape found during that audit.

describe('isSafeNextPath', () => {
  it('accepts an ordinary root-relative path', () => {
    expect(isSafeNextPath('/dashboard')).toBe(true);
    expect(isSafeNextPath('/invitations/accept?token=abc123')).toBe(true);
    expect(isSafeNextPath('/')).toBe(true);
  });

  it('rejects an absolute external URL', () => {
    expect(isSafeNextPath('https://evil.example')).toBe(false);
    expect(isSafeNextPath('http://evil.example/phish')).toBe(false);
  });

  it('rejects a protocol-relative URL (the //evil.example bypass)', () => {
    expect(isSafeNextPath('//evil.example')).toBe(false);
  });

  it('rejects the backslash variant browsers may still resolve as protocol-relative', () => {
    expect(isSafeNextPath('/\\evil.example')).toBe(false);
  });

  it('rejects a path that embeds a scheme past the leading slash', () => {
    expect(isSafeNextPath('/redirect?to=https://evil.example')).toBe(false);
  });

  it('rejects a path with no leading slash', () => {
    expect(isSafeNextPath('dashboard')).toBe(false);
  });

  it('rejects null, undefined, and empty string', () => {
    expect(isSafeNextPath(null)).toBe(false);
    expect(isSafeNextPath(undefined)).toBe(false);
    expect(isSafeNextPath('')).toBe(false);
  });
});

describe('safeNextPathOr', () => {
  it('returns the value unchanged when safe', () => {
    expect(safeNextPathOr('/dashboard')).toBe('/dashboard');
  });

  it('falls back to "/" by default when unsafe', () => {
    expect(safeNextPathOr('https://evil.example')).toBe('/');
  });

  it('falls back to a caller-supplied default when unsafe', () => {
    expect(safeNextPathOr('//evil.example', '/onboarding/create-organization')).toBe(
      '/onboarding/create-organization',
    );
  });
});
