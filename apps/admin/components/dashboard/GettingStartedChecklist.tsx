'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, ChevronUp, Circle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { OnboardingProgress, OnboardingStep } from '@/lib/onboarding';

interface Props {
  orgId: string;
  progress: OnboardingProgress;
  /** Starts expanded on the zero-properties welcome screen; collapsed by default on the regular
   * dashboard once the org has real data, matching Phase 7's "should not become irritating after
   * completion" instruction -- and generally, "not the first thing you see every day forever." */
  defaultExpanded?: boolean;
}

/**
 * V1 commercial onboarding pass, Phase 7 -- persistent, resumable getting-started checklist.
 * Every step's `completed`/`skipped` state comes from resolveOnboardingProgress() (real system
 * state, see that function's own comment for why), fetched server-side and passed in as a prop;
 * this component only renders it and calls the one onboarding API route for the two actions that
 * need a write (skip staff, mark an intro viewed).
 */
export function GettingStartedChecklist({ orgId, progress, defaultExpanded = false }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [busy, setBusy] = useState(false);

  if (progress.allDone) return null;

  async function postAction(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/v1/organizations/${orgId}/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div>
          <p className="font-display text-sm font-bold text-light-textPrimary dark:text-dark-textPrimary">
            Getting started — {progress.percentComplete}%
          </p>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-light-border dark:bg-dark-border">
            <div
              className="h-full rounded-full bg-light-accent dark:bg-dark-accent transition-all"
              style={{ width: `${progress.percentComplete}%` }}
            />
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={18} className="shrink-0 text-light-textMuted dark:text-dark-textMuted" />
        ) : (
          <ChevronDown size={18} className="shrink-0 text-light-textMuted dark:text-dark-textMuted" />
        )}
      </button>

      {expanded ? (
        <ul className="space-y-1 border-t border-light-border px-3 pb-3 pt-2 dark:border-dark-border">
          {progress.steps.map((step) => (
            <ChecklistRow
              key={step.id}
              step={step}
              busy={busy}
              onSkipStaff={
                step.id === 'invite_staff' ? () => postAction({ action: 'skip_staff' }) : undefined
              }
              onMarkViewed={
                step.id === 'review_payments'
                  ? () => postAction({ action: 'mark_intro_viewed', intro: 'payments' })
                  : step.id === 'explore_documents'
                    ? () => postAction({ action: 'mark_intro_viewed', intro: 'documents' })
                    : undefined
              }
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ChecklistRow({
  step,
  busy,
  onSkipStaff,
  onMarkViewed,
}: {
  step: OnboardingStep;
  busy: boolean;
  onSkipStaff?: () => void;
  onMarkViewed?: () => void;
}) {
  const done = step.completed || step.skipped;
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-light-surface dark:hover:bg-dark-surface">
      <Link href={step.href} onClick={onMarkViewed} className="flex min-w-0 items-center gap-2.5">
        {done ? (
          <Check
            size={16}
            className="shrink-0 text-light-accent dark:text-dark-accent"
            aria-hidden="true"
          />
        ) : (
          <Circle
            size={16}
            className="shrink-0 text-light-textMuted dark:text-dark-textMuted"
            aria-hidden="true"
          />
        )}
        <span
          className={`truncate text-sm ${done ? 'text-light-textMuted line-through dark:text-dark-textMuted' : 'text-light-textPrimary dark:text-dark-textPrimary'}`}
        >
          {step.label}
          {step.skipped ? ' (skipped)' : ''}
        </span>
      </Link>
      {onSkipStaff && !done ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onSkipStaff}
          className="shrink-0"
        >
          Skip for now
        </Button>
      ) : null}
    </li>
  );
}
