'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import {
  ErrorBox,
  Field,
  inputClass,
  parseAmount,
  sendJson,
  todayIso,
} from '@/components/cemetery/formBits';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  formatZar,
  type TenureTerms,
} from '@/lib/cemetery/terms';

export interface SaleSiteOption {
  id: string;
  reference: string;
  saleStatus: 'available' | 'reserved';
  listPrice: number | null;
  reservedForId: string | null;
  reservedForName: string | null;
}

/**
 * The grave-site sale workflow on one screen: (1) site, (2) purchaser — existing or new, (3) price, (4) deposit,
 * then submit, which records the sale and receipt and marks the site sold in one database transaction.
 */
export function SaleForm({
  sites,
  purchasers,
  initialSiteId,
  terms,
  isDemo,
}: {
  sites: SaleSiteOption[];
  purchasers: { id: string; name: string }[];
  initialSiteId: string | null;
  terms: TenureTerms;
  isDemo: boolean;
}) {
  const router = useRouter();
  const initialSite = sites.find((s) => s.id === initialSiteId) ?? null;
  const [siteId, setSiteId] = useState(initialSite?.id ?? '');
  const [mode, setMode] = useState<'existing' | 'new'>(
    initialSite?.reservedForId || purchasers.length > 0 ? 'existing' : 'new',
  );
  const [purchaserId, setPurchaserId] = useState(initialSite?.reservedForId ?? '');
  const [np, setNp] = useState({
    fullName: '',
    phone: '',
    email: '',
    address: '',
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinRelationship: '',
  });
  const [price, setPrice] = useState(
    initialSite?.listPrice != null ? String(initialSite.listPrice) : '',
  );
  const [deposit, setDeposit] = useState('');
  const [saleDate, setSaleDate] = useState(todayIso());
  const [method, setMethod] = useState('eft');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const site = sites.find((s) => s.id === siteId) ?? null;
  const priceN = parseAmount(price);
  const depositN = deposit.trim() === '' ? 0 : parseAmount(deposit);
  const balance = useMemo(
    () => (Number.isFinite(priceN) && Number.isFinite(depositN) ? priceN - depositN : NaN),
    [priceN, depositN],
  );

  function chooseSite(id: string) {
    setSiteId(id);
    const s = sites.find((x) => x.id === id);
    if (s?.listPrice != null) setPrice(String(s.listPrice));
    if (s?.reservedForId) {
      setMode('existing');
      setPurchaserId(s.reservedForId);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!site) return setError('Choose a grave site.');
    if (!Number.isFinite(priceN) || priceN <= 0)
      return setFieldErrors({ price: ['Enter a price greater than zero'] });
    if (!Number.isFinite(depositN) || depositN < 0 || depositN > priceN) {
      return setFieldErrors({ deposit: ['The deposit must be between zero and the price'] });
    }
    if (mode === 'existing' && !purchaserId)
      return setFieldErrors({ purchaserId: [`Choose the ${terms.holderLower}`] });
    if (mode === 'new' && !np.fullName.trim())
      return setFieldErrors({ fullName: ['Enter the full name'] });
    setSubmitting(true);
    const result = await sendJson<{ sale: { sale_id: string } }>('/api/v1/cemetery/sales', 'POST', {
      siteId: site.id,
      purchaserId: mode === 'existing' ? purchaserId : null,
      newPurchaser: mode === 'new' ? np : null,
      price: priceN,
      deposit: depositN,
      saleDate,
      method,
      reference: reference || null,
      notes: notes || null,
    });
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setError(result.message);
      setFieldErrors(result.fieldErrors);
      return;
    }
    router.push(`/cemetery/sales/${result.data.sale.sale_id}?created=1`);
    router.refresh();
  }

  const reservedForOther =
    site?.saleStatus === 'reserved' &&
    mode === 'existing' &&
    purchaserId &&
    purchaserId !== site.reservedForId;

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <ErrorBox message={error} />
        <Panel title="1. Grave site">
          <Field label="Site" error={fieldErrors.siteId}>
            <select
              required
              value={siteId}
              onChange={(e) => chooseSite(e.target.value)}
              className={inputClass}
              aria-label="Grave site"
            >
              <option value="">Choose an available or reserved site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.reference} —{' '}
                  {s.saleStatus === 'reserved' ? `reserved for ${s.reservedForName}` : 'available'}
                  {s.listPrice != null ? ` · ${formatZar(s.listPrice)}` : ''}
                </option>
              ))}
            </select>
          </Field>
          {site?.saleStatus === 'reserved' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Reserved for <strong className="text-foreground">{site.reservedForName}</strong>. It
              can only be sold to them; release the reservation first to sell to someone else.
            </p>
          ) : null}
        </Panel>

        <Panel title={`2. ${terms.holder}`}>
          <div className="mb-3 flex gap-2" role="radiogroup" aria-label={`${terms.holder} type`}>
            {(['existing', 'new'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                disabled={m === 'existing' && purchasers.length === 0}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${mode === m ? 'border-primary bg-primary-soft text-primary' : 'border-border text-foreground'} disabled:opacity-40`}
              >
                {m === 'existing' ? `Existing ${terms.holderLower}` : `New ${terms.holderLower}`}
              </button>
            ))}
          </div>
          {mode === 'existing' ? (
            <Field label={terms.holder} error={fieldErrors.purchaserId}>
              <select
                value={purchaserId}
                onChange={(e) => setPurchaserId(e.target.value)}
                className={inputClass}
                aria-label={terms.holder}
              >
                <option value="">Choose…</option>
                {purchasers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {reservedForOther ? (
                <span className="mt-1 block text-xs text-destructive">
                  This site is reserved for someone else.
                </span>
              ) : null}
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" error={fieldErrors.fullName} className="sm:col-span-2">
                <input
                  value={np.fullName}
                  onChange={(e) => setNp({ ...np, fullName: e.target.value })}
                  className={inputClass}
                  maxLength={200}
                />
              </Field>
              <Field label="Contact number">
                <input
                  value={np.phone}
                  onChange={(e) => setNp({ ...np, phone: e.target.value })}
                  className={inputClass}
                  maxLength={40}
                  inputMode="tel"
                />
              </Field>
              <Field label="E-mail">
                <input
                  type="email"
                  value={np.email}
                  onChange={(e) => setNp({ ...np, email: e.target.value })}
                  className={inputClass}
                  maxLength={254}
                />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <input
                  value={np.address}
                  onChange={(e) => setNp({ ...np, address: e.target.value })}
                  className={inputClass}
                  maxLength={500}
                />
              </Field>
              <Field label="Next of kin / authorised contact">
                <input
                  value={np.nextOfKinName}
                  onChange={(e) => setNp({ ...np, nextOfKinName: e.target.value })}
                  className={inputClass}
                  maxLength={200}
                />
              </Field>
              <Field label="Their contact number">
                <input
                  value={np.nextOfKinPhone}
                  onChange={(e) => setNp({ ...np, nextOfKinPhone: e.target.value })}
                  className={inputClass}
                  maxLength={40}
                />
              </Field>
              <Field label="Relationship">
                <input
                  value={np.nextOfKinRelationship}
                  onChange={(e) => setNp({ ...np, nextOfKinRelationship: e.target.value })}
                  className={inputClass}
                  maxLength={80}
                />
              </Field>
            </div>
          )}
        </Panel>

        <Panel title="3. Price and deposit">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${terms.price} (ZAR)`} error={fieldErrors.price}>
              <input
                required
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
                placeholder="e.g. 12500"
              />
            </Field>
            <Field label="Date" error={fieldErrors.saleDate}>
              <input
                type="date"
                required
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Deposit / payment received now (ZAR)"
              error={fieldErrors.deposit}
              hint="Leave blank if nothing was received yet."
            >
              <input
                inputMode="decimal"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </Field>
            <Field label="Payment method">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={inputClass}
                disabled={!depositN}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment reference">
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className={inputClass}
                maxLength={120}
                disabled={!depositN}
              />
            </Field>
            <Field label="Internal notes">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputClass}
                maxLength={2000}
              />
            </Field>
          </div>
        </Panel>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:h-fit">
        <Panel title="Summary">
          <dl className="space-y-2 text-sm">
            <Row label="Site" value={site?.reference ?? '—'} />
            <Row
              label={terms.price}
              value={Number.isFinite(priceN) ? formatZar(priceN, { cents: true }) : '—'}
            />
            <Row
              label="Received now"
              value={Number.isFinite(depositN) ? formatZar(depositN, { cents: true }) : '—'}
            />
            <div className="border-t border-border pt-2">
              <Row
                label="Outstanding balance"
                value={
                  Number.isFinite(balance) ? formatZar(Math.max(balance, 0), { cents: true }) : '—'
                }
                strong
              />
            </div>
          </dl>
          {isDemo ? (
            <p className="mt-3 rounded-md bg-warning/15 px-3 py-2 text-[11px] text-foreground">
              Demonstration cemetery: this is recorded as a demo transaction. No money is taken or
              requested.
            </p>
          ) : (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Records money already received. Proplyst does not collect or request payment.
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="mt-4 w-full"
            disabled={submitting || !site || Boolean(reservedForOther)}
          >
            {submitting ? 'Recording…' : `Record ${terms.saleLower}`}
          </Button>
          <Button type="button" className="mt-2 w-full" onClick={() => router.back()}>
            Cancel
          </Button>
        </Panel>
      </aside>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`tabular ${strong ? 'text-base font-bold text-foreground' : 'font-medium text-foreground'}`}
      >
        {value}
      </dd>
    </div>
  );
}
