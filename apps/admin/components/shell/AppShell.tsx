'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, Building2, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Avatar } from '@/components/ui/Avatar';
import { Pill } from '@/components/ui/Pill';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';

// Rebuilt against reference/lovable-ui-reference's app-shell.tsx literal structure (2026-08-04
// Lovable-adoption batch, UI_INTEGRATION_PLAN.md), replacing the previous three-breakpoint
// version (mobile top bar / icon-only rail / full sidebar). Lovable's own shell is binary --
// full 248px sidebar at `lg`+, an overlay drawer below it, no intermediate collapsed-icon state
// -- so that middle rail state is removed here to match exactly, a real structural difference
// from the prior pass, not a stylistic one. One shared component across all three route groups
// ((dashboard)/(super-admin)/(tenant)), same as before: each layout supplies its own nav content
// and identity; the optional `sidebarSubtitle`/`sidebarFooterWidget` slots below are new and are
// only ever populated by the (dashboard) [Owner PWA] layout for now -- Super Admin and Tenant
// Portal simply don't pass them, so their chrome content is unchanged even though the shared
// component gained the capability.
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
  /** Real display name (packages/validation `profiles.display_name`) when known -- Lovable's own
   *  shell shows a name, not just a role; falls back to identityLine when no profile name exists. */
  displayName?: string;
  demoBadge?: boolean;
  notifications?: HeaderNotification[];
  /** Real bug found and fixed (WORKLOG.md this date): this used to default to '/notifications' --
   *  an org-staff-only route -- so the tenant/owner/super-admin portals (which never pass this)
   *  showed a "View all" link that bounced the user straight into the org-staff onboarding
   *  funnel. No default now: the link only renders when a portal actually has a real
   *  notifications destination to send the user to, matching the no-fabricated-widget rule
   *  `sidebarFooterWidget` already documents below. */
  notificationsHref?: string;
  accountMenuLinks?: AccountMenuLink[];
  /** Persistent, non-dismissible strip rendered above everything else, e.g. SupportModeBanner
   *  (SECURITY.md: "banner-visible, never silent... a hard requirement, not a nice-to-have"). */
  banner?: ReactNode;
  /** Breadcrumb root — Lovable's own copy is "Portfolio"; other portals keep "Home" by not
   *  passing this. */
  homeLabel?: string;
  homeHref?: string;
  /** One-line real text under the product name in the full sidebar (e.g. real org name + real
   *  unit count) — Lovable's own slot here shows a fabricated "Enterprise · 412 units"; this
   *  prop exists so a layout can put real data in the identical visual position instead. */
  sidebarSubtitle?: string;
  /** Real content for the small card Lovable pins above the sidebar footer (its own version is a
   *  static "Collection health 94.2%"). Omit to render nothing there, matching the no-fabricated-
   *  widget rule for portals that don't have a real equivalent yet. */
  sidebarFooterWidget?: ReactNode;
  /** Final pre-UAT engineering pass (WORKLOG.md this date), Part 13: the Proplyst Assistant's
   *  floating trigger + drawer (components/assistant/AssistantDrawer.tsx). Omit for portals that
   *  don't get the assistant (Super Admin, demo mode) -- rendered as a fixed-position overlay so
   *  it's reachable from every page within a portal without touching per-page layout. */
  assistant?: ReactNode;
  children: React.ReactNode;
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
  displayName,
  demoBadge,
  notifications = [],
  notificationsHref,
  accountMenuLinks = [],
  banner,
  homeLabel = 'Home',
  homeHref = '/dashboard',
  sidebarSubtitle,
  sidebarFooterWidget,
  assistant,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  /** React #418 fix (WORKLOG.md this date): relativeTime() reads Date.now(), so calling it
   *  directly in render produced a different string on the server-rendered HTML than on the
   *  client's hydration pass whenever a minute boundary fell between the two -- a genuine
   *  hydration-mismatch source, not a false positive. mounted stays false through the client's
   *  first (hydrating) render, so that render matches the server's exactly; the real relative
   *  time only appears once mounted flips true post-hydration, in its own effect-driven render. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Longest-matching-prefix wins (real bug found 2026-08-04 adding the Accounting overview page:
  // its href /accounting is itself a path prefix of every existing Finance sub-page's href, e.g.
  // /accounting/rent-due, so plain startsWith() prefix matching lit up both "Accounting" and
  // "Rent Due" simultaneously while viewing Rent Due). Every other nav item in this app has always
  // had a unique, non-overlapping href, so this only changes behavior for that one new collision.
  const allHrefs = navSections.flatMap((section) => section.items.map((item) => item.href));
  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (!pathname.startsWith(`${href}/`)) return false;
    const longestMatch = allHrefs
      .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
      .reduce((longest, h) => (h.length > longest.length ? h : longest), '');
    return longestMatch === href;
  };

  async function signOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow">
            <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[15px] font-bold tracking-tight text-foreground">
              {productLabel}
            </span>
            {sidebarSubtitle ? (
              <span className="block truncate text-[11px] text-muted-foreground">
                {sidebarSubtitle}
              </span>
            ) : null}
            {demoBadge ? (
              <span className="mt-1 inline-flex w-fit items-center rounded-full border border-primary px-2 py-0.5 text-[10px] font-semibold text-primary">
                Demo mode
              </span>
            ) : null}
          </span>
        </div>

        <nav className="scrollbar-slim flex-1 space-y-6 overflow-y-auto px-3 pb-4">
          {navSections.map((section, i) => (
            <div key={section.label ?? i}>
              {section.label ? (
                <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {section.label}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        title={item.label}
                        className={`group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200 ${
                          active
                            ? 'bg-primary-soft text-accent-foreground'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
                        }`}
                      >
                        {active ? (
                          <span className="absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                        ) : null}
                        <span
                          className={`shrink-0 transition-colors ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}
                        >
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {sidebarFooterWidget ? (
          <div className="border-t border-sidebar-border p-3">{sidebarFooterWidget}</div>
        ) : null}
      </div>
    );
  }

  function Breadcrumbs() {
    const parts = pathname.split('/').filter(Boolean);
    return (
      <div className="hidden min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground lg:flex">
        <Link href={homeHref} className="transition-colors hover:text-foreground">
          {homeLabel}
        </Link>
        {parts.map((p, i) => (
          <span key={p + i} className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
            <span
              className={`truncate capitalize ${i === parts.length - 1 ? 'font-medium text-foreground' : ''}`}
            >
              {p.replace(/-/g, ' ')}
            </span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {banner ? <div className="sticky top-0 z-50 print:hidden">{banner}</div> : null}

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-sidebar-border bg-sidebar lg:block print:hidden">
        <SidebarBody />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[264px] border-r border-sidebar-border bg-sidebar shadow-lift">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute top-4 right-3 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl print:hidden">
          <div className="grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-surface lg:hidden"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <Breadcrumbs />
            </div>

            {/* Lovable's header includes a global search input here (properties/tenants/invoices).
                Deliberately not ported: no search index/API exists over those resources yet
                (real backend integration gap, not a styling choice) -- a search box that doesn't
                actually search would be a broken promise, not a visual upgrade. Left empty rather
                than a fake input, matching the "do not fabricate" rule. */}
            <div />

            <div className="flex items-center gap-1.5 justify-self-end">
              <ThemeToggle compact />

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Notifications"
                    className="relative grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                  >
                    <Bell className="h-[17px] w-[17px]" aria-hidden="true" />
                    {unreadCount > 0 ? (
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[340px] p-0">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold text-foreground">Notifications</p>
                    {unreadCount > 0 ? <Pill tone="primary">{unreadCount} new</Pill> : null}
                  </div>
                  {notifications.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No notifications yet.
                    </p>
                  ) : (
                    <ul className="max-h-[320px] divide-y divide-border overflow-y-auto">
                      {notifications.map((n) => (
                        <li key={n.id} className="px-4 py-3">
                          <p className="text-[13px] font-medium text-foreground">{n.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground/70">
                            {mounted ? relativeTime(n.createdAt) : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {notificationsHref ? (
                    <Link
                      href={notificationsHref}
                      className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-primary hover:underline"
                    >
                      View all
                    </Link>
                  ) : null}
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="ml-1 flex items-center gap-2 rounded-xl border border-border bg-card py-1 pr-2.5 pl-1 transition-colors hover:bg-surface"
                  >
                    <Avatar initials={initialsFor(displayName ?? identityLine ?? 'User')} />
                    <span className="hidden text-left sm:block">
                      <span className="block text-[12px] leading-tight font-semibold text-foreground">
                        {displayName ?? identityLine ?? 'Account'}
                      </span>
                      {displayName && identityLine ? (
                        <span className="block text-[11px] leading-tight text-muted-foreground capitalize">
                          {identityLine}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {identityLine ? (
                    <DropdownMenuLabel className="capitalize">{identityLine}</DropdownMenuLabel>
                  ) : null}
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
          </div>
        </header>

        <main className="animate-rise mx-auto w-full max-w-[1560px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 print:p-0 print:max-w-none">
          {children}
        </main>
      </div>

      {assistant ? <div className="print:hidden">{assistant}</div> : null}
    </div>
  );
}
