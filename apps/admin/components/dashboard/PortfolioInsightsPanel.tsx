'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pill, type PillTone } from '@/components/ui/Pill';

// Final pre-UAT engineering pass (WORKLOG.md this date), Part 5: replaces the dashboard's old
// single-line "most recent insight" banner with a real panel -- severity, a short reason, when
// generated, navigation to the relevant list page, and a real dismiss action, all backed by the
// existing GET /api/v1/insights / POST /api/v1/insights/:id/dismiss routes. Still never fabricates
// a value: `insights` is exactly what the server already loaded via RLS-scoped
// portfolio_insights, and an empty array renders the same truthful "no insights yet" state the
// prior banner already had.

export interface DashboardInsightSummary {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'urgent';
  insightType: string;
  generatedAt: string;
  /** Web owner financial dashboard pass (this date): budget_exceeded/budget_approaching/
   *  unusual_utility_usage carry the triggering property's id in data_source now (see
   *  lib/portfolioIntelligence.ts) so this panel can deep-link straight to that property's
   *  Finances tab instead of only a generic list page. Null for insight types that don't carry one,
   *  or if this row predates the property_id addition. */
  propertyId: string | null;
}

const SEVERITY_TONE: Record<DashboardInsightSummary['severity'], PillTone> = {
  urgent: 'destructive',
  warning: 'warning',
  info: 'info',
};

// Deliberately only the insight types the rules engine actually produces (AI_ARCHITECTURE.md
// §2.2) -- mapped to the existing nav destination that already lists the underlying records, not
// a fabricated per-insight detail page.
const INSIGHT_TYPE_LINK: Record<string, { href: string; label: string }> = {
  rent_overdue: { href: '/accounting/rent-due', label: 'View rent due' },
  rent_due_soon: { href: '/accounting/rent-due', label: 'View rent due' },
  lease_expiring: { href: '/leases', label: 'View leases' },
  maintenance_open: { href: '/maintenance', label: 'View maintenance' },
  invoice_unpaid: { href: '/accounting', label: 'View accounting' },
};

// Web owner financial dashboard pass (this date): budget/utility insights carry a propertyId
// (see DashboardInsightSummary), so their link goes straight to that property's Finances tab
// instead of a generic list page -- falls back to /properties (browse and pick one) if the
// property id is ever missing, rather than showing no link at all.
const PROPERTY_SCOPED_INSIGHT_LABEL: Record<string, string> = {
  budget_exceeded: 'View budget',
  budget_approaching: 'View budget',
  unusual_utility_usage: 'View utilities',
};

function linkFor(insight: DashboardInsightSummary): { href: string; label: string } | undefined {
  const scopedLabel = PROPERTY_SCOPED_INSIGHT_LABEL[insight.insightType];
  if (scopedLabel) {
    return {
      href: insight.propertyId ? `/properties/${insight.propertyId}?tab=Finances` : '/properties',
      label: scopedLabel,
    };
  }
  return INSIGHT_TYPE_LINK[insight.insightType];
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function PortfolioInsightsPanel({ insights }: { insights: DashboardInsightSummary[] }) {
  const [items, setItems] = useState(insights);
  const [dismissing, setDismissing] = useState<string | null>(null);
  // Same hydration-mismatch fix AppShell.tsx's own relativeTime() call already uses (Date.now()
  // read directly in render can differ between the server-rendered HTML and the client's first
  // hydration pass).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function dismiss(id: string) {
    setDismissing(id);
    try {
      const response = await fetch(`/api/v1/insights/${id}/dismiss`, { method: 'POST' });
      if (response.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    } finally {
      setDismissing(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
        <p className="text-[13px] text-muted-foreground">No portfolio insights right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Portfolio insights
      </p>
      <ul className="space-y-2">
        {items.map((insight) => {
          const link = linkFor(insight);
          return (
            <li
              key={insight.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Pill tone={SEVERITY_TONE[insight.severity]}>{insight.severity}</Pill>
                  <span className="text-[11px] text-muted-foreground">
                    {mounted ? relativeTime(insight.generatedAt) : ''}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-foreground">{insight.message}</p>
                {link ? (
                  <Link
                    href={link.href}
                    className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
                  >
                    {link.label}
                  </Link>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(insight.id)}
                disabled={dismissing === insight.id}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface disabled:opacity-40"
              >
                {dismissing === insight.id ? 'Dismissing…' : 'Dismiss'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
