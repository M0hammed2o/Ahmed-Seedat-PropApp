'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';

// PHASE 4: "DO NOT treat merely opening a PDF as acceptance. Require an explicit action." Marks
// the requirement VIEWED once (best-effort, on mount) purely for staff-side visibility -- the
// acceptance checkbox + button below is the only thing that ever calls .../acknowledge.

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function ComplianceAcknowledgeClient({
  requirementId,
  status,
  ruleTitle,
  versionNumber,
  effectiveDate,
  signedUrl,
}: {
  requirementId: string;
  status: string;
  ruleTitle: string;
  versionNumber: number;
  effectiveDate: string | null;
  signedUrl: string | null;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(status === 'acknowledged');
  const acceptanceStatement = `I confirm that I have read and understand ${ruleTitle} (version ${versionNumber}) and agree to comply with it.`;

  useEffect(() => {
    if (status === 'pending') {
      fetch(`/api/v1/tenant-portal/compliance/${requirementId}/view`, { method: 'POST' }).catch(
        () => {},
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  }, []);

  async function acknowledge() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/tenant-portal/compliance/${requirementId}/acknowledge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acceptanceStatement }),
        },
      );
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Could not record your acknowledgement.');
        return;
      }
      setAcknowledged(true);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'waived') {
    return (
      <Panel bodyClassName="p-6 text-center">
        <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
          This requirement has been waived by your property manager.
        </p>
      </Panel>
    );
  }

  if (acknowledged) {
    return (
      <Panel bodyClassName="p-6 text-center">
        <CheckCircle2
          size={28}
          className="mx-auto text-light-statusPaid dark:text-dark-statusPaid"
          aria-hidden="true"
        />
        <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          You&apos;ve acknowledged this document. Thank you.
        </p>
      </Panel>
    );
  }

  return (
    <Panel bodyClassName="p-6 space-y-4">
      <div className="flex items-center gap-3 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Effective {formatDate(effectiveDate)}</span>
      </div>

      {signedUrl ? (
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm font-medium text-light-accent hover:underline dark:text-dark-accent"
        >
          View document
        </a>
      ) : (
        <p className="text-sm text-light-textMuted dark:text-dark-textMuted">
          The document could not be loaded right now.
        </p>
      )}

      <label className="flex items-start gap-2 text-sm text-light-textPrimary dark:text-dark-textPrimary">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5"
        />
        <span>{acceptanceStatement}</span>
      </label>

      {error ? <p className="text-sm text-light-danger dark:text-dark-danger">{error}</p> : null}

      <Button variant="primary" disabled={!checked || submitting} onClick={acknowledge}>
        {submitting ? 'Submitting…' : 'Sign & acknowledge'}
      </Button>
    </Panel>
  );
}
