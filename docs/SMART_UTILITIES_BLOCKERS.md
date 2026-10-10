# Smart Utilities — Blockers (external; cannot be resolved in code)

| # | Blocker | Needs | Impact until resolved |
| --- | --- | --- | --- |
| B1 | No physical meters/gateways | Owner purchase + plumber/electrician (CoC) | Every hardware adapter stays "requires hardware testing" |
| B2 | Production deployment of migrations 175+ | Owner approval | Feature not live |
| B3 | Real external email to municipalities/agents | Owner approval + `SMART_UTILITY_AUTO_SUBMISSION_ENABLED=true` in that environment | Packs send only on manual approval (still via real Resend in prod once deployed); dev/test uses the mock provider |
| B4 | `SMART_UTILITY_CREDENTIALS_KEY` in each environment | Owner to generate and store a 32-byte key as a secret | Poll-based integrations (ThingsBoard) cannot be created |
| B5 | Live ChirpStack / The Things Stack / ThingsBoard servers | An account or self-hosted instance | Adapters verified against documented formats only |
| B6 | Pulse-head compatibility of SA pulse-ready water meters | Supplier confirmation | Water hardware choice per property |
| B7 | Legal check: SABS approval of private submeters for tenant recharge; NERSA resale rules | Owner/legal | Electricity recharge must stay landlord-reviewed drafts |
| B8 | Municipal acceptance of emailed readings | Municipality | "Sent" never implies "accepted" |
| B9 | Per-site legal position on recharging electricity/water and on shared-meter splits | Owner/legal (NERSA, by-laws, Water Services Act, lease clauses) | Charges carry review flags; nothing is issued automatically |
| B10 | Inverter/battery/generator vendor access | Pilot site hardware + vendor account (Victron VRM public; others partner-only) | Solar/battery/generator figures only from meters the existing adapters read, or manual entry |
| B11 | VAT treatment of recharges for VAT-registered landlords | Owner/accountant | VAT shown per charge/statement; ledger split not automatic (TD-61) |
