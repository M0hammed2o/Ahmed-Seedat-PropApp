'use client';

import { useState, type FormEvent } from 'react';
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
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, formatZar } from '@/lib/cemetery/terms';

/** Record a payment received against a grave-site sale; the database refuses anything above the balance. */
export function PaymentForm({
  saleId,
  balance,
  isDemo,
}: {
  saleId: string;
  balance: number;
  isDemo: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(balance));
  const [paidOn, setPaidOn] = useState(todayIso());
  const [method, setMethod] = useState('eft');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const n = parseAmount(amount);
    if (!Number.isFinite(n) || n <= 0)
      return setFieldErrors({ amount: ['Enter an amount greater than zero'] });
    if (n > balance + 0.0001)
      return setFieldErrors({
        amount: [`The balance due is ${formatZar(balance, { cents: true })}`],
      });
    setSubmitting(true);
    const result = await sendJson<{ payment: { payment_id: string } }>(
      `/api/v1/cemetery/sales/${saleId}/payments`,
      'POST',
      {
        amount: n,
        paidOn,
        method,
        reference: reference || null,
      },
    );
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setError(result.message);
      setFieldErrors(result.fieldErrors);
      return;
    }
    router.push(`/cemetery/receipts/${result.data.payment.payment_id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <ErrorBox message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount received (ZAR)" error={fieldErrors.amount}>
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Date received" error={fieldErrors.paidOn}>
          <input
            type="date"
            required
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={inputClass}
            maxLength={120}
          />
        </Field>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {isDemo ? 'Demonstration transaction — no money is taken or requested. ' : ''}A receipt is
        issued for the recorded payment.
      </p>
      <Button type="submit" variant="primary" disabled={submitting}>
        {submitting ? 'Recording…' : 'Record payment & issue receipt'}
      </Button>
    </form>
  );
}
