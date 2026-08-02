'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@propvault/validation';
import { branding } from '@propvault/config';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';

export function LoginForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginInput) => {
    setSubmitError(null);

    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      // No Supabase project to authenticate against in demo mode — see DECISIONS.md. Any
      // credentials "work"; the server always resolves the fixed demo admin session.
      router.replace('/overview');
      router.refresh();
      return;
    }

    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setSubmitError('Invalid email or password.');
      return;
    }
    // Real bug fixed 2026-08-01 (DECISIONS.md): this used to always send every signed-in user to
    // '/overview' (platform-admin only) -- a client-org member with no platform_admin_users row
    // would immediately bounce back to '/login' from that route group's own auth check, with no
    // way to ever reach their portal. '/' now checks both session types and routes accordingly.
    router.replace('/');
    router.refresh();
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm rounded-xl border border-light-border bg-light-surfaceRaised p-8 dark:border-dark-border dark:bg-dark-surfaceRaised"
      >
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          {branding.productName} Admin
        </h1>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Sign in with your administrator account.
        </p>

        <label className="mt-6 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
          {...register('email')}
        />
        {errors.email ? (
          <p className="mt-1 text-xs text-light-danger">{errors.email.message}</p>
        ) : null}

        <label className="mt-4 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
          {...register('password')}
        />
        {errors.password ? (
          <p className="mt-1 text-xs text-light-danger">{errors.password.message}</p>
        ) : null}

        {submitError ? <p className="mt-3 text-sm text-light-danger">{submitError}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-md bg-light-accent py-2 text-sm font-medium text-light-accentContrast disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
