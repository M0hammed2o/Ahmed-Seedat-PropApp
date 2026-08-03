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
  loginAttemptsPerMinute: 10,
  uploadRequestsPerMinute: 20,
  webhookRequestsPerMinute: 120,
  // A signed-in caller guessing invite tokens for other orgs (POST .../invites/accept) -- tokens
  // are UUIDs (impractical to brute-force regardless), this is defense in depth, not the only
  // protection.
  inviteAcceptAttemptsPerMinute: 10,
} as const;

export const BIOMETRIC_LOCK_DEFAULT_TIMEOUT_SECONDS = 60;
