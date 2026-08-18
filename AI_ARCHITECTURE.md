# AI Architecture

PropertyVault has **two architecturally distinct AI surfaces**, evidenced in the PropView reference product (`PROPVIEW_SCREENSHOT_AUDIT.md` §5, §1, IMG_7962, IMG_7990) and never to be blurred into one "AI feature":

1. **Conversational Assistant** — an LLM-backed chat. Its value proposition is flexibility: free-text in, staged action out.
2. **Portfolio Intelligence** — a scheduled rules engine. Its entire value proposition is explicitly **NOT** being an LLM — every insight is traceable to a real record, with zero fabrication risk.

Building the two on shared infrastructure (e.g. routing both through the same typed API, the same `audit_events` trail) is fine and expected. Building them as one module that "sometimes uses an LLM and sometimes doesn't" is not — a maintainer or an auditor must be able to look at either surface and know, unconditionally, whether an LLM touched the output.

## V1 status (final pre-UAT engineering pass, WORKLOG.md this date)

**Both surfaces are now live, not just designed.** What actually shipped this pass, and what
remains deliberately deferred:

- **Conversational Assistant is READ-ONLY in V1.** §1.5/§1.6 below describe the full staged-write/
  confirm architecture as the intended eventual design — that plumbing already existed
  (`ai_conversations`/`ai_messages`, the 3 routes, `StagedChange`) from an earlier pass, but this
  pass's own hard requirement was an explicit, enumerated prohibition on the Assistant proposing or
  applying ANY write (payments, leases, accounting, subscriptions, messages, arbitrary org
  access — see this pass's own task description). Rather than leave that prohibition merely
  informal, it's enforced twice: `MockLLMProvider` (`apps/admin/lib/providers/llm.ts`) never
  populates `stagedChange` for any intent, AND `POST /api/v1/ai/messages/:id/confirm`
  unconditionally 403s (`ai_writes_disabled`) regardless of what any future provider might return —
  defense in depth, not reliance on the mock's behaviour alone. Re-enabling writes is a future,
  deliberately-scoped pass's decision, not an accidental side effect of a provider swap.
- **Both owner/staff AND tenant users are now supported** (§1.2's data model originally assumed
  org-staff only — `ai_conversations_all_own`'s RLS policy, migration `20260101000109`, was
  widened to also accept a caller with an active tenancy in that org, mirroring the existing
  `payment_reports_select_tenant_self` tenant-self predicate shape). `AssembledOrgContext`
  (owner/staff) and the new `AssembledTenantContext` (tenant) are a discriminated union
  (`AssembledAssistantContext`); `POST /api/v1/ai/conversations/:id/messages` resolves which one
  to assemble from the caller's OWN real relationship to the conversation's `org_id` (org role,
  else tenancy, else 403) — never a client-supplied flag.
- **The approved read-only tool registry (§1.4) is now a real, named set of fields**, not just
  "whatever queries happen to be assembled": owner side —
  `rentOverdue`/`rentDueSoon`/`recentExpenses`/`openMaintenanceTickets`/`leasesExpiringSoon`
  (pre-existing) plus new this pass — `pendingPaymentReports`, `portfolioInsights` (reads the
  Portfolio Intelligence feed §2, summarised only, never re-derived or re-judged),
  `recentPayments`, `occupancySummary`. Tenant side (new) — `outstandingBalance`,
  `recentPaymentReports`, `rentSchedule`, `lease`, `maintenanceTickets`, `notices`. All fetched
  together per turn (no real LLM vendor exists yet to make lazy/dynamic tool-selection meaningful —
  §3, still an open decision) — a disclosed simplification, not a gap.
- **New V1 safeguards** (§4's cost/rate-limiting section already covered usage capping):
  `rateLimitOrRespond()` now gates both `POST /api/v1/ai/conversations` (20/hour/user) and
  `POST /api/v1/ai/conversations/:id/messages` (30/5min/user) — previously unguarded by anything
  but the usage cap. Conversation history passed into a turn is now bounded to the most recent 20
  messages (previously unbounded — a real, found-not-assumed gap, since nothing capped how large a
  long-lived conversation's context could grow).
- **A minimal web/PWA chat UI now exists** (`components/assistant/AssistantDrawer.tsx`) — a
  floating trigger + drawer, mounted via `AppShell`'s new `assistant` slot in both the owner
  dashboard and tenant portal layouts. Suggested questions, loading/error states, conversation
  history, clearly labelled "Proplyst Assistant." No confirm/apply affordance anywhere in it (there
  is nothing for it to render — the backend never returns a stagedChange in V1). Android: not
  built this pass — web/PWA is sufficient for V1 per this pass's own scope, not a gap.
- **Portfolio Intelligence (§2) is now actually invoked**, closing a real, previously-disclosed gap
  (`TECHNICAL_DEBT_REGISTER.md` TD-20): `reconcilePortfolioInsights()` existed, fully implemented,
  since an earlier pass but had zero callers anywhere in the codebase (confirmed by exhaustive grep
  before this pass — not even a test file). Now wired into the existing consolidated daily-jobs
  sweep (`runPortfolioIntelligenceJob()`, `apps/admin/lib/systemJobs.ts`) as its 6th and final job,
  run last so insights reflect the day's already-settled state. Bounded processing (a real
  performance issue found live, not assumed): concurrent batches of 10 orgs at a time, hard-capped
  at 500 orgs per run, any excess deferred to the next run rather than either blocking indefinitely
  or silently dropping orgs. Verified live: 5 new integration tests
  (`lib/__tests__/portfolioIntelligence.test.ts` — real rule-firing, idempotency, auto-resolve,
  cross-org isolation) plus 2 new daily-jobs orchestration tests (isolation from the 5 jobs above
  it). Surfaced in the web dashboard (a real panel — severity, reason, when-generated, navigation,
  dismiss — replacing the old single-line "most recent insight" banner) and, new this pass, in the
  Android owner Dashboard tab (previously a static "not yet built" placeholder).

---

## 1. Conversational Assistant

### 1.1 What it is (evidenced)

Floating sparkle FAB → bottom-sheet/drawer chat (IMG_7962, IMG_7957). Prompt chips: "How's my portfolio?", "What's overdue?", "Record an expense". Drawer copy: _"ask me how things are doing, or tell me what to change and I'll show you any change before it's saved"_ — confirming (a) it can answer questions from live data, (b) it can propose writes, (c) writes are never applied silently. Evidenced also: natural-language bulk unit generation ("describe a complex, it creates every unit") and lease/invoice/document PDF auto-parsing are separate, narrower AI-assist touches, not part of the Assistant's chat surface — they're inline extraction features (`DOCUMENT_INTELLIGENCE.md`), out of scope for this document.

### 1.2 Data model

`ai_conversations` (`org_id`, `user_id`, `started_at`) and `ai_messages` (`conversation_id`, `role`, `content`, `staged_changes jsonb nullable`, `confirmed bool default false`) — `DATABASE.md` §8. One conversation belongs to exactly one org and one user; there is no cross-org or cross-user conversation.

### 1.3 API surface (`API_SPEC.md` §9)

```
POST /api/v1/ai/conversations
POST /api/v1/ai/conversations/:id/messages   → returns assistant reply + staged_changes, never applies directly
POST /api/v1/ai/messages/:id/confirm         → applies the staged change via the normal typed endpoint it staged
```

### 1.4 Read path: context assembly (hard requirement — cross-tenant leakage prevention)

The LLM never receives a raw, admin-scoped, or service-role query result. Context for a turn is assembled by a **server-side context-assembly function** that:

1. Resolves the acting user's `org_id`(s) and role the same way every other API route does — via `organization_members`/`tenants`/`owners`, never from a client-supplied org id (`ARCHITECTURE.md` § Multi-tenancy model, `API_SPEC.md` §0).
2. Runs the _same RLS-scoped queries_ an authenticated user of that org could run through the normal API — i.e. it calls the existing typed read endpoints / their underlying RLS-protected Postgres queries, not a bespoke bulk export.
3. Assembles the retrieved rows into the prompt as plain data (not instructions), and passes only that assembled context to the LLM call.

Concretely: `POST /api/v1/ai/conversations/:id/messages` never opens a `SUPABASE_SERVICE_ROLE_KEY` connection on the LLM's behalf. It authenticates as the calling user's session (same JWT-derived `auth.uid()` as every other request, per `PERMISSIONS.md` §5 and `ARCHITECTURE.md` § Multi-tenancy model), so Postgres RLS enforces org scoping _independently_ of whatever the context-assembly code does or gets wrong — the same two-layer (API + RLS) defense described for the rest of the system. A bug in the context-assembly function's org-scoping logic is therefore not by itself a cross-tenant leak; RLS is the backstop, not the only check.

This is a hard requirement, stated explicitly because the failure mode is severe and easy to introduce by accident (e.g. a future engineer wiring the LLM up to a "just get me everything so the assistant is smarter" service-role helper): **the LLM's context window must never contain data the acting user could not already see through the ordinary UI.** No admin/service-role query is ever handed to the LLM, under any framing ("just for ranking," "just for summarization," etc.).

### 1.5 Write path: staging, never auto-apply

A proposed write from the Assistant is never applied as a side effect of the chat turn. It is written to `ai_messages.staged_changes` (jsonb — the shape of the typed API call it intends to make: target endpoint, method, body) with `confirmed = false`. The user sees the proposed change rendered in the chat UI (matching the evidenced "I'll show you any change before it's saved" copy) and must take an explicit confirm action before anything touches a real table.

### 1.6 Confirm path: no privileged shortcut

`POST /api/v1/ai/messages/:id/confirm` does not write business tables directly. It looks up the message's `staged_changes`, and **re-enters the exact same typed endpoint a human using the UI would call** — e.g. a staged "record an expense" change calls `POST /api/v1/expenses` with the acting user's own session/JWT, going through the identical Zod validation and role check (`PERMISSIONS.md` §2 minimum-role table) that endpoint enforces for any caller (`API_SPEC.md` §10, §11: _"No endpoint grants elevated/bypass access to... the AI Assistant... there is no shortcut path anywhere in this surface that skips business-logic validation because the caller happens to be a trusted internal client."_).

Concrete consequence: if the acting user is a `viewer` (read-only, per `PERMISSIONS.md` §2), the Assistant can _propose_ a staged expense entry, but the confirm call 403s at the same role check `POST /api/v1/expenses` would apply to that user directly — the Assistant cannot act with more authority than the human driving it. The AI is never a privileged system account; it always acts as the acting user, with the acting user's actual role.

### 1.7 Sequence (message → staged → confirmed)

```
User → POST /ai/conversations/:id/messages {text}
   → server: resolve org_id/role for auth.uid() (same as any request)
   → server: context-assembly fn runs RLS-scoped reads (rent due, overdue, recent expenses, etc.)
   → server: LLM call with {system prompt, assembled org-scoped context, user text}
   → server: LLM proposes a write → ai_messages row written with staged_changes, confirmed=false
   ← reply + staged_changes rendered in chat UI (nothing persisted to business tables yet)

User → POST /ai/messages/:id/confirm
   → server: load staged_changes, re-derive org_id/role for auth.uid() (fresh check, not cached from the earlier turn)
   → server: call the staged endpoint (e.g. POST /expenses) in-process, as the acting user
   → typed endpoint: same Zod validation, same PERMISSIONS.md role check, same audit_events write as a human-driven call
   → ai_messages.confirmed = true
   ← success/failure exactly as the human UI would see it
```

### 1.8 What the Assistant is explicitly not

It is not a second permission system, not a way to batch-approve/deny without per-item review, and not a source of insights — that's Portfolio Intelligence (§2). If a user asks the Assistant "how's my portfolio?", the answer is generated by the LLM summarizing the same RLS-scoped context described in §1.4 — it is not the Assistant reading `portfolio_insights` and repeating them verbatim (though referencing that feed as one input among several is reasonable).

---

## 2. Portfolio Intelligence

### 2.1 What it is (evidenced) — explicitly NOT an LLM

IMG_7990: _"Helpful pointers... explained in plain language... worked out from your own live data... Nothing is estimated or made up."_ IMG_7968/8023-24 surface it as a "More Tools" link from Maintenance, and the module grouping table (`PROPVIEW_SCREENSHOT_AUDIT.md` §2) tags it explicitly: _"Rules-based, not conversational."_ `ARCHITECTURE.md` § Business logic placement is equally explicit: _"a scheduled rules job (not an LLM) that evaluates live data against fixed conditions... kept separate from the AI Assistant specifically to preserve the evidenced 'nothing is estimated or made up' guarantee."_

**This engine never calls an LLM.** No prompt, no completion, no model inference of any kind is in its code path. It evaluates fixed, hand-written conditions against live Postgres data and only ever writes an insight when a condition is met by a real, queryable record. It cannot produce a plausible-sounding insight that isn't backed by an actual row — there is no generative step where one could be invented. This is a design constraint, not an implementation detail: any future change that routes this engine's insight text through an LLM (even "just for phrasing") breaks the transparency guarantee and must not be made without revisiting this document and the evidenced product claim it exists to satisfy.

### 2.2 Trigger conditions (evidenced)

From the reference product's Insights/Portfolio Intelligence and Maintenance Board surfaces:

- Overdue rent (`rent_schedules.status = 'overdue'`)
- Rent due this week (`rent_schedules.due_date` within the current week, `status = 'pending'`)
- Expiring leases (`leases.end_date` within a configurable lookahead window, `status = 'active'`)
- Open maintenance jobs (`maintenance_tickets.status in ('to_do', 'in_progress', 'pending_approval')`, optionally aged past a threshold)
- Unpaid invoices (`invoices.status != 'paid'` past `period`/due date)

Each condition is a plain SQL predicate (or a small set of them) over the org-scoped tables already defined in `DATABASE.md` §3–9. No condition is inferred by a model; every condition is a fixed rule a developer wrote and can point to in code.

### 2.3 `portfolio_insights` and the transparency guarantee

Schema (`DATABASE.md` §8): `id`, `org_id`, `insight_type text`, `message text`, `data_source jsonb`, `severity enum(info|warning|urgent)`, `generated_at`, `dismissed_at nullable`.

`data_source` is not free-form metadata — it is the literal evidence for the "worked out from your own live data" claim. For every insight row, `data_source` records exactly which records triggered it, e.g.:

```json
{
  "insight_type": "rent_overdue",
  "triggering_records": [
    { "table": "rent_schedules", "id": "…", "due_date": "2026-06-01", "amount": 12500 }
  ]
}
```

Rendering an insight without a resolvable `data_source` is a bug — the message template for each `insight_type` is built directly from the fields captured in `data_source`, so there is no path from "rule fired" to "insight shown" that doesn't pass through a real record's data. This is what keeps "nothing is estimated or made up" literally true rather than aspirational marketing copy: an auditor (or a support engineer debugging a wrong insight) can always follow `data_source` back to the row that caused it.

### 2.4 Severity computation

Severity is a fixed function of the rule that fired and how far past its threshold the underlying record is — not a judgment call, and not something an LLM estimates:

| `insight_type`     | `info`             | `warning`          | `urgent`                               |
| ------------------ | ------------------ | ------------------ | -------------------------------------- |
| `rent_overdue`     | —                  | 1–6 days overdue   | 7+ days overdue                        |
| `rent_due_soon`    | due in 4–7 days    | due in 1–3 days    | due today                              |
| `lease_expiring`   | 60–90 days out     | 30–59 days out     | ≤29 days out                           |
| `maintenance_open` | opened <3 days ago | open 3–7 days      | open 7+ days, or `priority = 'urgent'` |
| `invoice_unpaid`   | 1–6 days past due  | 7–13 days past due | 14+ days past due                      |

Thresholds are configuration (constants or an org-level override table added later if needed), not hardcoded magic numbers scattered through the codebase — but they are still deterministic thresholds, never a model's confidence score.

### 2.5 Scheduling

Two complementary triggers, matching the "how/when" requirement:

1. **Scheduled Edge Function** (primary): runs on a fixed cadence (e.g. hourly) per org, evaluates every rule against current data, and reconciles `portfolio_insights` — inserts new rows for newly-triggered conditions, and marks resolved ones (e.g. rent that was overdue and is now paid) so the feed doesn't show stale insights. This is the guaranteed baseline — even if no relevant write happens, the feed is never more than one cadence period stale.
2. **Triggered-on-write** (supplementary, optional at V1): the same evaluation function can be invoked synchronously (or via a lightweight queue) after a write to a directly-relevant table — e.g. immediately after a rent payment is confirmed, re-evaluate that lease's `rent_overdue` condition — so the feed reflects an obvious resolution without waiting for the next scheduled pass. This is a UX nicety layered on top of the scheduled job, never a replacement for it; the scheduled job is what makes the "nothing is estimated" guarantee hold even for conditions (like a lease simply reaching its expiry window) that no write event naturally corresponds to.

Both paths call the same rules-evaluation function — there is exactly one place in the codebase where the trigger conditions in §2.2 are implemented, so the scheduled and triggered paths cannot drift into evaluating different rules.

---

## 3. LLM provider — open decision (unresolved)

**No LLM vendor has been selected.** This is stated explicitly as an open decision, not a placeholder to fill in casually — the same posture `DOCUMENT_INTELLIGENCE.md` takes toward its OCR vendor choice ("Selection is deferred to Phase 2 and documented as a decision to make then... since it affects cost and accuracy tradeoffs Mohammed should weigh in on"). Do not pick a vendor in code, infrastructure, or this document ahead of that decision.

### 3.1 Provider-abstraction interface (mirrors the existing vendor-agnostic pattern)

The codebase already has two working examples of this pattern — `DocumentIntelligenceProvider` (`DOCUMENT_INTELLIGENCE.md`, `packages/types/documentIntelligence.ts`) and `SubscriptionProvider` (`apps/mobile/src/features/subscriptions/SubscriptionProvider.ts`). Both share the same shape: a typed interface with no vendor-specific types leaking through it, a mock/deterministic implementation that unblocks all UI and business-logic work before any real vendor account exists, and a note that the server-synced database is the source of truth, never the provider's own state.

An `LLMProvider` interface for the Assistant should follow the same shape, likely living at `packages/types/llmProvider.ts`:

```ts
// packages/types/llmProvider.ts — SHAPE ONLY, not yet implemented; vendor undecided.
export interface LLMProvider {
  /**
   * One conversational turn. `context` is the already-assembled, org-scoped
   * data from the server-side context-assembly function (§1.4) — never a
   * raw table dump, never fetched by the provider itself. `history` is the
   * prior turns of this conversation only (never cross-conversation).
   */
  converse(input: {
    context: AssembledOrgContext;
    history: ConversationTurn[];
    userMessage: string;
  }): Promise<{
    replyText: string;
    stagedChange?: StagedChange; // shape written to ai_messages.staged_changes
    costMetadata?: { inputTokens: number; outputTokens: number; costUsd: number };
  }>;
  // Throws a typed ProviderError (retryable | non_retryable), matching the
  // DocumentIntelligenceProvider convention, rather than a bare Error.
}
```

Design constraints this interface must preserve, independent of which vendor eventually implements it:

- **No vendor-specific types cross the interface boundary.** `apps/web` and the mobile apps depend only on `LLMProvider`, `AssembledOrgContext`, `StagedChange` — never on a vendor SDK type.
- **A `MockLLMProvider`** (deterministic canned replies + staged-change shapes, matching the `MockDocumentIntelligenceProvider` / `MockSubscriptionProvider` pattern) ships first, so the staging/confirm UI and the context-assembly function can be built and tested before any real LLM account exists.
- **Context assembly is outside the provider.** The provider only ever receives already-assembled, already-scoped context (§1.4) — it is never handed a raw query function or a service-role client, so a future provider swap cannot accidentally regress the cross-tenant isolation guarantee.
- **All provider calls happen server-side only**, same as `DOCUMENT_INTELLIGENCE.md`'s rule for OCR vendor calls — no client (web or native) ever holds an LLM API key or talks to the vendor directly.

### 3.2 What's deliberately not decided here

Candidate vendors, specific model choice, prompt-engineering details, and streaming-vs-batch response delivery are all out of scope for this document and deferred to the same Phase-2-style decision point as the OCR vendor choice.

---

## 4. Cost and rate limiting

Per-org usage caps are required because Super Admin's dashboard tracks AI/extraction usage per client (`RETAIN_REFACTOR_REBUILD_MATRIX.md` "Super Admin dashboard (client directory, MRR/ARR, billing config)" row; confirmed as a genuine tracking requirement, not yet backed by schema, in `SUPER_ADMIN.md` §2.3: _"Platform storage / email / WhatsApp / OCR / AI usage has no aggregation table in DATABASE.md... No AI usage/token-tracking table at all"_).

**Resolved by architecture review, 2026-07-30**: `usage_events`/`usage_snapshots` are now defined in `DATABASE.md` §7. This is the plan of record:

- **Metering.** Every `LLMProvider.converse()` call returns `costMetadata` (input/output tokens, cost). The server records this as a `usage_events` row (`org_id`, `usage_type = 'ai_token'`, `quantity`, `related_entity_type = 'ai_conversation'`, `related_entity_id = conversation_id`, `recorded_at`) at call time; a scheduled job rolls these into `usage_snapshots` per org/period, which is what dashboards actually read (`DATABASE.md` §7) — AI usage is one `usage_type` among several (storage/email/WhatsApp/OCR/AI), not a bespoke table.
- **Per-org caps.** Each org's effective plan (`organization_subscriptions` → `plans.feature_limits jsonb`, `DATABASE.md` §1) gains an AI-usage limit field (e.g. a monthly token or request cap) alongside the existing max-properties/units/staff-seat limits already modeled there — same mechanism, new limit key.
- **Enforcement point.** `POST /api/v1/ai/conversations/:id/messages` checks the org's current-period usage against its cap **before** calling the LLM provider, not after — an org that has exhausted its cap gets a clear 4xx (e.g. `429`-shaped `{error: {code: "ai_usage_cap_exceeded"}}`) rather than a metered call it can't afford. Portfolio Intelligence (§2) has no such cap, because it never calls an LLM — it is exempt from this section entirely, which is itself another reason to keep the two surfaces architecturally separate.
- **Super Admin visibility.** Once the usage-tracking table exists, the client directory (`SUPER_ADMIN.md` §3) gains an "AI usage this period" figure per org, matching the existing per-org storage/email/WhatsApp/OCR usage fields already flagged as blocked on the same gap.

---

## 5. Audit logging

Every AI-proposed-and-confirmed change produces the **same `audit_events` row any human-initiated change through that endpoint would produce** — because, per §1.6, the confirm call re-enters the identical typed endpoint, and every mutating endpoint writes its `audit_events` row as part of the same transaction as its primary write (`API_SPEC.md` §0: _"every mutating endpoint writes an audit_events row as part of the same transaction as its primary write — not a best-effort side effect that can silently fail"_). There is no separate, parallel audit path for AI-driven writes to fall out of sync with.

**Resolved by architecture review, 2026-07-30**: `audit_events.actor_type` (`DATABASE.md` §10) now includes `ai_assisted`, plus nullable `ai_conversation_id`/`ai_message_id` pointers, exactly as proposed here. `ai_assisted` means "this write's `actor_user_id` is a real, authenticated, permission-checked user, and it happened via a confirmed AI-staged change rather than a direct UI action" — `actor_user_id` is always populated identically either way; `ai_assisted` never means "the AI acted as its own principal." The pointers let a support engineer trace an audited change back to the exact conversation turn that staged it; they're `null` for every human-direct-UI change, which has no such conversation to point to.

Portfolio Intelligence writes to `portfolio_insights`, not to any business table, and does not go through the mutating-endpoint path described above — it has no `audit_events` row of its own for the same reason a dashboard query doesn't: it never changes user data, only surfaces derived read-only insights. If it later gains a write capability (e.g. auto-dismissing a resolved insight), that write should get the standard `actor_type = 'system'` treatment already defined for scheduled jobs.
