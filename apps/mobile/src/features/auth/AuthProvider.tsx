import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { DEMO_MODE, getSupabaseClient } from '@/lib/supabase';
import { DEMO_USER } from '@/demo/mockData';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  /** Set when EXPO_PUBLIC_DEMO_MODE=false but Supabase isn't actually configured — surfaced as
   * a clean message instead of an unhandled exception (error boundaries don't catch effect
   * errors; see launch-readiness audit, 2026-07-22, and src/design/components/ErrorBoundary.tsx). */
  configError: string | null;
  /** True in demo mode (nothing to verify); reflects `email_confirmed_at` otherwise — the
   * verify-email screen gates on this rather than letting the user just tap through. */
  isEmailVerified: boolean;
  /** Re-fetches the current user from Supabase so `isEmailVerified` updates after the user
   * clicks the confirmation link in another tab/app — Supabase doesn't push this change to an
   * already-open session via onAuthStateChange. */
  refreshEmailVerification: () => Promise<void>;
  resendVerificationEmail: (email: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** A minimally-shaped fake Session — enough for every screen that reads `session.user.id/email`. */
function buildDemoSession(email: string): Session {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'demo-access-token',
    refresh_token: 'demo-refresh-token',
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: 'bearer',
    user: {
      id: DEMO_USER.id,
      app_metadata: {},
      user_metadata: { display_name: DEMO_USER.displayName },
      aud: 'authenticated',
      created_at: '2026-02-01T00:00:00Z',
      email,
    },
  } as Session;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(!DEMO_MODE);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (DEMO_MODE) {
      // Demo mode starts signed out so the full onboarding journey (register → verify → paywall
      // → biometrics → add property) can be demonstrated; signing in/up instantly succeeds.
      setIsLoading(false);
      return;
    }
    try {
      const supabase = getSupabaseClient();
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setIsLoading(false);
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
      });
      return () => sub.subscription.unsubscribe();
    } catch (err) {
      // getSupabaseClient() throws synchronously if EXPO_PUBLIC_SUPABASE_URL/ANON_KEY are
      // missing — a real misconfiguration, not a demo-mode concern. Surfaced as state rather
      // than left to crash, since React error boundaries don't catch effect-phase errors.
      setConfigError(err instanceof Error ? err.message : 'Supabase is not configured.');
      setIsLoading(false);
      return undefined;
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    if (DEMO_MODE) {
      return {
        session,
        isLoading,
        configError,
        isEmailVerified: true,
        refreshEmailVerification: async () => {},
        resendVerificationEmail: async () => ({ error: null }),
        signUp: async (email) => {
          await new Promise((r) => setTimeout(r, 400));
          setSession(buildDemoSession(email));
          return { error: null };
        },
        signIn: async (email) => {
          await new Promise((r) => setTimeout(r, 400));
          setSession(buildDemoSession(email || DEMO_USER.email));
          return { error: null };
        },
        signOut: async () => {
          setSession(null);
        },
        sendPasswordReset: async () => ({ error: null }),
        updatePassword: async () => ({ error: null }),
      };
    }

    return {
      session,
      isLoading,
      configError,
      isEmailVerified: Boolean(session?.user.email_confirmed_at),
      refreshEmailVerification: async () => {
        const { data } = await getSupabaseClient().auth.getUser();
        if (data.user) {
          setSession((prev) => (prev ? { ...prev, user: data.user } : prev));
        }
      },
      resendVerificationEmail: async (email) => {
        const { error } = await getSupabaseClient().auth.resend({ type: 'signup', email });
        return { error: error?.message ?? null };
      },
      signUp: async (email, password) => {
        const { error } = await getSupabaseClient().auth.signUp({ email, password });
        return { error: error?.message ?? null };
      },
      signIn: async (email, password) => {
        const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      signOut: async () => {
        await getSupabaseClient().auth.signOut();
      },
      sendPasswordReset: async (email) => {
        const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email);
        return { error: error?.message ?? null };
      },
      updatePassword: async (password) => {
        const { error } = await getSupabaseClient().auth.updateUser({ password });
        return { error: error?.message ?? null };
      },
    };
  }, [session, isLoading, configError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
