import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { DEMO_MODE, getSupabaseClient } from '@/lib/supabase';
import { DEMO_USER } from '@/demo/mockData';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
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

  useEffect(() => {
    if (DEMO_MODE) {
      // Demo mode starts signed out so the full onboarding journey (register → verify → paywall
      // → biometrics → add property) can be demonstrated; signing in/up instantly succeeds.
      setIsLoading(false);
      return;
    }
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    if (DEMO_MODE) {
      return {
        session,
        isLoading,
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
  }, [session, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
