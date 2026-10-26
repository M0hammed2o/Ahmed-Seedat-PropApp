'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import {
  ErrorBox,
  Field,
  inputClass,
  parseAmount,
  sendJson,
  todayIso,
} from '@/components/cemetery/formBits';
import type { GraveSaleStatus, TenureTerms } from '@/lib/cemetery/terms';

type Panel = 'reserve' | 'withdraw' | 'burial' | 'edit' | 'document' | null;

/** Manager actions on one grave site. Each action is a separate, validated database operation. */
export function SiteActions({
  site,
  purchasers,
  terms,
}: {
  site: {
    id: string;
    reference: string;
    saleStatus: GraveSaleStatus;
    hasActiveSale: boolean;
    activeSaleId: string | null;
    burialsRecorded: number;
    maxInterments: number;
    listPrice: number | null;
    lengthM: number | null;
    widthM: number | null;
    siteType: string;
    notes: string | null;
  };
  purchasers: { id: string; name: string }[];
  terms: TenureTerms;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError(null);
    const result = await sendJson(url, method, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setOpen(null);
    router.refresh();
    return true;
  }

  const canSell = site.saleStatus === 'available' || site.saleStatus === 'reserved';
  const canBury = site.hasActiveSale && site.burialsRecorded < site.maxInterments;

  return (
    <div className="space-y-3">
      <ErrorBox message={error} />
      <div className="flex flex-wrap gap-2">
        {canSell ? (
          <Link
            href={`/cemetery/sales/new?siteId=${site.id}`}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            {terms.sellAction}
          </Link>
        ) : null}
        {site.saleStatus === 'available' ? (
          <>
            <Button size="sm" onClick={() => setOpen(open === 'reserve' ? null : 'reserve')}>
              Reserve
            </Button>
            <Button size="sm" onClick={() => setOpen(open === 'withdraw' ? null : 'withdraw')}>
              Mark unavailable
            </Button>
          </>
        ) : null}
        {site.saleStatus === 'reserved' ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run(`/api/v1/cemetery/sites/${site.id}/reservation`, 'DELETE')}
          >
            Release reservation
          </Button>
        ) : null}
        {site.saleStatus === 'unavailable' ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(`/api/v1/cemetery/sites/${site.id}/availability`, 'POST', { unavailable: false })
            }
          >
            Return to sale
          </Button>
        ) : null}
        {canBury ? (
          <Button size="sm" onClick={() => setOpen(open === 'burial' ? null : 'burial')}>
            Record burial
          </Button>
        ) : null}
        <Button size="sm" onClick={() => setOpen(open === 'edit' ? null : 'edit')}>
          Edit details
        </Button>
        <Button size="sm" onClick={() => setOpen(open === 'document' ? null : 'document')}>
          Add document
        </Button>
      </div>

      {open === 'reserve' ? (
        <ReserveForm
          purchasers={purchasers}
          terms={terms}
          busy={busy}
          onSubmit={(b) => run(`/api/v1/cemetery/sites/${site.id}/reservation`, 'POST', b)}
        />
      ) : null}
      {open === 'withdraw' ? (
        <WithdrawForm
          busy={busy}
          onSubmit={(reason) =>
            run(`/api/v1/cemetery/sites/${site.id}/availability`, 'POST', {
              unavailable: true,
              reason,
            })
          }
        />
      ) : null}
      {open === 'burial' ? (
        <BurialForm
          busy={busy}
          onSubmit={(b) => run(`/api/v1/cemetery/sites/${site.id}/burials`, 'POST', b)}
        />
      ) : null}
      {open === 'edit' ? (
        <EditForm
          site={site}
          busy={busy}
          onSubmit={(b) => run(`/api/v1/cemetery/sites/${site.id}`, 'PATCH', b)}
        />
      ) : null}
      {open === 'document' ? (
        <DocumentForm
          busy={busy}
          onSubmit={(b) =>
            run(`/api/v1/cemetery/sites/${site.id}/documents`, 'POST', {
              ...(b as Record<string, unknown>),
              saleId: site.activeSaleId,
            })
          }
        />
      ) : null}
    </div>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-3 text-sm font-semibold text-foreground">{title}</p>
      {children}
    </div>
  );
}

function ReserveForm({
  purchasers,
  terms,
  busy,
  onSubmit,
}: {
  purchasers: { id: string; name: string }[];
  terms: TenureTerms;
  busy: boolean;
  onSubmit: (b: unknown) => void;
}) {
  const [purchaserId, setPurchaserId] = useState('');
  const [until, setUntil] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Box title="Reserve this site">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ purchaserId, reservedUntil: until || null, notes: notes || null });
        }}
      >
        <Field label={`For ${terms.holderLower}`}>
          <select
            required
            value={purchaserId}
            onChange={(e) => setPurchaserId(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {purchasers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hold until (optional)">
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Notes">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
            maxLength={500}
          />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" size="sm" disabled={busy || !purchaserId}>
            {busy ? 'Saving…' : 'Reserve site'}
          </Button>
          {purchasers.length === 0 ? (
            <span className="ml-3 text-xs text-muted-foreground">
              Add a {terms.holderLower} first under{' '}
              <Link className="underline" href="/cemetery/purchasers/new">
                {terms.holders}
              </Link>
              .
            </span>
          ) : null}
        </div>
      </form>
    </Box>
  );
}

function WithdrawForm({ busy, onSubmit }: { busy: boolean; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Box title="Mark as unavailable">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit(reason);
        }}
      >
        <Field label="Reason (e.g. drainage, tree roots, path)" className="flex-1">
          <input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
            maxLength={300}
          />
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !reason.trim()}>
          {busy ? 'Saving…' : 'Mark unavailable'}
        </Button>
      </form>
    </Box>
  );
}

function BurialForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({
    deceasedFullName: '',
    dateOfBirth: '',
    dateOfDeath: '',
    burialDate: todayIso(),
    burialOrderNumber: '',
    funeralUndertaker: '',
    notes: '',
  });
  return (
    <Box title="Record a burial">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({
            ...f,
            dateOfBirth: f.dateOfBirth || null,
            dateOfDeath: f.dateOfDeath || null,
            burialOrderNumber: f.burialOrderNumber || null,
            funeralUndertaker: f.funeralUndertaker || null,
            notes: f.notes || null,
          });
        }}
      >
        <Field label="Full name of the deceased" className="sm:col-span-2">
          <input
            required
            value={f.deceasedFullName}
            onChange={(e) => setF({ ...f, deceasedFullName: e.target.value })}
            className={inputClass}
            maxLength={200}
          />
        </Field>
        <Field label="Date of birth">
          <input
            type="date"
            value={f.dateOfBirth}
            onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Date of death">
          <input
            type="date"
            value={f.dateOfDeath}
            onChange={(e) => setF({ ...f, dateOfDeath: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Burial date">
          <input
            type="date"
            required
            value={f.burialDate}
            onChange={(e) => setF({ ...f, burialDate: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Burial order number">
          <input
            value={f.burialOrderNumber}
            onChange={(e) => setF({ ...f, burialOrderNumber: e.target.value })}
            className={inputClass}
            maxLength={60}
          />
        </Field>
        <Field label="Funeral undertaker" className="sm:col-span-2">
          <input
            value={f.funeralUndertaker}
            onChange={(e) => setF({ ...f, funeralUndertaker: e.target.value })}
            className={inputClass}
            maxLength={200}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={busy || !f.deceasedFullName.trim()}
          >
            {busy ? 'Saving…' : 'Record burial'}
          </Button>
        </div>
      </form>
    </Box>
  );
}

function EditForm({
  site,
  busy,
  onSubmit,
}: {
  site: {
    listPrice: number | null;
    lengthM: number | null;
    widthM: number | null;
    siteType: string;
    maxInterments: number;
    notes: string | null;
  };
  busy: boolean;
  onSubmit: (b: unknown) => void;
}) {
  const [f, setF] = useState({
    listPrice: site.listPrice != null ? String(site.listPrice) : '',
    lengthM: site.lengthM != null ? String(site.lengthM) : '',
    widthM: site.widthM != null ? String(site.widthM) : '',
    siteType: site.siteType,
    maxInterments: String(site.maxInterments),
    notes: site.notes ?? '',
  });
  const n = (v: string) => (v.trim() === '' ? null : parseAmount(v));
  return (
    <Box title="Edit site details">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({
            listPrice: n(f.listPrice),
            lengthM: n(f.lengthM),
            widthM: n(f.widthM),
            siteType: f.siteType,
            maxInterments: Number(f.maxInterments),
            notes: f.notes || null,
          });
        }}
      >
        <Field label="List price (ZAR)">
          <input
            inputMode="decimal"
            value={f.listPrice}
            onChange={(e) => setF({ ...f, listPrice: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Length (m)">
          <input
            inputMode="decimal"
            value={f.lengthM}
            onChange={(e) => setF({ ...f, lengthM: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Width (m)">
          <input
            inputMode="decimal"
            value={f.widthM}
            onChange={(e) => setF({ ...f, widthM: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Site type">
          <select
            value={f.siteType}
            onChange={(e) => setF({ ...f, siteType: e.target.value })}
            className={inputClass}
          >
            <option value="single">Single</option>
            <option value="double">Double (two interments)</option>
            <option value="child">Child</option>
            <option value="cremation">Cremation niche / plot</option>
          </select>
        </Field>
        <Field label="Interments allowed">
          <input
            type="number"
            min={1}
            max={10}
            value={f.maxInterments}
            onChange={(e) => setF({ ...f, maxInterments: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Internal notes" className="sm:col-span-3">
          <textarea
            rows={3}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            className={inputClass}
            maxLength={2000}
          />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? 'Saving…' : 'Save details'}
          </Button>
        </div>
      </form>
    </Box>
  );
}

function DocumentForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({ title: '', documentType: 'agreement', reference: '', notes: '' });
  return (
    <Box title="Add to the document register">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ ...f, reference: f.reference || null, notes: f.notes || null });
        }}
      >
        <Field label="Title" className="sm:col-span-2">
          <input
            required
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            className={inputClass}
            maxLength={200}
          />
        </Field>
        <Field label="Type">
          <select
            value={f.documentType}
            onChange={(e) => setF({ ...f, documentType: e.target.value })}
            className={inputClass}
          >
            <option value="agreement">Agreement</option>
            <option value="title_deed">Title / rights certificate</option>
            <option value="burial_order">Burial order</option>
            <option value="death_certificate">Death certificate</option>
            <option value="id_document">ID document</option>
            <option value="correspondence">Correspondence</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Reference / where it is filed">
          <input
            value={f.reference}
            onChange={(e) => setF({ ...f, reference: e.target.value })}
            className={inputClass}
            maxLength={120}
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <input
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            className={inputClass}
            maxLength={1000}
          />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" size="sm" disabled={busy || !f.title.trim()}>
            {busy ? 'Saving…' : 'Add document'}
          </Button>
        </div>
      </form>
    </Box>
  );
}
