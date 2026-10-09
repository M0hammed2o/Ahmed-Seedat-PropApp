# Smart Utilities — Decisions & Assumptions (2026-10-10 session)

Earlier shaping decisions are in the repo-root `DECISIONS.md` (2026-10-08 entry). This file records the calls made
autonomously in the 2026-10-10 session, each with its reason, so they can be reversed deliberately.

1. **Extend Phase 1; no second utilities module.** The brief forbids a duplicate; Phase 1 tables/routes/UI are the base.
2. **"Verified and ready for integration" is reserved for paths proven end-to-end without hardware ambiguity** —
   manual readings and Proplyst's own generic JSON contract. Every hardware adapter is "Technically supported but
   requires hardware testing" until a real device has reported into Proplyst. Simulated adapters are labelled.
3. **Credential encryption is application-level AES-256-GCM** with a key from `SMART_UTILITY_CREDENTIALS_KEY`
   (32 bytes, base64) and a key-version byte for rotation. Rationale: works on hosted Supabase without Vault setup;
   ciphertext is never selectable by API clients (column grant). Without the key configured, credential-bearing
   integrations cannot be created (fail closed).
4. **Poll adapter = ThingsBoard REST API** (open-source platform with a documented REST API). Push adapters added:
   ChirpStack v4 HTTP integration and The Things Stack webhooks (both documented). Formats are taken from vendor docs
   (see catalogue sources) and pinned by tests; no live server was available.
5. **Automatic municipal sending needs three things:** an approved template (hash of the exact content), at least one
   authorised recipient, and the platform flag `SMART_UTILITY_AUTO_SUBMISSION_ENABLED`. Any template edit clears
   approval and disables the schedule.
6. **Test sends go only to the signed-in user's own account email**, never to a typed address.
7. **"Acknowledged" = a human-recorded acceptance** (`acceptance_status`). Delivery never implies acceptance.
8. **Billing creates draft charges → landlord approval → draft invoices only.** Nothing is issued or charged
   automatically; electricity recharge shows the NERSA resale caveat.
9. **Status `scheduled`** means approved and waiting for its send time (`scheduled_for`).
