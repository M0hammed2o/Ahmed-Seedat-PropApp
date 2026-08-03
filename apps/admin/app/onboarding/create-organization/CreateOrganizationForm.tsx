'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2 } from 'lucide-react';
import { createOrganizationSchema, type CreateOrganizationInput } from '@propvault/validation';
import { branding } from '@propvault/config';
import { Button } from '@/components/ui/Button';

export function CreateOrganizationForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { orgType: 'owner_managed' },
  });

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

    router.replace('/overview');
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
          <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{errors.legalName.message}</p>
        ) : null}

        <label className="mt-4 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
          Organization type
        </label>
        <select
          className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          {...register('orgType')}
        >
          <option value="owner_managed">Owner-managed (I manage my own properties)</option>
          <option value="agency">Agency (I manage properties for other owners)</option>
        </select>

        {submitError ? <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{submitError}</p> : null}

        <Button type="submit" variant="primary" disabled={isSubmitting} className="mt-6 w-full">
          {isSubmitting ? 'Creating…' : 'Create organization'}
        </Button>
      </form>
    </main>
  );
}
