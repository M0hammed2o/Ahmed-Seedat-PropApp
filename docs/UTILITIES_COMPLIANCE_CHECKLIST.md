# Utilities — South African Compliance Checklist

**Date:** 2026-10-12. **This is not legal, tax or accounting advice. Proplyst draws no legal conclusion.**
- Statutes and bodies are named so the right professional can be asked. Every item in Part B needs written
  confirmation from a lawyer, a registered tax practitioner/accountant, or the relevant municipality **per pilot
  site**.
- Nothing in the product assumes that recharging is lawful. Billing stays draft-only, and all sending is off.
- It is **not** assumed that charging tenants for solar-generated electricity or borehole water is lawful.

## Part A — Technical controls already implemented (verified in automated tests)

| Area | Control |
| --- | --- |
| No silent billing | Smart Utilities is off for every organisation until switched on (migration 182). A charge needs an explicit per-unit arrangement and a person pressing Calculate. Charges and invoices are always drafts; nothing is issued or sent by the module |
| Monitoring is not resale | Monitoring-only, included-in-rent, landlord-paid and tenant-direct (prepaid) arrangements create no charge and need no tariff. Solar, battery, generator, borehole, rainwater, tank and grid registers are never billed |
| Tariffs set by landlords/managers only | Tenants cannot create or change tariffs, arrangements, charges or credits (RLS, pgTAP). Portal owners can read but cannot set prices |
| Review flags on every charge | NERSA electricity resale review, water-services intermediary review, shared-split lease clause, cost-recovery tariff review, `vat_ledger_split_pending` (VAT-registered landlords). Shown to staff; never auto-resolved |
| Disclosure to tenants | Statements show opening/closing readings, consumption, tariff name, basis (actual / estimated / true-up), VAT and credits. A tenant sees only their own approved statements and can raise a dispute that blocks invoicing |
| Evidence and audit | Readings carry who/when/source, optional photo (malware-scanned, protected storage, org-bound) and verification. Tariff, arrangement, charge, dispute and approval changes are audited. Municipal packs are frozen when approved |
| Municipal sending | Off by default (`SMART_UTILITY_AUTO_SUBMISSION_ENABLED`). Needs an approved content hash, an authorised recipient and a schedule; any change withdraws the approval. Test sends go only to the signed-in user |
| Data minimisation / POPIA-relevant | Org and property isolation (RLS); tenant data visible only to that tenant; device tokens hashed; vendor credentials encrypted; telemetry retention configurable (≥ 400 days, off by default); account deletion anonymises (migration 174) |

## Part B — Questions requiring external confirmation (per site)

| # | Topic | Question to confirm | Who | Priority |
| --- | --- | --- | --- | --- |
| C1 | Electricity resale (NERSA; Electricity Regulation Act) | May this landlord recharge tenants for electricity at this site? Does the tariff have to equal the municipal/Eskom tariff, and may administration or metering costs be recovered? Earlier research noted guideline clauses on an identical tariff and no recovery of meter-reading/billing costs — confirm current wording | energy lawyer / NERSA | P1 before live billing |
| C2 | Solar and generator electricity | Is charging tenants for **self-generated** (solar) or generator electricity permitted, and on what basis (cost recovery vs resale)? | energy lawyer | P1 |
| C3 | Municipal electricity by-law | Does the municipality require approved submeters, registration, or a specific recharge method? | municipality | P1 |
| C4 | Municipal water by-law; Water Services Act | May water be recharged (including **borehole and rainwater**)? Are submeters required to be approved (e.g. SANS 1529-1 type)? Is the landlord acting as a water-services intermediary? | municipality / water lawyer | P1 |
| C5 | Meter approval and installation | Which meters are legally acceptable for billing (South African type approval / legal metrology)? MID certification is **not** SA approval. Installation needs a registered electrician (Certificate of Compliance) or plumber | metrology body / installer | P1 for device billing |
| C6 | Lease provisions (Rental Housing Act, CPA) | Does the lease state the arrangement per utility, shared-split method and percentages, fixed amounts, estimate and true-up policy, dispute process, and statement frequency? | property lawyer | P1 |
| C7 | Tenant disclosures | What must a statement show (tariff source, readings, basis)? Is the current statement content sufficient? | property lawyer | P1 |
| C8 | VAT treatment (VAT Act) | Is a utility recharge by this landlord a taxable supply, exempt, or a disbursement? Does the landlord's VAT registration change it? Should tariffs be entered VAT-inclusive or exclusive? | tax practitioner | P1 |
| C9 | General ledger allocation (TD-61) | Which income account do recharges post to? Should output VAT be split on the invoice line? (Today recharges post to rent income, and VAT is flagged for manual split) | accountant | P1 for VAT-registered landlords |
| C10 | Retention of readings and evidence | How long must meter readings, photos, statements and invoices be kept (tax records, disputes)? The retention setting must not delete anything younger than that period | accountant / lawyer | P2 (retention is off by default) |
| C11 | POPIA | Is consumption data personal information of the tenant? Is the lawful basis, notice, purpose limitation and operator agreement (hosting, e-mail provider) in place? Are cross-border transfers covered for hosted services? | information officer / lawyer | P1 before tenant data goes live |
| C12 | Municipal submissions | Which municipalities accept e-mailed readings, in what format and by what date? Are recipient addresses officially authorised? | municipality | P2 (sending stays off) |
| C13 | Estimates | May an estimated charge be invoiced? What notice must the tenant get? | property lawyer | P1 if estimates are used |

## Pilot rule

Until C1–C9 (and C13 if estimates are used) are confirmed in writing for the pilot site, run the pilot as
**monitoring-only**. Monitoring-only needs no tariffs, no charges and no statements to tenants.
