/**
 * Single source of truth for the product's replaceable identity. Nothing in mobile/admin
 * business logic should hardcode "Proplyst", a colour hex, or a bundle identifier directly —
 * import from here so a rebrand is a config edit, not a code rewrite.
 *
 * Renamed from "PropVault"/"PropertyVault" to "Proplyst" (Property Analyst) 2026-08-06, per
 * Mohammed's instruction, with a real logo (apps/admin/branding/proplyst-logo.png,
 * apps/admin/scripts/make-icons.mjs derives every PWA/favicon icon from it). This is the single
 * edit point for the live product name; historical WORKLOG.md/TASKS.md entries predating this
 * date are left referring to "PropVault"/"PropertyVault" on purpose — they're a record of what
 * was true when they were written, not something to rewrite after the fact.
 */
export const branding = {
  productName: 'Proplyst',
  tagline: 'Property Intelligence. Simplified.',
  iosBundleIdentifier: 'com.proplyst.app', // TO_BE_CONFIRMED before store submission
  androidPackageName: 'com.proplyst.app', // TO_BE_CONFIRMED before store submission
  // V1 communications productionisation (WORKLOG.md this date): supportEmail is still a
  // TO_BE_CONFIRMED placeholder -- no real support mailbox exists anywhere in this codebase
  // (confirmed by grep before this pass), so it is deliberately never rendered in a customer-
  // facing email (lib/email/layout.ts's footer omits a support line entirely rather than
  // display a non-functional address) until Mohammed provides a real one. websiteUrl WAS also a
  // placeholder pointing at a domain that was never registered/deployed -- corrected to the real,
  // live production domain (not invented: the same https://proplyst.co.za this whole project has
  // been deploying to since Release A).
  supportEmail: 'support@proplyst.example', // TO_BE_CONFIRMED -- do not render in customer-facing copy
  websiteUrl: 'https://proplyst.co.za',
} as const;

export type Branding = typeof branding;
