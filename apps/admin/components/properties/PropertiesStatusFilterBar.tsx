'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

// Property lifecycle pass (WORKLOG.md this date): "default listings show ACTIVE only; add a
// filter/toggle" -- same URL-state select pattern as PropertyAccountingFilterBar.tsx. The actual
// filtering happens server-side in properties/page.tsx's loadProperties() (this only steers the
// URL), so an archived property is never fetched at all unless explicitly requested here.
const STATUS_OPTIONS: { value: 'active' | 'archived' | 'all'; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

export function PropertiesStatusFilterBar({
  selected,
}: {
  selected: 'active' | 'archived' | 'all';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setStatus(status: 'active' | 'archived' | 'all') {
    const params = new URLSearchParams(searchParams.toString());
    params.set('status', status);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      Status
      <select
        value={selected}
        onChange={(e) => setStatus(e.target.value as 'active' | 'archived' | 'all')}
        className="h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
