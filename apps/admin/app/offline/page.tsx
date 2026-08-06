import { WifiOff } from 'lucide-react';

// PWA offline fallback (Stage 5, commercial-launch execution plan) -- the service worker
// (public/sw.js) serves this page when a navigation request fails with no network available and
// no cached copy of the requested page exists. Deliberately static/no data fetching of its own
// (it exists precisely for the case where fetching would fail) and precached at service-worker
// install time so it's available even on a visitor's very first, otherwise-uncached load.
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <WifiOff size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          You're offline
        </h1>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          This page needs a connection to load. Financial and tenant data is never shown from a
          cached copy — reconnect and try again.
        </p>
      </div>
    </main>
  );
}
