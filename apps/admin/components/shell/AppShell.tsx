'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

// DESIGN_SYSTEM.md "Responsive rules": persistent+expanded >=lg, icon-only >=md, overlay drawer
// below md -- never built until now (UI_REDESIGN_PLAN.md 2026-08-02). One shared shell for all
// three route groups ((dashboard)/(super-admin)/(tenant)) rather than three independently
// drifting copies of the same sidebar markup -- each layout supplies its own nav content, the
// responsive/collapse/theme-toggle mechanics live here once. The md->lg icon-rail-to-full
// transition is pure CSS (Tailwind breakpoints hiding/showing label text) -- only the mobile
// drawer's open/closed state needs JS.
//
// `icon` is a rendered element (`<LayoutDashboard size={17} .../>`), not a component reference --
// each layout.tsx is a Server Component, and passing a component *reference* as a prop into this
// Client Component isn't legal across the RSC boundary (only serializable data and already-
// rendered elements cross it; a raw function reference produces a real runtime 500, caught during
// this pass's own verification, not assumed away).
export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export interface AppShellProps {
  productLabel: string;
  navSections: NavSection[];
  identityLine?: string;
  demoBadge?: boolean;
  children: React.ReactNode;
}

export function AppShell({ productLabel, navSections, identityLine, demoBadge, children }: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  function NavContent({ showLabels, onNavigate }: { showLabels: boolean; onNavigate?: () => void }) {
    return (
      <nav className="mt-6 flex flex-1 flex-col gap-5 overflow-y-auto">
        {navSections.map((section, i) => (
          <div key={section.label ?? i} className="flex flex-col gap-0.5">
            {section.label && showLabels ? (
              <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-light-textMuted dark:text-dark-textMuted">
                {section.label}
              </p>
            ) : null}
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={item.label}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    !showLabels ? 'justify-center' : ''
                  } ${
                    active
                      ? 'bg-light-accent/10 text-light-accent dark:bg-dark-accent/10 dark:text-dark-accent'
                      : 'text-light-textSecondary hover:bg-light-surface hover:text-light-textPrimary dark:text-dark-textSecondary dark:hover:bg-dark-surface dark:hover:text-dark-textPrimary'
                  }`}
                >
                  {item.icon}
                  {showLabels ? <span>{item.label}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar: <md only -- the icon rail takes over from md upward. print:hidden on
          every chrome element below (top bar, both sidebars) -- lets any (dashboard) page double
          as a clean print/save-as-PDF view (e.g. Owner Statements) with zero extra route needed. */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-light-border bg-light-surfaceRaised px-4 md:hidden print:hidden dark:border-dark-border dark:bg-dark-surfaceRaised">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setDrawerOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-light-textSecondary hover:bg-light-surface dark:text-dark-textSecondary dark:hover:bg-dark-surface"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">{productLabel}</p>
      </div>

      {/* Mobile drawer overlay: <md only, open on demand, full labels always shown */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-light-textPrimary/40 dark:bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-light-surfaceRaised px-4 py-5 dark:bg-dark-surfaceRaised">
            <div className="flex items-center justify-between px-1">
              <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">{productLabel}</p>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-light-textSecondary hover:bg-light-surface dark:text-dark-textSecondary dark:hover:bg-dark-surface"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {demoBadge ? <DemoBadge /> : null}
            <NavContent showLabels onNavigate={() => setDrawerOpen(false)} />
            <ShellFooter identityLine={identityLine} showLabels />
          </aside>
        </div>
      ) : null}

      {/* Desktop: icon-only rail md-lg, full sidebar >=lg. Two separately-rendered <aside>s (one
          hidden at each breakpoint) rather than one dynamically relabeled sidebar -- avoids a
          content flash/reflow as labels would otherwise mount and unmount at the breakpoint. */}
      <aside className="sticky top-0 hidden h-screen w-[68px] shrink-0 flex-col items-center border-r border-light-border bg-light-surfaceRaised py-5 md:flex lg:hidden print:hidden dark:border-dark-border dark:bg-dark-surfaceRaised">
        <NavContent showLabels={false} />
        <ShellFooter identityLine={identityLine} showLabels={false} />
      </aside>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-light-border bg-light-surfaceRaised px-4 py-5 lg:flex print:hidden dark:border-dark-border dark:bg-dark-surfaceRaised">
        <p className="px-1 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">{productLabel}</p>
        {demoBadge ? <DemoBadge /> : null}
        <NavContent showLabels onNavigate={undefined} />
        <ShellFooter identityLine={identityLine} showLabels />
      </aside>

      <main className="min-w-0 flex-1 px-5 py-6 pt-20 md:px-8 md:py-8 md:pt-8 print:p-0">{children}</main>
    </div>
  );
}

function DemoBadge() {
  return (
    <span className="mx-1 mt-2 inline-flex w-fit items-center rounded-full border border-light-accent px-2 py-0.5 text-[10px] font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
      Demo mode
    </span>
  );
}

function ShellFooter({ identityLine, showLabels }: { identityLine?: string; showLabels: boolean }) {
  if (!showLabels) {
    // Rail mode: still show the theme toggle (icon buttons work fine narrow), skip the identity
    // line (would truncate illegibly at 68px).
    return (
      <div className="mt-auto flex flex-col items-center gap-3 border-t border-light-border pt-4 dark:border-dark-border">
        <ThemeToggle compact />
      </div>
    );
  }
  return (
    <div className="mt-auto flex flex-col gap-3 border-t border-light-border pt-4 dark:border-dark-border">
      <ThemeToggle />
      {identityLine ? (
        <p className="px-1 text-xs text-light-textMuted dark:text-dark-textMuted">{identityLine}</p>
      ) : null}
    </div>
  );
}
