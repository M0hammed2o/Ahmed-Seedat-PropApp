# Utilities — Security Findings

**Audit date:** 2026-10-10/11. **Scope:** migrations 175–180, `apps/admin/lib/smartUtility/*`, every utilities API route,
tenant portal statements, ingestion, poll integrations, municipal sending, background jobs.
**Method:** independent read-only code review (separate reviewer from the original author), then confirmation by
executable tests on a disposable local Supabase stack. **No production system was accessed.**

Severity: Critical / High / Medium / Low. Status: **Fixed** (code + test), **Accepted** (documented residual risk),
**Open**.

## Summary

| ID | Severity | Title | Status | Commit |
| --- | --- | --- | --- | --- |
| SEC-01 | Medium | Utility read/write gates did not bind the property to the row's organisation | Fixed | `04d8fd4` |
| SEC-02 | Medium | Legacy utility-settings / utility-meters routes trusted a client-supplied `orgId` | Fixed | `04d8fd4` |
| SEC-03 | Low→Medium for prod poll | SSRF guard checked hostname text, not resolved addresses | Fixed (residual: DNS rebinding) | `04d8fd4` |
| SEC-04 | Low | Reading evidence could cite another property's document | Fixed | `04d8fd4` |
| SEC-05 | Low | The person who recorded a reading could verify it themselves | Fixed (sole-reviewer exception, labelled) | `04d8fd4` |
| MUN-A | High | Municipal retries rebuilt attachments from live data (photos, settings) | Fixed | `97a85de` |
| MUN-B | Medium | Recipients/CC taken from current settings, not the approved message | Fixed | `97a85de` |
| MUN-C | Medium | Queued sends not re-checked when the flag/authorisation changed | Fixed | `97a85de` |
| MUN-D | Medium | Overlapping job runs could send the same delivery twice | Fixed | `97a85de` |
| INT-01 | Medium (data loss) | ThingsBoard poll dropped points beyond 1 000 while advancing the cursor | Fixed | `04d8fd4` |
| INT-02 | Low | Milesight uplink without device time can be stored twice on redelivery | Accepted | — |
| CAT-01 | Medium (misleading) | "Modbus gateway / any device" labelled *verified* | Fixed | `04d8fd4` |
| OPS-01 | — (requirement) | No per-organisation switch for the module | Fixed (`organizations.utilities_enabled`) | this pass |
| SUS-01 | Low | Cron secret compared with `===` (not constant-time) | Open (theoretical) | — |
| SUS-02 | Low | Tenants can read `calculation` of their own invoiced charges (allocation detail) | Accepted (own charges only) | — |

**No confirmed critical or high finding remains open.** MUN-A was the only High and is fixed.

## Findings

### SEC-01 — Utility gates did not bind property to org (Medium) — Fixed
- **Component:** `can_read_property_utilities` / `can_write_property_utilities` (migration 175); every `*_write` RLS
  policy in 175–178; service-role loaders in `billing.ts`.
- **Evidence:** the functions checked `has_org_role(p_org_id, …)` and `has_property_access(p_property_id, …)`
  independently. A user who is accountant+ in their own org A and holds an owner grant on org B's property could write
  rows `(org_id = A, property_id = B)` — meters, tariffs, sources, recipients — which B's billing and municipal packs
  (loaded by `property_id`) would then use.
- **Remediation (179):** both gates now require `properties.org_id = p_org_id`; a `property_in_org` trigger on every
  utility table with `org_id` + `property_id` (any write path, including service role); billing loaders also filter by
  `org_id`.
- **Verification:** pgTAP `utilities_hardening.test.sql` tests 1–6 (cross-org meter/tariff/settings refused; gates
  return false; RLS + trigger block the attacker) — pass.

### SEC-02 — Legacy routes trusted `orgId` from the body (Medium) — Fixed
- **Component:** `app/api/v1/properties/[id]/utility-settings/route.ts`, `…/utility-meters/route.ts`.
- **Evidence:** `orgId` from the body + `propertyId` from the URL were never tied together; migration 163's policy only
  checked the org.
- **Remediation:** routes reject (404) when the property's org differs from `orgId`; DB trigger as SEC-01.
- **Verification:** pgTAP test 3; Android-facing routes unchanged when the pair is correct (mfaPolicy + Android tests).

### SEC-03 — SSRF guard by hostname text only (Low; Medium for production poll integrations) — Fixed
- **Component:** `lib/smartUtility/providers.ts` (`validateBaseUrl`, ThingsBoard verify/poll).
- **Evidence:** a hostname resolving to 10.x / 169.254.x passed (TD-58).
- **Remediation:** `assertResolvesPublic()` resolves the name and rejects any private, loopback, link-local, CGNAT,
  multicast or IPv6 private address before every request; redirects remain refused.
- **Residual (Accepted):** DNS rebinding between the check and the connection. Mitigation for production: egress proxy
  or pinned-address agent (TD-58 stays open for that part). Poll integrations are optional and manager-only.
- **Verification:** `auditFixes.test.ts` (address classes; private resolution refused; poll never calls fetch).

### SEC-04 — Evidence document from another property (Low) — Fixed
- **Component:** `record_utility_reading()` (SECURITY DEFINER) / `utility_readings.document_id`.
- **Remediation:** trigger requires the document's org and property to match the meter's.
- **Verification:** pgTAP test 14.

### SEC-05 — Self-verification of manual readings (Low) — Fixed
- **Component:** `app/api/v1/meter-readings/[id]/route.ts`.
- **Remediation:** the recorder may reject (retract) but not verify, unless no other accountant+ member exists (sole
  landlord); such verifications are labelled "Self-verified (only reviewer in the organisation)" and audited.
- **Verification:** existing reading-review integration + e2e walk-through (sole-user org) pass.

### MUN-A — Retries could send different attachments than approved (High) — Fixed
- **Component:** `lib/smartUtility/submissions.ts`, `municipalReport.ts`.
- **Evidence:** each attempt reloaded photos (unordered, size-capped, current `include_photos`) and re-rendered the PDF
  (pdfkit stamps the current time).
- **Remediation:** approval/scheduling freezes `{photos: [id, sha256], to, cc}` in `rendered_email.frozen`; sends load
  exactly those files and refuse if one is missing or changed; the PDF is byte-deterministic.
- **Verification:** `municipalSafety.integration.test.ts` ("retries send identical content", "approved photo
  disappeared blocks the send"), `municipalPdfDeterminism.test.ts`.

### MUN-B / MUN-C / MUN-D — Recipients, re-checks, duplicate sends (Medium) — Fixed
- Deliveries only to addresses on the approved message that are still authorised; at send time a withdrawn recipient
  is stopped (no retry) and an automatically scheduled pack is held if `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` is off or
  the approved template changed; deliveries are claimed by compare-and-set on `attempts`.
- **Verification:** `municipalSafety.integration.test.ts` (5 tests) + the existing 20-test municipal suite.

### INT-01 — ThingsBoard data loss beyond one page (Medium) — Fixed
- Paging by timestamp (earliest last point among full keys), hard stop after 50 pages rather than skipping.
- **Verification:** `auditFixes.test.ts` (2 500 points over 3 pages, none lost).

### INT-02 — Milesight redelivery without device time (Low) — Accepted
- A redelivered uplink lacking `time` gets a new receipt timestamp and is stored twice. Readings are cumulative, so the
  duplicate adds a zero-consumption interval and never changes a bill. Deduplicating on frame counter alone would drop
  real readings after a counter reset.

### CAT-01 — Overstated catalogue verification (Medium, misleading) — Fixed
- The generic JSON provider was labelled "Modbus gateway / any device" with `verified`. Renamed "Proplyst JSON (any
  device or gateway)"; the electricity entry now states it is verified against Proplyst's contract, not a device.

### Areas checked and sound
Ingestion token hashing/constant-time compare/rotation/revocation; device binding scoped to integration + org +
property; timestamp window and duplicate/replay protection (`unique(meter_id, read_at)`, `(integration_id,
external_event_id)`); encrypted vendor credentials (AES-256-GCM, row-bound AAD, fail-closed key); column grants hiding
token hashes and ciphertext; ID-based routes loading through RLS then checking the row's own org/property; tenant
policies exposing only invoiced charges and approved/sent statements of the caller's own lease; test-send only to the
caller's own address; every table in 175–180 has RLS; SECURITY DEFINER functions set `search_path`; the new
service-only functions (`portfolio_intelligence_candidate_orgs`, `utility_reading_counts_since`) are revoked from
`anon`/`authenticated` (pgTAP test 17).
