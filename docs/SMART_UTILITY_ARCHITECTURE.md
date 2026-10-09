# Smart Utility Monitoring — Architecture

**Date:** 2026-10-08. **Companion docs:** `SMART_UTILITY_HARDWARE_RESEARCH.md` (what hardware and why),
`SMART_UTILITY_IMPLEMENTATION_PLAN.md` (phases, estimates, status). **Migration:**
`supabase/migrations/20260101000175_smart_utility_metering.sql`.

## 0. Principles

1. **Extend, don't replace.** Migration 163 already ships `utility_meters`, `utility_readings` (one _billing-period_
   reading per meter per month, used by the web panel and the Android capture screens), `record_utility_reading()`,
   `lib/utilityAnomaly.ts` and the `unusual_utility_usage` insight rule. All of that keeps working unchanged. The
   smart module adds _interval telemetry_ beside it rather than overloading the monthly table.
2. **Push, not poll, in Phase 1.** Every recommended device (Milesight LoRaWAN gateway, Shelly Gen2+, Teltonika /
   Modbus gateways) can push HTTP to us. So Phase 1 needs **no stored vendor credentials** and no polling workers —
   only per-integration _inbound_ tokens that Proplyst issues and stores as SHA-256 hashes.
3. **Vendor-neutral adapters.** One ingestion endpoint; per-provider adapters normalise payloads to one
   `NormalisedReading` shape. A new manufacturer is a new adapter file plus a test, never a schema change.
4. **Raw readings are immutable; consumption is derived.** We store timestamped _cumulative register values_ and
   compute consumption in pure, unit-tested TypeScript that understands rollover, resets, replacements, multipliers
   and gaps.
5. **Never auto-classify.** Main-vs-submeter differences are shown as _unallocated_; anomalies are "possible", with
   the rule and the numbers that triggered them. Nothing is labelled theft or a confirmed leak.
6. **A sent email is not an accepted reading.** Delivery state and municipal acceptance are separate fields;
   acceptance is only ever set by a human.

## 1. Hierarchy

```
Property ──┬─ Building (optional, property_buildings)
           │     └─ Units (units.building_id, optional)
           ├─ Main water meter        (utility_meters.meter_role = 'main', unit_id null)
           ├─ Main electricity meter  (meter_role = 'main')
           ├─ Building check meters   (meter_role = 'check', building_id set)
           └─ Unit meters             (meter_role = 'submeter', unit_id set, parent_meter_id → main/check)
```

- `property_buildings(id, org_id, property_id, name, sort_order)` — optional; a property with no buildings behaves
  exactly as today.
- `units.building_id` and `utility_meters.building_id` — nullable FKs, validated by trigger to belong to the same
  property.
- `utility_meters` gains (all nullable / defaulted so existing rows and the Android client are unaffected):
  `meter_role` (`main|submeter|check`, default `submeter` if unit-scoped else `main` — backfilled), `ownership`
  (`municipal|private`), `parent_meter_id`, `building_id`, `manufacturer`, `model`, `serial_number`,
  `connectivity` (`manual|lorawan|wifi|modbus_gateway|http_push|simulator`), `integration_id`,
  `external_device_id`, `external_channel`, `multiplier` (base units per raw unit, default 1), `value_offset` (base
  units added after the multiplier — the dial reading when a pulse counter was fitted at 0),
  `register_digits` (rollover), `expected_interval_minutes`, `tariff_per_unit` (R per kL / per kWh, for _estimated_
  cost only), `municipal_account_number`, `last_reading_at`, `last_reading_value`, `last_sync_at`,
  `health_status` (`unknown|online|stale|offline|error`), `replaced_meter_id`, `decommissioned_at`.
- **Replacement** = decommission the old row (`active=false`, `decommissioned_at`) and create a new row with
  `replaced_meter_id` → old. History is never moved or rewritten; consumption is computed per physical meter and
  summed across the replacement chain.
- **Uniqueness of device binding:** `(integration_id, external_device_id, external_channel)` is unique among active
  meters, so a device can feed only one active meter.

## 2. Data model (new tables, migration 175)

| Table                              | Purpose                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `property_buildings`               | Optional building/block level.                                                                                                                                                                                                |
| `meter_integrations`               | One push connection (a gateway, a Shelly fleet, a Modbus gateway, the simulator) scoped to an org and optionally one property. Holds `provider`, `token_prefix`, `token_hash` (SHA-256), `previous_token_hash` + `previous_token_expires_at` (rotation grace), `status`, `last_seen_at`. **The plaintext token is shown once and never stored.** |
| `meter_telemetry_readings`         | Append-only cumulative register readings: `meter_id`, `read_at`, `raw_value`, `value` (= raw × multiplier + value_offset, in the meter's base unit: L or kWh), `source` (`device|manual|simulator|estimated`), `integration_id`, `external_event_id`, `status` (`valid|suspect|rejected`), `rejection_reason`, `document_id` (photo evidence), `recorded_by`. **Unique `(meter_id, read_at)`** and **unique `(integration_id, external_event_id)`** = idempotency/duplicate detection. |
| `meter_ingest_events`              | One row per ingestion request (accepted / partially accepted / rejected, counts, reason, source IP hash) — the integration audit log and the "test connection" evidence.                                                     |
| `utility_alerts`                   | Rule-based anomaly and discrepancy alerts: `rule` (`water_continuous_night_flow`, `consumption_spike`, `vacant_unit_consumption`, `electricity_night_base_load`, `main_submeter_discrepancy`, `meter_offline`, `meter_reset_detected`), `severity`, `period_start/end`, `details jsonb`, `estimated_cost`, `status` (`open|acknowledged|resolved`), `dedupe_key` unique. |
| `utility_alert_settings`           | Per-property thresholds (discrepancy %, spike multiple, night-flow window/threshold, vacancy floor) with code defaults when absent.                                                                                         |
| `municipal_submission_settings`    | Per property: `municipality_code`, `municipal_account_number`, `mode` (`manual|approval_required|automatic`), `billing_day`, `lead_days`, `include_photos`, `enabled`.                                                         |
| `municipal_submission_recipients`  | Per property: `email`, `label`, `recipient_type` (`municipality|managing_agent|utility_company|accountant|custom`), `authorised_at`, `authorised_by`, `active`. Only **authorised** recipients can receive automatic sends. |
| `municipal_submissions`            | One reading pack per property per period: `period_start/end`, `status` (`draft|pending_approval|approved|sending|sent|partially_failed|failed|cancelled`), `report jsonb` (immutable snapshot of what was sent), `approved_by/at`, `acceptance_status` (`unknown|accepted|rejected|not_applicable`), `submission_reference`, `acceptance_notes`. |
| `municipal_submission_deliveries`  | One row per recipient per submission: `status` (`pending|queued|sent|delivered|failed|bounced`), `attempts`, `next_attempt_at`, `last_error`, `email_message_id`, `provider_message_id`. The delivery id is the `relatedEntityId` passed to `dispatchEmail`, so its one-email-per-entity idempotency applies per recipient. |

### 2.1 Access control (RLS)

All new tables carry `org_id` and `property_id` (or reach it via `meter_id`), and use the **owner-portal-aware
pattern** established by migrations 068/072:

- **read:** `(has_org_role(org_id,'viewer') and has_property_access(property_id,'read_only')) or has_property_access(property_id,'owner')`
- **write:** `has_org_role(org_id,'accountant') and (has_property_access(property_id,'accountant') or has_property_access(property_id,'property_manager') or has_property_access(property_id,'owner'))`
- `meter_telemetry_readings`, `meter_ingest_events`, `municipal_submission_deliveries` have **no client write
  policy**: they are written only by the service-role ingestion/dispatch code after the route has authorised the
  caller (token for devices, `requirePropertyAccess` for users).
- `meter_integrations.token_hash`/`previous_token_hash` are excluded from client reads by a column-level `revoke`
  so even an org principal never sees a hash.

**Existing-gap fix in the same migration.** `utility_meters` and `utility_readings` (migration 163) were org-only,
justified as "consistent with every other financial table" — but expenses moved to property-access RLS in migration
068, so a _selected-properties_ staff member could read every meter in the org, and portal owners could read none.
Migration 175 replaces those policies with the pattern above and adds the property check inside
`record_utility_reading()`. Members in `all` mode are unaffected (they hold auto-granted `administrator` rows,
migration 084).

## 3. Ingestion pipeline

```
Physical meter
  → pulse counter / Modbus meter / Shelly
  → gateway (Milesight network server | Teltonika | Shelly script)
  → POST /api/v1/integrations/meters/ingest      Authorization: Bearer pmi_<prefix>_<secret>
       1. rate limit (per IP and per token prefix)
       2. token lookup by prefix → constant-time SHA-256 compare (current or unexpired previous hash)
       3. integration must be active; resolves org (+ optional property) — never trusts payload org ids
       4. adapter(provider).parse(body) → NormalisedReading[] {externalDeviceId, channel, readAt, rawValue, eventId}
       5. per reading: resolve meter by (integration_id, external_device_id, channel), must be active and in the
          integration's org/property → else rejected 'unknown_device'
       6. validate: readAt not > 5 min in future, not older than 400 days, finite, ≥ 0;
          monotonic vs previous reading → if lower: rollover (register_digits) | 'reset_suspected' → status suspect
       7. insert meter_telemetry_readings (unique constraints = duplicate detection; 23505 → counted as duplicate)
       8. update meter last_reading_*, last_sync_at, health_status='online'; integration.last_seen_at
       9. insert meter_ingest_events summary row
  → 200 {accepted, duplicates, rejected[]}  (202-style partial acceptance never fails the whole batch)
```

- **Adapters** (`apps/admin/lib/smartUtility/adapters/`): `milesight` (Milesight network-server HTTP uplink: `devEUI`,
  `time`, `fCnt`, and either decoded `pulse`/`counter`/`water` fields or base64 `data` decoded with the EM300-DI
  channel layout `0x05 0xC8` counter), `shelly` (Gen2 EM / EMData `total_act` Wh and `Input` `counts.total`, posted by
  an on-device script), `generic_json` (`{readings:[{deviceId, channel?, readAt, value, eventId?}]}` for Teltonika /
  Waveshare / ESPHome / any Modbus gateway), `simulator`.
- **Spoof protection:** per-integration secret (≥ 32 random bytes, hashed); device must be pre-registered to a meter
  _bound to that integration_; cross-org device ids are impossible because lookup is scoped to the integration's org;
  timestamp window; monotonicity check; per-reading idempotency key; rate limiting; every request logged. Gateways
  that support it should also be IP-allow-listed at the edge (deployment note, not code).
- **Rotation:** `POST …/integrations/:id/rotate` issues a new secret; the old hash stays valid for 24 h
  (`previous_token_expires_at`) so a gateway can be reconfigured without data loss. `revoke` disables immediately.
- **Offline handling:** the daily job marks meters `stale` after 3 × `expected_interval_minutes` without a reading
  and `offline` after 24 h past that, and raises a `meter_offline` alert (deduped per meter per day). Devices that
  buffer (EM300-DI stores 1,000 records; Shelly EMData keeps history) back-fill on reconnect; late readings are
  accepted as long as they are inside the window and not duplicates, and consumption is always recomputed from the
  ordered series, so delayed telemetry is handled correctly.
- **Polling providers** (Phase 2, e.g. Shelly Integrator API or Kamstrup READy) would need stored vendor credentials.
  `encrypted_secrets` (migration 027) has no encryption implementation today — **Phase 2 blocker, recorded in the
  tech-debt register**. No Phase 1 path needs it.

## 4. Reading frequency

The owner configures `expected_interval_minutes` per meter. The UI only offers intervals the connectivity method
supports (`lib/smartUtility/capabilities.ts`):

| Connectivity                    | Offered intervals              | Why                                                                                   |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| LoRaWAN (EM300-DI)              | 15 min, 1 h, 1 day             | Battery life: ≈5 y at 10 min per Milesight; shorter is not offered                   |
| Wi-Fi (Shelly)                  | 15 min, 1 h, 1 day             | Mains-powered; finer data stays on device                                             |
| Modbus gateway                  | 15 min, 1 h, 1 day             | Gateway poll interval; LTE data cost scales with frequency                           |
| Manual                          | 1 day, 1 month                 | Human-entered                                                                         |

The interval is _configured on the device/gateway_ (documented in the install guide); Proplyst uses the stored value
for health checks and for choosing the default chart granularity. Proplyst never pushes configuration to devices in
Phase 1.

## 5. Consumption engine (`lib/smartUtility/consumption.ts`)

Pure functions over `[{readAt, value, status, meterId}]` per meter, all in the meter's base unit (L or Wh; kL / kWh
for display):

- `computeIntervals(readings, {registerDigits, multiplier})` → ordered deltas. A drop in value is a **rollover**
  when `registerDigits` is set and `prev + (10^digits × multiplier − prev) + curr` is a plausible delta (≤ 50 % of
  register span); otherwise it is a **reset**: the interval contributes `null` (unknown) consumption, is flagged, and
  the next interval restarts from the new value. Suspect/rejected readings are excluded.
- **Replacements:** each physical meter's series is computed separately and the results summed across the
  `replaced_meter_id` chain, so the old meter's final reading and the new meter's first reading never produce a
  bogus delta.
- **Multiplier changes:** stored `value` is already multiplied at ingest time with the multiplier in force, so a
  later multiplier change does not reinterpret history.
- `consumptionForPeriod(readings, start, end)` → value at each boundary by linear interpolation between the
  readings either side (when both exist within `maxGapHours`, default 48 h); otherwise the nearest reading inside
  the period, with `quality: 'interpolated' | 'nearest' | 'insufficient'`. **Billing periods come from the
  property's `billing_day`** (e.g. 25th → 25 Sep 00:00 to 25 Oct 00:00 SAST), never assumed to be calendar month
  end.
- All period maths uses `Africa/Johannesburg` (UTC+2, no DST) explicitly.

## 6. Reconciliation (`lib/smartUtility/reconciliation.ts`)

For a utility type and period: `main` consumption (property main meter, or building check meter for a building
scope) versus the sum of active submeters whose `parent_meter_id` is that main/check meter, or failing that every
unit submeter in the scope. Output: `{main, submeterTotal, unallocated, unallocatedPct, submeters[], missing[],
status}` where `status` is `within_threshold | above_threshold | insufficient_data`. With the brief's example
(100 kL main, 20 + 25 + 30 + 15 kL units) the engine returns `unallocated = 10 kL, 10 %`. Above the configured
threshold (default 15 %) a `main_submeter_discrepancy` alert is raised, worded "unallocated consumption — may be
common-area use, timing differences, measurement error or a leak". Negative unallocated (submeters exceed main) is
reported as its own data-quality status, not an alert about tenants.

## 7. Rule-based analytics (`lib/smartUtility/anomalies.ts`)

Run by the daily job over the last complete day (SAST), per meter:

| Rule                            | Water                                                                                                  | Electricity                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Night flow / base load          | Every hourly bucket 00:00–05:00 has consumption > `nightFlowLitresPerHour` (default 5 L/h) → _possible leak_ | Mean 00:00–05:00 hourly kWh > `baseLoadRatio` (default 0.6) × daytime mean and > 0.3 kWh/h       |
| Spike                           | Day consumption > `spikeMultiple` (default 3) × median of the previous 14 days and > 200 L           | same, floor 5 kWh                                                                                    |
| Vacant unit                     | Unit `status='vacant'` and day consumption > 50 L                                                     | > 2 kWh                                                                                              |
| Reset detected / offline        | From the consumption engine / health check                                                            | same                                                                                                 |
| Main vs submeter                | Reconciliation above threshold (monthly)                                                               | same                                                                                                 |

Every alert stores the numbers that triggered it and an **estimated financial impact** = excess consumption ×
`tariff_per_unit` when a tariff is configured (labelled "estimate"; Phase 2 replaces the flat tariff with block
tariffs). Alerts are deduped (`dedupe_key`), notify property staff via `notifyPropertyStaff` (`type =
'utility_alert'`), and never call an LLM. The existing mock-only LLM provider can later explain an alert on demand
(Phase 3); no per-reading inference is introduced.

## 8. Monthly municipal submissions

- **Municipality directory** (`lib/smartUtility/municipalities.ts`): code, name, channels, and _only_ the email
  addresses verified in the research doc, each with `sourceUrl` and `verifiedOn`. Ambiguous/stale ones
  (eThekwini `revlineresponse@`, Polokwane contractor domain) are listed as notes, not pre-filled. App-only
  municipalities have `emailSubmission: false` and the UI offers "prepare + remind + export" only.
- **What is reported:** only meters with `ownership='municipal'` (the official meter). Reading source per meter:
  a manual `utility_readings` / telemetry reading with a photo (`verified: photo evidence`), or a device reading
  from a counter on the municipal meter (`device-derived — verify against the meter dial`). **Private submeter
  readings are never put in a municipal pack.**
- **Modes:**
  - `manual` — the pack is generated (on demand or on the schedule) and the owner downloads CSV/PDF or sends it
    from their own mailbox. Nothing is emailed by Proplyst.
  - `approval_required` (default) — the job prepares the pack `lead_days` before `billing_day`, notifies staff,
    and only an accountant+/owner with property access can approve; approval queues delivery to the active
    recipients.
  - `automatic` — sends on schedule to **authorised** recipients only. Hard-gated by the platform flag
    `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` (default off): with the flag off, automatic behaves exactly as
    approval-required and the UI says so. Never available for app-only municipalities.
- **Report** (`lib/smartUtility/municipalReport.ts`): property name/address, owner/managing agent, municipality,
  account number, per-meter serial/number, type, previous & current reading, reading dates, consumption, source &
  verification status, reporting period, evidence photo count. Rendered as HTML email + plain text + **CSV
  attachment** + **PDF attachment** (pdfkit, already a dependency) + evidence photos as attachments when
  `include_photos`. `SendEmailInput` gains inline `files` attachments (Resend `attachments`), the first real
  attachment path in the codebase.
- **Delivery & retries:** one `municipal_submission_deliveries` row per recipient; `dispatchEmail` with
  `relatedEntityType='municipal_submission_delivery'`. Failures schedule retries with backoff (1 h, 6 h, 24 h, max 4
  attempts), then `failed` + staff notification. Resend webhook updates to `email_messages` are mirrored to the
  delivery row on the next job run (delivered/bounced). Submission status rolls up from deliveries.
- **Acceptance:** `acceptance_status` stays `unknown` until a user records `accepted`/`rejected` (with optional
  reference), typically after checking the next municipal bill. The UI states "Sent ≠ accepted by the municipality".
- **POPIA:** packs contain no tenant data; recipients require explicit authorisation; every send is audited.

## 9. Jobs

`runSmartUtilityJob(serviceClient)` in `lib/smartUtility/jobs.ts`, appended to `POST /api/v1/system/daily-jobs`
(existing Render cron) and also exposed as `POST /api/v1/system/smart-utility-jobs` (same dual auth) so it can be
scheduled more often later without touching the daily run. Steps, each independently caught: health sweep →
daily anomaly rules → monthly reconciliation (on the day after each property's billing day) → generate due
submissions → send approved/automatic deliveries → retry due failures → mirror email statuses.

## 10. UI (web/PWA; Android/iOS reach the same `/api/v1` routes)

- Property detail gets a new **Utilities** tab (`components/smartUtility/SmartUtilityPanel.tsx`) with sections:
  overview cards (water kL, electricity kWh, estimated cost, connected meters, health, open alerts, submission
  status) · meters (grouped main → building → unit; add/replace meter wizard: manufacturer → model → method →
  integration → assign → test) · alerts · reconciliation · municipal submissions (settings, recipients, history,
  approve/send, record acceptance) · integrations (create, rotate, revoke, last-seen, ingest log).
- The existing `PropertyUtilityMetersPanel` in the Finances tab is left in place (Android parity, monthly manual
  readings).
- Mobile: the panel is responsive (PWA). Native Android keeps its existing utilities screens; new native screens are
  Phase 2.

## 11. API surface (as implemented; all under `/api/v1`, `{error:{code,message}}` envelope, zod validation)

| Method & path                                                                 | Auth / permission                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET properties/:id/smart-utility` — dashboard payload                         | session; RLS read (`can_read_property_utilities`)                     |
| `POST properties/:id/smart-meters` · `PATCH smart-meters/:id` (incl. `decommission`) · `POST smart-meters/:id/replace` | session; `can_write_property_utilities`                               |
| `GET smart-meters/:id/telemetry?from&to` · `POST smart-meters/:id/telemetry` (manual reading, optional `documentId`) | read / write                                                          |
| `POST properties/:id/buildings`                                                | write                                                                 |
| `POST properties/:id/meter-integrations` (returns token once) · `GET meter-integrations/:id` (ingest log) · `POST meter-integrations/:id {action: rotate\|revoke}` | write **and** org role manager+                                       |
| `POST integrations/meters/ingest`                                              | integration bearer token; CSRF- and MFA-exempt (device, not user)    |
| `PUT properties/:id/municipal-submissions/settings` · `POST properties/:id/municipal-submissions/recipients` · `PATCH municipal-submission-recipients/:id` | write                                                                 |
| `POST properties/:id/municipal-submissions` (prepare pack) · `POST municipal-submissions/:id {action: approve\|send\|cancel\|acceptance}` · `GET municipal-submissions/:id/export?format=csv\|pdf` | write (export: read)                                                  |
| `PATCH utility-alerts/:id` · `PUT properties/:id/utility-alert-settings`       | write                                                                 |
| `POST system/smart-utility-jobs` (also runs as job 7 of `system/daily-jobs`)   | `CRON_JOB_SECRET` / super_admin                                       |

## 12. Device configuration reference

### 12.1 Milesight UG6x gateway (built-in network server) → Proplyst

1. In Proplyst: property → **Utilities** → **Hardware connections** → _Milesight LoRaWAN gateway_ → copy the address and
   the `Authorization: Bearer pmi_…` token (shown once).
2. Gateway web UI → Network Server → Applications → add an application with an **HTTP/HTTPS** data transport: uplink
   URL = `https://<app>/api/v1/integrations/meters/ingest`, custom header `Authorization: Bearer pmi_…`. Leave the
   payload codec empty (Proplyst decodes the raw `data` with the vendor's published EM300-DI layout) or add the
   Milesight codec (Proplyst then reads `object.pulse`).
3. Add each EM300-DI under the application with its DevEUI/AppKey (OTAA), then add the meter in Proplyst with the same
   DevEUI as _Device ID_, the meter's litres per pulse as _Multiplier_, and the dial reading at fitting time.
4. Exact menu names differ by firmware — **Likely, verify on the device**; the payload contract Proplyst accepts is
   pinned by `parseMilesight()` and its tests.

### 12.2 Shelly Gen2+ (Pro 3EM / Pro EM-50 / EM Gen3 / Plus Uni) → Proplyst

Proplyst does not run an MQTT broker in Phase 1; a Shelly on-device script posts its counters over HTTPS. Install via
the device web UI → Scripts. `HTTP.Request` with custom headers is part of the Gen2+ RPC API — **Likely, verify on
the firmware in use** before the first install.

```js
// Proplyst meter push (every 15 min). Replace URL and TOKEN.
let URL = 'https://<app>/api/v1/integrations/meters/ingest';
let TOKEN = 'pmi_...';
function push() {
  Shelly.call('Shelly.GetStatus', {}, function (st) {
    let id = Shelly.getDeviceInfo().id;
    let body = { src: id, params: { ts: st.sys.unixtime } };
    for (let k in st) {
      if (k.indexOf('emdata:') === 0 || k.indexOf('em1data:') === 0 || k.indexOf('input:') === 0) body.params[k] = st[k];
    }
    Shelly.call('HTTP.Request', {
      method: 'POST', url: URL, timeout: 15,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify(body),
    });
  });
}
Timer.set(15 * 60 * 1000, true, push);
push();
```

Meter set-up in Proplyst: _Device ID_ = the Shelly id (e.g. `shellypro3em-a0b1c2d3e4f5`), _Channel_ = `total`/`a`/`b`/`c`
(3EM), `em1:0`/`em1:1` (Pro EM-50 / EM Gen3) or `input:0` (Plus Uni pulse count), _Multiplier_ = 0.001 for Wh→kWh, or
litres per pulse for water.

### 12.3 Modbus gateways (Teltonika TRB246, Waveshare, ESPHome) → Proplyst

Configure the gateway to POST `{"readings":[{"deviceId":"sdm120-07","channel":"kwh","readAt":"<ISO-8601>","value":1234.5,"eventId":"<optional>"}]}`
with the bearer token. Each Eastron/CHINT meter gets a unique Modbus slave id, one baud rate per bus (the SDM120M
defaults to 2400), and the import-kWh register is read every 15/60 min.

## 13. Installation guide — first physical test property

**Goal:** one property, one municipal water meter (pulse) and one or two unit electricity meters (Shelly), feeding
Proplyst for 2–4 weeks before trusting alert thresholds. Nothing here is purchased or installed by Proplyst
engineering without the owner's approval.

1. **Survey (½ day):** photograph the municipal water meter (make, size, whether it has a pulse output or a pulse-head
   mount), its location (boundary box?), distance to where a gateway could have power + Wi-Fi/LTE, and each unit's
   distribution board (single- or three-phase, space for DIN devices/CT clamps). Note the municipal account number
   and billing day from a recent account.
2. **Confirm compatibility before buying:** with the water-meter supplier, confirm the pulse output/pulse head is a
   dry contact (reed) and its litres-per-pulse (research doc §6 item 3 is still open). If the existing municipal meter
   has no pulse output, Phase 1 for that property is **manual photo readings** (no hardware) — the municipality owns
   that meter and it must not be altered.
3. **Buy (per research doc §4.1):** EM300-DI (+ pulse-ready meter only on a _private_ submeter), one UG63-LTE or UG56,
   Shelly Pro EM-50 / EM Gen3 per unit board. Keep receipts as evidence.
4. **Install:**
   - Water: a **registered plumber** fits any new/private meter; the EM300-DI cable is connected to the pulse output
     (non-invasive). Record the dial reading at the moment of connection.
   - Electricity: a **registered electrician** fits Shelly devices/CTs in the DB and issues a **Certificate of
     Compliance** for the alteration.
   - Gateway: mount within range, powered, with Ethernet/Wi-Fi/LTE.
5. **Configure:** create the connections in Proplyst (§12), add meters (main meter → _Municipality_ ownership;
   unit meters → _Private_, linked to the unit and to the main meter), enter multiplier and starting dial reading,
   set the tariff for cost estimates.
6. **Verify (day 1):** _Hardware connections → Test / log_ shows `accepted`; meter status turns **Online**; compare the
   Proplyst reading with the dial (should match within one pulse).
7. **Municipal pack (first month):** set the municipality, account number, billing day, mode **Approval required**,
   add the recipient(s) and tick the authorisation box only after checking the address against the research doc /
   your account. Approve the first pack yourself and record the outcome after the next municipal account.
8. **Burn-in (2–4 weeks):** review alerts; tune thresholds (Alerts settings) before enabling anything automatic.
