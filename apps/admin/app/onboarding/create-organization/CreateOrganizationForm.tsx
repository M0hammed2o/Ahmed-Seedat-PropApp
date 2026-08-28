'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createOrganizationSchema, type CreateOrganizationInput } from '@propvault/validation';
import { branding } from '@propvault/config';
import { Button } from '@/components/ui/Button';
import { ProplystLogo } from '@/components/branding/ProplystLogo';

export function CreateOrganizationForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { orgType: 'owner_managed' },
  });
  const legalNameValue = watch('legalName');

  const onSubmit = async (values: CreateOrganizationInput) => {
    setSubmitError(null);

    const response = await fetch('/api/v1/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSubmitError(body?.error?.message ?? 'Could not create your organization. Try again.');
      return;
    }

    // Real bug found and fixed this date (Stage 6, commercial-launch execution plan, caught by a
    // new real-backend Playwright test, not by inspection): this used to send every newly-created
    // org's principal to '/overview' -- the Super Admin dashboard, gated on `requireRole
    // ('read_only_admin')`, a platform-admin-only role no ordinary customer has. A real signup
    // would create their organization successfully and then immediately hit a thrown FORBIDDEN
    // error instead of ever reaching their new org's dashboard -- the exact bug class LoginForm.tsx
    // already fixed once (see its own 2026-08-01 comment) for the sign-in path, just missed here on
    // the org-creation path. '/dashboard' is correct unconditionally here (unlike '/', which has to
    // check session type first) -- this code path only ever runs after a real org was just created.
    router.replace('/dashboard');
    router.refresh();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised"
      >
        <ProplystLogo />
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          Set up {branding.productName}
        </h1>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Create your organization to get started. You'll be its first administrator.
        </p>

        <label className="mt-6 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
          Organization / agency name
        </label>
        <input
          type="text"
          autoComplete="organization"
          placeholder="e.g. Seedat Property Management"
          className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          {...register('legalName')}
        />
        {errors.legalName ? (
          <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">
            {errors.legalName.message}
          </p>
        ) : null}

        <label className="mt-4 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
          Organization type
        </label>
        <select
          className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          {...register('orgType')}
        >
          <option value="owner_managed">Owner-managed — my own properties</option>
          <option value="agency">Agency — properties for other owners</option>
        </select>

        <div className="mt-6 rounded-lg border border-light-border p-3 dark:border-dark-border">
          <p className="text-xs font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Were you referred by someone? (optional)
          </p>
          <p className="mt-1 text-xs text-light-textSecondary dark:text-dark-textSecondary">
            Entirely optional — this never blocks or delays creating your organization, even if the
            code doesn't match anything.
          </p>

          <label className="mt-3 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
            Referral code (optional)
          </label>
          <input
            type="text"
            autoComplete="off"
            placeholder="e.g. JANE2024"
            className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            {...register('referralCode')}
          />

          <label className="mt-3 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
            Or the referrer's name (optional)
          </label>
          <input
            type="text"
            autoComplete="off"
            placeholder="e.g. Jane Smith"
            className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            {...register('referrerName')}
          />
        </div>

        {submitError ? (
          <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{submitError}</p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting || !legalNameValue?.trim()}
          className="mt-6 w-full"
        >
          {isSubmitting ? 'Creating…' : 'Create organization'}
        </Button>
      </form>
    </main>
  );
}
