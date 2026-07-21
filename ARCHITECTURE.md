# Architecture

## System overview

PropVault is a pnpm/Turborepo monorepo with two applications and a shared package layer, backed entirely by Supabase (Postgres + Auth + Storage + Edge Functions).

```
apps/mobile   Expo Router app (iOS/Android) — customer-facing
apps/admin    Next.js App Router app — SaaS operator dashboard
packages/*    Code shared between both apps and edge functions
supabase/*    Migrations, edge functions, seed data (single source of truth for schema)
```

No backend server is hand-rolled: business rules that must not be trusted to the client (subscription state, admin authority, document ownership, webhook processing) live in Postgres (RLS + functions) or Supabase Edge Functions, never in mobile/admin client code.

## Monorepo package graph

```
apps/mobile ─┬─> packages/types
             ├─> packages/validation ──> packages/types
             ├─> packages/config
             ├─> packages/utils ───────> packages/types
             └─> packages/ui

apps/admin ──┬─> packages/types
             ├─> packages/validation
             ├─> packages/config
             ├─> packages/utils
             └─> packages/ui

supabase/functions ─> packages/types, packages/validation, packages/config
                       (via relative import at deploy time — Edge Functions run on Deno,
                       so these packages are kept dependency-light/isomorphic on purpose)
```

Rule: packages never import from apps. apps/mobile and apps/admin never import from each other.

## Client/server trust boundary

This is the single most important architectural rule in the codebase (see SECURITY.md):

- **Mobile and admin clients** hold only the Supabase **anon key**. RLS is the only thing standing between one customer's data and another's.
- **The Supabase service-role key** exists only in: Edge Function environment variables, and (for admin-only elevated operations) Next.js server-only route handlers reading from `process.env` on the server. It is never sent to a browser bundle or the mobile app, and is never imported by any file reachable from client components (`"use client"`) or the RN bundle.
- **Subscription entitlement** is resolved server-side (RevenueCat webhook → `subscriptions` table) and read-only from the client. The client never writes its own subscription status.
- **Admin role** is resolved from the `admin_users` table via a server-side session check (Next.js middleware + route handlers), never from a client-supplied header or JWT claim the client could forge without also forging a valid Supabase-signed session for an account that is actually in `admin_users`.

## Mobile app structure (apps/mobile)

Expo Router file-based routing, grouped by access level:

```
app/
  (auth)/            welcome, register, verify-email, login, forgot-password, reset-password
  (onboarding)/       paywall, restore, enable-biometrics, add-first-property, first-upload, intro
  (app)/              (tabs) dashboard, properties, documents, settings — behind session + biometric lock
    properties/[id]/
  _layout.tsx          root layout: providers (QueryClient, auth store, lock gate)
src/
  features/
    auth/              screens call into this: session logic, forms, zod schemas from packages/validation
    biometrics/         BiometricLockProvider, lock-state machine, SecureStore-backed session gate
    properties/         CRUD hooks (TanStack Query) + repository
    subscriptions/       SubscriptionProvider interface + MockSubscriptionProvider + RevenueCatProvider (stub)
    documents/           DocumentRepository interface + Supabase Storage implementation (upload/list/sign)
    documentIntelligence/ DocumentIntelligenceProvider interface + Mock implementation
  lib/
    supabase.ts          single Supabase client factory (anon key only, SecureStore-backed session persistence)
    queryClient.ts
  state/
    useAppStore.ts        Zustand — UI-only state (lock state, active property filter, onboarding step)
  design/                 re-exports packages/ui tokens + RN component primitives
```

## Admin app structure (apps/admin)

Next.js App Router, server-first:

```
app/
  (auth)/login/
  (dashboard)/
    overview/
    customers/[id]/
    subscriptions/
    processing/
    system/
  api/
    admin/...            server route handlers using service-role client (never exported to client)
    webhooks/revenuecat/  RevenueCat webhook receiver (signature-verified, idempotent)
    webhooks/ocr/         Document-intelligence provider callback (signature-verified, idempotent)
middleware.ts             session + admin-role gate for (dashboard) routes
lib/
  supabase/server.ts       service-role + server-session clients (server-only, "server-only" import guard)
  supabase/client.ts        anon browser client for the small amount of client-side interactivity
  auth.ts                   getAdminSession(), requireRole()
```

## Data flow: upload → extraction → match → checklist

1. Mobile app uploads file to a private Storage bucket path `{user_id}/{property_id}/{year}/{month}/{uuid}.{ext}`, writes a `documents` row (status `processing`), and inserts an `extraction_jobs` row.
2. An Edge Function (triggered by Storage webhook or a queued job — see DOCUMENT_INTELLIGENCE.md) calls the configured `DocumentIntelligenceProvider`, writes `extraction_results`, and updates `documents`/`bills` with typed fields plus a confidence score. In Phase 1 this runs against `MockDocumentIntelligenceProvider` only.
3. Customer confirms/corrects extracted fields in-app; confirmed fields are written directly (never silently trusted from the provider).
4. When a `proof_of_payment` document is uploaded, a matching pass (packages/utils `calculateMatchScore`) compares it against candidate unpaid `bills` for the same user and proposes `payment_matches` rows above the review threshold. The customer must confirm before a bill is marked `paid` (see PAYMENT_MATCHING design in this file's companion, DECISIONS.md).
5. The monthly checklist is a read-optimised view (`property_expected_categories` LEFT JOIN `bills`) computed per property/month, not a separately maintained table, so it can never drift from the underlying bills.

## Navigation map (mobile)

```
Welcome → Register → Verify Email → Paywall → Restore? → Enable Biometrics? → Add First Property → First Upload → Dashboard
                                                                                                          │
                                                                    ┌─────────────────────────────────────┼───────────────────────┐
                                                                Properties                            Documents                Settings
                                                             Property Detail                        Search/Filter          Biometric toggle
                                                          (Monthly Checklist)                     Document Preview         Subscription mgmt
                                                                                                                          Delete account request
```

Returning users: Login → (biometric unlock if enabled and within timeout) → Dashboard. Onboarding is resumable: progress is persisted (`user_preferences.onboarding_step`) so a killed app resumes at the right step.

## Admin information architecture

```
Login (admin-only auth, separate session) → Overview
  ├─ Customers → Customer detail (profile, subscription, properties/doc counts, audit, notes, suspend)
  ├─ Subscriptions (platform, product id, status, RevenueCat sync)
  ├─ Processing (extraction job queue, retries, dead-letter)
  └─ System (health, webhook status, feature flags, plan limits, audit log, maintenance banner)
```

## Why Turborepo + pnpm

Reasoning captured in DECISIONS.md. Short version: pnpm workspaces give strict, disk-efficient dependency isolation (important with an RN app and a Next.js app that must not silently share incompatible transitive versions); Turborepo gives cached, parallel `lint`/`typecheck`/`test`/`build` across both apps and all packages with minimal config.
