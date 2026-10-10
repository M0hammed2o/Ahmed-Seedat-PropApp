# Smart Utilities — Progress & Checkpoint

**Read this first when resuming.** Companion files: `SMART_UTILITIES_DECISIONS.md`, `SMART_UTILITIES_BLOCKERS.md`,
`SMART_UTILITIES_TEST_RESULTS.md`, `SMART_UTILITIES_NEXT_STEPS.md`, `SA_SMART_METER_CATALOGUE.md`. Background design:
`SMART_UTILITY_ARCHITECTURE.md`, `SMART_UTILITY_HARDWARE_RESEARCH.md`, `SMART_UTILITY_IMPLEMENTATION_PLAN.md`.

## Baseline (start of the 2026-10-10 autonomous session)

Phase 1 already built, tested and committed (`git log`: four commits after `919215c`, 2026-10-10):
migration 175 (hierarchy, telemetry, hashed-token push integrations, alerts, municipal packs, utility RLS gap fix),
ingestion (Milesight EM300-DI, Shelly Gen2+, generic JSON, simulator), consumption/reconciliation/anomaly engines,
municipal packs (email/CSV/PDF, authorised recipients, retries), property → Utilities tab, daily job.

## Gap analysis: 2026-10-10 brief vs Phase 1

| Brief item | Phase 1 state | Work this session |
| --- | --- | --- |
| §2 catalogue doc with 4-level classification | research doc, no classification | `SA_SMART_METER_CATALOGUE.md` |
| §3 universal engine: auth, registration, verification, sync, health, retries, encrypted credentials | push-only parse functions; no credential store (TD-52) | provider interface + registry; AES-256-GCM credential encryption; poll sync with back-off; ChirpStack v4 + The Things Stack push adapters; ThingsBoard poll adapter |
| §4 structure | done | — |
| §5 Add Smart Meter catalogue experience, guided setup, test connection, first reading, integration requests | single form | catalogue wizard + request-integration |
| §6 dashboard: daily/weekly/monthly, unit comparison, missing readings, estimated labelling, alert config | daily 30-day chart, totals, alerts | granularity switch, unit comparison, missing readings, threshold settings UI |
| §7 municipal: CC, account holder, custom message, template editor, field toggles, preview, test send, approve template, enable schedule, statuses incl. scheduled | settings + recipients + approve per pack | all of these + rendered-email snapshot audit trail |
| §8 meter evidence: verification status, evidence report PDF, example report | photo upload only | verification workflow, evidence PDF, example report |
| §9 jobs: sync, snapshots, reminders | health/anomalies/packs/retries | poll sync, monthly snapshots, approval reminders |
| §10 billing: tariffs, fixed charges, unit allocation, review, invoice lines, history | none | tariffs (block + fixed), draft→approved→invoiced charges, draft invoices via `create_manual_invoice()` |

## Milestones

| # | Milestone | Status |
| --- | --- | --- |
| M0 | Commit Phase 1; continuity docs | Completed |
| M1 | Migration 176 (credentials, sync state, integration requests, evidence verification, template/approval, scheduled status, snapshots, tariffs, charges) + pgTAP; 177 (meter location) | Completed (`3badd96`, `751524f`) |
| M2 | Provider engine + new adapters + credential encryption + sync job | Completed (`3badd96`) |
| M3 | Catalogue + Add Smart Meter wizard + integration requests | Completed (`751524f`) |
| M4 | Dashboard extensions | Completed (`751524f`) |
| M5 | Municipal template editor, preview, test send, approval, scheduling | Completed (`b03d436`) |
| M6 | Evidence verification + evidence report + example | Completed (`d2b8b3e`) |
| M7 | Billing: tariffs, charges, invoice drafts | Completed (`81f2db8`) |
| M8 | Jobs tests, browser walk-through, regression, review fixes, docs | Completed (`9143f7c`, `6b40f66`) |

## Checkpoint (2026-10-10, end of session)

- **All milestones complete in code**; results in `SMART_UTILITIES_TEST_RESULTS.md`; external blockers in
  `SMART_UTILITIES_BLOCKERS.md`; ranked follow-ups and the exact next code step in `SMART_UTILITIES_NEXT_STEPS.md`.
- Commits `bb63746`…`6b40f66` on local `main` (not pushed). Migrations 175–177 exist only locally.
- Definition of done (brief §13): manage main/unit meters ✔ · catalogue ✔ · documented integration path implemented and
  tested ✔ (Proplyst JSON end-to-end; Milesight/ChirpStack/TTS/Shelly/ThingsBoard against published formats) · other
  integrations labelled ✔ · consumption/history ✔ · manual readings + photos ✔ (photo upload reuses the existing
  documents route; not browser-tested) · monthly reports ✔ · municipality + custom email config ✔ · preview/approve ✔ ·
  scheduling/delivery tested ✔ · existing functionality: regression clean except one pre-existing slow-job timeout ·
  hardware limitations documented ✔.
- Local environment: the main `propvault` stack was restored at the end of the session (see WORKLOG).

## Checkpoint — Hybrid Phase 2 complete in code (2026-10-10, end of session)

Commits `b728445`, `e76da3c`, `95b37bc`, `dccc21d`, `8b04c15`, `63dbb6b`, `cfcf7dd` (local, not pushed). Migration 178
(throwaway stack only). Owner summary: `HYBRID_UTILITIES_DELIVERY_REPORT.md`; design: `HYBRID_UTILITIES_ARCHITECTURE.md`.
Built: supply sources + levels + logs, measurement kinds, hybrid balance, tariff engine v2 (+ preview, CSV import),
billing arrangements, shared meters, billing v2 (segments, VAT, credits, disputes, adjustments, draft-only invoices),
dashboard (any range), statements (tenant/owner, approve-before-visible, PDF, e-mail behind flag), hybrid alerts,
portfolio page, web UI, Android tenant statements. Results: `SMART_UTILITIES_TEST_RESULTS.md`.
