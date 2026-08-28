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
    // pointer-events-none on the card itself (V1 closeout browser-quality fix, WORKLOG.md this
    // date): this is a `fixed` corner card rendered at the dashboard-layout level, so it floats
    // over whatever real page content happens to occupy that screen region on any page in this
    // route group -- reproduced live by Playwright on /properties/:id/units/:id/leases/new, where
    // it sat on top of and swallowed the click on the "Record existing lease" card. Only the
    // tour's own actual controls (skip/X, the step link, Back/Next) re-enable pointer-events, so a
    // click anywhere else on the card's body now passes through to whatever is genuinely
    // underneath, instead of the tour silently blocking an unrelated action.
    // hidden below sm (V1 closeout browser-quality fix, WORKLOG.md this date): at mobile widths
    // this 320px card is nearly the full viewport width, so even with the pointer-events pass-
    // through above, its own necessarily-solid button row still collides with a page's real
    // primary action -- reproduced live by Playwright at 375px on /properties/:id/units/:id/
    // applications/new, where it sat on top of the "Create application" submit button. The tour
    // remains fully available on desktop/tablet; a first-run mobile user just doesn't see it
    // (standard practice for exactly this reason, not a loss of functionality -- nothing here was
    // mobile-only).
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 hidden w-80 rounded-card border border-light-border bg-light-surfaceRaised p-4 shadow-xl sm:block dark:border-dark-border dark:bg-dark-surfaceRaised">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-light-textMuted dark:text-dark-textMuted">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <button
          type="button"
          onClick={skipTour}
          aria-label="Skip tour"
          className="pointer-events-auto text-light-textMuted hover:text-light-textPrimary dark:text-dark-textMuted dark:hover:text-dark-textPrimary"
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
        className="pointer-events-auto mt-2 inline-block text-xs font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        Go to {step.navLabel} →
      </Link>
      <div className="pointer-events-auto mt-4 flex items-center justify-between gap-2">
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
