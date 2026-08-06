import 'server-only';
import { branding, resolveDemoMode } from '@propvault/config';

/**
 * Server-only (enforced by the `server-only` import above — this file fails the build if ever
 * imported from a client component). When true, every admin page reads from
 * lib/demo/adminMockData.ts instead of a live Supabase project.
 *
 * SECURITY (fixed 2026-07-30, closes PRODUCTION_READINESS_REPORT.md R-01 — see SECURITY.md's
 * "Demo-mode auth bypass" section for the full design): demo mode also makes `/login` accept
 * any credentials and skips the auth check in both `middleware.ts` and `lib/auth.ts` entirely
 * (see those files). It is now gated by TWO independent conditions, both of which default to
 * false/absent — `NEXT_PUBLIC_DEMO_MODE=true` (app-level, developer opts in) AND
 * `ALLOW_DEMO_MODE=true` (infra-level only, never in `.env`/the client bundle, and never set at
 * all in the production project's environment configuration). An unset/misconfigured variable
 * can no longer enable the bypass — both must be explicitly, deliberately set.
 */
export const ADMIN_DEMO_MODE = resolveDemoMode(
  process.env.NEXT_PUBLIC_DEMO_MODE,
  process.env.ALLOW_DEMO_MODE,
);

if (ADMIN_DEMO_MODE) {
  console.warn(
    `[${branding.productName}] Demo mode is ON (NEXT_PUBLIC_DEMO_MODE=true AND ALLOW_DEMO_MODE=true) — admin login accepts ANY credentials and all data is mock. ` +
      "ALLOW_DEMO_MODE must never be set in a production environment's infra configuration.",
  );
}
