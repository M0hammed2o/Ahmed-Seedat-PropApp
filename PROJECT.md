# PropVault

A personal property document vault and payment-tracking SaaS mobile app for individual owners of multiple properties. Not a property-agency ERP, not a rental-management platform, not an accounting package.

## Core customer capabilities (V1 scope)

- Register, verify email, subscribe (RevenueCat, one base plan), secure login with biometric app-lock.
- Add/edit/archive/restore properties (South Africa-first address model, not South-Africa-only architecture).
- Upload bills/statements/receipts/proofs of payment, organised by property/category/month/year.
- See extracted fields (mock provider in Phase 1) and confirm/correct them.
- See a proposed bill↔proof-of-payment match and confirm it (never auto-marked paid silently).
- Monthly per-property checklist of expected categories (paid/unpaid/overdue/missing/needs review).
- Dashboard of what needs attention, search/archive of historical documents, reminders (architecture only in Phase 1).

## Platform administration

Separate Next.js web dashboard for the SaaS owner: customer/subscription/processing/system operations, role-gated (`super_admin`, `support_admin`, `operations_admin`, `read_only_admin`), least-privilege, no service-role key ever reaching the browser.

## Property fields (as specified)

`id, owner_user_id, nickname, full_address, address_line1, address_line2, suburb, city, province, postal_code, country, property_type, municipal_account_number?, notes?, image_path?, status(active|archived), created_at, updated_at`

## Branding

"PropVault" is a temporary internal name. All product name/logo/colour/icon/bundle-identifier values are centralised in `packages/config/branding.ts` (mobile) and `apps/admin`'s theme config, specifically so rebranding never requires touching business logic or component internals.

## Roadmap

- **Phase 0** (this delivery): architecture, docs, schema/security/subscription/design designs.
- **Phase 1** (this delivery): monorepo + both app shells, auth, biometric-lock architecture, property CRUD, initial migrations + RLS, admin shell + role gating, mock providers, initial tests.
- **Phase 2** (proposed next): real document upload to Storage with progress/retry, real edge-function-driven extraction against a chosen OCR provider, payment-matching UI end-to-end, monthly checklist UI, reminders/notifications, RevenueCat real integration once store products exist.
- **Phase 3+**: admin support-access workflow, data export, advanced search, push notification delivery, EAS production builds, store submission.

See DECISIONS.md for the specific choices made to get Phase 0/1 done, and TODO.md/KNOWN_BUGS.md for what's explicitly deferred.
