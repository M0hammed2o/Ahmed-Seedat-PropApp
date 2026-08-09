export const MAX_EXTRACTION_RETRIES = 3;

export const SIGNED_URL_TTL_SECONDS = {
  preview: 300,
  download: 60,
} as const;

export const RATE_LIMITS = {
  // requests per window, per authenticated user (or per source IP for unauthenticated routes) --
  // enforced via check_rate_limit()/lib/rateLimit.ts (PWA_V1_COMPLETION_PLAN.md #19,
  // TECHNICAL_DEBT_REGISTER.md TD-10 -- was a scaffolded placeholder with no backing store until
  // this closed it).
  // TECHNICAL_DEBT_REGISTER.md TD-31, closed 2026-08-06 (Stage 7): these three now have a real
  // server-side hook point (apps/admin/app/api/v1/auth/*) to actually enforce against --
  // previously scaffolded but unreachable, since the client called Supabase Auth directly with no
  // route handler in between.
  loginAttemptsPerMinute: 10,
  signupAttemptsPerMinute: 5,
  passwordResetAttemptsPerMinute: 5,
  // Production signup/onboarding (WORKLOG.md this date): the "Check your email" screen's own
  // resend button. Lower than signup itself -- a legitimate user rarely needs more than one or
  // two resends in a minute; this is the anti-abuse floor, the UI's own client-side cooldown
  // (see CheckEmailScreen.tsx) is the primary friction a real user actually experiences.
  resendVerificationAttemptsPerMinute: 3,
  mfaVerifyAttemptsPerMinute: 10,
  uploadRequestsPerMinute: 20,
  webhookRequestsPerMinute: 120,
  // A signed-in caller guessing invite tokens for other orgs (POST .../invites/accept) -- tokens
  // are UUIDs (impractical to brute-force regardless), this is defense in depth, not the only
  // protection.
  inviteAcceptAttemptsPerMinute: 10,
} as const;

export const BIOMETRIC_LOCK_DEFAULT_TIMEOUT_SECONDS = 60;
