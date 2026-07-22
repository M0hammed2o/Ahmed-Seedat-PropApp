# TODO

## Before any real deployment (release-blocking)

- [ ] Set `NEXT_PUBLIC_DEMO_MODE=false` and `EXPO_PUBLIC_DEMO_MODE=false` explicitly — both default ON and the admin app's demo mode is a full auth bypass if left unset. See SECURITY.md.
- [ ] Provide real Supabase project credentials and confirm `lib/auth.ts`/`propertyRepository.ts` etc. work end-to-end against them (Phase 1's real code paths still exist behind the demo-mode flags, untouched, but haven't been exercised against a live project in this sandbox).

## Phase 3 candidates (real backend integration — demo mode currently stands in for all of these)

- [ ] Select and integrate a real DocumentIntelligenceProvider (AWS Textract / Google Document AI / Azure Document Intelligence) — needs Mohammed's input on cost/accuracy tradeoffs.
- [ ] Real document upload pipeline to Supabase Storage: progress, retry, cancel, checksum-based duplicate detection, orphan-file cleanup job (the demo upload flow simulates all of this against the in-memory store — see `apps/mobile/src/demo/`).
- [ ] Edge Function: extraction job processor (queue consumer) wired to the chosen provider.
- [ ] Edge Function: RevenueCat webhook receiver (real signature verification + `subscriptions`/`subscription_events` upsert).
- [ ] Real RevenueCat product identifiers once App Store Connect / Play Console are set up by Mohammed.
- [ ] Wire the admin dashboard's live-Supabase code paths (still present, reachable when demo mode is off) against a real project and re-verify.
- [ ] Reminders: scheduled backend job + push notification delivery (`device_push_tokens`, `notification_deliveries`).
- [ ] Data export request implementation (currently table-design-only).
- [ ] Rate limiting with a real backing store (Upstash Redis or equivalent).
- [ ] Admin controlled support-access workflow (currently architecture-only, disabled).
- [ ] `document_versions`, `storage_usage`, `system_events`, `feature_flags`, `application_config`, `admin_notes`, `admin_support_access_requests` tables (designed in DATABASE.md, not yet migrated).
- [ ] EAS Build production profiles + store submission prep once Apple/Google accounts exist.

## Phase 2 follow-ups (small, non-blocking)

- [ ] `search.tsx`'s `propertyId` param (passed from Property Detail's "Search" quick action) isn't yet used to pre-scope results — currently a global search regardless of entry point.
- [ ] Onboarding screens ((onboarding)/_) work correctly in demo mode but weren't given the same visual polish pass as the main (app)/_ screens — lower priority since the primary demo path starts already-authenticated on Dashboard.
- [ ] Remaining brief-listed components not yet built: `SearchFilterSheet`, `SecureDocumentPreview` (document preview itself, as opposed to the metadata card), `AdminAuditDrawer`.

## Phase 1 follow-ups (small, non-blocking)

- [ ] Run `supabase start` + `supabase test db` locally (Docker required) to actually execute the RLS/policy tests written in `supabase/tests/`.
- [ ] Real Terms of Service / Privacy Policy copy (legal, not engineering).
- [ ] Confirm final commercial subscription pricing/trial length (currently `TO_BE_CONFIRMED` placeholders).
