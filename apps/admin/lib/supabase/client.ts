'use client';

import { createBrowserClient } from '@supabase/ssr';

/** Anon-key-only client for the small amount of client-side interactivity (e.g. the login form). */
export function getBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
}
