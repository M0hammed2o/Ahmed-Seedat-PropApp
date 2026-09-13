import 'server-only';
import { resolveDemoMode } from '@propvault/config';

/**
 * When may document intelligence run, and which stored results may be trusted?
 *
 * The rule this module exists to enforce: PRODUCTION NEVER USES THE MOCK PROVIDER.
 *
 * MockDocumentIntelligenceProvider returns plausible, mostly unlabelled values -- an ID number of
 * 9001015800086 at 0.92 confidence, a gross income of R25,000, a monthly rent of R8,500. That is
 * exactly right for local development and automated tests, and exactly wrong anywhere a landlord
 * could accept those figures into a tenant record or an affordability decision. Before this module
 * existed, getDocumentIntelligenceProvider() silently fell back to the mock whenever Google Cloud
 * Document AI was not fully configured, in every environment, production included.
 *
 * Everything here is a pure function of an environment object, defaulting to process.env, so the
 * whole policy is testable without mutating globals. Nothing here imports a provider.
 */

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

/**
 * Provider names that represent a REAL document read. Kept in step with
 * GoogleDocumentAIProvider.providerName by a unit test, so the two cannot drift apart silently.
 */
export const REAL_DOCUMENT_INTELLIGENCE_PROVIDER_NAMES: ReadonlySet<string> = new Set([
  'google-document-ai',
]);

/**
 * Is this a deployed production runtime?
 *
 * NODE_ENV is the signal the rest of this codebase already uses for the same kind of guard
 * (lib/billing.ts refuses the mock payment gateway on exactly this condition), and a `next build`
 * server always runs with NODE_ENV=production. It is deliberately NOT the only signal: `RENDER` is
 * set to "true" by Render itself on every service it runs, independently of how the app was built
 * or started, so a production deploy is still recognised even if NODE_ENV were ever misconfigured.
 * If Render did not set it, nothing weakens -- NODE_ENV alone still catches every production build.
 *
 * Both checks fail towards "production", which is the safe direction: the cost of wrongly treating
 * a deploy as production is that OCR needs Google configured; the cost of the opposite is
 * fabricated identity and income data reaching a real record.
 */
export function isDeployedProductionRuntime(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || env.RENDER === 'true';
}

/**
 * May the mock provider stand in for a real one here?
 *
 *  - deployed production: NEVER. This check runs first and nothing below it is consulted -- not
 *    even demo mode. A production runtime that needs OCR must have Google configured.
 *  - local development (`next dev`) and automated tests (vitest): yes, so neither needs Google
 *    credentials to exercise the extraction flow.
 *  - anything else (NODE_ENV unset, a custom demo or CI runtime): only in the repository's
 *    existing explicit demo mode. That reuses resolveDemoMode() rather than inventing a new
 *    switch, and so inherits its two-variable gate: NEXT_PUBLIC_DEMO_MODE=true (app-level) AND
 *    ALLOW_DEMO_MODE=true (infra-level only, never set in production). One stray variable cannot
 *    turn mock OCR on.
 */
export function isMockDocumentIntelligencePermitted(env: RuntimeEnv = process.env): boolean {
  if (isDeployedProductionRuntime(env)) return false;
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return true;
  return resolveDemoMode(env.NEXT_PUBLIC_DEMO_MODE, env.ALLOW_DEMO_MODE);
}

/**
 * May a STORED extraction result be shown, reused, confirmed or corrected?
 *
 * Refusing to run the mock is not enough on its own, because results already in the database
 * outlive the code that wrote them. The applicant extract route, for one, hands back an
 * already-succeeded result without calling any provider at all.
 *
 * A result is trusted when a real provider produced it, or when mock output is legitimate in this
 * runtime. In production that means `provider_name` must name a real provider. A NULL
 * `provider_name` is NOT trusted there: the column was only added in migration
 * 20260101000100 and nothing wrote it before that, so an old row cannot prove it came from a real
 * read. Refusing it costs a re-scan or manual entry; accepting it could mean fabricated data.
 */
export function isTrustedExtractionResult(
  providerName: string | null | undefined,
  env: RuntimeEnv = process.env,
): boolean {
  if (providerName && REAL_DOCUMENT_INTELLIGENCE_PROVIDER_NAMES.has(providerName)) return true;
  return isMockDocumentIntelligencePermitted(env);
}

/** Shown to a user when extraction cannot run. Names no variable, vendor or infrastructure. */
export const DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE =
  'Document extraction is temporarily unavailable. Please enter the information manually or try again later.';

/** Shown when a stored result exists but cannot be trusted, e.g. it predates real extraction. */
export const EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE =
  "This document's scan result can't be used. Please scan the document again or enter the information manually.";
