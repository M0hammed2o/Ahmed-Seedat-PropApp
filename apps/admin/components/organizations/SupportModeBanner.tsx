'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActiveSupportSession } from '@/lib/orgSession';

// SECURITY.md's Super Admin support-mode section: "Banner-visible, never silent... a hard
// requirement, not a nice-to-have" -- persistent, non-dismissible (no close button) while a
// support_access_sessions row is open for the org currently being viewed. Renders inside
// AppShell's `banner` slot, above every (dashboard) page (PWA_V1_COMPLETION_PLAN.md #12).
export function SupportModeBanner({
  session,
  orgName,
}: {
  session: ActiveSupportSession;
  orgName?: string;
}) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);

  async function endSession() {
    setEnding(true);
    try {
      await fetch(`/api/v1/admin/support-sessions/${session.sessionId}/end`, { method: 'POST' });
      router.push('/customers');
      router.refresh();
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-light-statusOverdue px-4 py-2 text-xs font-medium text-white dark:bg-dark-statusOverdue">
      <span>
        Support mode — viewing <strong>{orgName ?? session.orgId}</strong> (read-only) since{' '}
        {new Date(session.startedAt).toLocaleString('en-ZA')}.
      </span>
      <button
        type="button"
        onClick={endSession}
        disabled={ending}
        className="shrink-0 rounded-md border border-white/40 px-2.5 py-1 hover:bg-white/10"
      >
        {ending ? 'Ending…' : 'End session'}
      </button>
    </div>
  );
}
