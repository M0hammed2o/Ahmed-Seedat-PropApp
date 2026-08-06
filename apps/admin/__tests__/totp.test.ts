import { describe, expect, it } from 'vitest';
import { hotpFromAsciiSecret, generateTotpCode } from '../e2e/fixtures/totp';

// RFC 4226 Appendix D's own published test vectors -- secret is the ASCII string
// "12345678901234567890", HMAC-SHA1, 6 digits. If this implementation didn't match these
// published values, every E2E MFA test built on top of it would be worthless (either always
// failing, or worse, silently exercising a broken code path that happens to produce SOME 6-digit
// string without actually validating TOTP correctness).
const RFC4226_SECRET = '12345678901234567890';
const RFC4226_VECTORS = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

describe('hotpFromAsciiSecret (RFC 4226 Appendix D test vectors)', () => {
  it.each(RFC4226_VECTORS.map((expected, counter) => [counter, expected] as const))(
    'counter %i produces %s',
    (counter, expected) => {
      expect(hotpFromAsciiSecret(RFC4226_SECRET, counter)).toBe(expected);
    },
  );
});

describe('generateTotpCode', () => {
  it('produces a 6-digit numeric string', () => {
    // RFC4226_SECRET happens to also be valid base32 characters only if restricted to A-Z2-7;
    // digits 0189 aren't in the base32 alphabet, so use a real base32 secret here instead.
    const code = generateTotpCode('JBSWY3DPEHPK3PXP');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('is deterministic for the same secret and timestamp', () => {
    const at = Date.now();
    expect(generateTotpCode('JBSWY3DPEHPK3PXP', 30, at)).toBe(generateTotpCode('JBSWY3DPEHPK3PXP', 30, at));
  });

  it('changes across a 30-second step boundary', () => {
    const at = Math.floor(Date.now() / 30000) * 30000; // align to a step boundary
    const codeA = generateTotpCode('JBSWY3DPEHPK3PXP', 30, at);
    const codeB = generateTotpCode('JBSWY3DPEHPK3PXP', 30, at + 30000);
    expect(codeA).not.toBe(codeB);
  });
});
