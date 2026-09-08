# Android owner app — visual / UAT verification

> **Second pass, 2026-09-08 (final Android polish).** Everything reported below as unfixed —
> findings B, E, F and G — has since been fixed and re-verified on-device, and the demo portfolio
> has been rebuilt. See **[Final Android polish pass](#final-android-polish-pass)** at the end of
> this file for what changed; the sections in between are the original verification pass and are
> kept as the record of how each defect was found.

---

## Original pass — final visual / UAT verification

**Date:** 2026-09-08
**Build:** `app-debug.apk` from the working tree (Android unit suite: **253 run, 0 failures**)
**Device:** `PropertyVault_Pixel7_API35` emulator, 1080×2400
**Account:** UAT owner (`uat-owner@uat-proplyst.invalid`) in the **Proplyst UAT Portfolio**
organisation, against the live `proplyst.co.za` API. No customer organisation was touched.

This pass was verification, not development. Four small defects found during it were fixed and
re-verified on-device; the rest are reported for a decision rather than changed.

---

## 1. Needs-attention behaviour — visually proved

Previously this was covered only by unit tests. It is now proved on screen.

A temporary 16-row fixture was inserted into the **UAT org** (9 overdue invoices, 2 maintenance,
1 lease expiry), every row tagged `visual_qa_fixture` with its id recorded, then **deleted after the
captures**. Verified afterwards: 0 fixture rows remain, active insights back to **4**, confirmed
both by direct query and on-device after a cold start.

| Screenshot | What it proves |
|---|---|
| `SHOT-1-home-preview.png` | Badge reads **16**; exactly **4** preview rows render; "View all 16" appears; Quick actions and Top properties sit immediately below — no wall of cards |
| `SHOT-2-needs-attention-all.png` | Full screen: back arrow, badge, horizontally scrolling filter chips, every row with its category and count |
| `SHOT-3-filter-critical.png` | Critical filter narrows 16 → 3 rows |
| `SHOT-4-filter-rent-grouped.png` | Rent filter shows the grouped **"9 overdue rent invoices · Rent · 9 items"** row beside the single ungrouped warning |

Also verified live:

- **Grouping keeps the specific message when a group has one member** — the lone warning still reads
  "Invoice of 15000 for period 2026-09-01 is 7 days past due", not a vague "1 rent invoice".
- **Ordering** — the three CRITICAL rows precede every WARNING, on both Home and the full screen.
- **Empty filter state** — Payments (no payments awaiting confirmation) shows
  "Nothing under Payments / Try another filter to see the rest", not a blank screen.
- **Back navigation** returns to Home with its scroll position and bottom nav intact.
- **The ≤ 4 case** — after the fixture was removed, the badge reads 4, four rows render, and the
  "View all" link correctly disappears.

## 2. Owner walkthrough

Home, Properties, property detail, Record payment, invoice detail, Add expense, Utility reading,
Rent status, Activity, More (all sections), Monthly summary.

**No crashes, no ANRs, no fatal exceptions from `za.co.proplyst.app`** across the entire
walkthrough. The emulator did throw repeated ANRs — every one of them was a Google system app
(`com.google.android.googlequicksearchbox`, `com.google.android.gms`,
`com.google.android.apps.messaging`, `com.android.systemui`) under host CPU load, confirmed by
`logcat | grep "ANR in"`. None came from Proplyst.

### Fixed and re-verified on-device

| | Defect | Fix |
|---|---|---|
| **A** | **Properties list card — text unreadable.** The card's scrim thinned to 0.05 alpha at exactly the height the property name and address sit at, so the no-photo building glyph read straight through the words on every card. | Reshaped the gradient in [`PropertiesListScreen.kt`](apps/android/app/src/main/java/za/co/proplyst/app/ui/properties/PropertiesListScreen.kt) so it reaches a real scrim before the text starts and holds it to the bottom. The Navy Deck stripes and glyph are unchanged — the glyph now sits behind the text as an intended watermark. |
| **C** | **Save button unreachable on every form.** With the keyboard open, the scroll viewport kept its full height, so the form hit its scroll limit with Notes, Receipt and **Save expense** still hidden and no way to reach them. A user had to dismiss the keyboard first. | Added `imePadding()` to the scroll container on **AddExpense, RecordPayment, CreateMaintenanceTicket, ReportPayment and UtilityCapture**. Only `SignInScreen` had it before. |
| **D** | **Rent status eyebrow read "Settings"** — wrong on the Home → Quick actions path, which is the primary one. | Now reads "Portfolio", matching the More screen's own section heading. |

### Reported, not changed

| | Finding | Severity | Why it was left |
|---|---|---|---|
| **B** | Property detail: scrolling the hero slides the title under the fixed circular back button. | Low–medium | Needs a collapsing-header change, which is more than a verification pass should take on. Avoidable on camera by staying at the top of the screen. |
| **E** | Bottom nav says "Activity"; the screen it opens is titled "Notifications". | Low | Copy decision — which word is the product's? |
| **F** | **Home never refetches.** `DashboardViewModel` loads once in `init` and nothing calls its `loadX()` functions again; there is no pull-to-refresh anywhere in the app. Verified live: after deleting 12 insights, Home still showed 16 across a tab switch away and back, and only corrected on a cold start. | Medium | A real behaviour change (record a payment, return to Home, see stale figures). Worth doing, but it is a change to how the dashboard loads, not a visual fix. |
| **G** | The Record-payment invoice picker shows an unlabelled "R0" — it is the outstanding balance, which the invoice detail screen states clearly. The picker also offers a fully-paid invoice for further payment. | Low | The R0 needs a column label. Whether a paid invoice should accept another payment is financial logic and was left alone deliberately. |

### Working well

Utility reading (date prefilled to today, Save correctly disabled until valid, and a genuinely
helpful empty state naming where to add a meter); invoice detail (Amount / Paid / Balance, payment
history, PDF action); the More screen's grouping; every empty state seen was specific and honest
rather than a blank panel.

## 3. Add expense — keyboard verdict

**Before the fix it was a real obstruction, though not a hard block.** The numeric IME left the
Amount field itself fully visible, and the entered value survived dismissing the keyboard, so a user
could always finish by dismissing the IME first — one extra gesture most people make reflexively.
But the form could not be scrolled to Save at all while the keyboard was up, which reads as broken.

**After the fix,** with the keyboard open the form scrolls to a fully visible, tappable **Save
expense** with clearance above the IME. Verified on-device (`v-expense-ime-fixed.png`).

The same defect existed on four other forms — RecordPayment, CreateMaintenanceTicket, ReportPayment
and UtilityCapture — and the same one-line fix was applied to all of them. **Only Add expense was
re-verified on a device**; the other four are the identical modifier on the identical container
shape and they compile and pass the suite, but they have not been exercised with a keyboard open.

## 4. Recording-ready state

See **`DEMO_RECORDING_SHOTLIST.md`** — ten clips (A–J) plus an optional closing clip, each 3–8
seconds, with the exact taps, what each demonstrates, the current UAT figures, and the screens to
keep off camera and why.

Two things there need your decision before recording: the portfolio's **monthly net position is
−R47,450** (arithmetically right for this data, but it is the biggest red number on the screen), and
**Needs attention has only 4 items**, so the bounded preview cannot be shown live — the four
screenshots above cover it instead.

## 5. Production data

- The 12 temporary fixture insights were **deleted**; the UAT org is back to its own 4 real
  insights. Confirmed by query and on-device.
- Both temporary scripts (`tmp-seed-attention.mjs`, `tmp-cleanup-attention.mjs`) were deleted.
- **Nothing else was written.** No payment was recorded (UAT org payments: 0) and no expense was
  saved — the R4,500 typed into Add expense was never submitted, and the org's most recent expense
  (R1,250) predates this session.
- Worth a decision: the UAT org still holds **8 expenses** from earlier authorised passes, and they
  are what make the demo's net position negative. They are UAT-org records, not customer data, so
  they were left in place.

## What was not verified

- **iOS** — out of scope for this pass and not started.
- **Physical hardware** — everything here is an emulator result.
- **Four of the five IME fixes** — see §3. Add expense was re-verified on-device; RecordPayment,
  CreateMaintenanceTicket, ReportPayment and UtilityCapture were not opened with a keyboard up.
- **No independent verifier ran on this pass** — every result above is self-verified.
- Nothing here is committed. All changes are local on `main`.
- **Findings B, E, F and G** are unfixed by design; the descriptions above are what was observed,
  not what a fix would do.
- The emulator's ANR-prone Google apps (`googlequicksearchbox`, `messaging`, `photos`, `youtube`)
  were disabled with `pm disable-user` to stop them stealing input focus. Re-enable with
  `pm enable` if you need them.

---

# Final Android polish pass

**Date:** 2026-09-08 · **Build:** clean `app-debug.apk` · **Android unit suite: 253 run, 0 failures**
· **Device:** `PropertyVault_Pixel7_API35`, against the live `proplyst.co.za` API as the demo owner.

Every fix below was inspected on the emulator, not just compiled.

## 1. Home dashboard refresh — the headline fix

Home is a destination on a single flat `NavHost`, so it stays composed underneath Add expense,
Record payment, Meter reading and the other tabs. Its ViewModel survived, and it loaded exactly
once in `init` — nothing ever called it again — so an owner who recorded a payment came back to
pre-action figures until they force-stopped the app.

Two changes, both small:

- `DashboardViewModel` gained a single `refresh()` that runs all five section fetches concurrently,
  guarded so only one refresh is ever in flight. `init` now calls it too, so there is one code path
  rather than two. A section only falls back to its loading skeleton on the very first load; on a
  refresh the previous figures stay on screen until the new ones arrive, so returning to Home never
  flashes.
- `DashboardScreen` calls it from `LifecycleResumeEffect`. That covers **every** return path with
  one rule instead of a callback per flow, and the in-flight guard absorbs the duplicate call on
  first composition. Rapid tab-flipping costs one refresh per visit, never a loop.

Pull-to-refresh came almost free on top of that: `PullToRefreshBox` wraps Home's list and calls the
same `refresh()`, with `isRefreshing` driving the spinner.

**Proved end-to-end, twice, without ever force-stopping the app.** An expense was added directly to
the demo org while the app was running; leaving Home for Properties and returning updated Total
expenses R25,440 → **R26,000**, Budget 82.6% → 84.4% and net position R19,060 → **R18,500**. The row
was then deleted and a pull-to-refresh alone reverted every one of those figures.

## 2. Property detail header

The back button is pinned while the hero scrolls beneath it, so the property title slid into the
translucent circle. There is now an opaque navy band across the status bar and the button's own
height, fading out below it — matching the navy header every other screen already has. Content is
hidden behind it rather than showing through, and the button keeps its contrast over any photo.

Honest limit: at maximum scroll the title still ends up immediately beneath the button. It is now
cleanly occluded by an opaque header rather than competing with a see-through one, which is the
standard treatment, but the two are still adjacent.

## 3. Record payment

Two parts, both verified:

- **The unlabelled amount is now labelled `Balance`** — the word this invoice's own detail screen
  and the web invoice page already use. "Outstanding" stays reserved for totals across invoices. A
  settled invoice's R0 is muted; the one genuinely outstanding invoice shows **R8,500** in full
  contrast beside a red **Overdue** chip.
- **A settled invoice stops asking to be paid.** It still *accepts* a payment — corrections and
  genuine overpayments are real accounting events and the server remains the authority — so no
  calculation and no permission changed. What changed is presentation: on a zero balance the screen
  says "This invoice is fully paid." and the call to action drops to an outlined **Record another
  payment** instead of a filled CTA that reads as an outstanding task.

## 4. Activity terminology

The tab said Activity, the screen said Notifications. This destination is the full feed that Home
previews as "Recent activity" and that Home's own "View all" opens, so **Activity** is the product's
word for it; the empty state now reads "No activity yet". The gear beside it still says
"Notification settings", because that one genuinely configures notification delivery.

## 5. A real bug found while preparing the demo data

`invoices.status` is never set to `'paid'` anywhere in this codebase — paid/balance is derived from
`invoice_payments`, the way `loadInvoicesWithBalances()` does it. The unpaid-invoice rule in
`portfolioIntelligence.ts` filtered on `status <> 'paid'` alone, so **every issued invoice stayed
"past due" forever regardless of payment**. It surfaced immediately on the demo portfolio: four
fully settled invoices were all reported "8 days past due".

Fixed by subtracting non-reversed payments and skipping voided invoices — the same balance rule the
rest of the app uses — and by reporting the amount still owed rather than the invoice total. A
regression test covers both a fully settled invoice (must not be flagged) and a partly paid one
(must be flagged, for the remaining R3,000). Insight tests: **10 run, 0 failures**, including the
real local-Supabase integration cases.

This is a V1 defect that affected every customer, not just the demo.

Also fixed in passing: `PropertyCard.test.tsx`'s fixture had gone stale against `PropertyCardData`
and was failing `tsc --noEmit` on `main`. Typecheck is now clean.

## 6. Recording walkthrough

Home → Operating costs → Budget → Monthly net position → Needs attention (and the full list, with
filters) → Properties → Property detail → Rent status → Invoices → Record payment → Add expense →
Meter reading → Activity → More.

| Check | Result |
|---|---|
| Clipping / overlap | None. The property-card scrim and the new detail header both hold. |
| Raw errors, localhost references | None. `logcat` shows no `127.0.0.1`/`10.0.2.2`/`localhost` from the app. |
| Proplyst ANRs or crashes | **None.** The emulator's own Google apps ANR under host load; `logcat \| grep "ANR in"` confirms every one was `googlequicksearchbox`, `gms`, `messaging` or `systemui`. |
| Keyboard obstruction | Gone on **Add expense** and, this pass, re-verified on **Record payment** — both keep their submit button visible and tappable with the IME open. |
| Dashboard refresh | Works on tab return and on pull-to-refresh. |
| Bottom nav / back navigation | Correct throughout; Home keeps its scroll position. |
| Demo data | Professional. No "UAT", no UUIDs, no developer wording on any recorded screen. |

## 7. What is still not verified

- **iOS** — not started, out of scope.
- **Physical hardware** — emulator only.
- **CreateMaintenanceTicket, ReportPayment and UtilityCapture** still carry the same one-line
  `imePadding()` fix from the previous pass but have not been opened with a keyboard on a device.
  Add expense and Record payment both have.
- **No independent verifier ran.** Everything above is self-verified.
