// PRODUCT DECISION 1 (2026-08-03): registration requires capturing which version of the Terms
// and Privacy Policy a user accepted (registerSchema, packages/validation/src/auth.ts). The
// actual legal text is real content a lawyer needs to author/review -- out of engineering scope,
// same "clearly-labeled placeholder, not invented" posture as PLATFORM_WHATSAPP_NUMBER
// (apps/admin/lib/whatsappDispatch.ts). Bump these strings (and the pages at /terms and
// /privacy) whenever the real text changes -- the version string itself, not the page content,
// is what gets stored per-user as their consent record.
export const TERMS_VERSION = 'v1-placeholder-2026-08-03'; // TO_BE_CONFIRMED -- real legal text pending
// Real, binding Privacy Policy published 2026-09-11 for the Google Play v1.0 release (see
// apps/admin/app/privacy/page.tsx). Bumping this deliberately re-prompts every existing user
// for consent on their next sign-in via lib/legalConsent.ts -- the correct outcome for a
// material change from placeholder text to a binding policy. TERMS_VERSION is untouched:
// /terms is still placeholder text, and authoring binding terms is a separate, lawyer-led job.
export const PRIVACY_VERSION = 'v1.0-2026-09-11';
