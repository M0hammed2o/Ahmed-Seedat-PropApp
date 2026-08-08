import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResult, AuthSession } from '@/data/contracts';
import { useRepositories } from '@/data/RepositoryProvider';

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  configError: string | null;
  pendingEmail: string | null;
  pendingMfaFactorId: string | null;
  isEmailVerified: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signInWithProvider: (provider: 'google' | 'apple') => Promise<AuthResult>;
  verifyMfa: (code: string) => Promise<AuthResult>;
  completeEmailConfirmation: () => Promise<AuthResult>;
  refreshEmailVerification: () => Promise<void>;
  resendVerificationEmail: (email?: string) => Promise<AuthResult>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { auth } = useRepositories();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingMfaFactorId, setPendingMfaFactorId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    auth.getSession().then((nextSession) => {
      if (mounted) {
        setSession(nextSession);
        setIsLoading(false);
      }
    }).catch(() => {
      if (mounted) setIsLoading(false);
    });
    const unsubscribe = auth.subscribe((nextSession) => setSession(nextSession));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [auth]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isLoading,
    configError: null,
    pendingEmail,
    pendingMfaFactorId,
    isEmailVerified: Boolean(session?.user.emailConfirmed),
    async signIn(email, password) {
      const result = await auth.signIn(email, password);
      if (result.status === 'mfa_required') setPendingMfaFactorId(result.factorId);
      if (result.status === 'email_unconfirmed') setPendingEmail(result.email);
      return result;
    },
    async signUp(email, password) {
      const result = await auth.signUp(email, password);
      if (result.status === 'confirmation_sent') setPendingEmail(result.email);
      return result;
    },
    signInWithProvider: (provider) => auth.signInWithProvider(provider),
    async verifyMfa(code) {
      if (!pendingMfaFactorId) return { status: 'error', code: 'unknown', message: 'Start sign-in again.' };
      const result = await auth.verifyMfa(pendingMfaFactorId, code);
      if (result.status === 'authenticated') setPendingMfaFactorId(null);
      return result;
    },
    completeEmailConfirmation: () => auth.completeEmailConfirmation(),
    async refreshEmailVerification() {
      setSession(await auth.getSession());
    },
    resendVerificationEmail: (email) => auth.resendConfirmation(email ?? pendingEmail ?? ''),
    sendPasswordReset: (email) => auth.requestPasswordReset(email),
    updatePassword: (password) => auth.updatePassword(password),
    async signOut() {
      await auth.signOut();
      setPendingMfaFactorId(null);
    },
  }), [auth, isLoading, pendingEmail, pendingMfaFactorId, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
