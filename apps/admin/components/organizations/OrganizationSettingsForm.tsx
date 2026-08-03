'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Organization } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

interface FormState {
  legalName: string;
  tradingName: string;
  cipcRegNo: string;
  vatNo: string;
  sarsTaxNo: string;
  popiaInformationOfficer: string;
  invoicePrefix: string;
  depositInterestPct: string;
  ffcNumber: string;
  ffcIssued: string;
  ffcExpires: string;
}

function toFormState(org: Organization): FormState {
  return {
    legalName: org.legalName,
    tradingName: org.tradingName ?? '',
    cipcRegNo: org.cipcRegNo ?? '',
    vatNo: org.vatNo ?? '',
    sarsTaxNo: org.sarsTaxNo ?? '',
    popiaInformationOfficer: org.popiaInformationOfficer ?? '',
    invoicePrefix: org.invoicePrefix,
    depositInterestPct: String(org.depositInterestPct),
    ffcNumber: org.ffcNumber ?? '',
    ffcIssued: org.ffcIssued ?? '',
    ffcExpires: org.ffcExpires ?? '',
  };
}

// PWA_V1_COMPLETION_PLAN.md #8 -- every editable organizations column (see
// lib/organizations.ts's mapOrganizationRow for the full set this is built from). Reachable only
// by manager+ (page-level gate); PATCH /api/v1/organizations/:orgId enforces the same floor
// server-side regardless.
export function OrganizationSettingsForm({ organization }: { organization: Organization }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(organization));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      const response = await fetch(`/api/v1/organizations/${organization.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: form.legalName,
          tradingName: form.tradingName || null,
          cipcRegNo: form.cipcRegNo || null,
          vatNo: form.vatNo || null,
          sarsTaxNo: form.sarsTaxNo || null,
          popiaInformationOfficer: form.popiaInformationOfficer || null,
          invoicePrefix: form.invoicePrefix,
          depositInterestPct: Number(form.depositInterestPct || '0'),
          ffcNumber: form.ffcNumber || null,
          ffcIssued: form.ffcIssued || null,
          ffcExpires: form.ffcExpires || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to save organization settings.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Failed to save — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        {saved ? <p className="text-xs text-light-statusPaid dark:text-dark-statusPaid">Saved.</p> : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Legal name" error={fieldErrors.legalName}>
            <input required value={form.legalName} onChange={(e) => set('legalName', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Trading name (optional)" error={fieldErrors.tradingName}>
            <input value={form.tradingName} onChange={(e) => set('tradingName', e.target.value)} className={inputClass} />
          </Field>
          <Field label="CIPC registration no." error={fieldErrors.cipcRegNo}>
            <input value={form.cipcRegNo} onChange={(e) => set('cipcRegNo', e.target.value)} className={inputClass} />
          </Field>
          <Field label="VAT no." error={fieldErrors.vatNo}>
            <input value={form.vatNo} onChange={(e) => set('vatNo', e.target.value)} className={inputClass} />
          </Field>
          <Field label="SARS tax no." error={fieldErrors.sarsTaxNo}>
            <input value={form.sarsTaxNo} onChange={(e) => set('sarsTaxNo', e.target.value)} className={inputClass} />
          </Field>
          <Field label="POPIA information officer" error={fieldErrors.popiaInformationOfficer}>
            <input
              value={form.popiaInformationOfficer}
              onChange={(e) => set('popiaInformationOfficer', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Invoice prefix" error={fieldErrors.invoicePrefix}>
            <input
              required
              value={form.invoicePrefix}
              onChange={(e) => set('invoicePrefix', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Deposit interest (%)" error={fieldErrors.depositInterestPct}>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={form.depositInterestPct}
              onChange={(e) => set('depositInterestPct', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Fidelity Fund Certificate no." error={fieldErrors.ffcNumber}>
            <input value={form.ffcNumber} onChange={(e) => set('ffcNumber', e.target.value)} className={inputClass} />
          </Field>
          <Field label="FFC issued" error={fieldErrors.ffcIssued}>
            <input type="date" value={form.ffcIssued} onChange={(e) => set('ffcIssued', e.target.value)} className={inputClass} />
          </Field>
          <Field label="FFC expires" error={fieldErrors.ffcExpires}>
            <input type="date" value={form.ffcExpires} onChange={(e) => set('ffcExpires', e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </Panel>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

function Field({ label, error, children }: { label: string; error?: string[]; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="text-light-textMuted dark:text-dark-textMuted">{label}</span>
      {children}
      {error?.length ? (
        <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error[0]}</p>
      ) : null}
    </label>
  );
}
