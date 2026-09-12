# Play Console declarations — recommended answers

Everything here was established by reading the code. Where a question genuinely turns on business
fact rather than implementation, that is said plainly instead of guessed. Prepared 12 September
2026 against `0a22bca`.

Data Safety has its own file: `DATA_SAFETY.md`.

---

## Ads

**Answer: No, my app does not contain ads.**

No ad SDK is present — `gradle/libs.versions.toml` and `app/build.gradle.kts` contain no AdMob, no
`play-services-ads`, no mediation library, no `AD_ID` permission. There is no promotional surface of
any kind in the app, and nothing renders third-party creative.

---

## Government apps

**Answer: No.**

Proplyst is commercial property-management software published by GENBRIDGE Pty Ltd. It is not
developed by, on behalf of, or in partnership with any government entity, and it does not deliver a
government service. Municipal accounts appear only as *expenses a landlord records*: a
rates-and-taxes line, a water bill someone uploads. The app has no connection to any municipal or
government system.

---

## Financial features

**This is the one to answer carefully**, because the app is full of money. The distinction Google
draws is between *recording* financial information and *providing a financial service*.

What Proplyst actually does:

| Activity | Present? | What it is |
|---|---|---|
| Property-management recordkeeping | **Yes** | Rent schedules, invoices, expenses, budgets, utility costs — bookkeeping for a landlord's own portfolio |
| Payment **confirmation** | **Yes** | A tenant reports "I paid by EFT"; the owner confirms or rejects it. This records an assertion about money that moved **elsewhere** |
| SaaS subscription billing | Yes, **website only** | PayFast, on proplyst.co.za. The Android app has no purchase flow — see `BILLING_COMPLIANCE.md` |
| Lending / credit / loans | No | — |
| Banking / e-money / wallets | No | Proplyst never holds funds |
| Payments or money transmission | No | The app moves no money and initiates no transaction |
| Investing / securities / forex | No | — |
| Crypto | No | — |
| Insurance | No | — |
| Debt collection / credit reporting | No | Overdue rent is flagged to the landlord only; nothing is reported to any bureau |
| Tax preparation or filing | No | Records are retained for tax purposes; nothing is calculated or filed |

**Recommended answer: the app does NOT provide financial features / financial services.** It is
business record-keeping software. Proplyst never holds, moves, lends or invests money; the Android
app contains no payment SDK and no PayFast integration.

If the questionnaire offers a non-regulated "personal finance management / accounting or
bookkeeping" sub-option, select that — it describes the product accurately. Do **not** select
lending, banking, payments, investment, crypto or insurance; none is true, and each drags in
documentation requirements Proplyst cannot satisfy because the activity does not exist.

`Unknown — a question only you can answer:` whether GENBRIDGE Pty Ltd holds any financial-services
licence or registration that Play might ask about. Nothing in the codebase implies one is needed.

---

## Health

**Answer: No health-related functionality.**

No health data, no fitness tracking, no medical content, no COVID-19 contact tracing or status
functionality. Grepping the Android source for health, fitness, medical and COVID APIs returns
nothing, and no health permission is declared.

---

## Target audience and content

**Answer: 18 and over.**

Proplyst is business software for landlords, property owners and letting staff. Signing up means
running a property portfolio — an activity a child cannot undertake. The app is not designed for or
appealing to children: no games, no cartoon styling, no child-directed content. The Privacy Policy
already states it "is business software and is not directed at children under 18."

Because the audience is adults only, **Google Play's Families policy does not apply**, and no
Families self-certified ads declaration is needed.

---

## Content rating (IARC questionnaire)

Expected outcome: the lowest rating in each system — **Everyone / PEGI 3 / 3+**.

Answer the questionnaire as a **Utility, Productivity, Communication or Other** app, then:

| Question area | Answer | Why |
|---|---|---|
| Violence (realistic, fantasy, or cartoon) | No | — |
| Sexual content or nudity | No | — |
| Profanity or crude humour | No | — |
| Controlled substances (drugs, alcohol, tobacco) | No | — |
| Gambling — simulated or real | No | No gambling, no loot boxes, no wagering |
| Horror or fear content | No | — |
| Discrimination or hate content | No | — |
| User-generated content shared publicly | **No** | Users type notes, descriptions and announcements, but these are visible only inside their own organisation. There is no public feed, no social surface, no stranger-to-stranger contact |
| Users can interact or exchange content | **Qualified yes** | Only within one organisation, between an owner/staff member and their own tenants — never with the public. Answer as the questionnaire's wording requires, and do not claim an open social feature that does not exist |
| Shares user location with other users | No | No location is collected at all |
| Allows purchase of digital goods | **No** | The app contains no purchase flow |
| Digital purchases / in-app purchases | No | Same |

**Do not tick "Users can interact"** as an unqualified yes if the questionnaire treats it as open
social interaction; Proplyst has no public or stranger-facing communication. Where the wording is
ambiguous, describe it as organisation-scoped messaging between a landlord and their own tenants.

---

## Other declarations

| Declaration | Answer | Why |
|---|---|---|
| **News app** | No | Not a news publisher |
| **COVID-19 contact tracing / status** | No | No such functionality |
| **Data safety — government ID** | No | Not collected *by the app* — see `DATA_SAFETY.md` for the full reasoning |
| **Advertising ID** | Not used | No `AD_ID` permission, no ads SDK |
| **Account creation** | Required | Every screen is behind sign-in — see `APP_ACCESS.md` |
| **Account deletion** | In-app and on the web | More → Account & security → Delete account, and `proplyst.co.za/delete-account` |
