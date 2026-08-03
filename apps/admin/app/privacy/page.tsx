import Link from 'next/link';
import { PRIVACY_VERSION, branding } from '@propvault/config';

// PRODUCT DECISION 1 (2026-08-03) -- placeholder legal content. See ./terms/page.tsx's identical
// note and packages/config/src/legal.ts.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm text-light-textPrimary dark:text-dark-textPrimary">
      <h1 className="font-display text-2xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">Version {PRIVACY_VERSION}</p>
      <p className="mt-6 rounded-lg border border-light-border bg-light-surfaceRaised p-4 text-light-textSecondary dark:border-dark-border dark:bg-dark-surfaceRaised dark:text-dark-textSecondary">
        Placeholder — the real Privacy Policy for {branding.productName} has not been finalized yet. This page
        exists so account registration has something concrete to reference and version; it is not binding legal
        content.
      </p>
      <Link href="/register" className="mt-6 inline-block text-light-accent hover:underline dark:text-dark-accent">
        ← Back to registration
      </Link>
    </main>
  );
}
