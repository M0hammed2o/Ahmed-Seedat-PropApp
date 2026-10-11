# Utilities — Pilot Demonstration Data

**Everything here is DEMONSTRATION DATA.**
- All tariffs are fictional figures, labelled "DEMO FICTIONAL" in the app. They are not municipal or legally authorised
  rates.
- All people and places are fictional; e-mail addresses use `@demo.proplyst.example`, which cannot receive mail.
- Meter "photos" are generated grey placeholders.

## Where it may run

Only on a **disposable local** Supabase stack. The seeder refuses to run unless **all** of these hold:

1. `NEXT_PUBLIC_SUPABASE_URL` is `http://127.0.0.1:54321` (or `localhost`).
2. `PILOT_DEMO_CONFIRM=disposable` is set.
3. The database holds **fewer than 200 organisations**. The preserved main local copy has 2,725; a customer database
   is never local.

Never point it at staging or production. A staging demo needs the owner's approval and a separate, reviewed script.

## How to run

```bash
cd apps/admin
PILOT_DEMO_CONFIRM=disposable PILOT_DEMO_PASSWORD='<choose 12+ characters>' npx vitest run -c vitest.demo.config.ts
```

- Each run creates a **new** demo organisation and never updates or deletes anything, so it is reusable.
- The password is used for the four demo users and is never printed.
- The run prints the organisation and property ids and the demo e-mail addresses.
- It is not part of `vitest run`, because `vitest.demo.config.ts` is the only config that includes it.

## What it builds — "DEMO Protea Gardens (fictional)", Pietermaritzburg, October 2026 (31 days)

| | Electricity | Water |
| --- | --- | --- |
| Supply (monitoring only, never billed) | municipal grid import 600 kWh, rooftop solar 880 kWh | municipal 34 kL, borehole 16 kL, JoJo tank 45 % → 65 %, 2 kL tanker delivery (R950) |
| Main meters (never billed) | main DB 1,450 kWh | erf connection 52 kL |
| Unit submeters | F1–F7, each linked to the main meter (`parent_meter_id`) | F1, F2, F3; shared meter for F4 + F6 |

Fictional tariffs:
- **Electricity:** R3.00/kWh plus R60.00 a month, VAT-inclusive.
- **Water:** 0–6 kL at R20, 6–15 kL at R30, above 15 kL at R50 per kL.

| Flat | Arrangement | Use | Draft charge (hand-computed) |
| --- | --- | --- | --- |
| F1 | metered electricity (manual readings with photos; Nov reading **verified**) + metered water | 200 kWh; 8 kL | 200×3 + 60 = **R660.00**; 6×20 + 2×30 = **R180.00** |
| F2 | electricity included in rent; water paid by landlord | 150 kWh; 5 kL | none (monitored) |
| F3 | fixed R400 incl. 100 kWh; metered water | 130 kWh; 12 kL | **R400.00** + 30×3 = **R90.00**; 6×20 + 6×30 = **R300.00** |
| F4 | fixed R350/month; shared water (equal) | — ; ½ of 20 kL | **R350.00**; R640 ÷ 2 = **R320.00** |
| F5 | metered; tenant out 15 Oct, in 16 Oct | 50 + 40 kWh | 150 + 60×15/31 = **R179.03**; 120 + 60×16/31 = **R150.97** |
| F6 | metered; **1 Nov reading missing** → estimated; shared water | Sep: 300 kWh / 30 days | estimate 10/day × 31 = 310 kWh → **R990.00**; reading arrives (330 kWh) → **R60.00 draft true-up** |
| F7 | vacant — monitored only, no arrangement | 12 kWh | none |

- **Month total:** R3,940.00. The seeder recomputes it in cents as a second method.
- No charge ever cites a main, grid, solar or source meter. Tank levels and tanker logs are never billed.

## Statements and access (checked by the seeder, signed in as each person)

- Draft tenant statements are created for every lease with charges, plus one draft owner statement. Only F1's tenant
  statement is approved.
- **Tenant F1:** sees exactly one statement, their own approved one.
- **Tenant F2:** sees no statements, no tariffs and no meter readings.
- **Portal owner:**
  - sees the consumption dashboard (main meter 1,450 kWh);
  - **cannot** create a tariff.
- **Manager:** full access in the web app. Use them to walk through Utilities: overview, readings with photo evidence,
  charges with flags, statements, and the dashboard by date range.

## Walk-through script (manual, about 15 minutes)

1. **Manager → property → Utilities:**
   - the supply map shows grid, solar, municipal water, borehole and tank as monitoring-only;
   - the main → submeter list.
2. **Readings:** F1 electricity has photo evidence. Open the evidence PDF. The November reading shows "verified".
3. **Charges:**
   - October drafts with review flags (NERSA, by-law, "Estimated: trued up when readings arrive");
   - the F6 true-up draft.
4. **Statements:** the approved F1 statement as PDF; the owner statement draft. Sending is not offered: both sending
   flags are off.
5. Sign in as **tenant F1** (web or Android) → Utilities statements shows one statement.
6. Sign in as **tenant F2** → nothing.
7. Sign in as the **owner** → dashboard. The owner sees no tariff editing.
