'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeaseStatus, Tenant } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

// Replaces the old bare "PATCH status" lease-status dropdown (LeaseForm.tsx) with the same
// workflow-action-panel pattern ApplicationActions.tsx/InspectionActions.tsx already establish:
// status transitions are actions with real preconditions, not a free-text field. Also resolves
// the lease detail page's former "No tenant assigned to this lease yet." dead end (Stage 10).

interface LeaseActionsProps {
  leaseId: string;
  orgId: string;
  status: LeaseStatus;
  hasTenant: boolean;
  canEdit: boolean;
  source: 'manual' | 'application_approved';
}

export function LeaseActions({ leaseId, orgId, status, hasTenant, canEdit, source }: LeaseActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canEdit) return null;

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/activate`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to activate lease.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to activate lease — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function end(target: 'expired' | 'terminated') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to end lease.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to end lease — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const showTenantPicker = status === 'draft' && !hasTenant;
  const showActivate = status === 'draft';
  const showEnd = status === 'active';
  // V1 launch-completion pass, Section 8: a manual/imported lease has no Prepare/Send workflow
  // (gated out on the detail page for source !== 'application_approved') -- this is where it
  // retains its already-signed document instead, directly, no re-signature step.
  const showDocumentUpload = status === 'draft' && source === 'manual';

  if (!showTenantPicker && !showActivate && !showEnd && !showDocumentUpload) return null;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {showTenantPicker ? (
        <TenantAssignPanel
          leaseId={leaseId}
          orgId={orgId}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onAssigned={() => router.refresh()}
        />
      ) : null}

      {showDocumentUpload ? (
        <SignedDocumentPanel leaseId={leaseId} busy={busy} setBusy={setBusy} setError={setError} />
      ) : null}

      {showActivate ? (
        <Panel title="Activate lease">
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            {hasTenant
              ? 'Activating this lease will mark the unit occupied and generate its first rent-schedule entry.'
              : 'Assign a tenant above before this lease can be activated.'}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="primary"
            disabled={busy || !hasTenant}
            onClick={activate}
          >
            {busy ? 'Activating…' : 'Activate lease'}
          </Button>
        </Panel>
      ) : null}

      {showEnd ? (
        <Panel title="End lease">
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            Ending this lease returns the unit to vacant (unless another active lease or a
            maintenance flag applies).
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => end('expired')}>
              Mark expired
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => end('terminated')}
            >
              Terminate
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

interface LeaseDocumentSummary {
  id: string;
  originalFileName: string | null;
  createdAt: string;
}

function SignedDocumentPanel({
  leaseId,
  busy,
  setBusy,
  setError,
}: {
  leaseId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [latest, setLatest] = useState<LeaseDocumentSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/leases/${leaseId}/documents`)
      .then((res) => res.json())
      .then((body) => setLatest(body.leaseDocuments?.[0] ?? null))
      .catch(() => setLatest(null))
      .finally(() => setLoaded(true));
  }, [leaseId]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch(`/api/v1/leases/${leaseId}/documents`, {
        method: 'POST',
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to upload the signed lease document.');
        return;
      }
      setLatest(body.leaseDocument);
      router.refresh();
    } catch {
      setError('Failed to upload the signed lease document — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Signed lease document">
      {!loaded ? (
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Loading…</p>
      ) : latest ? (
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          Attached: {latest.originalFileName ?? 'signed lease document'}. Uploading a new file
          replaces it.
        </p>
      ) : (
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          No signed lease document attached yet — this lease can still be activated without one,
          but attaching the already-signed copy keeps a durable record.
        </p>
      )}
      <input
        type="file"
        accept="application/pdf,.docx"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        className="mt-2 block text-xs text-light-textMuted dark:text-dark-textMuted"
      />
    </Panel>
  );
}

function TenantAssignPanel({
  leaseId,
  orgId,
  busy,
  setBusy,
  setError,
  onAssigned,
}: {
  leaseId: string;
  orgId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onAssigned: () => void;
}) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/tenants?filter[org_id]=${orgId}&filter[status]=active`)
      .then((res) => res.json())
      .then((body) => setTenants(body.tenants ?? []))
      .catch(() => setTenants([]))
      .finally(() => setLoaded(true));
  }, [orgId]);

  async function assign() {
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, isPrimary: true }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to assign tenant.');
        return;
      }
      onAssigned();
    } catch {
      setError('Failed to assign tenant — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Assign tenant">
      {!loaded ? (
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Loading tenants…</p>
      ) : tenants.length === 0 ? (
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          No tenants yet in this organization.{' '}
          <a
            href="/tenants/new"
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            Add a tenant
          </a>{' '}
          first, then assign them here.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Tenant</span>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="mt-1 block w-64 rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
            >
              <option value="">Select a tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="primary" disabled={busy || !tenantId} onClick={assign}>
            {busy ? 'Assigning…' : 'Assign tenant'}
          </Button>
        </div>
      )}
    </Panel>
  );
}
