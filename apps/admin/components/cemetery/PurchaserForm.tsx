'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { ErrorBox, Field, inputClass, sendJson } from '@/components/cemetery/formBits';

export interface PurchaserFormValues {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
  nextOfKinRelationship: string;
  notes: string;
}

export function PurchaserForm({
  mode,
  purchaserId,
  initial,
  holderLabel,
}: {
  mode: 'create' | 'edit';
  purchaserId?: string;
  initial?: Partial<PurchaserFormValues>;
  holderLabel: string;
}) {
  const router = useRouter();
  const [f, setF] = useState<PurchaserFormValues>({
    fullName: '',
    phone: '',
    email: '',
    address: '',
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinRelationship: '',
    notes: '',
    ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? ''])),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const set = (k: keyof PurchaserFormValues, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    const url =
      mode === 'create'
        ? '/api/v1/cemetery/purchasers'
        : `/api/v1/cemetery/purchasers/${purchaserId}`;
    const result = await sendJson<{ purchaser: { id: string } }>(
      url,
      mode === 'create' ? 'POST' : 'PATCH',
      f,
    );
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setError(result.message);
      setFieldErrors(result.fieldErrors);
      return;
    }
    router.push(`/cemetery/purchasers/${result.data.purchaser.id}`);
    router.refresh();
  }

  return (
    <Panel className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" error={fieldErrors.fullName} className="sm:col-span-2">
            <input
              required
              value={f.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              className={inputClass}
              maxLength={200}
            />
          </Field>
          <Field label="Contact number" error={fieldErrors.phone}>
            <input
              value={f.phone}
              onChange={(e) => set('phone', e.target.value)}
              className={inputClass}
              maxLength={40}
              inputMode="tel"
            />
          </Field>
          <Field label="E-mail" error={fieldErrors.email}>
            <input
              type="email"
              value={f.email}
              onChange={(e) => set('email', e.target.value)}
              className={inputClass}
              maxLength={254}
            />
          </Field>
          <Field label="Address" error={fieldErrors.address} className="sm:col-span-2">
            <textarea
              rows={2}
              value={f.address}
              onChange={(e) => set('address', e.target.value)}
              className={inputClass}
              maxLength={500}
            />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-foreground">
            Next of kin / authorised contact
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" error={fieldErrors.nextOfKinName}>
              <input
                value={f.nextOfKinName}
                onChange={(e) => set('nextOfKinName', e.target.value)}
                className={inputClass}
                maxLength={200}
              />
            </Field>
            <Field label="Contact number" error={fieldErrors.nextOfKinPhone}>
              <input
                value={f.nextOfKinPhone}
                onChange={(e) => set('nextOfKinPhone', e.target.value)}
                className={inputClass}
                maxLength={40}
              />
            </Field>
            <Field label="Relationship" error={fieldErrors.nextOfKinRelationship}>
              <input
                value={f.nextOfKinRelationship}
                onChange={(e) => set('nextOfKinRelationship', e.target.value)}
                className={inputClass}
                maxLength={80}
              />
            </Field>
          </div>
        </div>
        <Field label="Internal notes" error={fieldErrors.notes}>
          <textarea
            rows={3}
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
            className={inputClass}
            maxLength={2000}
          />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting
              ? 'Saving…'
              : mode === 'create'
                ? `Add ${holderLabel.toLowerCase()}`
                : 'Save changes'}
          </Button>
          <Button type="button" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}
