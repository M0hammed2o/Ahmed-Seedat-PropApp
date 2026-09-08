# Proplyst Android — screen-recording shot list

Updated 2026-09-08, after the final Android polish pass. The demo portfolio has been rebuilt since
the first version of this file: the figures, property names and alerts below are what the app
actually shows now.

**Account to record with:** the demo owner `uat-owner@uat-proplyst.invalid` in the **Proplyst UAT
Portfolio** organisation (password is in the UAT credentials file — never on screen, never in this
repo). Never Mohammed's own administrator account, and never a real customer organisation.

**Device:** `PropertyVault_Pixel7_API35` emulator, or a physical Pixel-class phone running the same
debug build. Record at 1080×2400.

---

## Before you press record

1. Cold-start the app once and sign in, then let Home settle (~20 s on the emulator).
2. Home now refreshes itself whenever you return to it, and supports pull-to-refresh, so you can
   record the action clips in any order without stale figures.
3. Turn off notification popups. The emulator's own Google apps throw "isn't responding" dialogs
   under load; if that happens, `adb shell pm disable-user --user 0 com.google.android.apps.messaging`
   (and `…googlequicksearchbox`) stops them interrupting a take.
4. **Do not tap Save** on Add expense or Record payment during a take unless you intend to change
   the demo figures. Both forms are safe to fill in and back out of.

## What the demo portfolio shows

| Surface | Value |
|---|---|
| Collected in September | **R44,500** of **R53,000** billed — **84%**, **R8,500** outstanding |
| Occupancy | **71%** across **3 properties** (5 of 7 units let) |
| Operating costs | Water R2,840 · Electricity R3,500 · Rates & taxes R9,250 · Levies R1,800 · Other R8,050 — **total R25,440** |
| Budget | R25,440 of R30,800 — **82.6%** used, R5,360 remaining |
| Monthly net position | **+R19,060** (green) |
| Needs attention | **5** — 2 critical, 3 warnings |

**Properties**

| Property | Type | Let | Collected | Budget state |
|---|---|---|---|---|
| Lembede Place Offices | Commercial | 1/2 · 50% | R12,000 | On track (72%) |
| Hillcrest Family Home | Residential | 1/1 · 100% | R15,000 | Over budget (107%) |
| Marine Parade Apartments | Residential | 3/4 · 75% | R17,000 | Approaching (88.5%) |

**Tenants on camera:** Craig Williams, Naledi Khumalo, Thandeka Mokoena, Sipho Ndlovu (the overdue
one), and Khanya Design Studio (the commercial tenant in Suite A). All fictional.

---

## Clips

Each clip is a single take, 3–8 seconds. Start each one already on the named screen unless the clip
is about the navigation itself.

| # | Clip | Duration | Exactly what to do | What it demonstrates |
|---|---|---|---|---|
| A | Owner Home — the money first | 6 s | Open on Home, hold 2 s on "Collected in September · R44,500", then slow-scroll to Operating costs | The dashboard leads with cash actually collected, and with what is still outstanding |
| B | Operating costs breakdown | 5 s | Continue the scroll through Water → Total expenses R25,440 | Per-category operating spend, not one lump figure |
| C | Budget and net position | 6 s | Hold on Budget (82.6% used), then on the green **+R19,060** | Spend against plan, then the month's actual position, with the caption stating what it excludes |
| D | Needs attention | 6 s | Hold on the badge (5) and the four preview rows, then tap **View all 5** | Alerts ranked by severity, bounded so they never bury the page |
| E | The full alert list | 5 s | On the Needs attention screen, tap **Critical**, then **Rent** | Filterable, grouped, plain-language alerts |
| F | Quick actions | 4 s | Back to Home, hold on the four tiles, then tap **Add expense** | One tap from Home to the most common owner action |
| G | Add expense | 8 s | Pick a property chip, tap a category chip, type an amount, scroll to **Save expense**. Back out — do not save | Property/category chips, receipt attach, and the keyboard never blocking Save |
| H | Properties list | 6 s | Bottom nav → Properties, slow-scroll past all three cards | Occupancy bars, per-property collected, budget pills |
| I | Property detail | 7 s | Tap **Lembede Place Offices**, hold on Finances (Rent planned / Collected / Outstanding / Total expenses / Operating position) | The same figures a landlord would ask an agent for, per property |
| J | Rent status | 5 s | Home → Quick actions → **Rent status**, switch the property chip to **Marine Parade Apartments** | Per-tenant Expected / Paid / Outstanding, with Paid and Overdue states side by side |
| K | Invoices and the overdue one | 6 s | Home → **Record payment** → scroll the list → tap **INV-000007** (Sipho Ndlovu, Overdue) | Every amount labelled Balance; settled invoices muted and "Paid", the overdue one bold with a red chip and a Record payment CTA |
| L | Activity | 5 s | Bottom nav → **Activity** | A real running history: payments received, expense recorded, rent overdue |
| M | More — the full surface area | 6 s | Bottom nav → More, **start the shot below the account card** and slow-scroll from Portfolio through Finances | Shows the product is more than a dashboard: ledger, tenants, maintenance, notices, utilities, budget |

### Optional closing clip

| N | Meter reading | 5 s | Home → **Meter reading**, select **Marine Parade Apartments**, then tap Water and Electricity | Meter capture. Marine Parade is the only property with meters configured — the other two correctly say no meter is set up yet, which is honest but reads as empty on video |

---

## Screens and moments to keep off camera

- **The More screen's account card** — it shows `uat-owner@uat-proplyst.invalid`, which is obviously
  a test address. Clip M starts below it for that reason.
- **Reports & summary** — legitimately empty in this org.
- **Maintenance** — no tickets, so "Open jobs" on Home shows a dash and the list is empty.
- **Property detail, scrolled to the very bottom** — the title passes just beneath the pinned back
  button. It is now hidden behind an opaque header band rather than showing through it, but the
  cleanest framing is to stay near the top, which clip I does.
