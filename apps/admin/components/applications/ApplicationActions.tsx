'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Application } from '@propvault/types';
import { APPLICATION_SCREENING_STATUS_PRESENTATION } from '@propvault/ui';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';

// Workflow actions for a single application (API_SPEC.md §4: consent -> screen -> decide). Each
// action is its own fetch to its own dedicated endpoint -- there is no generic PATCH for
// applications, this component IS the "edit" surface for this resource, shaped around the real
// state machine instead of a generic field-editing form.

export function ApplicationActions({ application, canAct }: { application: Application; canAct: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function recordConsent(kind: 'popiaConsent' | 'screeningConsent') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/applications/${application.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [kind]: true }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to record consent.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to record consent — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function runScreening() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/applications/${application.id}/screen`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to run screening.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to run screening — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (application.status === 'decided') {
    return (
      <div className="mt-6 rounded-lg border border-light-border p-4 dark:border-dark-border">
        <p className="text-sm text-light-textPrimary dark:text-dark-textPrimary">
          Decided: <span className="font-medium capitalize">{application.decision}</span>
          {application.decisionReason ? ` — ${application.decisionReason}` : ''}
        </p>
        <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
          {application.decidedAt ? new Date(application.decidedAt).toLocaleString('en-ZA') : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Consent</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <ConsentRow
            label="POPIA consent"
            grantedAt={application.popiaConsentAt}
            canAct={canAct}
            busy={busy}
            onGrant={() => recordConsent('popiaConsent')}
          />
          <ConsentRow
            label="Screening consent"
            grantedAt={application.screeningConsentAt}
            canAct={canAct}
            busy={busy}
            onGrant={() => recordConsent('screeningConsent')}
          />
        </div>
      </div>

      <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Screening</h2>
          <StatusBadge presentation={APPLICATION_SCREENING_STATUS_PRESENTATION[application.screeningStatus]} />
        </div>
        {canAct ? (
          <Button
            className="mt-3"
            size="sm"
            disabled={busy || !application.screeningConsentAt}
            onClick={runScreening}
          >
            Run screening
          </Button>
        ) : null}
        {!application.screeningConsentAt ? (
          <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
            Screening consent must be recorded first.
          </p>
        ) : null}
      </div>

      {canAct ? <DecisionPanel applicationId={application.id} busy={busy} setBusy={setBusy} setError={setError} /> : null}
    </div>
  );
}

function ConsentRow({
  label,
  grantedAt,
  canAct,
  busy,
  onGrant,
}: {
  label: string;
  grantedAt: string | null;
  canAct: boolean;
  busy: boolean;
  onGrant: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-light-textSecondary dark:text-dark-textSecondary">{label}:</span>
      {grantedAt ? (
        <span className="text-light-statusPaid dark:text-dark-statusPaid">
          Granted {new Date(grantedAt).toLocaleDateString('en-ZA')}
        </span>
      ) : canAct ? (
        <Button size="sm" disabled={busy} onClick={onGrant}>
          Record
        </Button>
      ) : (
        <span className="text-light-textMuted dark:text-dark-textMuted">Not yet granted</span>
      )}
    </div>
  );
}

function DecisionPanel({
  applicationId,
  busy,
  setBusy,
  setError,
}: {
  applicationId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'approve' | 'decline'>('approve');
  const [rentAmount, setRentAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload =
        mode === 'approve'
          ? {
              decision: 'approved',
              rentAmount: Number(rentAmount),
              depositAmount: Number(depositAmount || '0'),
              startDate,
              endDate: endDate || null,
            }
          : { decision: 'declined', reason: reason || null };
      const response = await fetch(`/api/v1/applications/${applicationId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to record decision.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to record decision — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Decision</h2>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant={mode === 'approve' ? 'primary' : 'secondary'}
          type="button"
          onClick={() => setMode('approve')}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant={mode === 'decline' ? 'destructive' : 'secondary'}
          type="button"
          onClick={() => setMode('decline')}
        >
          Decline
        </Button>
      </div>

      <form onSubmit={submit} className="mt-4 max-w-md space-y-3">
        {mode === 'approve' ? (
          <>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Rent amount (ZAR)</span>
              <input
                required
                type="number"
                min={0}
                step={0.01}
                value={rentAmount}
                onChange={(e) => setRentAmount(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Deposit amount (ZAR)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Start date</span>
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">End date (optional)</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
            </label>
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
              Approving atomically creates the tenant, lease, and first rent-schedule row.
            </p>
          </>
        ) : (
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Reason (optional)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputClass} />
          </label>
        )}

        <Button type="submit" variant={mode === 'approve' ? 'primary' : 'destructive'} disabled={busy}>
          {busy ? 'Saving…' : mode === 'approve' ? 'Approve application' : 'Decline application'}
        </Button>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
