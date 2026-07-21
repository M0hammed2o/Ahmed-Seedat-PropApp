# TODO

## Phase 2 candidates (not started)

- [ ] Select and integrate a real DocumentIntelligenceProvider (AWS Textract / Google Document AI / Azure Document Intelligence) — needs Mohammed's input on cost/accuracy tradeoffs.
- [ ] Real document upload pipeline: progress, retry, cancel, checksum-based duplicate detection, orphan-file cleanup job.
- [ ] Edge Function: extraction job processor (queue consumer) wired to the chosen provider.
- [ ] Edge Function: RevenueCat webhook receiver (real signature verification + `subscriptions`/`subscription_events` upsert).
- [ ] Real RevenueCat product identifiers once App Store Connect / Play Console are set up by Mohammed.
- [ ] Payment-matching UI end-to-end (candidate list, confirm/reject, audit log write).
- [ ] Monthly checklist UI screen consuming `calculate_monthly_checklist`.
- [ ] Reminders: scheduled backend job + push notification delivery (`device_push_tokens`, `notification_deliveries`).
- [ ] Data export request implementation (currently table-design-only).
- [ ] Rate limiting with a real backing store (Upstash Redis or equivalent).
- [ ] Admin controlled support-access workflow (currently architecture-only, disabled).
- [ ] `document_versions`, `storage_usage`, `system_events`, `feature_flags`, `application_config`, `admin_notes`, `admin_support_access_requests` tables (designed in DATABASE.md, not yet migrated).
- [ ] EAS Build production profiles + store submission prep once Apple/Google accounts exist.

## Phase 1 follow-ups (small, non-blocking)

- [ ] Run `supabase start` + `supabase test db` locally (Docker required) to actually execute the RLS/policy tests written in `supabase/tests/`.
- [ ] Confirm Zod v4 / `@hookform/resolvers` peer compatibility after first real `pnpm install` on a machine with network access to the npm registry (this sandbox's install result is recorded in WORKLOG.md — check there first).
- [ ] Real Terms of Service / Privacy Policy copy (legal, not engineering).
- [ ] Confirm final commercial subscription pricing/trial length (currently `TO_BE_CONFIRMED` placeholders).
