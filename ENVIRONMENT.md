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
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_TEXTRACT_REGION` | Real AWS Textract credentials (`apps/admin/lib/providers/documentIntelligence.ts`, Stage 5, 2026-08-06, TD-39). All three required together (`AWS_TEXTRACT_REGION` falls back to `AWS_REGION` if unset). | No — falls back to `MockDocumentIntelligenceProvider` when unset |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Real upload malware-scanning target (`apps/admin/lib/providers/malwareScan.ts`, Stage 7, 2026-08-06, TD-43). Points at the local `clamav` service in the repo-root `docker-compose.yml` by default (`docker compose up -d clamav`) -- unlike the other vendors on this list, self-hosted/free, so `.env.example` defaults it ON rather than blank. | No — falls back to `MockMalwareScanProvider` when unset (uploads go through unscanned, MIME-allowlist only) |

## Validation

Both apps validate their environment at startup through a Zod schema in `packages/config/env.ts` (parameterised per-app since mobile/admin need different variables) — a missing or malformed required variable fails fast with a clear error instead of an obscure runtime crash later.
