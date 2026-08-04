import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { branding } from '@propvault/config';
import { ThemeProvider } from 'next-themes';
import './globals.css';

// Self-hosted via next/font (downloaded at build time, served from this origin) -- never an
// external Google Fonts CDN request at runtime, which would need a CSP script-src/style-src
// exception (the exact class of external-resource issue already fixed this session for
// hydration). CSS variables feed tailwind.config.ts's fontFamily.display/sans.
const displayFont = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display', weight: ['600', '700', '800'] });
const bodyFont = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: `${branding.productName} Admin`,
  description: 'PropVault SaaS operations dashboard',
};

/**
 * Real bug found and fixed 2026-08-02 (UI_REDESIGN_PLAN.md, DECISIONS.md): `tailwind.config.ts`
 * has always used `darkMode: 'class'`, which requires a `.dark` class on an ancestor element --
 * nothing in this codebase ever set one. Every `dark:` utility class written across every module
 * this session was correct and completely unreachable; dark mode has never actually activated in
 * production. `next-themes` (attribute="class", matching the existing Tailwind strategy exactly --
 * no need to touch a single already-written `dark:` class anywhere) fixes this and adds the
 * System/Light/Dark toggle `DESIGN_SYSTEM.md` already specified but never had an implementation.
 * `nonce` is read from `proxy.ts`'s per-request CSP nonce (`x-nonce` header) so next-themes' own
 * small inline no-FOUC script isn't blocked by the same CSP that broke hydration entirely until
 * the previous fix.
 *
 * `defaultTheme` changed "system" -> "light" 2026-08-04 (Lovable-adoption batch,
 * UI_INTEGRATION_PLAN.md): Lovable's own shell always defaults to light and explicitly must not
 * follow OS preference for a first-time Owner PWA visitor. A perfectly scoped version of this
 * (Owner PWA only, Super Admin/Tenant Portal/public pages keep following system) would need
 * `ThemeProvider` moved out of this single true-root layout into each of the three route groups'
 * own layouts separately (next-themes' no-FOUC mechanism needs to be the only provider in a given
 * request's tree to avoid a real flash-of-wrong-theme risk) -- a structural change to files
 * outside this batch's scope (shell/dashboard/properties/property-detail), not attempted here.
 * Applied globally instead: every portal now defaults to light, not just the Owner PWA. Dark mode
 * remains fully user-selectable everywhere via the header's theme toggle, unaffected by this
 * change. Documented as a real, disclosed scope-exceeding side effect, not a silent one.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem nonce={nonce}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
