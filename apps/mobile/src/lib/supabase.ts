import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { resolveDemoMode, parseMobileEnv } from '@propvault/config';

const env = parseMobileEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_DEMO_MODE: process.env.EXPO_PUBLIC_DEMO_MODE,
  EXPO_PUBLIC_ALLOW_DEMO_MODE: process.env.EXPO_PUBLIC_ALLOW_DEMO_MODE,
  EXPO_PUBLIC_SUBSCRIPTION_MODE: process.env.EXPO_PUBLIC_SUBSCRIPTION_MODE,
  EXPO_PUBLIC_REVENUECAT_API_KEY_IOS: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS,
  EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  EXPO_PUBLIC_ANALYTICS_ENDPOINT: process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT,
});

export const mobileEnv = env;

/**
 * True when the app should run entirely from mock data — no Supabase project required.
 *
 * SECURITY (fixed 2026-07-30, closes PRODUCTION_READINESS_REPORT.md R-01): gated by TWO
 * independent conditions, both defaulting to false — `EXPO_PUBLIC_DEMO_MODE=true` AND
 * `EXPO_PUBLIC_ALLOW_DEMO_MODE=true`. Unlike the web app, an Expo bundle has no server-only
 * trust boundary to hide the second gate behind (a compiled app can always be inspected), so
 * this pair is a defense against *accidental* enablement (a stray local `.env` leaking into a
 * build, a CI misconfiguration), not a cryptographic guarantee against a determined attacker
 * reverse-engineering the binary. The real enforcement point for mobile is `eas.json`'s
 * `production` build profile, which must never set `EXPO_PUBLIC_ALLOW_DEMO_MODE` at all — see
 * the comment there.
 */
export const DEMO_MODE = resolveDemoMode(
  env.EXPO_PUBLIC_DEMO_MODE,
  env.EXPO_PUBLIC_ALLOW_DEMO_MODE,
);

/**
 * SecureStore-backed session persistence — the Supabase session (access/refresh tokens) is
 * encrypted at rest via the OS keychain/keystore rather than plain AsyncStorage. This client
 * only ever holds the anon key; see SECURITY.md for the trust boundary.
 */
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

let cachedClient: SupabaseClient | null = null;

/**
 * Lazily constructs the real Supabase client on first use. Never called at all in DEMO_MODE —
 * callers that might run in demo mode should check `DEMO_MODE` first (see src/demo/) rather
 * than calling this unconditionally, since it throws without real project credentials.
 */
export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (!env.EXPO_PUBLIC_SUPABASE_URL || !env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. Set EXPO_PUBLIC_DEMO_MODE=true to run without a Supabase project, or provide real project credentials.',
    );
  }
  cachedClient = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}
