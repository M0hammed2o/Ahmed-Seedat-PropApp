'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TenancySummary } from '@/lib/tenantSession';

function labelFor(t: TenancySummary): string {
  const property = t.propertyNickname ?? 'Property';
  const unit = t.unitLabel ? ` — ${t.unitLabel}` : '';
  return `${property}${unit}`;
}

/**
 * Tenant-portal tenancy switcher (WORKLOG.md this date, multi-tenancy scoping pass). Only ever
 * rendered by (tenant)/layout.tsx when `tenancies.length > 1` -- a tenant with exactly one
 * tenancy sees the plain `sidebarSubtitle` text instead (AppShell's existing slot), never this
 * component, per "do not show a pointless switcher."
 *
 * Deliberately a native <select>, not a copy of the landlord org-switcher (there isn't one to
 * copy -- (dashboard) itself has no org-switching UI today, it just uses the caller's first
 * active membership) -- the smallest control that does the job, grouped Current/Past
 * (TenancySummary.isActive) so an ended tenancy is visibly distinct without a separate history
 * screen (Phase 11: "only if supported cleanly by existing data").
 *
 * POSTs to /api/v1/tenant-portal/switch-tenancy, which re-validates the requested tenantId is
 * genuinely the caller's own before setting the cookie -- this component has no authorization
 * logic of its own; a rejected switch just leaves the active tenancy unchanged and shows the
 * error inline.
 */
export function TenancySwitcher({
  tenancies,
  activeTenantId,
}: {
  tenancies: TenancySummary[];
  activeTenantId: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = tenancies.find((t) => t.isActive) ?? tenancies[0];
  const historical = tenancies.filter((t) => !t.isActive);
  const active = tenancies.filter((t) => t.isActive);

  async function handleChange(tenantId: string) {
    if (tenantId === activeTenantId) return;
    setSwitching(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/tenant-portal/switch-tenancy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not switch tenancy.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not switch tenancy — check your connection and try again.');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div>
      <label className="block text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        Tenancy
      </label>
      <select
        value={activeTenantId}
        disabled={switching}
        onChange={(e) => handleChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-sidebar-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
      >
        {active.length > 0 ? (
          <optgroup label="Current">
            {active.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {labelFor(t)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {historical.length > 0 ? (
          <optgroup label="Past">
            {historical.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {labelFor(t)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {current ? (
        <p className="mt-1 truncate text-[10px] text-muted-foreground">{current.orgName ?? ''}</p>
      ) : null}
      {error ? <p className="mt-1 text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}
