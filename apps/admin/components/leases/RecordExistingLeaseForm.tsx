'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';

interface TenantOption {
  id: string;
  fullName: string;
}

type LeaseType = 'fixed' | 'month_to_month';
type TrackingOption = 'current_billing_period' | 'lease_start_date' | 'custom';

interface FormState {
  primaryTenantId: string;
  coTenantId: string;
  leaseType: LeaseType;
  startDate: string;
  endDate: string;
  rentAmount: string;
  depositAmount: string;
  trackingOption: TrackingOption;
  customTrackingDate: string;
  historicalConfirmed: boolean;
}

const EMPTY_STATE: FormState = {
  primaryTenantId: '',
  coTenantId: '',
  leaseType: 'fixed',
  startDate: '',
  endDate: '',
  rentAmount: '',
  depositAmount: '0',
  trackingOption: 'current_billing_period',
  customTrackingDate: '',
  historicalConfirmed: false,
};

function firstOfCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function daysAgo(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

/**
 * V1 launch-completion pass, Sections 6-8: the missing staff-facing "record an already-signed
 * existing tenancy" UI. Creates a manual draft lease (POST /api/v1/leases, unchanged), assigns
 * the chosen tenant(s) (POST .../tenants, unchanged), optionally uploads the signed document
 * (POST .../documents, unchanged), then hands off to the lease detail page, where -- because
 * source is 'manual' -- activate_lease() already skips the send/acknowledge chain entirely
 * (migration 20260101000143) and the lease detail page's Prepare/Send action is now hidden for
 * manual-source leases (this same pass), leaving a direct Activate action: no re-signature, no
 * "ready for review" notice, exactly per spec.
 */
export function RecordExistingLeaseForm({
  orgId,
  propertyId,
  unitId,
  unitLabel,
  tenants,
  initialTenantId,
}: {
  orgId: string;
  propertyId: string;
  unitId: string;
  unitLabel: string;
  tenants: TenantOption[];
  /** Tenant/occupancy V1 pass: pre-selects the primary tenant when arriving here right after Add
   *  Tenant (via ?tenantId=). Ignored if the id isn't in `tenants` (e.g. a stale/tampered link). */
  initialTenantId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    initialTenantId && tenants.some((t) => t.id === initialTenantId)
      ? { ...EMPTY_STATE, primaryTenantId: initialTenantId }
      : EMPTY_STATE,
  );
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const resolvedTrackingDate =
    form.trackingOption === 'current_billing_period'
      ? firstOfCurrentMonth()
      : form.trackingOption === 'lease_start_date'
        ? form.startDate
        : form.customTrackingDate;

  const isHistorical =
    form.trackingOption !== 'current_billing_period' &&
    Boolean(resolvedTrackingDate) &&
    daysAgo(resolvedTrackingDate) > 31;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!form.primaryTenantId) {
      setError('Choose the primary tenant.');
      return;
    }
    if (form.leaseType === 'fixed' && !form.endDate) {
      setFieldErrors({ endDate: ['Expiry date is required for a fixed-term lease.'] });
      return;
    }
    if (isHistorical && !form.historicalConfirmed) {
      setError(
        'This tracking date is in the past and will generate historical rent schedules — confirm below to continue.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const leaseResponse = await fetch('/api/v1/leases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          unitId,
          startDate: form.startDate,
          endDate: form.leaseType === 'month_to_month' ? null : form.endDate,
          rentAmount: Number(form.rentAmount),
          depositAmount: Number(form.depositAmount || '0'),
          rentTrackingStartDate: resolvedTrackingDate || null,
        }),
      });
      const leaseBody = await leaseResponse.json();
      if (!leaseResponse.ok) {
        setFieldErrors(leaseBody.error?.field_errors ?? {});
        setError(leaseBody.error?.message ?? 'Failed to record this lease.');
        return;
      }
      const leaseId = leaseBody.lease.id as string;

      const tenantAssignments = [
        fetch(`/api/v1/leases/${leaseId}/tenants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: form.primaryTenantId, isPrimary: true }),
        }),
      ];
      if (form.coTenantId) {
        tenantAssignments.push(
          fetch(`/api/v1/leases/${leaseId}/tenants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: form.coTenantId, isPrimary: false }),
          }),
        );
      }
      const tenantResponses = await Promise.all(tenantAssignments);
      if (tenantResponses.some((r) => !r.ok)) {
        setError('Lease was recorded, but assigning the tenant failed — open the lease to try again.');
        router.push(`/leases/${leaseId}`);
        return;
      }

      if (file) {
        const formData = new FormData();
        formData.set('file', file);
        const docResponse = await fetch(`/api/v1/leases/${leaseId}/documents`, {
          method: 'POST',
          body: formData,
        });
        if (!docResponse.ok) {
          setError('Lease and tenant were recorded, but the document upload failed — open the lease to try again.');
          router.push(`/leases/${leaseId}`);
          return;
        }
      }

      router.push(`/leases/${leaseId}`);
      router.refresh();
    } catch {
      setError('Failed to record this lease — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader title="Record existing lease" subtitle={unitLabel} />

      <Panel className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error ? (
            <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Primary tenant">
              <select
                required
                value={form.primaryTenantId}
                onChange={(e) => set('primaryTenantId', e.target.value)}
                className={inputClass}
              >
                <option value="">Select a tenant…</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                  </option>
                ))}
              </select>
              {tenants.length === 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  No tenants yet — add one first via &quot;+ Add existing tenant&quot;.
                </p>
              ) : null}
            </Field>
            <Field label="Additional / co-tenant (optional)">
              <select
                value={form.coTenantId}
                onChange={(e) => set('coTenantId', e.target.value)}
                className={inputClass}
              >
                <option value="">None</option>
                {tenants
                  .filter((t) => t.id !== form.primaryTenantId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <Field label="Lease type">
            <div className="mt-1 flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={form.leaseType === 'fixed'}
                  onChange={() => set('leaseType', 'fixed')}
                />
                Fixed term
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={form.leaseType === 'month_to_month'}
                  onChange={() => set('leaseType', 'month_to_month')}
                />
                Month-to-month / ongoing
              </label>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Lease start date (legal)">
              <input
                required
                type="date"
                value={form.startDate}
                onChange={(e) => set('startDate', e.target.value)}
                className={inputClass}
              />
            </Field>
            {form.leaseType === 'fixed' ? (
              <Field label="Expiry date" error={fieldErrors.endDate}>
                <input
                  required
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set('endDate', e.target.value)}
                  className={inputClass}
                />
              </Field>
            ) : (
              <div className="flex items-end pb-2 text-[13px] text-muted-foreground">Ongoing — no expiry date</div>
            )}
            <Field label="Monthly rent (ZAR)">
              <input
                required
                type="number"
                min={0}
                step={0.01}
                value={form.rentAmount}
                onChange={(e) => set('rentAmount', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Deposit (ZAR)">
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.depositAmount}
                onChange={(e) => set('depositAmount', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
            <Field label="Start tracking rent from">
              <div className="mt-1 space-y-1.5 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={form.trackingOption === 'current_billing_period'}
                    onChange={() => set('trackingOption', 'current_billing_period')}
                  />
                  Current billing period (default — recommended for an imported tenancy)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={form.trackingOption === 'lease_start_date'}
                    onChange={() => set('trackingOption', 'lease_start_date')}
                  />
                  Lease start date
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={form.trackingOption === 'custom'}
                    onChange={() => set('trackingOption', 'custom')}
                  />
                  Custom date
                </label>
              </div>
            </Field>
            {form.trackingOption === 'custom' ? (
              <input
                type="date"
                value={form.customTrackingDate}
                onChange={(e) => set('customTrackingDate', e.target.value)}
                className={`${inputClass} mt-2 max-w-[200px]`}
              />
            ) : null}
            <p className="mt-2 text-[11px] text-muted-foreground">
              This controls when rent schedules start in Proplyst — it never changes the lease&apos;s
              legal start date above.
            </p>
            {isHistorical ? (
              <div className="mt-3 rounded-md border border-light-statusNeedsReview/40 bg-light-statusNeedsReview/10 p-3 dark:border-dark-statusNeedsReview/40 dark:bg-dark-statusNeedsReview/10">
                <p className="text-[12px] text-light-statusNeedsReview dark:text-dark-statusNeedsReview">
                  This will generate rent schedules going back to {resolvedTrackingDate} — that&apos;s{' '}
                  {daysAgo(resolvedTrackingDate)} days of history. Only continue if you actually want
                  Proplyst to track arrears from that date.
                </p>
                <label className="mt-2 flex items-center gap-1.5 text-[12px] text-foreground">
                  <input
                    type="checkbox"
                    checked={form.historicalConfirmed}
                    onChange={(e) => set('historicalConfirmed', e.target.checked)}
                  />
                  I understand and want to track rent from this historical date.
                </label>
              </div>
            ) : null}
          </div>

          <Field label="Existing signed lease document (optional, can be added later)">
            <input
              type="file"
              accept="application/pdf,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className={`${inputClass} py-1.5`}
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Record lease'}
            </Button>
            <Button
              type="button"
              onClick={() => router.push(`/properties/${propertyId}/units/${unitId}`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string[];
  children: ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="text-light-textMuted dark:text-dark-textMuted">{label}</span>
      {children}
      {error?.length ? (
        <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error[0]}
        </p>
      ) : null}
    </label>
  );
}
