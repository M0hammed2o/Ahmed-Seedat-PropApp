// Vitest stub for the `server-only` package (apps/admin/vitest.config.ts's `resolve.alias`).
//
// `server-only`'s real module unconditionally throws -- Next.js's webpack build is what
// substitutes a no-op in the server bundle and leaves the throw in place for an accidental
// client bundle, which is the whole point of the package. Vitest has no such bundler-level
// substitution, so importing any apps/admin/lib file that starts with `import 'server-only'`
// (the established pattern for every server-side lib file in this app) fails immediately under
// a plain Node import resolution, unrelated to the code being tested. This file is an
// intentionally empty stub `server-only` aliases to for tests only -- it does not weaken the
// real guard, which still throws normally in the actual Next.js client bundle.
export {};
