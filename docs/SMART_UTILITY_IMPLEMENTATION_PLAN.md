# Smart Utility Monitoring — Implementation Plan, Estimates & Status

**Date:** 2026-10-08. See `SMART_UTILITY_HARDWARE_RESEARCH.md` and `SMART_UTILITY_ARCHITECTURE.md`.

## 1. Codebase audit summary (what is reused)

| Area                   | Exists today (verified by reading the code)                                                                                                                            | Reuse decision                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Properties / units     | `properties`, `units` (`org_id`, `status` vacant/occupied/maintenance). **No buildings concept.**                                                                       | Reuse; add optional `property_buildings` + nullable `building_id`.                                                   |
| Meters & readings      | Migration 163: `utility_meters`, `utility_readings` (one reading per meter per month, `UNIQUE(meter_id, period_month)`), `record_utility_reading()` (negative consumption on reset), `lib/utilityAnomaly.ts`, `PropertyUtilityMetersPanel`, Android `ui/utilities/*` | Keep as the monthly/manual layer. Extend `utility_meters` with smart columns. Add interval telemetry in a new table. |
| RLS                    | `has_org_role`, `has_property_access` (+ owner-portal pattern 072). **Gap:** utility tables are org-only.                                                              | Use the property-access pattern everywhere; fix the gap on the two meter tables.                                     |
| Billing                | `invoices` + `invoice_line_items`, `create_manual_invoice()` (lease-bound).                                                                                             | Phase 2: utility recharge lines via `create_manual_invoice`. Not touched in Phase 1.                                 |
| Notifications          | `notifications` + `lib/notify.ts` `notifyPropertyStaff`.                                                                                                                | Reuse for alerts, approval requests, failed submissions.                                                              |
| Email                  | `dispatchEmail` (idempotent per entity+template, suppression, audit, `email_messages`), Resend provider, mock in dev. **Attachments were not implemented.**             | Reuse; add inline-file attachments to the provider; per-recipient delivery rows to fit the idempotency key.           |
| Scheduler              | One Render cron → `POST /api/v1/system/daily-jobs` (`CRON_JOB_SECRET` or super_admin).                                                                                   | Append `runSmartUtilityJob`; add a standalone route for a more frequent schedule later.                              |
| Webhooks               | PayFast / Resend patterns: raw body, signature, `*_events` unique key, 23505 = duplicate, `CSRF_EXEMPT_PATHS`.                                                          | Same idempotency pattern for meter ingestion; token auth instead of HMAC.                                             |
| Secrets                | `encrypted_secrets` table with no implementation.                                                                                                                       | Not needed in Phase 1 (push-only, hashed inbound tokens). Phase 2 blocker for polling vendors.                       |
| Evidence storage       | `documents` bucket, `POST /api/v1/documents` (scanned upload), `utility_readings.document_id`.                                                                          | Reuse for meter photos.                                                                                              |
| Audit                  | `audit_events`, `writeAuditEvent`, `log_audit_event_trigger()`.                                                                                                         | Attach the generic trigger to config tables; explicit audit on ingestion/submission actions.                         |
| AI                     | Mock-only LLM provider; rules engine `portfolioIntelligence.ts`.                                                                                                        | No AI in Phase 1. Phase 3: on-demand anomaly explanation.                                                            |
| Mobile                 | Android calls `/api/v1/*` with Bearer token; iOS spec-only.                                                                                                             | New routes are reachable by native later; Phase 1 UI is the responsive web/PWA.                                       |

## 2. Fastest hardware & simplest working architecture

- **Fastest to integrate:** Shelly Gen2+ (electricity, monitoring-grade) and Milesight EM300-DI + UG6x gateway
  (water). Both push HTTP with publicly documented payloads, need no vendor account, and are in stock in SA.
- **Simplest architecture:** device/gateway → `POST /api/v1/integrations/meters/ingest` (bearer token per
  integration) → adapter → validation → `meter_telemetry_readings` → derived consumption/analytics → daily job →
  alerts and municipal packs → `dispatchEmail`.

## 3. Estimates

### 3.1 Engineering (software only)

| Work package                                                                                       | Hours (range) |
| -------------------------------------------------------------------------------------------------- | ------------- |
| Migration 175 (hierarchy, telemetry, integrations, alerts, submissions) + RLS gap fix + pgTAP     | 10–14         |
| Ingestion endpoint, token auth/rotation, 4 adapters, validation, idempotency + tests              | 12–16         |
| Consumption engine (rollover/reset/replacement/interpolation), reconciliation, anomaly rules + tests | 10–14       |
| Municipal directory, report (HTML/CSV/PDF), attachments in provider, deliveries/retries + tests    | 12–16         |
| Smart-utility job + route + health sweep                                                           | 4–6           |
| Web UI (Utilities tab: overview, meters, integrations, alerts, reconciliation, submissions)        | 16–24         |
| Docs, regression runs, review                                                                      | 6–10          |
| **Total MVP**                                                                                      | **70–100 h** (Derived: sum of the minimums is 70, sum of the maximums is 100) |

Calendar for one engineer: **≈2–3 weeks** of software time. This session builds the bulk of it against simulators;
what remains after this session is listed in §5.

### 3.2 Waiting time (not engineering)

| Dependency                                                                    | Typical wait (Likely, not verified)                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| Buy in-stock hardware (MiRO, tech.co.za, FirstShop)                           | 2–7 days delivery                                       |
| Confirm pulse-head compatibility with the chosen water meter (supplier)       | 1–5 days                                                |
| Registered plumber (water meter/counter), electrician + CoC (DIN meters/CTs)  | 1–2 days on site, booking lead time varies              |
| Gateway configuration (network server → HTTP integration)                    | 0.5 day                                                 |
| Burn-in data before trusting anomaly thresholds                               | 2–4 weeks                                               |
| Production Resend sending to external recipients (already configured in prod) | none technically; **needs your approval to enable**     |
| Municipal acceptance of emailed readings                                      | Not controllable — "received", not "accepted"           |

### 3.3 Costs (incl VAT, 2026-10-08 snapshot, Derived from the research doc's verified prices)

| Item                                         | One-off                                                                                       | Monthly                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Water per meter (pulse-ready meter + EM300-DI) | R605.48 + R1,350.00 = **R1,955.48** (+ plumber)                                              | R0                                                                                               |
| LoRaWAN gateway per site                     | UG63-LTE **R4,384.95** · UG56 **R5,717.80** · UG65 **R8,888.35**                              | LTE data or existing broadband — **Unknown** (not priced)                                        |
| Electricity monitoring per unit (Shelly)     | EM Gen3 R1,575–R1,665 · Pro EM-50 (2 units) R1,989 ≈ R995/unit · Pro 3EM R3,029              | R0 (building Wi-Fi)                                                                              |
| Electricity billing-grade per unit (Eastron) | ≈R1,070 (box-of-100 price) + gateway TRB246 R3,770 per site (+ electrician/CoC)              | LTE data — Unknown                                                                               |
| API licensing                                | **R0** — no partner/cloud API used in Phase 1                                                 | R0                                                                                               |
| Hosting                                      | —                                                                                             | Storage: at hourly readings, 50 meters ≈ 438,000 rows/yr (Derived: 50 × 24 × 365); at 15-min, ≈1.75 M rows/yr. Fits the existing Supabase plan for pilot scale; **monitor DB size before scaling past a few buildings at 15-min**. |
| Email                                        | —                                                                                             | Within the existing Resend plan (a few emails per property per month)                            |

**Additional cost per meter:** water ≈R1,955 hardware + install; electricity ≈R995–R1,665 (Shelly) or ≈R1,070 +
share of the gateway (Eastron) + electrician; R0 recurring per meter.

### 3.4 Risks that can delay deployment

1. Pulse-head compatibility of SA "pulse-ready" meters with the EM300-DI is unverified (research §6 item 3).
2. Gateway stock (TRB246/Waveshare were out of stock 2026-10-08).
3. SA type approval for tenant rebilling (SABS-approved submeter wording in by-laws) is unresolved — affects
   billing, not monitoring.
4. Municipal channels change and contradict each other (CoJ); readings are "may use", not guaranteed.
5. Production email to municipalities needs owner-authorised recipients and your go-ahead.
6. Battery LoRaWAN devices outside gateway range at the property boundary — needs a site survey.

## 4. Phases

**Phase 1 (this session):** audit · research · hierarchy & schema · manual readings · one water integration
(Milesight EM300-DI via LoRaWAN network-server HTTP) · one electricity integration (Shelly Gen2+ EM/3EM via HTTP)
· generic Modbus-gateway JSON adapter · simulator · consumption dashboard · rule-based alerts ·
main/submeter reconciliation · monthly report (HTML/CSV/PDF) · custom recipients · approval/automatic modes ·
submission history with retries.

**Phase 2:** further adapters (Kamstrup OMS-LoRaWAN, SDM230-LoRaWAN, Teltonika native format), encrypted vendor
credentials + polling, per-municipality workflows (Tshwane template, eThekwini register fields), evidence
management UI, block tariffs, tenant utility recharge invoices via `create_manual_invoice`, native Android screens.

**Phase 3:** forecasting, AI explanations of alerts (on demand), portfolio-wide analytics, authorised municipal
integrations if any municipality publishes one.

## 5. Status (2026-10-09, end of implementation session)

| Phase 1 item                                           | Status                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Codebase audit, hardware/API research, municipal research | Completed (research doc; facts dated 2026-10-08)                                                     |
| Meter database & hierarchy (incl. buildings, replacement) | Completed — migration 175, pgTAP 34/34                                                              |
| Manual meter readings (+ optional photo)               | Completed — API + UI; photo upload reuses `POST /api/v1/documents`                                       |
| One real smart water integration                      | Completed in software (Milesight EM300-DI via UG6x HTTP); **not tested against physical hardware**      |
| One real smart electricity integration                | Completed in software (Shelly Gen2+ HTTP push); **not tested against physical hardware**                |
| Generic Modbus-gateway adapter + simulator             | Completed                                                                                                |
| Basic consumption dashboard                            | Completed (property → Utilities tab); **not walked through in a browser this session**                   |
| Monthly email report (HTML/text + CSV + PDF + photos)   | Completed; sent only via the mock provider in tests; photo attachment not exercised end-to-end          |
| Custom recipient configuration + authorisation         | Completed                                                                                                |
| Submission history, retries, acceptance tracking       | Completed                                                                                                |
| Basic anomaly alerts                                   | Completed (night flow, base load, spike, vacant unit, offline, reset, reconciliation)                    |
| Multi-unit reconciliation (brought forward from Phase 2) | Completed                                                                                              |
| Production deployment, real municipal sends, hardware purchase | **Not done — requires your approval** (out of scope for this session by instruction)             |

**Deployment timeline (estimate, Derived from §3):** software is ready for a dev/staging review now; production
rollout = apply migration 175 (+ any pending 172–174 per environment) → deploy → smoke test ≈ 0.5–1 day once approved.
First live data depends on hardware: ~1–2 weeks (purchase, compatibility check, plumber/electrician booking) plus 2–4
weeks burn-in before alert thresholds are trusted.
