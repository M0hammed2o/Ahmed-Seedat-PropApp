// Inbound integration tokens for meter ingestion. Format: pmi_<prefix>_<secret> where prefix is 12
// lowercase alphanumerics (indexed lookup) and secret is 32 random bytes base64url. Only
// SHA-256(full token) is stored (meter_integrations.token_hash); the plaintext is shown once.
import crypto from 'node:crypto';

const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export interface IssuedToken {
  token: string;
  prefix: string;
  hash: string;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueToken(): IssuedToken {
  const bytes = crypto.randomBytes(12);
  let prefix = '';
  for (const b of bytes) prefix += PREFIX_ALPHABET[b % PREFIX_ALPHABET.length];
  const secret = crypto.randomBytes(32).toString('base64url');
  const token = `pmi_${prefix}_${secret}`;
  return { token, prefix, hash: hashToken(token) };
}

/** Extracts the lookup prefix from a bearer token, or null if it is not a well-formed token. */
export function parseTokenPrefix(token: string): string | null {
  const m = /^pmi_([a-z0-9]{12})_[A-Za-z0-9_-]{40,}$/.exec(token);
  return m?.[1] ?? null;
}

/** Constant-time comparison of a presented token against a stored SHA-256 hex digest. */
export function tokenMatchesHash(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || storedHash.length !== 64) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}
