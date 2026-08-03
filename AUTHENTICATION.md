# Authentication

**PRODUCT DECISION 1 (2026-08-03)**: PropertyVault's PWA supports self-service web account
creation. This was not an intentional V1 exclusion — it was an unflagged gap, discovered during
`PWA_V1_READINESS_REPORT.md`'s end-to-end workflow audit (no `/register` page, no
`POST /api/v1/auth/signup` route existed anywhere, despite `API_SPEC.md` §1 documenting one and
`packages/validation`'s `registerSchema` already existing with zero call sites). This document
describes what was built to close it.

## 1. Architecture

Everything goes through **Supabase Auth** directly (`@supabase/ssr`'s browser/server clients) —
there is no separate custom password system, and this app never handles a raw password itself.
`API_SPEC.md` §1's documented `/api/v1/auth/**` REST surface was never built and still isn't
(login/register/reset all call Supabase Auth client-side, matching the pattern
`LoginForm.tsx`/`ResetPasswordForm.tsx` already established before this change) — that spec
section is aspirational, not implemented, and this document doesn't pretend otherwise.

Three real, independent identity systems already existed (`PERMISSIONS.md`'s "never merge role
systems" principle) — org staff (`organization_members`), owners (`owners.user_id`), tenants
(`tenants.user_id`), plus platform admins (`platform_admin_users`). Registration/OAuth/linking
work identically for all of them: every `auth.users` row gets exactly one `profiles` row
(`on_auth_user_created` trigger, migration `20260101000004`) regardless of which of those it
later also becomes.

## 2. V1 authentication methods

1. **Email and password** — `supabase.auth.signUp()` / `signInWithPassword()`.
2. **Google OAuth** — `supabase.auth.signInWithOAuth({ provider: 'google' })`.
3. **Apple OAuth** — same, `provider: 'apple'`.

Deliberately **not** Microsoft or other providers — the instruction driving this change is
explicit that a fourth provider is only worth adding once the first three are complete and it's
genuinely low-effort, and no Microsoft credentials/decision exist. Not built.

## 3. Flows

| Flow | Where | Notes |
|---|---|---|
| Create account | `/register` | Email/password + Terms/Privacy version acceptance, or OAuth buttons |
| Email verification | Supabase-sent link → `/auth/callback` | `[auth.email] enable_confirmations = true` (`supabase/config.toml`) |
| Sign in | `/login` | Email/password or OAuth; `?next=` carries continuation |
| Sign out | `AppShell`'s account menu | Unchanged, pre-existing |
| Google / Apple sign-in | `components/auth/OAuthButtons.tsx` | Shared by `/login` and `/register` |
| Forgot / reset password | `/forgot-password` → `/reset-password` | Unchanged, pre-existing (built in an earlier phase) |
| Session expiry | `proxy.ts`'s auth gate | Now preserves `?next=` on redirect to `/login` (previously dropped the original path entirely — a real gap fixed alongside this change) |
| Auth callback | `/auth/callback/route.ts` | Single landing point for OAuth, email verification, and (pre-existing) password reset codes. Handles `?code=` (PKCE, the current default) and `?token_hash=&type=` (legacy OTP-link shape) |
| Provider error | `/auth/callback` → `/login?error=` | Shown as a banner on `/login` |
| Invitation continuation | `?next=` end-to-end | A user who clicks Google/Apple (or registers) from an org-invite or tenant-activation page returns to that exact page once authenticated |
| Suspended/archived org | `has_org_role()` (migration `20260101000057`) / `accept_tenant_invitation()` (`org_inactive`) | Suspended orgs stay viewer-accessible; archived orgs block new tenant links entirely — see §5 |

## 4. Account identity rules (never multiple identities for one person)

Supabase Auth has no supported operation to merge two already-distinct `auth.users` rows, and
`PERMISSIONS.md`'s "never merge based on an unverified email" rules out attempting it manually
from a client-supplied value. The sanctioned way for one person to gain a second sign-in method
against their **same** `auth.users.id` (so every org membership, tenant link, owner link, and
audit row tied to that id is preserved automatically — nothing to migrate, since the id never
changes) is **manual linking**: `supabase.auth.linkIdentity({ provider })`, called from an
already-authenticated session — `components/settings/LinkedAccountsPanel.tsx`, reachable from
`/settings` (org staff/owners) and `/profile` (tenants).

This requires the Supabase project's **"Enable Manual Linking"** auth setting (external
Supabase Dashboard configuration — see §6). Without it, `linkIdentity()`/`unlinkIdentity()`
return a real, descriptive error rather than silently failing.

Automatic linking (Supabase auto-merging a new OAuth sign-in into an existing password account
because the emails match) is **not** enabled — the safer default per the instruction ("if
automatic linking is unsafe or unsupported, require the user to authenticate with the existing
method before linking another provider"). A user who already has a password account and signs up
via Google with the same email gets Supabase Auth's own duplicate-registration handling (a real
error, never a silent merge); they're expected to sign in with their existing method and use
"Link account" from settings instead.

## 5. Tenant activation (PRODUCT DECISION 2)

A landlord/staff member creates the tenant/property/unit/lease first — the tenant never
re-enters data already captured. Full design: `TECHNICAL_DEBT_REGISTER.md` has no entry for this
(it was net-new, not paid-down debt); the canonical spec lives in migration
`20260101000059_tenant_invitations.sql`'s own header comment and `accept_tenant_invitation()`'s
function comment.

- **Separate table from `organization_invites`** (deliberately, not a merge): org invites
  identify a role grant into an org for someone who may not exist as a row anywhere yet; tenant
  invitations link an **already-existing** `tenants` row to an auth identity, support a
  short-code delivery path org invites never needed, and require hashed-at-rest storage
  (`token_hash`/`short_code_hash`, sha256) that org invites' plaintext `token uuid` column
  doesn't.
- **Never store plaintext tokens/codes** after generation — `create_tenant_invitation()` returns
  the plaintext exactly once, in the API response; the staff UI (`TenantInvitationPanel.tsx`)
  shows a one-time "copy now, it won't be shown again" panel.
- **Short codes always require a second factor**: acceptance via short code requires the
  caller's email too, and the RPC looks up candidate invitations by `(tenant.email, code)`
  together — never by code alone, so a wrong-code guess against a wrong email doesn't even
  identify a row to lock out.
- **Failed-attempt lockout**: 5 wrong short-code attempts per invitation, tracked on the
  invitation row itself. This is layered with (not a replacement for) `check_rate_limit()`
  (`lib/rateLimit.ts`, TD-10) applied per-user and per-IP on the accept endpoint.
- **Atomic, idempotent acceptance**: `accept_tenant_invitation()` is a single `SECURITY DEFINER`
  Postgres function — link `tenants.user_id`, mark the invitation accepted, and write the audit
  event all happen in one transaction. It returns a `(success, error_code, tenant_id)` row rather
  than raising for expected failures — raising a Postgres exception rolls back every write made
  earlier in the same function call (including the failed-attempt increment), which was a real
  bug caught by writing the adversarial pgTAP suite for it, not assumed away. `error_code` values:
  `not_found`, `invalid_code`, `locked_out`, `revoked`, `expired`, `already_used`, `org_inactive`,
  `already_linked`, `email_mismatch`.
- **Suspended vs. archived org**: a suspended org's tenant can still activate and use their
  portal (tenant self-access was never gated by org status — `has_org_role()`'s status
  enforcement, TD-17, only ever governed *staff* access). An archived org rejects new tenant
  links entirely (`org_inactive`), matching `has_org_role()`'s own archived-org exclusion.
- **Delivery**: email (`dispatchEmail`, template `tenant_invitation`), WhatsApp
  (`dispatchWhatsApp`, template `tenant_invitation`, WHATSAPP.md §2's pre-approved trigger list),
  or manual (staff reads a short code aloud/hands it over — no message sent at all).
- **"Resend" and "regenerate" are the same operation**, deliberately: the raw token/code is never
  stored, only its hash, so literally re-sending the original secret is cryptographically
  impossible, not merely unbuilt. `POST /api/v1/tenants/:id/invitations` always issues a fresh
  invitation (revoking any prior un-accepted one first); the UI just labels the button
  differently depending on whether one already exists.

## 6. External setup required (not done here — no real credentials exist in this environment)

**Google:**
1. Google Cloud Console → OAuth consent screen (External, or Internal if using Workspace).
2. Create an OAuth 2.0 Client ID (Web application).
3. Authorised redirect URI: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
   (hosted) or `http://127.0.0.1:54321/auth/v1/callback` (local CLI).
4. Set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (root `.env.example`) and flip
   `supabase/config.toml`'s `[auth.external.google].enabled` to `true`.
5. For a hosted project, also enter the same client ID/secret under Supabase Dashboard → Auth →
   Providers → Google (config.toml only governs the local CLI).

**Apple:**
1. Apple Developer account → Certificates, Identifiers & Profiles.
2. Create a Services ID (this is the OAuth "client ID" Supabase expects) with **Sign in with
   Apple** enabled.
3. Configure the Services ID's redirect URI to the same `/auth/v1/callback` shape as above.
4. Generate a Sign in with Apple private key; combine it with your Team ID and Key ID into the
   client secret JWT Supabase expects (Supabase's own docs cover the exact JWT shape).
5. Set `APPLE_OAUTH_CLIENT_ID` / `APPLE_OAUTH_CLIENT_SECRET`, flip
   `[auth.external.apple].enabled` to `true`, and mirror into the hosted project's Dashboard.

**Supabase project (either provider):**
- Auth → Settings → **Enable Manual Linking** (required for `LinkedAccountsPanel.tsx` to work at
  all — see §4).
- Confirm **Automatic linking** stays off (the safe default this design relies on).

## 7. What's verified vs. not

`Verified`: pgTAP (`tenant_invitations.test.sql`, 26 adversarial assertions — link/short-code
acceptance, expiry, revocation, replay, lockout, cross-org, already-linked, email mismatch,
archived/suspended org, audit event, RLS isolation), typecheck, lint, real local Supabase
migration + RLS.

`Unknown — requires real Google/Apple credentials to settle`: the actual OAuth redirect round
trip end-to-end (button click → provider consent → callback → session). The code path is built
and exercises the same `exchangeCodeForSession()` call already proven working for password reset
in this exact project, but cannot be click-tested without real provider credentials, which this
environment does not have and cannot fabricate.
