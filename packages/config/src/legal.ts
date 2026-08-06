// PRODUCT DECISION 1 (2026-08-03): registration requires capturing which version of the Terms
// and Privacy Policy a user accepted (registerSchema, packages/validation/src/auth.ts). The
// actual legal text is real content a lawyer needs to author/review -- out of engineering scope,
// same "clearly-labeled placeholder, not invented" posture as PLATFORM_WHATSAPP_NUMBER
// (apps/admin/lib/whatsappDispatch.ts). Bump these strings (and the pages at /terms and
// /privacy) whenever the real text changes -- the version string itself, not the page content,
// is what gets stored per-user as their consent record.
export const TERMS_VERSION = 'v1-placeholder-2026-08-03'; // TO_BE_CONFIRMED -- real legal text pending
export const PRIVACY_VERSION = 'v1-placeholder-2026-08-03'; // TO_BE_CONFIRMED -- real legal text pending
