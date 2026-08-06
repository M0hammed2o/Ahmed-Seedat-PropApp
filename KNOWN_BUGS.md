# Known Bugs / Limitations

## ~~jest-expo cannot currently run in this environment~~ — FIXED 2026-07-30, root cause was not what was previously documented

**Previous diagnosis (2026-07-21) was wrong on the specifics, right that it was upstream.** It concluded "Windows MAX_PATH issue... ruled out" and left the failure attributed vaguely to "jest-expo's stack-trace-based module lookup misbehaving in this Node/Jest 29/Windows combination." That was never fully traced to an actual line of code — corrected here with the real, empirically-confirmed cause.

**Symptom (as before):** every `apps/mobile` Jest suite failed identically at collection time with `TypeError: The "path" argument must be of type string. Received null` inside `jest-expo`'s `attemptLookup()`.

**Actual root cause (traced by instrumenting the failing code path directly, not inferred):** `attemptLookup()` uses `stacktrace-js` → `error-stack-parser@2.1.4` to parse a V8 stack trace line and recover the source file's path. `error-stack-parser`'s `extractLocation()` does:

```js
var parts = regExp.exec(urlLike.replace(/[()]/g, ''));
```

This strips **every** literal parenthesis from the location string — not just the outer `(file:line:col)` wrapper V8 adds, but any parentheses that happen to be part of the real file path too. This repository's own working directory is named `PropValt (Property App)` — a directory name that itself contains parentheses. Debug instrumentation confirmed the corrupted value directly: the parsed path came back as `...\PropValt Property App\node_modules\...\ExpoFetchModule.ts` (the literal string `"(Property App)"` silently mangled to `"Property App"`), which does not exist on disk, so the upward `package.json` search in `attemptLookup()` never finds anything, `modulePath` stays `null`, and `path.join(null, ...)` throws.

**This is a genuine upstream bug, confirmed still present in the latest published release** (checked `error-stack-parser@3.0.0`, the newest version on npm as of this check — same unfixed line). It is **not** Windows-specific, **not** a Node-version issue, **not** a Jest-config issue, **not** missing env vars, and **not** incorrect mocks — it reproduces on any OS, for any project checked out into a directory whose path contains literal parentheses.

**Fix applied:** a `pnpm patch` (`patches/error-stack-parser.patch`, registered in root `package.json`'s `pnpm.patchedDependencies`, applies automatically on every `pnpm install` — including CI, including any other machine that clones this repo) correcting `extractLocation` to strip only a leading `(` and trailing `)` — the actual V8-added wrapper — rather than every parenthesis in the string:

```js
var parts = regExp.exec(urlLike.replace(/^\(|\)$/g, ''));
```

**Verified fixed, not just patched-and-assumed-working:** ran `pnpm --filter mobile test` after the patch — all 3 suites pass (12/12 tests). Ran `pnpm test` at the repo root — all 5 test tasks pass across all 7 workspaces (`packages/config`, `packages/utils`, `packages/validation`, `admin`, `mobile`) — the first time this project has been fully green.

**Remaining limitation:** none functionally — the suites run and pass. The only residual note is that this patch is scoped to `error-stack-parser@2.1.4` specifically (via pnpm's version-keyed patch mechanism); if a future dependency bump changes the resolved version, `pnpm install` will report the patch no longer applies (a loud failure, not a silent gap) and the patch file will need a matching version bump, trivial given the fix is two characters of regex.

## RLS isolation tests — execution status (2026-07-30)

`supabase/tests/multi_tenant_isolation.test.sql` and `rls_isolation.test.sql`: Docker was re-verified as actually available in this environment (`docker ps` succeeds) — the "no local Docker/Supabase instance" assumption carried in `RISK_REGISTER.md`/`TASKS.md` since the PropVault era was itself never re-checked and turned out to be stale. `supabase start`/`supabase test db` execution status is being verified now — see `WORKLOG.md`/`RISK_REGISTER.md` R-02 for the current, up-to-date result rather than duplicating a status here that will go stale.

## Structural limitations (not bugs — scope boundaries, tracked for transparency)

- RLS/policy SQL tests are written but not executed in this sandbox (no local Docker/Supabase instance available) — see DECISIONS.md and TESTING.md.
- Document upload, OCR extraction, and payment matching have interfaces + mocks only in Phase 1 (per the brief's explicit instruction not to build the full versions yet) — not a defect, a scope boundary.
- Push notification delivery, reminders scheduling, and data export are designed but not implemented.
