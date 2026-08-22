'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { WalkthroughStep } from '@/lib/walkthroughSteps';

export const RESTART_WALKTHROUGH_EVENT = 'proplyst:restart-walkthrough';

/** Fired from anywhere (Settings' "Restart guided tour" button) to reopen the SAME overlay
 * instance mounted once in the dashboard layout -- a plain DOM CustomEvent rather than threading
 * React context across the layout/page boundary, matching this pass's "lightweight internal
 * implementation, no heavy dependency" instruction. */
export function requestWalkthroughRestart() {
  window.dispatchEvent(new CustomEvent(RESTART_WALKTHROUGH_EVENT));
}

interface Props {
  orgId: string;
  steps: WalkthroughStep[];
  /** Auto-open on first mount when the walkthrough has never been dismissed or completed --
   * "do not automatically restart after completion." */
  autoShow: boolean;
}

async function postWalkthroughState(orgId: string, state: 'dismissed' | 'completed' | 'restart') {
  try {
    await fetch(`/api/v1/organizations/${orgId}/onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'walkthrough', state }),
    });
  } catch {
    // Best-effort persistence -- a failed write just means the tour may show again next visit,
    // never a blocking error for the user.
  }
}

/**
 * V1 commercial UX pass, Phase 8 -- the actual interactive walkthrough UI (the persistence layer
 * already existed; this is the piece that was missing). A simple floating card, not a full
 * DOM-spotlight engine -- each step names and links to the relevant section rather than drawing a
 * highlight box around it, a deliberate "lightweight, no heavy third-party tour dependency" scope
 * decision.
 */
export function WalkthroughOverlay({ orgId, steps, autoShow }: Props) {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (autoShow) setVisible(true);
  }, [autoShow]);

  useEffect(() => {
    function onRestart() {
      setStepIndex(0);
      setVisible(true);
    }
    window.addEventListener(RESTART_WALKTHROUGH_EVENT, onRestart);
    return () => window.removeEventListener(RESTART_WALKTHROUGH_EVENT, onRestart);
  }, []);

  if (!visible || steps.length === 0) return null;

  const step = steps[stepIndex]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  function close() {
    setVisible(false);
  }

  async function skipTour() {
    close();
    await postWalkthroughState(orgId, 'dismissed');
  }

  async function next() {
    if (isLast) {
      close();
      await postWalkthroughState(orgId, 'completed');
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function back() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-80 rounded-card border border-light-border bg-light-surfaceRaised p-4 shadow-xl dark:border-dark-border dark:bg-dark-surfaceRaised">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-light-textMuted dark:text-dark-textMuted">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <button
          type="button"
          onClick={skipTour}
          aria-label="Skip tour"
          className="text-light-textMuted hover:text-light-textPrimary dark:text-dark-textMuted dark:hover:text-dark-textPrimary"
        >
          <X size={16} />
        </button>
      </div>
      <h3 className="mt-1 font-display text-sm font-bold text-light-textPrimary dark:text-dark-textPrimary">
        {step.title}
      </h3>
      <p className="mt-1.5 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {step.body}
      </p>
      <Link
        href={step.href}
        className="mt-2 inline-block text-xs font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        Go to {step.navLabel} →
      </Link>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={skipTour}>
          Skip tour
        </Button>
        <div className="flex gap-2">
          {!isFirst ? (
            <Button variant="secondary" size="sm" onClick={back}>
              Back
            </Button>
          ) : null}
          <Button size="sm" onClick={next}>
            {isLast ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
