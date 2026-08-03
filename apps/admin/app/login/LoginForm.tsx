'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2 } from 'lucide-react';
import { loginSchema, type LoginInput } from '@propvault/validation';
import { branding } from '@propvault/config';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

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
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
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
          className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          {...register('email')}
        />
        {errors.email ? (
          <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{errors.email.message}</p>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <label className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-light-accent hover:underline dark:text-dark-accent"
          >
            Forgot password?
          </Link>
        </div>
        <input
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          {...register('password')}
        />
        {errors.password ? (
          <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{errors.password.message}</p>
        ) : null}

        {submitError ? <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{submitError}</p> : null}

        <Button type="submit" variant="primary" disabled={isSubmitting} className="mt-6 w-full">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
