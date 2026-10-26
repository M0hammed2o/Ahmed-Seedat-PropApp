# Production deployment plan — Cemetery Management + demo year (prepared 2026-10-26)

**Status: awaiting owner approval. Nothing below has been run against production.**

## What changes

| # | Change | Target | Blast radius |
| --- | --- | --- | --- |
| 1 | Migration **184** (Cemetery Management) | Supabase `radqoboichldiucydrgy` | Additive: new tables, functions, policies and one new column (`organizations.cemetery_enabled`, default false). All 16 existing organisations stay off. No existing row, policy or function changes. |
| 2 | Migration **185** (invoice numbering) | same | Moves `invoice_number_seq` from 3 to ≥ 2296, and makes `set_invoice_number()` skip taken numbers. The next rent invoice of **any** organisation is numbered INV-002297 onwards (today it would fail). No existing invoice changes. |
| 3 | Code: `feature/cemetery-management` fast-forwarded into `main` and pushed | GitHub → Render auto-deploy (`proplyst.co.za`) | Cemetery pages, navigation and dashboard panel appear only for organisations with the module on. Existing dashboards gain "Last 12 months", month and year filters and a 12-month chart; Reports gains a 12-month table. |
| 4 | Demo organisation and its year of history (provisioner) | production database | INSERT and UPDATE rows of the new demo organisation only. Also: one new auth user (`cemetery.demo@proplyst.co.za`, pre-confirmed), its profile and consent rows, and an active Business subscription with no payment method. No e-mail, WhatsApp or payment request is sent. |
| 5 | Live verification as the demo login | `proplyst.co.za` | Read-only checks, plus a reservation that is made and released on one demo grave site (two history rows). Refusal checks (double sale, overpayment) write nothing. Optionally, one live test sale with a payment and receipt (see below). |

## Prerequisites (checked 2026-10-26, read-only)

- **Backup:** newest daily physical backup completed `2026-10-26T00:49:17Z`, 8 daily backups retained. PITR is off.
- **Production state:**
  - migration head `20260101000183`;
  - 16 organisations;
  - no `cemetery*` tables, types or functions (no name clash);
  - demo login and demo organisation absent.
- **Rehearsal on a production-data copy (disposable stack):**
  - 184 + 185 apply;
  - the 184 rollback restores the pre-184 schema exactly (the only difference is 185's intended function change);
  - pgTAP passes 68 + 3 assertions;
  - the provisioner runs and reconciles, and a second run creates nothing.
- **CI (`staging/cemetery-management`):** see the run linked in the WORKLOG entry.
- **Permissions:** the access token in this checkout can query and push migrations to the project (used read-only so
  far). Pushing `main` deploys through Render's auto-deploy. There is no Render API key on this machine: the deploy is
  detected by a route changing status.

## Steps (each step stops on failure)

1. Re-check the backup (Management API) and take the read-only data fingerprint (`fingerprint.sql`: 18 business
   tables of existing organisations).
2. `supabase link --project-ref radqoboichldiucydrgy` in the worktree, then `supabase db push --linked --dry-run`. It
   must list exactly 184 and 185.
3. `supabase db push --linked`, then verify:
   - head is 185;
   - `cemetery_enabled` is false for all 16 organisations;
   - the sequence is at least 2296;
   - the fingerprint is unchanged (organizations are compared without the new column).
4. Fast-forward `main` to the feature branch, then `git push origin main`.
5. Wait for the new build. `POST /api/v1/cemetery/purchasers` changes from 404 to 401/403. Public pages `/`, `/login`,
   `/privacy` and `/terms` must return 200.
6. Run the provisioner against production:

   ```
   CEMDEMO_CONFIRM_PRODUCTION=yes CEMDEMO_CREDENTIALS_FILE=<repo>/.env.cemetery-demo.local …
   ```

   Then verify:
   - it reconciles;
   - it prints totals;
   - a second run creates nothing;
   - the fingerprint for other organisations is unchanged;
   - `email_messages` and `whatsapp_messages` counts are unchanged.
7. Live browser verification (`e2e-demo/cemetery-live.spec.ts` and the demo-year checks) as the demo login, desktop
   and phone. Also check that the marketing demo organisation's dashboard and reports still load.

## Rollback

| Change | Rollback |
| --- | --- |
| Code | Redeploy `0e0df7f` in Render, or push a revert to `main`. The old build runs on the new schema. |
| 184 | Switch the module off: `update organizations set cemetery_enabled = false …`. The schema drop is `supabase/rollback/20260101000184_cemetery_down.sql`; it refuses while customer cemetery data exists. |
| 185 | None needed. Forward-only, and correct for all organisations. |
| Demo org | Archive it (`status = 'archived'`, module off) and ban the login. It cannot be hard-deleted, because `audit_events` is immutable. |

## Decisions needed from the owner

1. **Approve production database changes 184 + 185** (steps 2–3).
2. **Approve the code deploy** to `main` / Render (steps 4–5).
3. **Approve creating the demo login, organisation and year of data** in production (step 6).
4. **Live test sale (optional).**
   - If approved: one fictional sale with a deposit and a payment on an available demo site, cancelled again
     afterwards. It stays visible in the register and history as a cancelled sale.
   - If not: live write checks are limited to a reservation and its release; the full sale workflow is covered by CI.
