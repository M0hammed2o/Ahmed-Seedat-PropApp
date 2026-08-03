import Link from 'next/link';
import { TERMS_VERSION, branding } from '@propvault/config';

// PRODUCT DECISION 1 (2026-08-03) -- placeholder legal content, not real Terms of Service. See
// packages/config/src/legal.ts's own comment: the actual text is real legal work pending, out of
// engineering scope. This page exists so registration's "accept the Terms" checkbox links
// somewhere real rather than a dead link, and so acceptedTermsVersion has a version to reference.
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm text-light-textPrimary dark:text-dark-textPrimary">
      <h1 className="font-display text-2xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">Version {TERMS_VERSION}</p>
      <p className="mt-6 rounded-lg border border-light-border bg-light-surfaceRaised p-4 text-light-textSecondary dark:border-dark-border dark:bg-dark-surfaceRaised dark:text-dark-textSecondary">
        Placeholder — the real Terms of Service for {branding.productName} have not been finalized yet. This page
        exists so account registration has something concrete to reference and version; it is not binding legal
        content.
      </p>
      <Link href="/register" className="mt-6 inline-block text-light-accent hover:underline dark:text-dark-accent">
        ← Back to registration
      </Link>
    </main>
  );
}
