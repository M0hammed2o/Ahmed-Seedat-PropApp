# API Specification

REST over HTTPS, JSON bodies, served from Next.js Route Handlers (`apps/web/app/api/**`) backed by Supabase (direct client queries where RLS alone is sufficient; Route Handlers/Edge Functions where server-side business logic is required — `ARCHITECTURE.md` § Business logic placement). Native mobile apps consume the same API surface as the web app — no mobile-only endpoints, no client bypassing business logic to write Postgres directly except for plain RLS-protected reads where no server-side rule applies (e.g. reading your own properties list).

## 0. Conventions

- **Auth**: `Authorization: Bearer <supabase-jwt>` on every request (native Android/iOS callers) or an equivalent `@supabase/ssr` session cookie (the PWA) — `getServerSupabaseClient()` (`apps/admin/lib/supabase/server.ts`) accepts either through one abstraction, 2026-08-02, `TASKS.md` M10/TD-28. No endpoint accepts a client-supplied `org_id` as authoritative — it's always re-derived server-side from the caller's `organization_members`/`tenants`/`owners` rows (`PERMISSIONS.md`).
- **Base path**: `/api/v1/...`. Versioned from day one — a breaking change ships as `/api/v2` alongside `/v1`, never an in-place breaking change to a shipped mobile app's contract.
- **Pagination**: cursor-based (`?cursor=<opaque>&limit=<n, default 25, max 100>`), response includes `next_cursor: string | null`. Offset pagination is not used — it degrades under concurrent writes, which this system has plenty of (rent schedules, journal entries).
- **Filtering**: `?filter[status]=active&filter[property_id]=<uuid>` — explicit allow-listed filter fields per endpoint, never arbitrary query passthrough to the database.
- **Search**: `?q=<text>` where evidenced (Properties, Tenants, Vendors, Documents, Audit Log all had search boxes) — implemented as `ILIKE`/trigram search server-side, not client-side filtering of a full list.
- **Errors**: `{ error: { code: string, message: string, field_errors?: Record<string,string[]> } }`, standard HTTP status codes (400 validation, 401 unauthenticated, 403 unauthorized, 404 not found _within your org_ — a resource in another org 404s, never 403, so org existence isn't leaked by status code).
- **Auditing**: every mutating endpoint writes an `audit_events` row as part of the same transaction as its primary write — not a best-effort side effect that can silently fail.
- **Idempotency**: mutating endpoints that trigger external side effects (WhatsApp/email send, journal posting) accept an `Idempotency-Key` header; a repeated key with the same body returns the original result rather than double-executing.

## 1. Auth & session

```
POST   /api/v1/auth/signup
POST   /api/v1/auth/signin
POST   /api/v1/auth/signout
POST   /api/v1/auth/password-reset
GET    /api/v1/me                      → profile + all org memberships + owner/tenant records (portal-switch data)
```

The `/api/v1/auth/**` surface above is still aspirational, not implemented (`AUTHENTICATION.md` §1) — login/register/reset all call Supabase Auth directly, client-side, matching the pattern established before this document was written. `AUTHENTICATION.md` is the authoritative record of what was actually built for web account creation and OAuth (2026-08-03).

## 2. Organizations & billing (Super Admin scope marked)

```
POST   /api/v1/organizations                        (org signup/creation)
GET    /api/v1/organizations/:orgId
PATCH  /api/v1/organizations/:orgId                  (compliance profile fields)
GET    /api/v1/organizations/:orgId/members
POST   /api/v1/organizations/:orgId/invites
POST   /api/v1/organizations/:orgId/invites/:id/accept
DELETE /api/v1/organizations/:orgId/members/:id      (role: manager+)

# Super Admin only (platform_admin_users, separate auth check)
GET    /api/v1/admin/organizations                   (client directory, filters: status/plan)
GET    /api/v1/admin/organizations/:orgId
POST   /api/v1/admin/organizations/:orgId/suspend
POST   /api/v1/admin/organizations/:orgId/activate
POST   /api/v1/admin/organizations/:orgId/archive     (super_admin only; sets status='archived' — distinct from cancelled/suspended, see SUPER_ADMIN.md §4)
GET    /api/v1/admin/organizations/:orgId/usage       (reads usage_snapshots, DATABASE.md §7)
POST   /api/v1/admin/organizations/:orgId/usage/reset (operations_admin+; zeroes current-period usage_snapshots, never deletes usage_events)
PATCH  /api/v1/admin/organizations/:orgId/plan
POST   /api/v1/admin/organizations/:orgId/credits
POST   /api/v1/admin/support-sessions                 (reason required, audited)
POST   /api/v1/admin/support-sessions/:id/end
GET    /api/v1/admin/plans
POST   /api/v1/admin/plans
```

## 3. Portfolio

```
GET/POST           /api/v1/properties
GET/PATCH/DELETE   /api/v1/properties/:id             (DELETE = archive, never hard-delete)
GET/POST           /api/v1/properties/:propId/units
GET/PATCH          /api/v1/units/:id
GET/POST           /api/v1/owners
GET/PATCH          /api/v1/owners/:id
POST               /api/v1/properties/:propId/owners  (attach owner + ownership_pct)
GET                /api/v1/portfolio/map               (properties with lat/lng + occupancy + maintenance-flag summary — simplified V1 map data)
```

## 4. Leasing

```
GET/POST           /api/v1/applications
POST               /api/v1/applications/:id/consent    (POPIA + screening consent capture)
POST               /api/v1/applications/:id/screen
POST               /api/v1/applications/:id/decide      (approved → atomically creates tenant+lease+rent_schedule, per ARCHITECTURE.md)
GET/POST           /api/v1/leases
GET/PATCH          /api/v1/leases/:id
POST               /api/v1/leases/:id/upload-and-parse  (PDF → OCR → prefilled lease review)
GET/POST           /api/v1/tenants
GET/PATCH          /api/v1/tenants/:id
GET                /api/v1/leases/:id/rent-schedule
GET/POST           /api/v1/tenants/:id/invitations               (list + create; staff-only, rate-limited 20/min per user; POST always issues a fresh invitation, revoking any prior unaccepted one — "resend" and "regenerate" in the UI are the same call, AUTHENTICATION.md §5)
POST               /api/v1/tenants/:id/invitations/:invitationId/revoke
POST               /api/v1/tenant-invitations/accept               (requires auth; dual rate-limited per-user + per-IP; maps accept_tenant_invitation()'s error_code to a friendly message)
```

## 5. Operations

```
GET/POST           /api/v1/maintenance-tickets
GET/PATCH          /api/v1/maintenance-tickets/:id      (status transitions validated server-side against the To Do→In Progress→Pending Approval→Completed state machine)
POST               /api/v1/maintenance-tickets/:id/photos
GET/POST           /api/v1/inspections
POST               /api/v1/inspections/:id/items
POST               /api/v1/inspections/:id/sign         (landlord or tenant signature; refusal reason accepted in lieu of tenant signature)
POST               /api/v1/inspections/:id/complete      (rejects if neither both-signed nor refusal-logged)
GET/POST           /api/v1/vendors
GET/POST           /api/v1/vendor-bills
POST               /api/v1/vendor-bills/:id/approve
GET/POST           /api/v1/announcements
POST               /api/v1/announcements/:id/acknowledge (tenant)
```

## 6. Accounting (all writes route through the posting service — `ACCOUNTING.md`)

```
GET     /api/v1/rent-schedules?status=overdue
POST    /api/v1/rent-schedules/recalculate
GET/POST /api/v1/invoices
POST    /api/v1/invoices/:id/issue                       (generates PDF, queues email)
GET/POST /api/v1/expenses
POST    /api/v1/expenses/:id/upload-receipt               (AI-assisted extraction)
GET     /api/v1/bank-accounts
GET/POST /api/v1/bank-transactions
POST    /api/v1/bank-transactions/:id/match                (propose via calculateMatchScore; confirm is separate)
POST    /api/v1/bank-transactions/:id/confirm-match
GET     /api/v1/trust-ledgers/:tenantId
POST    /api/v1/trust-ledgers/:id/release                  (rejects unless move-out inspection is completed)
GET/POST /api/v1/owner-statements
POST    /api/v1/owner-statements/draft                     (month-scoped batch draft, evidenced: skips owners who already have one)
POST    /api/v1/owner-statements/:id/issue
GET     /api/v1/trial-balance?ledger_class=business|trust|deposits
GET     /api/v1/tax-pack?tax_year=2027
POST    /api/v1/tax-pack/export                             (PDF)
POST    /api/v1/journal-entries/:id/reverse                 (never PATCH/DELETE on journal-entries directly — no such endpoint exists)
```

### 6a. Utilities / rates / levies / budgets (V1 pass — `UTILITIES_RATES_BUDGET_IMPLEMENTATION.md`)

```
GET/POST /api/v1/properties/:id/recurring-costs             (rates & taxes / levy, effective-dated; ?unitId= to scope)
GET/POST /api/v1/properties/:id/utility-settings             (water/electricity responsibility mode; ?unitId= to scope)
GET/POST /api/v1/properties/:id/utility-meters               (?unitId= to scope)
GET/POST /api/v1/utility-meters/:id/readings                  (GET returns consumption history + isUnusualUsage)
GET/POST /api/v1/properties/:id/budget?month=YYYY-MM-01       (server-authoritative budget-vs-actual)
POST     /api/v1/properties/:id/budget/annual                 ("distribute evenly across months" convenience — still produces 12 editable monthly rows)
GET      /api/v1/properties/:id/financial-summary?month=YYYY-MM-01   (property-scoped one-call summary — rent + expenses + budget + net position, avoids N+1)
GET      /api/v1/organizations/:orgId/financial-summary?month=YYYY-MM-01   (continuation pass — the PORTFOLIO-wide equivalent, live/never cached; what Android Home actually calls)
GET      /api/v1/properties/:id/tenant-payment-status?month=YYYY-MM-01   (paid/unpaid list, reuses rent_schedules.status directly)
```

### 6b. Smart Utility Monitoring (2026-10-08 — migration 20260101000175, design `docs/SMART_UTILITY_ARCHITECTURE.md` §11)

Shared plumbing (`apps/admin/lib/smartUtility/http.ts`): order is auth → JSON → zod → permission. `401 unauthenticated` (no session), `400 invalid_json`, `400 validation_failed` (`field_errors` + `form_errors`), `404 not_found` when the property/meter/integration/etc. is not readable under RLS (`can_read_property_utilities`), `403 forbidden` when the write gate fails. **Write gate** on every mutating session route = `can_write_property_utilities(org_id, property_id)` RPC (the same predicate the RLS write policies use, evaluated as the caller). Zod schemas live in `packages/validation/src/smartUtility.ts`. Writes that bypass RLS (telemetry, integrations, submissions) use the service-role client only after the gate passes; audited actions call `writeAuditEvent` explicitly.

**Session-authenticated (staff / portal owner)**

```
GET    /api/v1/properties/:id/smart-utility
         Dashboard payload (meters + health, period-to-date consumption/cost, 30-day daily series,
         reconciliation, alerts, submission settings/recipients/history). Read-only, every query on the
         caller's session (RLS-scoped). 200 { property, ...overview } | 404 | 500 smart_utility_overview_failed

POST   /api/v1/properties/:id/smart-meters                    body: smartMeterCreateSchema
         utilityType water|electricity; meterRole main|submeter|check; ownership municipal|private;
         connectivity manual|lorawan|wifi|modbus_gateway|http_push|simulator; optional unitId, buildingId,
         parentMeterId, meterNumber, manufacturer, model, serialNumber, integrationId, externalDeviceId,
         externalChannel (default ''), multiplier (>0, default 1), valueOffset (≥0, default 0),
         registerDigits 3–12, expectedIntervalMinutes 15|60|1440|43200, tariffPerUnit, municipalAccountNumber,
         responsibilityMode (default owner_paid), isPrepaid, installedDate YYYY-MM-DD, notes.
         Refinements: a submeter needs unitId or buildingId; a non-manual meter needs integrationId + externalDeviceId.
         201 { meterId } | 409 device_already_bound | 400 invalid_meter_link   (audit smart_meter.create)

PATCH  /api/v1/smart-meters/:id                               body: smartMeterUpdateSchema
         Config edits (number, serial, manufacturer, model, ownership, parent, building, multiplier, valueOffset,
         registerDigits, expectedIntervalMinutes, tariffPerUnit, municipalAccountNumber, notes) or
         { decommission: true } → active=false + decommissioned_at; history is never deleted.
         200 { meterId, changed: false } when nothing to change | 409 device_already_bound | 400 invalid_meter_link
         (audit smart_meter.update / smart_meter.decommission)

POST   /api/v1/smart-meters/:id/replace                       body: smartMeterCreateSchema
         Physical swap: old meter decommissioned, new meter inserted with replaced_meter_id → old; active
         submeters re-parented to the new meter; old meter restored if the insert fails.
         201 { meterId, replacedMeterId } | 409 meter_inactive | 400 utility_type_mismatch   (audit smart_meter.replace)

GET    /api/v1/smart-meters/:id/telemetry?from=&to=
         Up to 500 readings, newest first, in display units. 200 { displayUnit: 'kL'|'kWh', readings[] }
POST   /api/v1/smart-meters/:id/telemetry                     body: manualMeterReadingSchema
         { readAt (ISO datetime with offset), reading (kL for water / kWh, ≥0), documentId?, notes? }
         201 { readingId } | 409 meter_inactive | 400 future_timestamp (> now + 5 min)
         | 400 invalid_document (photo must be a live document of the same property)
         | 400 below_offset | 409 duplicate_reading (same meter + read_at)   (audit meter_reading.manual)

POST   /api/v1/properties/:id/buildings                       body: { name 1–100 }
         201 { building } | 409 duplicate_building

POST   /api/v1/properties/:id/meter-integrations              body: { provider milesight_lorawan|shelly_gen2|generic_json|simulator, name 1–100 }
         Gate: org role manager+ (requireOrgRole 'manager') AND can_write_property_utilities.
         201 { integration, token, ingestUrl } — the plaintext token is returned ONCE and never stored or logged.
         403 forbidden ("Only an organisation manager or principal can connect meter hardware.")   (audit meter_integration.create)
GET    /api/v1/meter-integrations/:id
         200 { integration (non-secret columns), events: last 20 meter_ingest_events } | 404
POST   /api/v1/meter-integrations/:id                         body: { action: 'rotate' | 'revoke' }
         Gate: manager+ AND can_write_property_utilities. 409 integration_revoked if already revoked.
         rotate → 200 { token, previousTokenValidUntil } (old token valid 24 h)   (audit meter_integration.rotate)
         revoke → 200 { status: 'revoked' }, previous-token grace cleared immediately   (audit meter_integration.revoke)

PUT    /api/v1/properties/:id/utility-alert-settings          body: utilityAlertSettingsSchema
         { discrepancyThresholdPct 0–100, spikeMultiple 1–50, nightFlowLitresPerHour, nightBaseLoadRatio 0–5,
           vacantWaterLitresPerDay, vacantElectricityKwhPerDay } → upsert on property_id. 200 { saved: true }
PATCH  /api/v1/utility-alerts/:id                             body: { status: 'acknowledged'|'resolved'|'open' }
         200 { status } — written with the session client under the utility_alerts_update_status policy.

PUT    /api/v1/properties/:id/municipal-submissions/settings  body: municipalSubmissionSettingsSchema
         { municipalityCode?, municipalAccountNumber?, mode manual|approval_required|automatic, billingDay 1–28,
           leadDays 0–20, includePhotos, enabled } → 200 { saved: true }
         | 400 unknown_municipality | 400 automatic_not_supported (municipality has no verified email channel)
POST   /api/v1/properties/:id/municipal-submissions/recipients   body: { email, label?, recipientType
           municipality|managing_agent|utility_company|accountant|custom, authorise: boolean }
         201 { recipientId } | 409 duplicate_recipient
PATCH  /api/v1/municipal-submission-recipients/:id            body: { active?, authorise?, label? } → 200 { updated: true }
POST   /api/v1/properties/:id/municipal-submissions           body: { periodStart? YYYY-MM-DD }
         Prepares (does NOT send) the pack for the last complete billing period or the period containing
         periodStart. Idempotent per (property, period_start): 201 when created, 200 when it already existed.
POST   /api/v1/municipal-submissions/:id                      body: discriminated on action
         approve    → approve + create deliveries for authorised recipients + send now; 200 { status:'approved', deliveries, send }
         send       → make failed deliveries due now and send; 409 not_approved unless approved|sending|partially_failed|failed
         cancel     → only draft|pending_approval|approved, else 409 cannot_cancel; pending deliveries deleted (audit municipal_submission.cancelled)
         acceptance → { acceptanceStatus unknown|accepted|rejected|not_applicable, reference?, notes? } (audit municipal_submission.acceptance_recorded)
         409 invalid_state on an illegal transition (SubmissionStateError) — including approve with no active
         authorised recipient, which is checked BEFORE any status change, so a refused approval leaves the pack unchanged.
GET    /api/v1/municipal-submissions/:id/export?format=csv|pdf   (default pdf)
         Stored report snapshot as an attachment download, Cache-Control: private, no-store. 400 invalid_format.
```

**Device-token authenticated (meter gateways)**

```
POST   /api/v1/integrations/meters/ingest
         Authorization: Bearer pmi_<prefix>_<secret> (per-integration token; no user session; CSRF-exempt and
         MFA step-up-exempt). The token resolves org + property; nothing in the payload can name them.
         Body: provider-specific JSON (Milesight network-server uplink, Shelly Gen2, generic JSON, simulator),
         normalised by lib/smartUtility/adapters.ts. Max 256 KB.
         Rate limits: 600/min per source IP, 300/min per token prefix (rateLimitOrRespond).
         200 { accepted, duplicates, suspect, rejected: [{ deviceId, channel, readAt, reason, detail? }] }
             reason ∈ unknown_device | future_timestamp | too_old | invalid_value | payload_invalid
             (partial success is still 200 so a gateway never retries a whole batch for one bad device)
         401 unauthorized (missing/malformed/unknown token) | 403 integration_revoked
         400 invalid_json | 413 payload_too_large | 422 when the payload itself is unparseable (payload_invalid)
         503 ingest_failed (transient; safe to retry — idempotency keys prevent double storage)
```

**System jobs**

```
POST   /api/v1/system/smart-utility-jobs
         Authorization: Bearer <CRON_JOB_SECRET>, or a signed-in super_admin. Runs runSmartUtilityJob():
         health sweep → daily anomalies → monthly reconciliation → due submissions → deliveries/retries →
         email status sync. 200 { result } | 500 { result } when any step failed.
POST   /api/v1/system/daily-jobs    (existing) — now runs the same job as step 7 `smartUtility`; it is
         independent of steps 1–6 and its failure marks the overall run unsuccessful.
```

#### 6b.1 2026-10-10 additions (migrations 20260101000176 / 177)

Same plumbing as above unless stated (`401 unauthenticated`, `400 invalid_json`, `400 validation_failed`, `404` when not readable under RLS, `403 forbidden` when the write gate fails). Errors are `{ error: { code, message, ...extra } }` (`jsonError` in `lib/smartUtility/http.ts`). Rate-limited routes return `429` from `rateLimitOrRespond`. **Superseded lines above:** the `meter-integrations` action list, the ingest `200` body (now also has `ignored`), and the recipient responses (now also carry `approvalWithdrawn`) are restated here.

**Meter hardware (provider engine)**

```
POST   /api/v1/properties/:id/meter-integrations              body: meterIntegrationCreateSchema
         { provider milesight_lorawan|shelly_gen2|generic_json|simulator|chirpstack_v4|tts_v3|thingsboard,
           name 1–100, config? { <key>: string ≤500 } (default {}), credentials? { <key>: string ≤2000 } (≤10 keys),
           syncIntervalMinutes? 15|60|1440 }
         Gate unchanged: manager+ (requireOrgRole 'manager') AND can_write_property_utilities.
         Poll providers (thingsboard): config.baseUrl must pass validateBaseUrl (SECURITY.md) → else 400 invalid_config;
         credential keys must be the provider's credentialFields and at least one non-empty → else 400 invalid_credentials;
         503 credentials_key_missing when SMART_UTILITY_CREDENTIALS_KEY is not configured (fail closed).
         Credentials are encrypted with the new row id as AAD; sync_interval_minutes defaults to 60; next_sync_at = now.
         201 { integration { id, provider, name, token_prefix, status, sync_mode, created_at }, token, ingestUrl }
             — token/ingestUrl are null for poll providers (Proplyst calls them; no inbound token is shown).
POST   /api/v1/meter-integrations/:id                         body: meterIntegrationActionSchema (discriminated on action)
         Gate for EVERY action: manager+ AND can_write_property_utilities → else 403; 409 integration_revoked if revoked.
         rotate              → unchanged (200 { token, previousTokenValidUntil })
         revoke              → 200 { status: 'revoked' }; now also sets credentials_ciphertext = null (stored vendor credentials destroyed)
         verify              → 200 { ok, message }. Push (or no verifyConnection): reports the last meter_ingest_events row.
                                Poll: 409 no_credentials | 503 credentials_key_missing | provider verifyConnection result.
         sync_now            → poll only, else 409 not_polled. 200 { integrationId, ok, message, result? } when ok, 502 same body when not.
         update_credentials  → { credentials }. Poll only, else 409 not_polled; 400 invalid_credentials (unexpected key);
                                503 credentials_key_missing. Re-encrypts, resets consecutive_failures, clears last_sync_error,
                                next_sync_at = now. 200 { updated: true }   (audit meter_integration.credentials_updated — field names only)
GET    /api/v1/organizations/:orgId/meter-integration-requests
         200 { requests[] } (≤50, newest first; RLS: org viewer+, so a non-member gets an empty list)
POST   /api/v1/organizations/:orgId/meter-integration-requests   body: meterIntegrationRequestSchema
         { propertyId? uuid, utilityType water|electricity, manufacturer 1–100, model 1–100, connectionMethod? ≤100,
           supplier? ≤200, notes? ≤1000 }
         403 forbidden (not an org member) | 429 (10 per hour per user) | 403 forbidden when RLS refuses the insert
         (e.g. a property the caller cannot read). Inserted with the session client, requested_by = caller.
         Notifies org staff at manager+ (meter_integration_requested), excluding the requester. 201 { requestId }
```

**Device ingest (changed)**

```
POST   /api/v1/integrations/meters/ingest
         URL query parameters are now passed to the provider adapter. ChirpStack v4 sends the event type as ?event=…;
         only `up` carries readings — any other event is acknowledged with zero readings (200). The Things Stack
         non-uplink messages are likewise acknowledged and ignored.
         200 { accepted, duplicates, suspect, ignored, rejected[] } — `ignored` counts readings from a BOUND device
         on a channel no meter uses (e.g. a codec's battery field); an unbound device is still `unknown_device`.
         A poll provider's integration cannot push: parsePush throws → payload_invalid → 422.
```

**Meters and readings**

```
POST   /api/v1/properties/:id/smart-meters  and  POST /api/v1/smart-meters/:id/replace
         smartMeterCreateSchema now also accepts location (≤200); installedDate YYYY-MM-DD (both mapped by meterInsertRow).
PATCH  /api/v1/smart-meters/:id
         smartMeterUpdateSchema now also accepts location (≤200) and installedDate (YYYY-MM-DD, nullable); '' clears a field.
GET    /api/v1/smart-meters/:id/telemetry
         Each reading now also carries verificationStatus, verifiedAt, verificationNote, recordedBy.
POST   /api/v1/smart-meters/:id/telemetry
         Manual readings are stored with verification_status = 'unverified'.
POST   /api/v1/meter-readings/:id                             body: meterReadingReviewSchema { decision verified|rejected, note? ≤500 }
         404 not readable | 403 unless can_write_property_utilities | 409 not_reviewable for device readings
         (verification_status 'not_required'). Sets verified_by/at/note; rejected → status 'rejected' (excluded from
         consumption), verified → status 'valid'. 200 { verificationStatus, verifiedAt }   (audit meter_reading.verified|rejected)
GET    /api/v1/meter-readings/:id/evidence
         One-page PDF (photo beside the reading, meter identity/location, date, who recorded it, source, verification).
         404 unless can_read_property_utilities. Photo only if the document is JPEG/PNG, same org, not deleted; read via
         downloadProtectedObject keyed to the reading's org. Content-Disposition inline; filename
         meter-evidence-<YYYY-MM-DD>.pdf; Cache-Control: private, no-store. 500 evidence_report_failed.
```

**Municipal reporting**

```
PUT    /api/v1/properties/:id/municipal-submissions/settings  body: municipalSubmissionSettingsSchema
         New optional fields: ccEmails (≤5 emails, lower-cased, de-duplicated), accountHolderName ≤200, customMessage ≤2000,
         subjectTemplate ≤300, bodyTemplate ≤5000, includeFields { propertyAddress, accountNumber, accountHolder,
         serialNumber, previousReading, consumption, readingDate, photos } (all booleans), scheduleEnabled.
         400 unknown_placeholders (subject/body placeholder outside the allowed list).
         Upserted with the session client. If the template hash, municipal account number or municipality changed,
         approval is withdrawn (and schedule_enabled set false).
         scheduleEnabled: true → 409 template_not_approved or 409 no_authorised_recipients, each with saved: true in the
         error body (the settings were saved; scheduling was not switched on).
         200 { saved: true, approvalWithdrawn }
POST   /api/v1/properties/:id/municipal-submissions/preview   body (optional): municipalPreviewSchema
         { subjectTemplate?, bodyTemplate?, customMessage?, accountHolderName?, includeFields? } — unsaved edits, render only.
         Gate: can_read_property_utilities (else 404). Previews the billing period containing the next scheduled send date.
         200 { periodStart, periodEnd, to[], cc[], subject, bodyText, bodyHtml, attachments[], photos[{filename,
               contentType, dataUrl}], templateHash, isDraft, approved, scheduleEnabled, scheduledFor, warnings, meters }
         (a draft preview is never `approved`) | 400 invalid_json | 400 validation_failed | 500 preview_failed
GET    /api/v1/properties/:id/municipal-submissions/preview?format=pdf
         The PDF that would be attached (saved template). 400 invalid_format without format=pdf.
         Content-Disposition inline; Cache-Control: private, no-store. 500 preview_pdf_failed.
POST   /api/v1/properties/:id/municipal-submissions/test-send  (no body)
         Gate: can_write_property_utilities. Sends the saved pack ONLY to the signed-in user's own account email,
         subject prefixed "[TEST] ", no CC, body prefixed with who the real email would go to; PDF + CSV + photos attached.
         409 no_email (account has no email) | 429 (5 per hour per user). 200 { sentTo, deliveryConfigured, message }
         (audit municipal_template.test_sent with templateHash). Creates no deliveries (integration-tested).
POST   /api/v1/properties/:id/municipal-submissions/approve-template   body: { templateHash: 64 hex }
         Gate: can_write_property_utilities. The hash must equal the server's hash of the SAVED template now
         → else 409 preview_outdated; 409 no_authorised_recipients; 500 approve_failed when no settings row exists.
         Sets template_hash / template_approved_at / template_approved_by.
         200 { approved: true, templateHash, approvedAt }   (audit municipal_template.approved with to, cc, subject,
         bodyText and attachment filenames)
DELETE /api/v1/properties/:id/municipal-submissions/approve-template
         Withdraws approval and sets schedule_enabled = false. 200 { approved: false }   (audit municipal_template.approval_withdrawn)
POST   /api/v1/properties/:id/municipal-submissions/recipients   — now 201 { recipientId, approvalWithdrawn };
         adding a recipient with authorise: true withdraws the template approval.
PATCH  /api/v1/municipal-submission-recipients/:id              — now 200 { updated: true, approvalWithdrawn };
         any request that includes `active` or `authorise` withdraws the template approval.
```

Scheduled packs: when the job generates a pack and the effective mode is `automatic` (requires `SMART_UTILITY_AUTO_SUBMISSION_ENABLED='true'`), `schedule_enabled` is on, the approval hash is current and an authorised recipient exists, the pack is created as `scheduled` with deliveries; otherwise `pending_approval` (or `draft` in manual mode). Delivery sends the stored `rendered_email` subject/body, never a re-render. `POST /api/v1/municipal-submissions/:id` `approve` responds `{ status: 'scheduled' }`; `send` accepts approved|scheduled|sending|partially_failed|failed and `cancel` accepts draft|pending_approval|approved|scheduled (fixed 2026-10-10 after doc review; a scheduled pack can be cancelled — integration-tested).

**Billing (tariffs and utility charges)**

```
GET    /api/v1/properties/:id/utility-tariffs
         200 { tariffs[] } newest effective_from first (RLS-scoped session read; no explicit 404 for an unreadable property).
POST   /api/v1/properties/:id/utility-tariffs                 body: utilityTariffCreateSchema
         { utilityType water|electricity, name 1–100, fixedCharge 0–1,000,000 (default 0), blocks [{ upTo >0|null,
           rate 0–100,000 }] 1–10, vatInclusive (default true), effectiveFrom YYYY-MM-DD, notes? ≤500 }
         Gate: can_write_property_utilities. 400 invalid_blocks (validateBlocks: ascending upTo, last block open-ended).
         The previous open-ended tariff for the same utility (effective_from earlier) is closed the day before.
         201 { tariffId }   (audited by the table's log_audit_event_trigger)
GET    /api/v1/properties/:id/utility-charges
         200 { charges[] } (≤300, all statuses, newest period first, with units(unit_label)).
POST   /api/v1/properties/:id/utility-charges                 Gate: can_write_property_utilities.
         Generate: { periodStart, periodEnd } (YYYY-MM-DD) → DRAFT charges for every active unit submeter, idempotent
           per meter + period. 201 when any were created, else 200: { created, existing, skipped[{ meterId, label, reason }] }
           (skipped when no tariff is effective on periodStart).
         Action: { action approve|void|invoice, chargeIds uuid[1–200], dueInDays? 0–90 }
           approve → 200 { approved, ignored } (only drafts with a calculated consumption)   (audit utility_charges.approved)
           void    → 200 { voided } (draft or approved only)                                 (audit utility_charges.voided)
           invoice → 200 { invoices[], skippedWithoutLease } — one DRAFT invoice per lease/tenant via
                     create_manual_invoice() on the caller's SESSION client (due in dueInDays, default 14; reference
                     UTIL-<period_start>); charges marked invoiced only after the invoice exists; never issued.
                     (audit utility_charges.invoiced)
         409 billing_rejected (BillingError, e.g. nothing eligible) | 400 validation_failed | 500 charges_action_failed
```

**System job (changed):** `runSmartUtilityJob()` steps are now poll sync (`runPollSync`, due `poll` integrations, ≤100 per run) → health sweep → daily anomalies → monthly reconciliation → monthly snapshots (`meter_period_snapshots`, on each property's billing day) → approval reminders (packs `pending_approval` ≥20 h, at most once per ~20 h) → due submissions → deliveries/retries → email status sync. Each step is caught independently; any step error makes `jobFailed()` true.

## 7. Documents & OCR

```
POST    /api/v1/documents                (multipart upload, returns document + queues ocr_job)
GET     /api/v1/documents
GET     /api/v1/documents/:id
GET     /api/v1/ocr-jobs/:id
POST    /api/v1/ocr-jobs/:id/review        (human confirms/corrects extracted fields)
```

## 8. Communication

```
GET     /api/v1/notifications
POST    /api/v1/notifications/:id/read
PATCH   /api/v1/notification-preferences
POST    /api/v1/webhooks/whatsapp          (inbound, signature-verified — see WHATSAPP.md)
POST    /api/v1/webhooks/email             (delivery status callbacks — see EMAIL.md)
```

## 9. AI

```
POST    /api/v1/ai/conversations
POST    /api/v1/ai/conversations/:id/messages   (returns assistant reply + staged_changes, never applies directly)
POST    /api/v1/ai/messages/:id/confirm          (applies the staged change via the normal typed endpoint it staged — the AI path re-enters the same permission/validation checks as a human using the UI, never a privileged shortcut)
GET     /api/v1/insights                          (Portfolio Intelligence feed, rules-engine generated)
POST    /api/v1/insights/:id/dismiss
```

## 10. Cross-cutting: permission and validation enforcement

Every endpoint above validates: (1) caller is authenticated, (2) caller has an active membership/owner/tenant relationship to the target `org_id`/resource, (3) caller's role meets the endpoint's minimum role per `PERMISSIONS.md` (e.g. `POST /journal-entries/:id/reverse` requires `accountant`+), (4) request body against a Zod schema (retained pattern from `packages/validation`, extended with new domain schemas) before any database write is attempted. Validation failures return `400` with `field_errors`, never a generic `500`.

## 11. What the AI Assistant and native apps do NOT get

No endpoint grants elevated/bypass access to either the AI Assistant or the native mobile clients — both call the exact same typed endpoints, under the exact same role checks, as the web app. This is the API-design expression of `PERMISSIONS.md` §5's "never only in the UI" rule: there is no shortcut path anywhere in this surface that skips business-logic validation because the caller happens to be a trusted internal client.
