import 'server-only';

/**
 * Production signup/onboarding (WORKLOG.md this date). Deliberately hand-rolled rather than
 * pulling in a phone-number library: the workspace's `pnpm-lock.yaml` is being concurrently
 * edited by mobile work outside this task's scope, and a new dependency here would touch that
 * same shared lockfile -- avoided entirely rather than managed carefully. This covers exactly
 * what "store a valid contact number" needs; full carrier/line-type validation is out of scope
 * (no SMS OTP yet, per instruction).
 *
 * South Africa is this product's primary market (`DECISIONS.md` 2026-07-29), so a bare local
 * format (0821234567, with optional spaces/dashes) is accepted and normalized to +27 -- but the
 * database/API are never SA-only: any input already in E.164 form (+<countrycode><number>) is
 * accepted for any country, preserving international support.
 */
export function normalizePhoneToE164(input: string): string | null {
  const stripped = input.trim().replace(/[\s()-]/g, '');
  if (!stripped) return null;

  if (stripped.startsWith('+')) {
    // E.164: a leading non-zero digit (country code), 8-15 digits total after the '+'.
    return /^\+[1-9]\d{7,14}$/.test(stripped) ? stripped : null;
  }

  // South African local format: a leading 0 followed by 9 digits (e.g. 0821234567).
  if (/^0\d{9}$/.test(stripped)) {
    return `+27${stripped.slice(1)}`;
  }

  return null;
}
