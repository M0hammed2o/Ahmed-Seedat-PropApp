# Proplyst Smart Utilities — Client Demo (14 October 2026)

**What this is:** an **isolated DEMO deployment**, separate from production (proplyst.co.za). It uses its own
Supabase project, its own Render service and fictional data only.
- Production code, its database (migration 174) and its customers are untouched. `main` was not pushed.
- Code: GitHub branch **`demo/client-2026-10-14`**.

## Status

| Item | State |
| --- | --- |
| Code pushed (demo branch) | done — `M0hammed2o/Ahmed-Seedat-PropApp` @ `demo/client-2026-10-14` |
| Demo journey verified | done locally on a production build with the same demo data: login, dashboard, property, units and tenants, Utilities (sources, meters, alerts, charts), tariffs, live draft-charge calculation, statement PDF, municipal settings save and e-mail preview, portfolio, reports, phone layout — **all pass** |
| Hosted demo database | **waiting on you:** create the Supabase project (step 1) |
| Hosted app URL | **waiting on you:** create the Render service (step 3) |

## Step 1 — Create the demo database (≈ 3 min, Supabase dashboard)

1. Supabase → **New project**.
   - Name `proplyst-demo`, region **eu-west-1** (same as production), a strong DB password.
   - **If Supabase says this project will be charged, stop and tell me.** No paid service is set up without your say.
2. When it is ready, copy the following into a new file **`apps/admin/.env.demo.local`**. This file is git-ignored,
   and the values are never printed or committed:

```
DEMO_SUPABASE_URL=https://<demo-ref>.supabase.co
DEMO_DB_URL=<Connect → Session pooler connection string, with your DB password filled in>
DEMO_ANON_KEY=<Project Settings → API → anon public>
DEMO_SERVICE_ROLE_KEY=<Project Settings → API → service_role>
DEMO_LOGIN_EMAIL=<the address you will log in with, e.g. demo@yourdomain>
DEMO_LOGIN_PASSWORD=<12+ characters, only for the demo>
DEMO_TENANT_EMAIL=<optional second login to show the tenant view>
```

3. Tell me it's done. I then run `apps/admin/scripts/client-demo/setup-demo-db.sh`, which:
   - applies migrations 001–183 to the demo database only (it refuses the production ref);
   - creates the fictional portfolio: "DEMO — Umhlanga Ridge Property Management (fictional)", **DEMO Ridgeview
     Apartments**, 6 units, 5 fictional tenants, Unit 6 vacant.

## Step 2 — Demo auth settings (≈ 1 min, Supabase dashboard of the DEMO project)

Authentication → URL Configuration:
- **Site URL** = the Render URL from step 3;
- add `<Render URL>/**` to Redirect URLs.

Demo users are created already confirmed, so no e-mail is needed.

## Step 3 — Create the demo web service (≈ 10 min, Render dashboard)

Render → New → **Web Service** → this GitHub repo → **branch `demo/client-2026-10-14`**.
- Easiest: copy the **Build** and **Start** commands from your existing production service.
- Otherwise use:
  - **Build:** `corepack enable && pnpm install --frozen-lockfile && pnpm --filter admin build`
  - **Start:** `pnpm --filter admin start`
- Node 20.18.1.
- **Instance:**
  - Free spins down when idle: open the URL about 5 minutes before the meeting, because the first load can take
    about a minute.
  - Starter avoids that, but is a paid choice for you.
- **Auto-deploy:** off, so later pushes don't change the demo mid-meeting.
- **Memory:** the production build needed a 3 GB Node heap locally, so a 512 MB free instance may fail the build
  with "out of memory".
  - If that happens, use the same instance type as your production service (your call: it is a paid change).
  - Or add `NODE_OPTIONS=--max-old-space-size=3072` on a plan with enough memory.

**Environment variables** (Render → Environment):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | demo project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | demo anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | demo service_role key |
| `NEXT_PUBLIC_APP_URL` | the Render URL, e.g. `https://proplyst-demo.onrender.com` |
| `ADMIN_SESSION_COOKIE_SECRET` | any new random 64-char string (not production's) |
| `CRON_JOB_SECRET` | any new random string |
| `NODE_VERSION` | `20.18.1` |

Leave **unset** (this keeps the demo isolated and silent):
- payments: PayFast;
- messaging and documents: Resend, WhatsApp, Cloudmersive, Google Document AI;
- Smart Utilities: `SMART_UTILITY_AUTO_SUBMISSION_ENABLED`, `SMART_UTILITY_TENANT_STATEMENTS_ENABLED`,
  `SMART_UTILITY_CREDENTIALS_KEY`;
- `NEXT_PUBLIC_DEMO_MODE`.

E-mail falls back to a mock: nothing is sent to anyone. No scheduled cron is needed for the demo.

**Never** use production's Supabase URL or keys here.

## Step 4 — Verification (me)

When you send the URL, I run the demo journey against it:
`DEMO_BASE_URL=<url> … npx playwright test -c playwright.demo.config.ts`. I report each check.

## Presenting (suggested 15-minute path)

1. Log in → **Dashboard** (portfolio overview).
2. **Properties → DEMO Ridgeview Apartments** → Units (6) → Tenants.
3. **Utilities** tab:
   - Supply & sources: municipal grid, 12 kWp solar, 20 kWh battery, diesel generator, municipal water, borehole,
     JoJo tanks.
   - Monitoring vs billing. Hybrid registers (solar, battery, generator, borehole, tanks) are monitored, never billed.
4. **Alerts:**
   - possible night-time water flow in Unit 4 (simulated leak);
   - consumption in vacant Unit 6;
   - Unit 5 usage spike;
   - JoJo tanks low.
5. **Meters and readings:**
   - simulated daily readings over 4 months;
   - Unit 1 has manual readings with photo evidence, one verified.
6. **Utility recharges:**
   - fictional tariffs, each labelled "DEMO FICTIONAL";
   - who pays what: metered, included in rent, fixed allowance, shared split, vacant;
   - last month's charges are approved, two are on **draft** invoices;
   - **Calculate charges** for the month before, live.
7. **Utility statements:** Unit 1's approved statement → **PDF**. E-mailing is switched off.
8. **Monthly municipal readings:** settings (eThekwini, fictional account) → **Preview saved email**. Sending is never
   triggered in the demo.
9. **Utilities** (portfolio page) and **Reports**.

**Say plainly:** readings are simulated demonstration data; tariffs are fictional; no meter is physically connected in
this demo.

## Backup (if hosting is unavailable)

Run the same demo on this laptop and present from its screen:
1. Start the disposable Supabase stack (scratchpad `su-stack`).
2. Run `scripts/client-demo/provision.demo.ts` against it (already done; the data is there now).
3. Build the app with the local demo environment (all external services blank).
4. Run `next start -p 3200` and open **http://127.0.0.1:3200**.

The same 5 journey checks pass on this setup. It is reachable from this laptop only.

## Safety confirmations

- No real tenant billing, payment collection, municipal e-mail, WhatsApp or meter commands. Invoices are drafts.
- Simulated readings carry `source = simulator` and the note "Simulated demo reading"; meters show connectivity
  "simulator".
- Demo data lives only in the demo project. The provisioner refuses the production ref and any database with 50+
  organisations.
