import { z } from 'zod';

/**
 * Fails fast with a clear message on a missing/malformed required variable rather than an
 * obscure runtime crash later (SECURITY.md, ENVIRONMENT.md). Each app parses only the shape
 * it actually needs.
 */
export const mobileEnvSchema = z.object({
  // Optional at the schema level: in EXPO_PUBLIC_DEMO_MODE=true, the app never constructs a
  // real Supabase client at all (see src/demo/), so these aren't required to run/demo the app.
  // The real (non-demo) repository/auth code paths assert their presence themselves before use.
  EXPO_PUBLIC_SUPABASE_URL: z.string().optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  EXPO_PUBLIC_DEMO_MODE: z.string().optional(),
  EXPO_PUBLIC_SUBSCRIPTION_MODE: z.enum(['mock', 'revenuecat']).default('mock'),
  EXPO_PUBLIC_REVENUECAT_API_KEY_IOS: z.string().optional(),
  EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID: z.string().optional(),
  EXPO_PUBLIC_SENTRY_DSN: z.string().optional(),
  EXPO_PUBLIC_ANALYTICS_ENDPOINT: z.string().optional(),
});
export type MobileEnv = z.infer<typeof mobileEnvSchema>;

export const adminServerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Reserved for a future custom-signed cookie layer (not used by anything in Phase 1 — session
  // handling is entirely Supabase's own cookie via @supabase/ssr) — optional until it has a use.
  ADMIN_SESSION_COOKIE_SECRET: z.string().min(16).optional(),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  DOCUMENT_INTELLIGENCE_WEBHOOK_SECRET: z.string().optional(),
});
export type AdminServerEnv = z.infer<typeof adminServerEnvSchema>;

export function parseMobileEnv(source: Record<string, string | undefined>): MobileEnv {
  return mobileEnvSchema.parse(source);
}

export function parseAdminServerEnv(source: Record<string, string | undefined>): AdminServerEnv {
  return adminServerEnvSchema.parse(source);
}
