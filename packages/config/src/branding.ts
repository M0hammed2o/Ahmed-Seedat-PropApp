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
  // Real, monitored mailbox, confirmed by Mohammed for the Google Play v1.0 release
  // (2026-09-11). This replaced a long-standing `support@proplyst.example` placeholder that every
  // renderer deliberately suppressed rather than display a bouncing address. Now that it is real,
  // those suppressions are lifted: /delete-account renders the "I can't sign in" email route, the
  // privacy policy names it, and /access-restricted offers Contact support again.
  //
  // Marked temporary by Mohammed: it is a genbridge.co.za address, not a proplyst.co.za one. When
  // a permanent support@proplyst.co.za mailbox exists, changing this one constant updates every
  // surface -- no renderer hard-codes an address.
  supportEmail: 'notifications@genbridge.co.za',
  websiteUrl: 'https://proplyst.co.za',
} as const;

export type Branding = typeof branding;

/**
 * Proplyst's OWN legal/billing entity details -- V1 billing invoice pass (WORKLOG.md this date).
 * Distinct from `organizations.vat_no`/`cipc_reg_no`/etc. (packages/config has no equivalent for
 * that table on purpose) -- THOSE are a CUSTOMER org's own legal details for THEIR landlord/tenant
 * accounting; this is Proplyst's own details as the entity ISSUING a subscription invoice to that
 * customer. All null until Mohammed confirms real values -- never fabricated -- the same
 * "TO_BE_CONFIRMED, never invented" rule `supportEmail` followed until a real mailbox was
 * confirmed for it on 2026-09-11. Every renderer
 * (PDF, billing UI) must treat a null field here as "omit this line," never substitute a
 * placeholder string -- see lib/subscriptionInvoicePdf.ts's own header comment for the VAT-specific
 * consequence (never label a document "Tax Invoice" unless vatNumber is actually set).
 */
export const platformBillingEntity = {
  // Confirmed by Mohammed on 2026-09-12. Proplyst is the product/trading name; GENBRIDGE Pty Ltd
  // is the company that operates it and contracts with customers.
  legalEntityName: 'GENBRIDGE Pty Ltd' as string | null,
  // Still null, still deliberately: the omit-never-substitute rule above applies unchanged. A
  // document must not be labelled "Tax Invoice" until vatNumber is a real, confirmed value, and
  // neither the registration number nor the registered address may be guessed from the name.
  vatNumber: null as string | null,
  companyRegistrationNumber: null as string | null,
  registeredAddress: null as string | null,
} as const;

export type PlatformBillingEntity = typeof platformBillingEntity;
