import crypto from 'crypto';

// RFC 4226 (HOTP) + RFC 6238 (TOTP) implementation for E2E test use only -- generates a real,
// valid 6-digit code from the base32 secret Supabase's MFA enroll endpoint returns, so the
// Playwright suite can complete a real enrollment/login round trip rather than stubbing MFA out.
// Correctness matters here (a wrong implementation would make every MFA test either always fail
// or, worse, coincidentally pass) -- verified against RFC 4226 Appendix D's own published test
// vectors in e2e/fixtures/__tests__/totp.test.ts before this was trusted in any real E2E test.

function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val === -1) throw new Error(`Invalid base32 character: ${char}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** ASCII-secret variant (RFC 4226's own test vectors use a raw ASCII secret, not base32). */
export function hotpFromAsciiSecret(asciiSecret: string, counter: number): string {
  return hotp(Buffer.from(asciiSecret, 'ascii'), counter);
}

/** TOTP from a base32 secret (what Supabase's mfa.enroll() returns) at the current time. */
export function generateTotpCode(base32Secret: string, stepSeconds = 30, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter);
}
