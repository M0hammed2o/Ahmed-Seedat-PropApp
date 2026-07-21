# Edge Functions

No functions are deployed in Phase 1 (per the brief: don't build the full OCR provider, real webhook processing, or automatic matching yet). This directory documents the two functions Phase 2 adds, so the boundary is designed now and not restructured later:

- `revenuecat-webhook/` — verifies `REVENUECAT_WEBHOOK_SECRET`, upserts `subscriptions`, appends `subscription_events` keyed by RevenueCat's event id (idempotent). See SUBSCRIPTIONS.md, SECURITY.md.
- `document-intelligence-process/` — consumes queued `extraction_jobs`, calls the selected `DocumentIntelligenceProvider` implementation server-side, writes `extraction_results` + typed `bills`/`payments` fields. See DOCUMENT_INTELLIGENCE.md.

Both will be Deno functions (`supabase functions deploy <name>`) reading secrets via `supabase secrets set`, never via a client-supplied value.
