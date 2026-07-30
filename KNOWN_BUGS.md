# Known Bugs / Limitations

## jest-expo cannot currently run in this environment (mobile unit tests written, not executing)

**Symptom:** every `apps/mobile` Jest suite (including pure-logic files with zero Expo imports, e.g. `lockStateMachine.test.ts`) fails identically at collection time:

```
TypeError: The "path" argument must be of type string. Received null
  at attemptLookup (jest-expo/src/preset/setup.js:223:31)
  ... expo/src/winter/fetch/ExpoFetchModule.ts ...
```

**Root cause (verified, not guessed):** `jest-expo`'s preset setup installs Expo's global `fetch` polyfill for every test file. Its `attemptLookup()` helper walks a captured stack-trace file path upward looking for the nearest `package.json` to locate an optional-native-module mock; that walk never finds one (leaving `modulePath = null`), so a subsequent `path.join(null, ...)` throws. Reproduced identically:

- After a full clean reinstall (`rm -rf node_modules pnpm-lock.yaml && pnpm install`) — rules out a stale/duplicate dependency tree.
- With `expo` pinned to the exact version (`56.0.5`) that `jest-expo@56.0.5` itself depends on — rules out a version-drift theory.
- Confirmed the actual file (`ExpoFetchModule.ts`) and its package's `package.json` both exist on disk at that exact resolved path (`fs.existsSync` → true when checked directly), so it is not a Windows MAX_PATH issue either (`LongPathsEnabled=1` confirmed on this machine).

This isolates the bug to `jest-expo@56.0.5`'s stack-trace-based module lookup misbehaving in this Node/Jest 29/Windows combination — an upstream tooling defect, not a defect in this project's application code.

**Impact:** `pnpm test` fails for `apps/mobile` specifically; `packages/utils`, `packages/validation`, `packages/config`, and `apps/admin` all pass cleanly and are unaffected (see WORKLOG.md for the full run).

**What still has coverage despite this:** the logic under test in the blocked mobile suites (`lockStateMachine`, `MockSubscriptionProvider`, `PropertyCard`) is plain TypeScript/React with no Expo-runtime dependency — it is written the same way the passing package-level tests are, so once this tooling issue is resolved these suites should pass without code changes.

**Unblocking steps for Mohammed:**

1. Try running `pnpm --filter mobile test` on macOS/Linux (or WSL) — this failure mode is stack-trace/path-shape specific and may be Windows-only.
2. Watch `jest-expo` releases for a fix past `56.0.5` (there was none newer as of this writing — SDK 56's own jest-expo line tops out at `56.0.5`; SDK 57's `jest-expo@57.x` requires bumping the whole Expo SDK, which is a separate decision).
3. As a workaround, running the affected suites with `expo/scripts/withScriptDefaults` disabled or a custom minimal Jest config that doesn't use the `jest-expo` preset (plain `react-native`'s preset + manual RN mocks) would sidestep this specific code path — not attempted here since it would mean re-deriving jest-expo's other RN mocks by hand, a larger change than fits Phase 1 scope.

## RLS isolation tests written, not executed (2026-07-30)

`supabase/tests/multi_tenant_isolation.test.sql` (M1/M3 org/portfolio schema) and the original `rls_isolation.test.sql` are both blocked by the same root cause as the jest-expo issue above — no local Docker/Supabase instance in this sandbox. Tracked as `RISK_REGISTER.md` R-02 (Critical) and `TASKS.md` M3's exit criteria — that's the canonical status; not duplicated in detail here.

## Structural limitations (not bugs — scope boundaries, tracked for transparency)

- RLS/policy SQL tests are written but not executed in this sandbox (no local Docker/Supabase instance available) — see DECISIONS.md and TESTING.md.
- Document upload, OCR extraction, and payment matching have interfaces + mocks only in Phase 1 (per the brief's explicit instruction not to build the full versions yet) — not a defect, a scope boundary.
- Push notification delivery, reminders scheduling, and data export are designed but not implemented.
