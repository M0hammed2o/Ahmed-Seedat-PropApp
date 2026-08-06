import 'server-only';

/**
 * Base URL for links embedded in outbound emails (invite acceptance, password reset). No hosting
 * platform is chosen yet (TECHNICAL_DEBT_REGISTER.md TD-20's same root gap), so this reads a
 * plain env var rather than a platform-specific one (e.g. VERCEL_URL) to stay host-agnostic;
 * falls back to localhost for local dev so links are still clickable in a demo/local Mailpit
 * inbox without any extra setup.
 */
export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}
