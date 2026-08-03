import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// PWA_V1_COMPLETION_PLAN.md #5 -- no branded not-found.tsx existed anywhere, so a mistyped or
// stale URL fell through to Next.js's own unbranded default 404.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <p className="mt-4 font-display text-4xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          404
        </p>
        <h1 className="mt-1 text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Page not found
        </h1>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          The page you're looking for doesn't exist or has moved.
        </p>
        <Link href="/" className="mt-6 block">
          <Button variant="primary" className="w-full">
            Go home
          </Button>
        </Link>
      </div>
    </main>
  );
}
