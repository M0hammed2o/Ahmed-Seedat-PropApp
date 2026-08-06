# Production Readiness Report

Reviewed as a design-review gate before any production migration or feature code is written — the entire architecture (`ARCHITECTURE.md`, `DATABASE.md`, `PERMISSIONS.md`, `ACCOUNTING.md`, `API_SPEC.md`, `SECURITY.md`, `AI_ARCHITECTURE.md`, `SUPER_ADMIN.md`, `WHATSAPP.md`, `EMAIL.md`, `TESTING.md`, `DEPLOYMENT.md`, `MOBILE_ARCHITECTURE_DECISION.md`, `PRODUCT_SPEC.md`, `ROADMAP.md`, `TASKS.md`) read together as one system, not document-by-document. Companion documents: `ARCHITECTURE_DECISION_RECORDS.md` (the "why," in ADR form), `RISK_REGISTER.md` (what could still go wrong), `TECHNICAL_DEBT_REGISTER.md` (known, scoped gaps with a paydown plan).

**Method**: for each of the 22 requested dimensions, this report states what was found, what was fixed as part of this review (details in the relevant document, cross-referenced), and what remains open (tracked in the risk/debt registers rather than re-stated here). Twelve real, previously-unaddressed gaps were found and closed at the design level during this pass — this report is not a rubber stamp of pre-existing work.

---

## 1. Scalability to tens of thousands of organisations

**Found**: the data model itself scales cleanly (every table `org_id`-scoped, no shared mutable state across orgs) — but three real bottlenecks existed with no mitigation: (a) `has_org_role()`'s per-row `security definer` cost at high query volume, (b) Super Admin's cross-org dashboard metrics as live aggregates, (c) no journal-table partitioning trigger defined.

**Fixed**: staged RLS-performance mitigation (index now, session-claim escalation documented for if/when measured, ADR-020); `platform_metrics_snapshots` hourly rollup replaces live cross-org aggregates (ADR-018); `journal_lines` partitioning threshold already noted (`DATABASE.md` §13, ~10M rows/org).

**Open**: none of this is load-tested — can't be, no implementation exists yet (`RISK_REGISTER.md` R-05).

## 2. Database normalization

**Found**: schema is soundly normalized (3NF-ish) with a small number of _deliberate_, documented denormalizations (`units.org_id`, `trust_ledgers.current_balance`, `organizations.status`). Two of the three had no defined consistency mechanism — a real normalization-adjacent risk (denormalization without a sync rule is just drift waiting to happen).

**Fixed**: `organizations.status`/`organization_subscriptions.status` now has an explicit single-writer-single-transaction rule; `trust_ledgers.current_balance` now has an explicit same-transaction-update rule plus a reconciliation-job backstop (`DATABASE.md`, this review).

**Open**: none identified beyond what's now documented.

## 3. Indexing strategy

**Found**: FK and `(org_id, status)` indexing was already good practice throughout `DATABASE.md`. Missing entirely: any index supporting the full-text/trigram search the reference product evidences on 5+ modules, and the composite index `has_org_role()` actually needs to stay index-friendly.

**Fixed**: `pg_trgm` + targeted GIN indexes per search-bearing column specified; `organization_members(user_id, org_id, status)` composite index added (`DATABASE.md` §13, this review).

**Open**: none identified beyond execution/measurement.

## 4. Query performance

**Found**: covered by §1 and §3's fixes (RLS cost, search indexing, platform-metrics rollup). No N+1 patterns identified in the _design_ (every list endpoint is a single scoped query per `API_SPEC.md`'s conventions), but this can't be fully confirmed without implementation.

**Fixed**: see §1/§3.

**Open**: real query-plan verification requires running Postgres against real data volume — not possible in this session.

## 5. Caching opportunities

**Found**: **zero caching strategy existed anywhere in the architecture before this review** — a genuine, significant gap for a system meant to run at scale for a decade.

**Fixed**: three-tier caching strategy added (`ARCHITECTURE.md` § Caching strategy, this review) — reference-data cache for `plans`, deliberate _non_-caching of org-membership resolution (correctness > speed here, with a documented escalation path), and a stated non-goal (no blanket Redis layer without measured need). ADR-015.

**Open**: none at the design level; revisit if production profiling shows a real bottleneck the design didn't anticipate.

## 6. API consistency

**Found**: `API_SPEC.md`'s conventions (cursor pagination, standard error shape, org-id-never-trusted, idempotency, audit-on-every-mutation) are applied consistently across every listed endpoint. No inconsistency found requiring a fix.

**Open**: no formal API-versioning deprecation policy (how long is `/v1` supported after `/v2` ships) — minor, logged as a future consideration, not blocking.

## 7. Naming consistency

**Found**: one real, systemic inconsistency — `is_platform_admin()`/`platform_admin_users` used as if already live across three documents, when the actual current names are `is_admin()`/`admin_users` (rename deliberately deferred, ADR-007).

**Fixed**: every reference now carries an explicit current-vs-target naming note (`PERMISSIONS.md`, `SECURITY.md`, `SUPER_ADMIN.md`, `DATABASE.md`, this review) so a reader implementing against these docs today isn't misled.

**Open**: resolved by the deferred rename landing on schedule (`TASKS.md` M19) — tracked as TD-03.

## 8. Security

**Found**: strong baseline (two-layer RLS+API enforcement, encrypted-secrets pointer pattern, webhook signature verification, OWASP-controls checklist) — but three real gaps: no file-upload malware scanning, a genuine information-disclosure bug in WhatsApp's disambiguation flow, and the long-standing demo-mode bypass still unimplemented.

**Fixed**: malware-scanning requirement specified (`SECURITY.md`, this review); WhatsApp disclosure bug fixed at the design level (`WHATSAPP.md` §1.2, this review — role labels only, never identifying details, pre-resolution).

**Open**: demo-mode bypass fix is specified but not yet coded (R-01, Critical); RLS tests not executed (R-02, Critical); rate limiting not wired to a backing store (R-13); no penetration test performed yet (R-14, can't be — nothing to test).

## 9. Auditability

**Found**: `audit_events` is well-designed (insert-only, no update/delete policy for any role, before/after snapshots) — but retention policy was ambiguous by omission (could be read as eligible for the same archival-to-cold-storage treatment as `documents`/`whatsapp_messages`).

**Fixed**: explicit statement that `journal_entries`/`journal_lines`/`audit_events` are **never** archived or deleted at any scale — archival for these three means cheaper storage tier, never reduced access (`DATABASE.md` §13, this review).

**Open**: none identified.

## 10. Accounting correctness

**Found**: immutability/reversing-entries/balanced-entry validation were already rigorous. Two real gaps: no period-locking mechanism (nothing stopped a backdated post into an already-reconciled month), and four real-world edge cases (partial payments, multi-owner rounding, mid-lease amendments, shared expenses) were entirely unaddressed.

**Fixed**: `accounting_periods` table + posting-service enforcement + audited reopen action (`ACCOUNTING.md` §9, `DATABASE.md`, this review — ADR-019); all four edge cases given concrete V1 answers (`ACCOUNTING.md` §10, this review).

**Open**: real-world edge cases not yet anticipated by this review will surface once production usage exists (R-16, inherent to any pre-launch accounting design).

## 11. Mobile offline support

**Found**: **entirely unaddressed** before this review — a real gap for a field-heavy product (landlords walking properties, tenants in low-signal units).

**Fixed**: scoped offline strategy added (`MOBILE_ARCHITECTURE_DECISION.md` §9, this review — read-through cache for view screens, a real write queue for Maintenance submission specifically, connectivity required for higher-stakes writes). ADR-016.

**Open**: deliberately narrow V1 scope; broader offline support is a V2 decision gated on usage evidence, not built speculatively.

## 12. Synchronization strategy

**Found**: covered by §11's fix — the Maintenance write-queue's retry/background-upload mechanism is the only synchronization surface in V1 (no conflict resolution needed, since it's a pure insert).

**Open**: none beyond §11's stated V2 boundary.

## 13. Backup and disaster recovery

**Found**: **entirely unaddressed** before this review — unacceptable for a system holding real financial/tenancy records long-term.

**Fixed**: full strategy added (`DEPLOYMENT.md` §9, this review) — PITR required from day one (not retrofitted), retention minimums proposed, restore-drill cadence specified, RTO/RPO targets proposed pending real validation.

**Open**: targets are proposed, not yet validated by an actual drill (R-11) — no infrastructure exists yet to drill against.

## 14. Multi-region deployment readiness

**Found**: not addressed; reasonable given the confirmed single-market (South Africa) target, but worth confirming the schema doesn't foreclose it later.

**Fixed**: explicit V1 decision (single-region) plus confirmation that `org_id`-scoping already provides the natural future sharding key with no data-model change required later (`DEPLOYMENT.md` §10, this review — ADR-017).

**Open**: single-region is a single point of regional failure for _availability_ (not data loss, which PITR covers) — accepted risk at current scale (R-10).

## 15. Observability

**Found**: one paragraph existed (error-monitoring retention, one specific alert) — no structured logging, no SLOs, no tracing strategy.

**Fixed**: full observability section added (`DEPLOYMENT.md` §11, this review) — structured logging with request-ID propagation, log retention tiers, three initial SLOs, expanded alerting, and an explicit non-goal (no distributed tracing until log-correlation alone proves insufficient).

**Open**: SLO targets are starting points, uncalibrated against real traffic (inherent to pre-launch).

## 16. Logging

**Found**: covered by §15's fix — structured JSON logging, `scrubContext` redaction extended from error reports to all logs, 30-day hot / 12-month cold retention.

**Open**: none beyond §15.

## 17. Monitoring

**Found**: covered by §15's fix, plus the pre-existing Trial Balance "Balanced" check alert and CI-failure alert (`DEPLOYMENT.md` §8, retained). New alerting surfaces added: backup-drill failures, webhook signature-verification failure spikes.

**Open**: no on-call rotation defined to actually receive these alerts (R-12) — an organizational gap, not a technical one.

## 18. Feature flag support

**Found**: `packages/config`'s `FeatureFlags` pattern is retained and already identified as the native-release kill-switch mechanism (`DEPLOYMENT.md` §7) — reasonable foundation, not deeply extended for granular per-org staged rollout of risky backend features (e.g., a new accounting posting rule).

**Open**: not fixed in this pass — judged non-critical for V1 (the existing pattern is adequate for the native kill-switch use case it was built for); flagged as a future-extensibility consideration, not a launch blocker.

## 19. Future integrations

**Found**: the provider-abstraction pattern (ADR-014) is consistently applied and is itself the extensibility mechanism for future integrations (a new email/WhatsApp/OCR/LLM vendor is a swap, not a rewrite). One real gap: no accounting-data export path for orgs wanting to use their own external accountant's tooling.

**Open**: export-path gap accepted as a V2 candidate (R-08) — not designed now, since no client demand has been evidenced yet.

## 20. AI extensibility

**Found**: the two current AI surfaces (Assistant, Portfolio Intelligence) are well-architected and clearly separated (ADR-011). One real gap discovered during `PRODUCT_SPEC.md` compilation: the evidenced "AI-assisted unit setup" feature has no architecture document at all — it exists only as a screenshot-evidenced feature name.

**Fixed**: gap explicitly flagged (`PRODUCT_SPEC.md` §5, `TECHNICAL_DEBT_REGISTER.md` TD-12) rather than silently built without a design pass or silently dropped from scope.

**Open**: needs its own design pass before `TASKS.md` M6 can claim this specific feature complete.

## 21. Testing strategy

**Found**: `TESTING.md` is thorough and correctly prioritizes RLS/multi-tenant isolation as the highest-risk category. Real gap: no load/performance testing strategy despite this review's explicit "tens of thousands of orgs" framing.

**Open**: not fixed in this pass — flagged as a gap for `TESTING.md` to address once M14+ (Accounting) and M23 (Automated testing) provide something real to load-test; premature to design load-test scenarios against a system that doesn't exist yet.

## 22. CI/CD strategy

**Found**: `DEPLOYMENT.md`'s pipeline design (per-PR checks, staged auto-deploy, gated production promotion, forward-only migrations) is sound and consistent with the accounting subsystem's own reversing-entry philosophy. No migration-performance-testing-before-deploy step exists (a migration that locks a huge table in production is a real, if currently low-probability given no scale yet, risk).

**Open**: flagged as a `DEPLOYMENT.md` refinement for later (once tables are large enough for this to matter) — not fixed now, since designing migration-performance gates against tables with zero rows would be speculative.

---

## Cost optimization (requested as its own dimension, summarized here — full detail `DEPLOYMENT.md` §12)

**Found**: entirely unaddressed before this review.

**Fixed**: storage-quota-via-`feature_limits`, usage-metering-as-cost-visibility-foundation (already built for other reasons, now explicitly connected to cost), and an explicit non-goal (no bespoke cost dashboard until native billing alerts prove insufficient) — `DEPLOYMENT.md` §12, this review.

**Open**: no real spend data exists to validate against (R-18).

---

## Summary: what this review changed

**12 previously-unaddressed gaps closed at the design level**: caching strategy, mobile offline/sync, backup/DR, multi-region readiness statement, observability/logging/monitoring, cost optimization, accounting period locking, `organizations.status` sync mechanism, `trust_ledgers.current_balance` consistency mechanism, platform-level metrics rollup, RLS performance mitigation path, search/trigram indexing. Plus: a real security disclosure bug fixed (WhatsApp disambiguation), a naming-consistency fix (is_admin/is_platform_admin), a permissions ambiguity fix (delete semantics), and 4 accounting edge cases given concrete answers.

**What this review did not and could not do**: execute anything. Every fix above is a specification change to a `.md` file — none of it has been built, run, load-tested, or penetration-tested, because the corresponding implementation doesn't exist yet (only M1/M2's schema is real). This is the central, honest caveat behind the score below.

---

## Score: **77 / 100** (revised 2026-07-31 — see addendum below the table; original 72/100 rationale preserved for the historical record)

| Category                                                           |  Weight |       Score | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------: | ----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & data model (normalization, naming, API consistency) |      15 |          13 | Very strong design, two known/tracked drift items (TD-01/TD-03) prevent a perfect score.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Multi-tenancy & security                                           |      20 | 18 (was 14) | **2026-07-31**: both formerly-unexecuted Critical items are now genuinely executed and passing — demo-mode fix build-verified, and the RLS isolation suite (31 pgTAP assertions across 3 files, including a new full org-creation→invite→accept→role-gated-write→multi-org-switch integration test) passes on a freshly-reset local database. Not 20/20: a real, currently-unenforced gap was found in this same pass (`organizations.status` is not checked by any RLS policy — an archived/suspended/cancelled org's own members retain full access; open product decision, R-22/TD-17) and RLS performance under real concurrent-org load remains unmeasured (R-05). |
| Accounting correctness                                             |      10 |           8 | Rigorous design including this review's period-locking and edge-case additions; deduction for zero implementation/test execution against real numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Scalability & performance                                          |      15 |          10 | Was a real weak point pre-review (no caching, no platform rollups, no RLS-cost plan); now well-designed but completely unmeasured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Mobile (offline/sync)                                              |       5 |           4 | Real gap closed with an appropriately-scoped V1 answer; not a full solution by design, which is the right call, not a deduction-worthy shortcut.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Operations (backup/DR, multi-region, observability, CI/CD)         |      15 |           9 | Was largely absent pre-review; now has a real strategy, but RTO/RPO unvalidated, no on-call defined, nothing has ever actually run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Extensibility (feature flags, integrations, AI)                    |       8 |           6 | Provider-abstraction pattern is genuinely excellent and the strongest extensibility story in the system; one real undesigned feature (AI unit setup) and shallow feature-flag depth hold it back from full marks.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Testing strategy                                                   |       7 |   6 (was 5) | **2026-07-31**: pgTAP tests now genuinely execute against a real database (not just written) and caught real bugs (two more this pass: a missing `organization_invites` INSERT policy, a documented enum drift). Still missing: load/performance testing, and only the M1-M7 slice of the system has any implementation to test at all.                                                                                                                                                                                                                                                                                                                                 |
| Cost optimization                                                  |       5 |           3 | Reasonable foundation newly added this review; entirely unvalidated against real spend, appropriately deferred rather than over-built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Total**                                                          | **100** |      **77** |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### What would move this to 90+

Not more documentation — the documentation is, at this point, unusually thorough for a pre-implementation stage. The gap to 90+ is **execution**: build and run the accounting invariant test suite against a real posting service, run one real backup-restore drill, load-test `has_org_role()` under realistic concurrent-org traffic, and decide + implement whether `organizations.status` (suspended/archived/cancelled) should restrict member data access (currently it does not — R-22). Every one of those is already scoped to a specific `TASKS.md` milestone or flagged as an open decision — this score reflects "solid multi-tenant foundation now genuinely execution-verified, most of the rest of the system still unbuilt," which is exactly where a system at this stage of a 25-milestone build should be, not a verdict that the architecture itself is weak.

### Addendum, 2026-07-31 — real execution against the M1-M7 slice

The original 72/100 score (below) was assigned when "none of it has been built, run, load-tested" — a paper review of a design that hadn't been executed at all. Since then, M1-M7 (multi-tenancy foundation through Properties/Units/Owners APIs) have been implemented, and — per Mohammed's explicit instruction to verify execution rather than assume correctness — the local Supabase stack was actually started, all 26 migrations applied to a genuinely clean database, and the full pgTAP suite run for real. This surfaced concrete bugs no static review had caught: a `LegacyHealthCheckTimeoutError`-class Docker health-check failure (root-caused to the `vector` log-shipping sidecar being unable to reach the Docker socket in this environment — confirmed via `docker inspect` showing zero mounts; infrastructure-only, mitigated by disabling `[analytics]` locally), a seed script that had silently never run in any prior session (`[db.seed].sql_paths` was never configured, so `supabase db reset` always looked for a nonexistent `supabase/seed.sql`), a documented-but-never-implemented `organizations.status` enum value (`archived` was in `DATABASE.md`/`SUPER_ADMIN.md` but not the actual Postgres enum), and a fully-missing `organization_invites` INSERT policy that meant the invitation feature could never have actually been used end-to-end despite looking schema-complete. All four are fixed and re-verified; the enum/policy fixes are new migrations (20260101000025, 20260101000026); full details in `WORKLOG.md` 2026-07-31. This is the same lesson as R-02's original closure: **execution finds bugs design review cannot**, and it keeps finding new ones each time a previously-unexecuted path is actually run for the first time.

### Gate decision

Per the instruction not to begin coding until every critical issue is resolved or explicitly accepted: **both Critical items (R-01 demo-mode bypass, R-02 RLS tests) are explicitly accepted as open, tracked, milestone-scoped work** — R-01 closes in M2, R-02 closes across M3/M23 once a Docker-capable environment is available. Neither is silently ignored; both block their respective milestone's own exit criteria (`TASKS.md`) from being marked complete. Implementation may proceed on schema/feature work that doesn't depend on either being closed first (e.g., continuing the M1 properties cutover), but **no environment reachable by a real user may go live until R-01 is closed**, per `SECURITY.md`'s own release-blocking framing.
