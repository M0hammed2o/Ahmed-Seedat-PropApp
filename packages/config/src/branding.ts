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
  iosBundleIdentifier: 'com.proplyst.app', // TO_BE_CONFIRMED before store submission -- iOS not started (Android V1 final gap-closure pass, WORKLOG.md this date)
  // CONFIRMED (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 1): the real
  // apps/android applicationId, changed from the never-published com.propertyvault.app.
  // za.co.<company>.<app> matches proplyst.co.za's own real domain. Consumed by
  // apps/admin/app/.well-known/assetlinks.json/route.ts for Android App Links verification --
  // apps/mobile/app.config.ts does NOT read this constant (it has its own separate, unrelated,
  // pre-existing local branding object; apps/mobile is a distinct, out-of-scope Expo app).
  androidPackageName: 'za.co.proplyst.app',
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

/**
 * Proplyst's OWN legal/billing entity details -- V1 billing invoice pass (WORKLOG.md this date).
 * Distinct from `organizations.vat_no`/`cipc_reg_no`/etc. (packages/config has no equivalent for
 * that table on purpose) -- THOSE are a CUSTOMER org's own legal details for THEIR landlord/tenant
 * accounting; this is Proplyst's own details as the entity ISSUING a subscription invoice to that
 * customer. All null until Mohammed confirms real values -- never fabricated, matching the same
 * "TO_BE_CONFIRMED, never invented" rule `supportEmail` above already establishes. Every renderer
 * (PDF, billing UI) must treat a null field here as "omit this line," never substitute a
 * placeholder string -- see lib/subscriptionInvoicePdf.ts's own header comment for the VAT-specific
 * consequence (never label a document "Tax Invoice" unless vatNumber is actually set).
 */
export const platformBillingEntity = {
  legalEntityName: null as string | null,
  vatNumber: null as string | null,
  companyRegistrationNumber: null as string | null,
  registeredAddress: null as string | null,
} as const;

export type PlatformBillingEntity = typeof platformBillingEntity;
