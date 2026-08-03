# UI Integration Plan — Lovable Donor Project

**Branch:** `propertyvault/lovable-ui-integration` · **Source:** `reference/lovable-ui-reference/propertyvault-essence-main`

## Audit summary

| # | Question | Finding |
|---|---|---|
| 1 | Framework | TanStack Start (React 19) + Vite. PropertyVault: Next.js 16 App Router. **Not runtime-compatible** — JSX/Tailwind markup is hand-ported, the router/framework is not. |
| 2 | Routing | TanStack file-based router (`src/routes/**`), client-side loaders. PropertyVault: Next.js App Router, Server Components, real Supabase queries. Kept as-is — only the visual layer is ported into existing route files. |
| 3 | Styling | Tailwind v4, CSS-first `@theme inline` + OKLCH custom properties (`src/styles.css`). PropertyVault: Tailwind v3.4, JS config (`tailwind.config.ts` + `packages/ui/src/tokens.ts`). Already converted OKLCH→hex in the 2026-08-03 design-foundation pass (`599d7bb`) — token **names** differ (`--color-primary` vs `light.accent`) but the semantic set is equivalent. No two competing systems: PropertyVault's existing token file is the single source of truth; any gap (e.g. `info` semantic colour, `chart-2`/`chart-5`) gets added there, never as a parallel file. |
| 4 | Component library | shadcn/ui generated primitives over Radix (`src/components/ui/*`, 46 files, all MIT). PropertyVault has **zero** Radix dependencies today — hand-rolled components throughout. Adopting the full 46-primitive set is unjustified for this batch; only `dropdown-menu` and `popover` are pulled in (needed for the shell's user menu / notifications), each a small, actively-maintained, React-19-compatible MIT package. |
| 5 | Icons | `lucide-react`. PropertyVault already depends on `lucide-react@^1.28.0` — no new dependency. |
| 6 | Charts | `recharts@^2.15`. PropertyVault already depends on `recharts@^3.10.1` (added in the dashboard batch) — API used (Area/Line/Pie/Tooltip/ResponsiveContainer) is stable across both majors, no downgrade needed. |
| 7 | Animation deps | `tw-animate-css` (Tailwind v4 plugin). Not installed — PropertyVault already has its own `animate-rise` keyframe ported into `tailwind.config.ts`. |
| 8 | State management | None — `@tanstack/react-query` is wired but every page reads static arrays from `lib/data.ts`. Nothing to port; PropertyVault's real Server-Component + Supabase pattern is already the correct architecture and is preserved untouched. |
| 9 | Mock data location | `src/lib/data.ts` (single file, ~350 lines, every page imports from it). Never copied as data — used only to understand shape/structure, and only where PropertyVault has a real equivalent field. |
| 10 | Placeholder API calls | None found — fully static, no fetch layer to strip. |
| 11 | Assets/fonts | Google Fonts CDN `<link>` tags (Inter + Plus Jakarta Sans) — **not reused**, PropertyVault already self-hosts both via `next/font/google` (avoids the CSP/external-request issue found earlier this session). Property photos are hotlinked Unsplash URLs — **not reused** (no rights, not real properties, external request). Generic Lovable `favicon.ico` — **not reused**. |
| 12 | Licence/attribution | No `LICENSE`/`NOTICE` file in the reference project. `package.json` dependencies are exclusively permissive OSS (MIT: Radix, shadcn-generated code, Tailwind, recharts, react-hook-form, zod, class-variance-authority, tailwind-merge; ISC: lucide-react). The project's own `README.md` embeds the *original design brief the user gave to Lovable* to generate "PropertyVault" — confirms this is commissioned work product for this exact project, not a scraped third-party product; all meta/title tags already say "PropertyVault". **Low copyright risk** for code adaptation. Excluded regardless: `.lovable/`, `lib/lovable-error-reporting.ts`, `lib/error-capture.ts` (Lovable platform telemetry), the README's "Build with Lovable" section, the generic favicon. |
| 13 | Safe to adapt directly | `src/components/kit.tsx` (`PageHeader`, `Panel`, `Pill`, `Meter`, `Avatar`, `Delta`, `statusTone`) — small, dependency-free, near-identical to what PropertyVault already hand-built for `PageHeader`/`Panel`; `Pill`/`Meter`/`Avatar`/`Delta` are net-new and genuinely useful. `src/components/app-shell.tsx` — strong shell (grouped nav, breadcrumbs, search, notifications popover, user menu, mobile drawer) PropertyVault's current shell lacks entirely on desktop (no header row at all). Property/Unit/Tenant page **visual structure** (card grids, meters, pills, filter bars, stat rows). |
| 14 | Needs adaptation | Router calls (`Link to=`/`useRouterState`) → Next.js (`Link href=`/`usePathname`). Nav items → PropertyVault's real routes, filtered by the authenticated user's role (Lovable's is static). All KPIs/table rows → real Supabase-backed data via existing loaders, Demo Mode fixtures only in demo mode. `dropdown-menu.tsx`/`popover.tsx` → copied from shadcn source (Radix wrapper, MIT) since PropertyVault has no equivalent yet. |
| 15 | Do not import | Everything in finding #14's mock-data list (`portfolioValue`, property `value`/valuation, tenant `score`, the "Vault Intelligence" fabricated-AI-insight banner, SaaS MRR/health data) — no PropertyVault field backs any of these; per this instruction's own "do not invent portfolio values / investment returns / market valuations" rule they are dropped, not stubbed. `routes/admin`, `routes/mobile`, `routes/portal`, `routes/reports`, `routes/accounting`, `routes/maintenance`, `routes/documents` — out of scope for this checkpoint, deferred to their place in the module order. Tenants page's master-detail single-pane pattern — see decision below. |

## Deliberate adaptation decisions (not 1:1 ports)

- **Tenants list**: Lovable combines list+detail into one client-side master/detail pane (`useState` selection, no deep link per tenant). PropertyVault's tenant detail is a real server-rendered route (`/tenants/[id]`, deep-linkable, RLS-scoped query). Collapsing these would break deep-linking and force a client-side data-merge Lovable never needed (its "detail" is just a filter over the same static array). **Kept as two routes**; only the visual language (avatar chips, pills, list row density) is adapted onto the existing list page.
- **Property detail**: Lovable nests Units/Tenants/Documents/Maintenance/Accounting/Reports as *tabs inside one page*. In PropertyVault these are separate real modules with their own routes, permissions and data shapes (Documents has OCR review, Accounting has ledger posting, etc.) — collapsing them into tabs would be a navigation/IA change, not a visual one. **Kept as the existing stacked-sections layout**; only the hero header (image/placeholder + gradient + stat strip) is adapted in.
- **Properties list**: Lovable's card-grid *is* adopted directly as the new default view — it's a genuine upgrade over the current `AdminDataTable` row-table for a "portfolio" concept, real `imagePath` field already exists on `Property` (currently always `null` in fixtures, handled with a placeholder, never a hotlinked stock photo) and every stat shown is real. Grid/list toggle kept (cheap, reuses the same data).
- **Units list**: adopted directly — status-tab counts + dense table + search maps cleanly onto the existing real `units` query, no IA change.

## Component/page mapping (checkpoint batch)

| Source (Lovable) | PropertyVault destination | Copy/Adapt/Rebuild | Data source | Permissions | Verification |
|---|---|---|---|---|---|
| `src/styles.css` tokens | `packages/ui/src/tokens.ts`, `tailwind.config.ts` | Adapt (already mostly done; fill gaps: `info` semantic, `chart-2`/`chart-5`) | n/a | n/a | visual diff light/dark |
| `src/components/kit.tsx` | `apps/admin/components/ui/{Pill,Meter,Avatar,Delta}.tsx` (`PageHeader`/`Panel` already exist, left as-is) | Adapt | n/a | n/a | unit test per component |
| `src/components/app-shell.tsx` | `apps/admin/components/shell/AppShell.tsx` (rewritten) | Adapt | real session (`resolvePortalSession`), real nav per role | role-filtered nav items, no inaccessible links rendered | real-browser, all 3 route groups, light/dark, mobile drawer |
| `routes/index.tsx` (Dashboard) | `apps/admin/app/(dashboard)/dashboard/page.tsx` | Adapt | existing `loadData()` (real Supabase) | existing | real-browser, both themes |
| `routes/properties/index.tsx` | `apps/admin/app/(dashboard)/properties/page.tsx` | Adapt (card grid + list toggle) | existing property query | existing (`canCreate`) | real-browser, empty-state (no `imagePath`) |
| `routes/properties/$propertyId.tsx` | `apps/admin/app/(dashboard)/properties/[id]/page.tsx` | Adapt (hero header only) | existing query | existing | real-browser |
| `routes/units/index.tsx` | `apps/admin/app/(dashboard)/units/page.tsx` | Adapt (status tabs + dense table) | existing units query | existing | real-browser |
| `routes/tenants/index.tsx` | `apps/admin/app/(dashboard)/tenants/page.tsx` | Adapt (avatar/pill list rows only, no master-detail merge) | existing tenants query | existing (`canCreate`) | real-browser |

Dependencies added: `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover` (MIT, small, React-19-compatible, used only by the shell's user menu/notifications). Nothing else from the Lovable `package.json` is installed — no TanStack Router/Start/Query, no `sonner`, no `vaul`, no `cmdk`, no `react-hook-form`/`zod` duplicates (PropertyVault already has its own).

## Out of scope for this checkpoint

Documents, Maintenance, Inspections, Accounting, Owner Statements, Tax Pack, Payments, Reports, Notifications, Announcements, Applications, Tenant Portal, Auth/onboarding, Staff workflow, Super Admin — deferred to their place in the 19-step module order after this checkpoint is approved.
