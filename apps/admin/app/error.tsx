'use client';

import { useEffect } from 'react';

/**
 * Next.js App Router convention: catches render errors in this segment and below. Previously
 * there was no error boundary anywhere in the admin app (launch-readiness audit, 2026-07-22) —
 * an uncaught error rendered a blank page with no recovery action.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No error-monitoring backend is wired in Phase 1/2 (see KNOWN_BUGS.md) — console is the
    // one safe sink here.
    console.error('[admin] Unhandled error', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          An unexpected error occurred. Try again, or contact engineering if it persists.
        </p>
        <button
          onClick={reset}
          className="mt-6 rounded-md bg-light-accent px-4 py-2 text-sm font-medium text-light-accentContrast dark:bg-dark-accent dark:text-dark-accentContrast"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
