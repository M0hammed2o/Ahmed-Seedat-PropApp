# Demo Run Guide

Exact Windows + VS Code steps to run PropertyVault's PWA locally in Demo Mode for a live
presentation. Every command below was actually run in this environment on 2026-08-03 while
preparing the demo — nothing here is invented. If a step's output differs from what's shown,
stop and check the Troubleshooting section before continuing.

## 1. Required software (confirmed installed in this environment)

- **Windows 10**, VS Code
- **Node.js** >= 20 (root `package.json` `engines.node`)
- **pnpm** 9.15.0 (`packageManager` field in root `package.json`) — installed via `npm install -g pnpm` if missing
- **Docker Desktop** — required to run local Supabase (Postgres, Auth, Storage, Studio all run as Docker containers)
- **Google Chrome** — the app itself is browser-agnostic, but Chrome is what was used to verify tonight's build

## 2. Repository path and branch

```
Path:   C:\Users\junsm\Downloads\PropValt (Property App)
Branch: propertyvault/lovable-ui-integration
```

## 3. Open the VS Code terminal

1. Open VS Code.
2. `File > Open Folder…` → select `C:\Users\junsm\Downloads\PropValt (Property App)` (if not already open).
3. Open a terminal: **Terminal menu → New Terminal**, or the shortcut `` Ctrl+` ``.
4. Confirm you're on the right branch:
   ```
   git branch --show-current
   ```
   Should print `propertyvault/lovable-ui-integration`. If it prints something else:
   ```
   git checkout propertyvault/lovable-ui-integration
   ```

## 4. Start Docker Desktop

1. Open **Docker Desktop** from the Start menu (or it may already be running — check the system tray whale icon).
2. Wait until the Docker Desktop window shows "Engine running" (usually 10-30 seconds after launch).
3. Verify from the VS Code terminal:
   ```
   docker info
   ```
   If this prints engine details (not a connection error), Docker is ready.

## 5. Start local Supabase

```
npx supabase start
```

First run downloads several Docker images and can take a few minutes; subsequent runs are fast
(a few seconds) since the containers are cached. If Supabase was already running from an earlier
session, this command is safe to run again — it will just report the existing status.

## 6. Confirm Supabase is healthy

```
npx supabase status
```

Confirms with a JSON block containing `API_URL`, `DB_URL`, `STUDIO_URL`, etc. As a second check,
confirm the containers are actually healthy:

```
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Look for `supabase_db_propvault`, `supabase_auth_propvault`, `supabase_storage_propvault`,
`supabase_kong_propvault` all showing `Up ... (healthy)`. (`supabase_analytics_propvault`,
`supabase_vector_propvault`, and `supabase_pooler_propvault` are optional containers not needed
for the demo — safe to ignore if `supabase status` lists them as stopped.)

**For the demonstration itself you do not need to reset the database** — Demo Mode (next section)
never touches Supabase at all; it runs entirely on in-memory fixture data. Supabase only needs to
be running because the Next.js production server was built against a local Supabase URL and a few
non-demo code paths (e.g. the `/activate` tenant-activation landing page) make a real, harmless
`auth.getUser()` call to it.

## 7. Enable Demo Mode

Open `apps\admin\.env.local` in VS Code and confirm these two lines both say `true`:

```
NEXT_PUBLIC_DEMO_MODE=true
ALLOW_DEMO_MODE=true
```

If either says `false`, change it to `true` and save. (This file is git-ignored — your local
edits never get committed.)

**Why both flags**: this is a deliberate double-gate (`SECURITY.md` — the flag that closed the
old demo-mode auth-bypass risk). Demo Mode only activates when _both_ are `true`; either alone
does nothing. `ALLOW_DEMO_MODE` must never be set this way outside a local `.env.local` file.

## 8. Install dependencies (only if needed)

Skip this if `node_modules` already exists at the repo root (it does as of tonight's session).
If you get a "command not found" or module-resolution error anywhere below, run once from the
repo root:

```
pnpm install
```

## 9. Build the PWA (production-style run)

```
cd apps\admin
npx next build
```

Should end with `✓ Compiled successfully`. This step must be re-run any time you edit a file
under `apps/admin` — the production server (next step) only serves what was last built.

## 10. Start the PWA on port 3090

Still inside `apps\admin`:

```
npx next start -p 3090
```

Wait for:

```
▲ Next.js 16.2.11
- Local:         http://localhost:3090
✓ Ready in ...ms
```

**Leave this terminal window open and running** for the entire demonstration — closing it or
pressing `Ctrl+C` stops the server.

## 11. Open the app

Browser URL:

```
http://localhost:3090/dashboard
```

You should see the Owner/Staff dashboard with a blue **"Demo mode"** badge under the
PropertyVault logo in the top-left of the sidebar. If you land somewhere else or see a login
screen, see Troubleshooting below.

## 12. Stop the PWA (after the demo)

In the terminal running `next start`, press:

```
Ctrl+C
```

If that terminal was closed accidentally instead, find and stop it another way:

```
netstat -ano | findstr :3090
taskkill /PID <the_PID_from_above> /F
```

## 13. Stop Supabase

```
npx supabase stop
```

(Optional — it's fine to leave Supabase running between sessions; this just frees the Docker
containers if you want to shut everything down cleanly.)

## 14. Restore live-mode environment values

If you want `apps/admin` to go back to talking to a real (non-demo) Supabase session afterward,
edit `apps\admin\.env.local` again:

```
NEXT_PUBLIC_DEMO_MODE=false
ALLOW_DEMO_MODE=false
```

Then repeat steps 9-10 (rebuild, restart) for the change to take effect.

## Troubleshooting

**`docker info` fails / "cannot connect to the Docker daemon"**
Docker Desktop isn't running yet, or is still starting up. Open Docker Desktop, wait for the whale
icon in the system tray to stop animating, then retry.

**`npx supabase start` hangs or fails with a port-in-use error**
Something else on the machine is using ports `54321-54324`. Check what's running:

```
netstat -ano | findstr :54321
```

If it's a stale Supabase instance from a previous session, `npx supabase stop` first, then
`npx supabase start` again.

**`next start` says "Port 3090 is already in use"**
Something else is bound to 3090 (possibly a leftover server from an earlier attempt tonight):

```
netstat -ano | findstr :3090
taskkill /PID <the_PID> /F
```

Then retry `npx next start -p 3090`. Alternatively, use a different port: `npx next start -p 3091`
and adjust the URL you open accordingly.

**The page loads but there's no "Demo mode" badge, and it looks like a login screen**
Demo Mode isn't actually active. Confirm both flags in `apps\admin\.env.local` are `true`, then
rebuild (step 9) and restart (step 10) — Next.js reads environment variables at build time for
`NEXT_PUBLIC_*` variables, so editing `.env.local` alone without rebuilding has no effect on an
already-built app.

**Sidebar shows a narrow icon-only column with no text labels, and no visible "Demo mode" badge**
This is the app's own responsive design working correctly, not a bug — the full sidebar (with the
Demo mode badge) only renders at browser widths ≥ 1280px. Maximize the browser window or widen it;
on a typical laptop screen at full width this is not an issue.

**Console shows one repeated warning: "A form field element should have an id or name attribute"**
Known, pre-existing, cosmetic-only issue on several list pages' search boxes (missing `name`/`id`
on an `<input>` — affects browser autofill hints only). Does not affect functionality and is safe
to ignore during the demo.

**One console/network message referencing a `favicon`**
Should no longer occur — fixed the same day this guide was written (`apps/admin/app/icon.tsx`
added). If you still see a stray favicon-related network message after all the steps above, it is
harmless and not a sign of a broken demo.

**Any page shows a real error, blank screen, or a red Next.js error overlay**
Note the exact URL and the error text, then check the terminal running `next start` for a stack
trace. This did not occur during tonight's full-page verification pass (`PWA_V1_COMPLETION_PLAN.md`
/ `WORKLOG.md` 2026-08-03) — if it happens live, it indicates something changed since, not a
known, accepted gap.

**Account Settings page says "Account settings require a live Supabase project"**
Expected, not a bug — Account Settings (identity linking, profile fields) is one of a small number
of screens that intentionally only works in live mode. Describe it narratively in the demo rather
than clicking into it (see `DEMO_PRESENTATION_SCRIPT.md`).

**`/activate` (tenant activation link) always shows "Sign in / Create an account", never a
completed activation**
Expected in Demo Mode — this one page talks to the real (local) Supabase Auth client rather than
using fixture data, so it always shows the real signed-out state. It's a legitimate, working
screen (this is genuinely what a brand-new tenant would see first), just not click-through-able
to a completed state without a real sign-up. See `DEMO_PRESENTATION_SCRIPT.md` §5 for how to
present it.
