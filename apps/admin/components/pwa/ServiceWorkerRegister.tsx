'use client';

import { useEffect } from 'react';

// Registers public/sw.js once on mount. A plain client component (not an inline <script>) so it
// goes through the normal JS bundle and is unaffected by the strict script-src CSP nonce policy
// (proxy.ts) -- no CSP change was needed for this (worker-src 'self' blob: already covers a
// same-origin service worker). Feature-detects navigator.serviceWorker so this is a silent no-op
// on any browser without support, never a console error.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[ServiceWorkerRegister] registration failed', err);
    });
  }, []);

  return null;
}
