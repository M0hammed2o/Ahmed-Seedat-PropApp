import { LoginForm } from './LoginForm';

// Forced dynamic (2026-08-02, proxy.ts's CSP-nonce fix): nonce-based CSP requires every page to
// render per-request, since the nonce can't exist at build time. This page was previously a
// single 'use client' file with no way to attach this export -- split into this thin Server
// Component wrapper + LoginForm.tsx (unchanged content, just relocated) so the export has
// somewhere to live.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <LoginForm />;
}
