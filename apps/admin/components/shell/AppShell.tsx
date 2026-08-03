'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Avatar } from '@/components/ui/Avatar';
import { Pill } from '@/components/ui/Pill';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';

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

export interface HeaderNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface AccountMenuLink {
  href: string;
  label: string;
}

export interface AppShellProps {
  productLabel: string;
  navSections: NavSection[];
  identityLine?: string;
  demoBadge?: boolean;
  notifications?: HeaderNotification[];
  notificationsHref?: string;
  accountMenuLinks?: AccountMenuLink[];
  /** Persistent, non-dismissible strip rendered above everything else, e.g. SupportModeBanner
   *  (SECURITY.md: "banner-visible, never silent... a hard requirement, not a nice-to-have"). */
  banner?: ReactNode;
  children: React.ReactNode;
}

// Adapted from reference/lovable-ui-reference's app-shell.tsx header row (UI_INTEGRATION_PLAN.md)
// -- breadcrumbs, notifications, and a user menu, none of which this shell had on desktop before.
// Global search was deliberately NOT ported: no search API exists over properties/tenants/invoices
// yet, and a search box that doesn't search would be a broken promise, not a visual upgrade.
function Breadcrumbs({ pathname }: { pathname: string }) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div className="hidden min-w-0 items-center gap-1.5 text-[13px] text-light-textMuted lg:flex dark:text-dark-textMuted">
      <Link href="/dashboard" className="transition-colors hover:text-light-textPrimary dark:hover:text-dark-textPrimary">
        Home
      </Link>
      {parts.map((p, i) => (
        <span key={p + i} className="flex min-w-0 items-center gap-1.5">
          <ChevronRight size={13} className="shrink-0 opacity-50" aria-hidden="true" />
          <span
            className={`truncate capitalize ${i === parts.length - 1 ? 'font-medium text-light-textPrimary dark:text-dark-textPrimary' : ''}`}
          >
            {p.replace(/-/g, ' ')}
          </span>
        </span>
      ))}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function initialsFor(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function AppShell({
  productLabel,
  navSections,
  identityLine,
  demoBadge,
  notifications = [],
  notificationsHref = '/notifications',
  accountMenuLinks = [],
  banner,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  async function signOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

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
    <div className="flex min-h-screen flex-col">
      {banner ? <div className="sticky top-0 z-50 print:hidden">{banner}</div> : null}
      <div className="flex min-h-0 flex-1">
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

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop header: breadcrumbs + notifications + user menu, md and up only -- the mobile
            top bar above already carries the product name and nav toggle at narrower widths. */}
        <header className="sticky top-0 z-20 hidden h-16 items-center justify-between gap-3 border-b border-light-border bg-light-surfaceRaised/85 px-6 backdrop-blur-xl md:flex print:hidden dark:border-dark-border dark:bg-dark-surfaceRaised/85">
          <Breadcrumbs pathname={pathname} />

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle compact />

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Notifications"
                  className="relative flex h-9 w-9 items-center justify-center rounded-md text-light-textMuted hover:bg-light-surface hover:text-light-textSecondary dark:text-dark-textMuted dark:hover:bg-dark-surface dark:hover:text-dark-textSecondary"
                >
                  <Bell size={17} aria-hidden="true" />
                  {unreadCount > 0 ? (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-light-statusOverdue ring-2 ring-light-surfaceRaised dark:bg-dark-statusOverdue dark:ring-dark-surfaceRaised" />
                  ) : null}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[340px] p-0">
                <div className="flex items-center justify-between border-b border-light-border px-4 py-3 dark:border-dark-border">
                  <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Notifications</p>
                  {unreadCount > 0 ? <Pill tone="primary">{unreadCount} new</Pill> : null}
                </div>
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
                    No notifications yet.
                  </p>
                ) : (
                  <ul className="max-h-[320px] divide-y divide-light-border overflow-y-auto dark:divide-dark-border">
                    {notifications.map((n) => (
                      <li key={n.id} className="px-4 py-3">
                        <p className="text-[13px] font-medium text-light-textPrimary dark:text-dark-textPrimary">{n.title}</p>
                        <p className="truncate text-xs text-light-textMuted dark:text-dark-textMuted">{n.body}</p>
                        <p className="mt-1 text-[11px] text-light-textMuted/70 dark:text-dark-textMuted/70">
                          {relativeTime(n.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href={notificationsHref}
                  className="block border-t border-light-border px-4 py-2.5 text-center text-xs font-medium text-light-accent hover:underline dark:border-dark-border dark:text-dark-accent"
                >
                  View all
                </Link>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-1 flex items-center gap-2 rounded-xl border border-light-border bg-light-surfaceRaised py-1 pr-2.5 pl-1 hover:bg-light-surface dark:border-dark-border dark:bg-dark-surfaceRaised dark:hover:bg-dark-surface"
                >
                  <Avatar initials={initialsFor(identityLine ?? 'User')} />
                  {identityLine ? (
                    <span className="hidden text-left text-[12px] leading-tight font-medium text-light-textPrimary capitalize sm:block dark:text-dark-textPrimary">
                      {identityLine}
                    </span>
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {identityLine ? <DropdownMenuLabel className="capitalize">{identityLine}</DropdownMenuLabel> : null}
                {accountMenuLinks.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    {accountMenuLinks.map((link) => (
                      <DropdownMenuItem key={link.href} onSelect={() => router.push(link.href)}>
                        {link.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut}>
                  <LogOut size={15} aria-hidden="true" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-5 py-6 pt-20 md:px-8 md:py-8 md:pt-8 print:p-0">{children}</main>
      </div>
      </div>
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
