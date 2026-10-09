import 'server-only';
import crypto from 'node:crypto';

// Integration credential encryption (docs/SMART_UTILITIES_DECISIONS.md #3). AES-256-GCM with a
// 32-byte key from SMART_UTILITY_CREDENTIALS_KEY (base64). Envelope: "v1:<iv>:<tag>:<ciphertext>"
// (base64 parts). The version prefix allows a future key rotation (decrypt with the old key,
// re-encrypt with the new). Fails closed: no key ⇒ credentials can be neither stored nor read.
//
// Ciphertext lives in meter_integrations.credentials_ciphertext, which API clients cannot select
// (migration 176 column grant). Plaintext never leaves the server and is never logged.

const VERSION = 'v1';

export class CredentialsKeyMissingError extends Error {
  constructor() {
    super('SMART_UTILITY_CREDENTIALS_KEY is not configured; integration credentials cannot be stored or read.');
    this.name = 'CredentialsKeyMissingError';
  }
}

function key(): Buffer {
  const raw = process.env.SMART_UTILITY_CREDENTIALS_KEY;
  if (!raw) throw new CredentialsKeyMissingError();
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('SMART_UTILITY_CREDENTIALS_KEY must be 32 bytes, base64-encoded.');
  return buf;
}

export function isCredentialsKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptCredentials(value: Record<string, string>, aad: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  // AAD binds the ciphertext to its integration row: a ciphertext copied onto another row fails.
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptCredentials(envelope: string, aad: string): Record<string, string> {
  const [version, ivB64, tagB64, ctB64] = envelope.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) throw new Error('Unsupported credentials envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as Record<string, string>;
}
