export const MAX_EXTRACTION_RETRIES = 3;

export const SIGNED_URL_TTL_SECONDS = {
  preview: 300,
  download: 60,
} as const;

export const RATE_LIMITS = {
  // requests per window, per authenticated user — architecture placeholder (see SECURITY.md);
  // Phase 1 does not yet wire an enforcement backend.
  loginAttemptsPerMinute: 10,
  uploadRequestsPerMinute: 20,
  webhookRequestsPerMinute: 120,
} as const;

export const BIOMETRIC_LOCK_DEFAULT_TIMEOUT_SECONDS = 60;
