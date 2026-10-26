'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { ErrorBox, Field, inputClass, parseAmount, sendJson } from '@/components/cemetery/formBits';
import { TENURE_LABEL } from '@/lib/cemetery/terms';

interface SectionDraft {
  code: string;
  name: string;
  siteCount: string;
  sitesPerRow: string;
  listPrice: string;
}

/** Create a cemetery with its sections; grave sites A-001… are generated for each section. */
export function CemeterySetupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [tenureModel, setTenureModel] = useState<'burial_rights' | 'land_sale'>('burial_rights');
  const [sections, setSections] = useState<SectionDraft[]>([
    { code: 'A', name: 'Section A', siteCount: '40', sitesPerRow: '10', listPrice: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<SectionDraft>) =>
    setSections((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const nextCode = () => String.fromCharCode(65 + sections.length);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await sendJson<{ cemetery: { id: string } }>(
      '/api/v1/cemetery/cemeteries',
      'POST',
      {
        name,
        addressLine1: addressLine1 || null,
        city: city || null,
        province: province || null,
        tenureModel,
        sections: sections.map((s) => ({
          code: s.code.trim().toUpperCase(),
          name: s.name.trim(),
          siteCount: Number(s.siteCount),
          sitesPerRow: Number(s.sitesPerRow),
          listPrice: s.listPrice.trim() === '' ? null : parseAmount(s.listPrice),
        })),
      },
    );
    setSubmitting(false);
    if (!result.ok || !result.data) return setError(result.message);
    router.push(`/cemetery?cemeteryId=${result.data.cemetery.id}`);
    router.refresh();
  }

  const total = sections.reduce((sum, s) => sum + (Number(s.siteCount) || 0), 0);

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4">
      <ErrorBox message={error} />
      <Panel title="Cemetery">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              maxLength={200}
              placeholder="e.g. Greenfields Memorial Gardens"
            />
          </Field>
          <Field label="Street address">
            <input
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              className={inputClass}
              maxLength={200}
            />
          </Field>
          <Field label="Town / city">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
              maxLength={120}
            />
          </Field>
          <Field label="Province">
            <input
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className={inputClass}
              maxLength={120}
            />
          </Field>
          <Field
            label="What is transferred to the buyer"
            hint="Changes the wording on sale records and receipts."
          >
            <select
              value={tenureModel}
              onChange={(e) => setTenureModel(e.target.value as typeof tenureModel)}
              className={inputClass}
            >
              <option value="burial_rights">{TENURE_LABEL.burial_rights}</option>
              <option value="land_sale">{TENURE_LABEL.land_sale}</option>
            </select>
          </Field>
        </div>
      </Panel>
      <Panel title="Sections / blocks" description={`${total} grave sites will be created`}>
        <div className="space-y-3">
          {sections.map((s, i) => (
            <div
              key={i}
              className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-5"
            >
              <Field label="Code">
                <input
                  required
                  value={s.code}
                  onChange={(e) => update(i, { code: e.target.value })}
                  className={inputClass}
                  maxLength={6}
                />
              </Field>
              <Field label="Name">
                <input
                  required
                  value={s.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className={inputClass}
                  maxLength={120}
                />
              </Field>
              <Field label="Sites">
                <input
                  required
                  type="number"
                  min={1}
                  max={2000}
                  value={s.siteCount}
                  onChange={(e) => update(i, { siteCount: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Sites per row">
                <input
                  required
                  type="number"
                  min={1}
                  max={50}
                  value={s.sitesPerRow}
                  onChange={(e) => update(i, { sitesPerRow: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="List price (ZAR)">
                <input
                  inputMode="decimal"
                  value={s.listPrice}
                  onChange={(e) => update(i, { listPrice: e.target.value })}
                  className={inputClass}
                />
              </Field>
              {sections.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setSections((x) => x.filter((_, j) => j !== i))}
                  className="col-span-2 text-left text-xs text-destructive sm:col-span-5"
                >
                  Remove section
                </button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setSections((x) => [
                ...x,
                {
                  code: nextCode(),
                  name: `Section ${nextCode()}`,
                  siteCount: '40',
                  sitesPerRow: '10',
                  listPrice: '',
                },
              ])
            }
            disabled={sections.length >= 26}
          >
            + Add section
          </Button>
        </div>
      </Panel>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={submitting || !name.trim()}>
          {submitting ? 'Creating…' : 'Create cemetery'}
        </Button>
        <Button type="button" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
