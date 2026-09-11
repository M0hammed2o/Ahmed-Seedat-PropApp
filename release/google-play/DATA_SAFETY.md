# Data safety declaration — Proplyst

Every answer below was derived by reading the app's code, not assumed. Where a claim depends on a
specific file, that file is named so it can be re-checked.

## The two questions Google asks first

**Does your app collect or share any of the required user data types?** — **Yes.**

**Is all of the user data collected by your app encrypted in transit?** — **Yes.**
Every network call goes to `https://proplyst.co.za` or `https://<project>.supabase.co`. There is no
`usesCleartextTraffic` flag and no network security config permitting cleartext; on minSdk 26+
cleartext is blocked by platform default.

**Do you provide a way for users to request that their data be deleted?** — **Yes.**
In-app: More → Account → Delete account. Web: `https://proplyst.co.za/delete-account`.

## Data types

### Personal info

| Type | Collected | Shared | Required | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Optional | App functionality, Account management |
| Email address | Yes | No | Required | App functionality, Account management |
| Phone number | Yes | No | Optional | App functionality |

Email and password are the sign-in credential (Supabase Auth). Name is the profile display name.
Phone is an optional field on an organisation member and on tenant records.

### Financial info

| Type | Collected | Shared | Required | Purpose |
|---|---|---|---|---|
| Other financial info | Yes | No | Required | App functionality |

Rent amounts, invoices, payments, expenses, budgets and utility costs — the substance of the
product. **No payment card or bank credential is collected by the Android app.** Subscription
billing happens on the web through PayFast, which the app does not embed.

### Photos and videos

| Type | Collected | Shared | Required | Purpose |
|---|---|---|---|---|
| Photos | Yes | No | Optional | App functionality |

Only images the user deliberately attaches: an expense receipt, a utility bill, maintenance
evidence. Chosen through the system camera app or the Android photo picker — the app declares no
`CAMERA`, `READ_MEDIA_IMAGES` or storage permission, so it never has ambient access to the gallery.

### Files and docs

| Type | Collected | Shared | Required | Purpose |
|---|---|---|---|---|
| Files and docs | Yes | No | Optional | App functionality |

Documents the user attaches through the system file picker.

### App info and performance / Device or other IDs

**Not collected.** There is no analytics, advertising, attribution or crash-reporting SDK in the
build — verified against `app/build.gradle.kts`: no Firebase, Crashlytics, AdMob, Sentry, Bugsnag,
AppsFlyer, Mixpanel or Facebook SDK. The dependency set is AndroidX, Compose, Hilt, Room, Coil,
Retrofit/OkHttp and `androidx.security.crypto`.

### Location, Health, Messages, Contacts, Calendar, Audio, Web browsing
**Not collected.** No corresponding permission is declared and no API is called.

## Sharing

**No data is shared with third parties** in Google's sense. Supabase (database and auth) and Render
(application hosting) are infrastructure processors acting on Proplyst's instructions, which
Google's own guidance excludes from "sharing".

## Data handling practices

- **Encrypted in transit:** Yes, HTTPS everywhere.
- **Deletion:** Users can request deletion in-app and on the web.
- **Data retention:** Accounting records are retained to meet South African tax-record obligations
  (five years) after account deletion, and no longer identify the person. Disclose this exactly —
  it matches `app/api/v1/account/delete/route.ts` and `/delete-account`.

## Security practices on the device

The session token is held in `EncryptedSharedPreferences` (`androidx.security.crypto`), and
`android:allowBackup="false"` keeps it out of Android auto-backup archives, so a token cannot be
restored onto a different device.

## Other Play declarations

| Declaration | Answer | Why |
|---|---|---|
| **Ads** | Contains no ads | No ad SDK, no ad code |
| **Target audience** | 18+ | Business software for property owners; not designed for or appealing to children |
| **Content rating** | Complete the questionnaire; expect **Everyone / PEGI 3**. No violence, sexual content, gambling, drugs or user-generated public content | Utility business app |
| **News app** | No | |
| **COVID-19 contact tracing** | No | |
| **Data safety — government ID** | No | Not collected |
| **Financial features** | **See note below** | |

### Financial features declaration
Play asks whether the app provides financial features (lending, payments, crypto, investment).
Proplyst **records** rent and expenses for a landlord's own bookkeeping. It does **not** move money,
process payments, lend, or hold funds; the Android app contains no payment SDK and no PayFast
integration. Answer: **the app does not provide financial services** — it is business
record-keeping software. If Play's questionnaire offers a "personal finance management / accounting"
sub-option, select that.
