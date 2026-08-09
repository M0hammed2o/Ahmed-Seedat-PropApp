'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TrustLedger } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

// Replaces the old customer-facing placeholder ("Trust deposit status ... is built at the API
// layer (TASKS.md M14) but not yet wired into this page.") -- the trust-ledger backend
// (post_lease_deposit()/release_trust_deposit(), migrations 20260101000038/51) already existed and
// worked; this was purely a missing UI wire-up (Stage 13).

interface DepositPanelProps {
  leaseId: string;
  leaseStatus: string;
  depositAmount: number;
  trustLedger: TrustLedger | null;
  canPost: boolean; // accountant+ -- same role gate post_lease_deposit()/release_trust_deposit() enforce server-side
}

export function DepositPanel({
  leaseId,
  leaseStatus,
  depositAmount,
  trustLedger,
  canPost,
}: DepositPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState(false);

  if (depositAmount <= 0 && !trustLedger) {
    return (
      <Panel title="Deposit">
        <p className="text-sm text-light-textMuted dark:text-dark-textMuted">
          No deposit amount was captured for this lease.
        </p>
      </Panel>
    );
  }

  async function postDeposit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/post-deposit`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to record deposit.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to record deposit — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!trustLedger) {
    return (
      <Panel title="Deposit">
        {error ? (
          <p className="mb-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
            {error}
          </p>
        ) : null}
        <p className="text-sm text-light-textPrimary dark:text-dark-textPrimary">
          R{depositAmount.toLocaleString('en-ZA')} deposit — not yet recorded in the trust ledger.
        </p>
        {leaseStatus !== 'active' ? (
          <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
            The deposit can be recorded once this lease is active.
          </p>
        ) : canPost ? (
          <Button
            className="mt-3"
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={postDeposit}
          >
            {busy ? 'Recording…' : 'Record deposit received'}
          </Button>
        ) : (
          <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
            An accountant or admin needs to record this deposit.
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Deposit">
      {error ? (
        <p className="mb-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Status</dt>
          <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
            {trustLedger.status === 'released' ? 'Released' : 'Held'}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Balance</dt>
          <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
            R{trustLedger.currentBalance.toLocaleString('en-ZA')}
          </dd>
        </div>
      </dl>

      {trustLedger.status === 'active' && canPost ? (
        releasing ? (
          <ReleaseForm
            trustLedgerId={trustLedger.id}
            currentBalance={trustLedger.currentBalance}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onDone={() => {
              setReleasing(false);
              router.refresh();
            }}
            onCancel={() => setReleasing(false)}
          />
        ) : (
          <Button className="mt-3" size="sm" onClick={() => setReleasing(true)}>
            Release deposit
          </Button>
        )
      ) : null}
    </Panel>
  );
}

function ReleaseForm({
  trustLedgerId,
  currentBalance,
  busy,
  setBusy,
  setError,
  onDone,
  onCancel,
}: {
  trustLedgerId: string;
  currentBalance: number;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [refundAmount, setRefundAmount] = useState(String(currentBalance));
  const [deductionAmount, setDeductionAmount] = useState('0');
  const [deductionMemo, setDeductionMemo] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/trust-ledgers/' + trustLedgerId + '/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundAmount: Number(refundAmount || '0'),
          deductionAmount: Number(deductionAmount || '0'),
          deductionMemo: deductionMemo || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        // release_trust_deposit() rejects release without a completed move-out inspection --
        // surfaced verbatim, it is already a clear customer-facing sentence.
        setError(body.error?.message ?? 'Failed to release deposit.');
        return;
      }
      onDone();
    } catch {
      setError('Failed to release deposit — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 max-w-sm space-y-3">
      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        Refund + deduction must equal the current balance (R
        {currentBalance.toLocaleString('en-ZA')}). Requires a completed move-out inspection.
      </p>
      <label className="block text-xs">
        <span className="text-light-textMuted dark:text-dark-textMuted">
          Refund to tenant (ZAR)
        </span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={refundAmount}
          onChange={(e) => setRefundAmount(e.target.value)}
          className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        />
      </label>
      <label className="block text-xs">
        <span className="text-light-textMuted dark:text-dark-textMuted">Deduction (ZAR)</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={deductionAmount}
          onChange={(e) => setDeductionAmount(e.target.value)}
          className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        />
      </label>
      {Number(deductionAmount || '0') > 0 ? (
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">
            Deduction reason (optional)
          </span>
          <input
            value={deductionMemo}
            onChange={(e) => setDeductionMemo(e.target.value)}
            className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
          />
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          {busy ? 'Releasing…' : 'Confirm release'}
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
