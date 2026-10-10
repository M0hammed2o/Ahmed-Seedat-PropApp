# Smart Utilities — Next Steps

Ordered by what unblocks real use first. Items needing the owner are marked **(owner)**.

## 1. To go live (no new code)

1. **(owner)** Review and push the commits (local only; nothing pushed). Apply migrations 175–177 to production after the
   usual backup check; 172–174 status per environment is in project memory.
2. **(owner)** Generate and store `SMART_UTILITY_CREDENTIALS_KEY` (32 random bytes, base64) as a secret in each
   environment that should allow polled (ThingsBoard) connections. Without it they are refused (fail closed).
3. **(owner)** Decide on `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` per environment. Until on, every pack waits for approval.
4. **(owner)** Buy test hardware for one property (`SMART_UTILITY_ARCHITECTURE.md` §13): EM300-DI + UG63-LTE for water;
   Shelly Pro EM-50 / EM Gen3 for electricity. Confirm pulse-head compatibility with the meter supplier first.
5. After the first real uplink: move the matching catalogue entry from "awaiting hardware testing" to "verified and ready"
   in `meterCatalogue.ts` **and** `PROVIDERS[...].verification`, and update `SA_SMART_METER_CATALOGUE.md` with the evidence.

## 1a. Hybrid Phase 2 (owner)

- Apply 175–178 per `HYBRID_UTILITIES_DELIVERY_REPORT.md` §7; decide recharge legality per pilot site, VAT/GL (TD-61),
  whether to offer cost-recovery tariffs, and which inverter brand to support first (TD-64).

## 2. Engineering follow-ups (ranked)

0. Hybrid: Victron VRM poll adapter when a pilot has Victron (TD-64); guided TOU/season editor (TD-63); credits at
   approval (TD-62); unit-page utilities panel; staff dashboards on Android; GL/VAT split (TD-61).

1. TD-58 — DNS-resolving SSRF guard (or egress proxy) before enabling ThingsBoard polling in production.
2. TD-59 — blank external-service env vars in `apps/admin/playwright.config.ts` (existing e2e suite).
3. TD-54 — make Android's capture screen post to `POST /api/v1/smart-meters/:id/telemetry` (or have
   `record_utility_reading()` also write telemetry), then add the new routes to `MOBILE_V1_API_ROUTES` (TD-57).
4. TD-53 — batch inserts + retention/roll-up for 15-minute data before onboarding many buildings.
5. TD-56 — largely done (tariffs v2, VAT on charges); remaining: optional municipality presets each July (entered, never hardcoded).
6. TD-60 — carry document ids through photo loading for previews.
7. Native Android/iOS Smart Utilities screens.
8. More adapters as hardware is confirmed (Kamstrup OMS-LoRaWAN codec, Dragino RS485 decoder fields, Milesight CT101).

## 3. Exact next implementation step if resuming code work

Fix TD-58: in `apps/admin/lib/smartUtility/providers.ts`, before each ThingsBoard request resolve the hostname
(`dns.promises.lookup(host, { all: true })`), reject private/reserved addresses with the same rules as `validateBaseUrl`,
and add unit tests in `lib/smartUtility/__tests__/engine.v2.test.ts` with a mocked resolver.
