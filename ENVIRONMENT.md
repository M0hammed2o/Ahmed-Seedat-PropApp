# Environment Variables

No real secret values are ever committed. Every variable below exists as a placeholder in the relevant `.env.example`. Copy to `.env` (or `.env.local` for Next.js) locally; set real values in each platform's secret manager for deployed environments.

## apps/mobile/.env.example

| Variable                                 | Purpose                              | Required for Phase 1 dev?                     |
| ---------------------------------------- | ------------------------------------ | --------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`               | Supabase project URL                 | Yes (or use local `supabase start` URL)       |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`          | Supabase anon key (safe for client)  | Yes                                           |
| `EXPO_PUBLIC_SUBSCRIPTION_MODE`          | `mock` \| `revenuecat`               | Yes — defaults `mock`                         |
| `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS`     | RevenueCat public SDK key (iOS)      | No — only when `SUBSCRIPTION_MODE=revenuecat` |
| `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` | RevenueCat public SDK key (Android)  | No — same                                     |
| `EXPO_PUBLIC_SENTRY_DSN`                 | Error monitoring                     | No (Phase 2)                                  |
| `EXPO_PUBLIC_ANALYTICS_ENDPOINT`         | Product analytics abstraction target | No (Phase 2)                                  |

## apps/admin/.env.example

| Variable                               | Purpose                                                                    | Required for Phase 1 dev?          |
| -------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                                       | Yes                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | Supabase anon key                                                          | Yes                                |
| `SUPABASE_SERVICE_ROLE_KEY`            | **Server-only.** Never prefixed `NEXT_PUBLIC_`. Never sent to the browser. | Yes, for admin server routes       |
| `REVENUECAT_WEBHOOK_SECRET`            | Verifies inbound RevenueCat webhook                                        | No (Phase 2, once webhook is live) |
| `DOCUMENT_INTELLIGENCE_WEBHOOK_SECRET` | Verifies inbound OCR callback                                              | No (Phase 2)                       |
| `ADMIN_SESSION_COOKIE_SECRET`          | Reserved for a future custom-signed cookie layer                           | No — unused in Phase 1             |

## supabase/functions/*/.env.example (per function, Phase 2)

| Variable                                 | Purpose                                          |
| ---------------------------------------- | ------------------------------------------------ |
| `SUPABASE_SERVICE_ROLE_KEY`              | Function-local service-role client               |
| `DOCUMENT_INTELLIGENCE_PROVIDER_API_KEY` | OCR vendor secret — server-side only, vendor TBD |
| `REVENUECAT_WEBHOOK_SECRET`              | Shared with admin app's webhook receiver         |

## Root

| Variable                     | Purpose                                                                                                         | Required for Phase 1 dev?                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `SUPABASE_PROJECT_REF`       | Used by `supabase link` for CLI operations                                                                      | No                                                 |
| `GOOGLE_OAUTH_CLIENT_ID`     | Read by the Supabase CLI's `env(...)` interpolation in `supabase/config.toml` — PRODUCT DECISION 1 (2026-08-03) | No — Google sign-in is `enabled = false` until set |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same                                                                                                            | No — same                                          |
| `APPLE_OAUTH_CLIENT_ID`      | Same, for Apple sign-in                                                                                         | No — Apple sign-in is `enabled = false` until set  |
| `APPLE_OAUTH_CLIENT_SECRET`  | Same                                                                                                            | No — same                                          |

See `AUTHENTICATION.md` for the full external setup walkthrough (Google Cloud OAuth consent
screen + client, Apple Developer Services ID + key) these four variables come from.

| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Mapbox _public_ token — drives the Owner Dashboard's real property map and server-side geocoding-on-save (`lib/providers/geocoding.ts`, 2026-08-04). Not a secret by Mapbox's own design. | No — map/geocoding degrade to an honest "not available" state when unset |
| `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` / `PAYFAST_PASSPHRASE` | Real PayFast gateway credentials (`apps/admin/lib/providers/payfast.ts`, Stage 4 commercial-launch execution plan, 2026-08-05, `TECHNICAL_DEBT_REGISTER.md` TD-36). All three required together. | No — billing falls back to `MockBillingGatewayProvider` when unset |
| `PAYFAST_MODE` | `sandbox` (default) or `live`. | No |
| `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` | Real email gateway credentials (`apps/admin/lib/providers/email.ts`, Stage 5, 2026-08-06, TD-37). Both required together. | No — falls back to `MockEmailProvider` when unset |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_WEBHOOK_SECRET` | Real Meta WhatsApp Cloud API credentials, direct (no BSP) (`apps/admin/lib/providers/whatsapp.ts`, Stage 5, 2026-08-06, TD-38). All three required together. | No — falls back to `MockWhatsAppProvider` when unset |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Meta template-approval locale code. | No — defaults to `en_US` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | An arbitrary string you choose yourself and paste into BOTH this variable and the Meta App Dashboard's "Verify Token" field. Used only for Meta's one-time GET handshake when registering the callback URL — a different value from `WHATSAPP_WEBHOOK_SECRET`. | No — but the callback URL cannot be registered without it |
| `WHATSAPP_UAT_OVERRIDE_NUMBER` | **UAT only, never production.** Redirects every outbound WhatsApp message to one E.164 number so a single handset can receive every template and persona. Ignored outright (with a loud error) when `NODE_ENV=production`; suppresses the send rather than falling through to the real recipient if unparseable. | No — inactive when unset |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_TEXTRACT_REGION` | Real AWS Textract credentials (`apps/admin/lib/providers/documentIntelligence.ts`, Stage 5, 2026-08-06, TD-39). All three required together (`AWS_TEXTRACT_REGION` falls back to `AWS_REGION` if unset). | No — falls back to `MockDocumentIntelligenceProvider` when unset |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Real upload malware-scanning target (`apps/admin/lib/providers/malwareScan.ts`, Stage 7, 2026-08-06, TD-43). Points at the local `clamav` service in the repo-root `docker-compose.yml` by default (`docker compose up -d clamav`) -- unlike the other vendors on this list, self-hosted/free, so `.env.example` defaults it ON rather than blank. | No — falls back to `MockMalwareScanProvider` when unset (uploads go through unscanned, MIME-allowlist only) |
| `PLATFORM_ADMIN_ALLOWED_EMAILS` | Super Admin separation (`apps/admin/lib/auth.ts`, 2026-08-06). Comma-separated email allow-list, checked in addition to `platform_admin_users` -- a real admin whose email isn't listed here (when this is set) is treated as a non-admin entirely. | No — `platform_admin_users` alone (RLS default-deny, manual-only provisioning) is the allow-list when unset |

## External-communications go-live checklist

Recorded during the external-communications release-gate pass (`WORKLOG.md` 2026-09-06). Both
WhatsApp and email currently fall back to mock providers, which log and return a synthetic id but
send **nothing**. Everything below is obtained from the vendor — none of it can be generated from
this repository, which is why real delivery stays unverified until these are supplied.

### WhatsApp (Meta Cloud API, direct — no BSP)

Prerequisite: a Meta Business account with a WhatsApp Business Account (WABA), a verified business,
and a registered sender phone number. That number must be one **not already registered to the
consumer WhatsApp app**.

| Variable | Where it comes from |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Meta App Dashboard → WhatsApp → API Setup. Use a **System User** token (permanent); the 24-hour temporary token there is only useful for a first smoke test. |
| `WHATSAPP_PHONE_NUMBER_ID` | Same API Setup screen — the numeric **Phone number ID** of the sender (not the phone number itself). |
| `WHATSAPP_WEBHOOK_SECRET` | Meta App Dashboard → Settings → Basic → **App Secret**. This is what signs `X-Hub-Signature-256` on every inbound POST. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | You invent this. Paste the same string into this variable and into the Verify Token field when subscribing the callback URL. |

Then, in the Meta dashboard: subscribe the callback URL `https://<host>/api/v1/webhooks/whatsapp`
and enable the `messages` webhook field (this delivers both inbound messages and outbound
sent/delivered/read/failed status callbacks).

Templates must additionally be **approved by Meta** before they can be sent. The registry in
`apps/admin/lib/whatsappTemplates.ts` carries an `approved` flag per template and fails fast
locally (`reason: 'template_not_approved'`) rather than spending an API call — so a template whose
Meta approval is revoked or still in review must have its flag set back to `false` there.

### Email (Resend)

| Variable | Where it comes from |
| --- | --- |
| `RESEND_API_KEY` | Resend dashboard → API Keys. |
| `RESEND_FROM_ADDRESS` | A sender on a domain you have **verified** in Resend (DNS: SPF + DKIM). Unverified domains are rejected at send time. |
| `RESEND_WEBHOOK_SECRET` | Resend dashboard → Webhooks, if delivery/bounce status tracking is wanted. Optional. |

Note the naming: this codebase uses `RESEND_FROM_ADDRESS`. There is no `EMAIL_FROM` or
`EMAIL_FROM_NAME` variable.

### What each unlocks

- WhatsApp values → `getWhatsAppProvider()` returns `MetaWhatsAppProvider` instead of the mock, so
  outbound sends reach Meta and inbound webhook signatures are genuinely verified.
- Resend values → `getEmailProvider()` returns `ResendEmailProvider` instead of the mock.

Until then the pipelines are verified but delivery is not, and every dispatch result reports
`deliveryConfigured: false` so the difference is never ambiguous.

## Validation

Both apps validate their environment at startup through a Zod schema in `packages/config/env.ts` (parameterised per-app since mobile/admin need different variables) — a missing or malformed required variable fails fast with a clear error instead of an obscure runtime crash later.
