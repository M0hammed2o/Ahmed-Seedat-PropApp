import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time check of a scheduler's bearer secret against CRON_JOB_SECRET (TD-68). Both sides are hashed first so
 * the comparison is fixed-length and leaks neither content nor length through timing. An unset secret never matches.
 */
export function cronSecretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
