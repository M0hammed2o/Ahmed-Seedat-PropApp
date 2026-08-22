import type { ComponentType } from 'react';
import { Building2, FileText, Users, Wallet, Wrench, LayoutGrid, type LucideProps } from 'lucide-react';

const NAV_ITEMS: { icon: ComponentType<LucideProps>; label: string; active?: boolean }[] = [
  { icon: LayoutGrid, label: 'Dashboard', active: true },
  { icon: Building2, label: 'Properties' },
  { icon: Users, label: 'Tenants' },
  { icon: Wallet, label: 'Accounting' },
  { icon: FileText, label: 'Documents' },
  { icon: Wrench, label: 'Maintenance' },
];

const STAT_CARDS = [
  { label: 'Occupied units', value: '42 / 46' },
  { label: 'Rent collected', value: 'R612,400' },
  { label: 'Open maintenance', value: '3' },
] as const;

const PROPERTY_ROWS = [
  { name: 'Ridgeview Apartments', units: '12 units', status: 'Fully let', tone: 'good' },
  { name: 'Harbour View Complex', units: '8 units', status: '1 vacancy', tone: 'warn' },
  { name: 'Oakwood Townhouses', units: '6 units', status: 'Fully let', tone: 'good' },
] as const;

/**
 * Public website polish (this date). A stylized product preview built from this app's own design
 * tokens/components (Building2/Wallet/etc icon set + light-/dark- palette already used throughout
 * the real dashboard) rather than a generic stock illustration or a screenshot of real customer
 * data -- every label/number below is illustrative placeholder content, never a live query.
 */
export function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-card border border-light-border bg-light-surfaceRaised shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
      <div className="flex items-center gap-1.5 border-b border-light-border bg-light-surface px-4 py-2.5 dark:border-dark-border dark:bg-dark-surface">
        <span className="h-2.5 w-2.5 rounded-full bg-light-danger/60 dark:bg-dark-danger/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-light-statusNeedsReview/60 dark:bg-dark-statusNeedsReview/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-light-statusPaid/60 dark:bg-dark-statusPaid/60" />
        <span className="ml-3 truncate text-xs text-light-textMuted dark:text-dark-textMuted">
          app.proplyst.co.za/dashboard
        </span>
      </div>

      <div className="grid grid-cols-[auto,1fr]">
        <nav className="hidden w-40 shrink-0 space-y-1 border-r border-light-border p-3 sm:block dark:border-dark-border">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                item.active
                  ? 'bg-light-accent/10 text-light-accent dark:bg-dark-accent/10 dark:text-dark-accent'
                  : 'text-light-textSecondary dark:text-dark-textSecondary'
              }`}
            >
              <item.icon size={14} aria-hidden="true" />
              {item.label}
            </div>
          ))}
        </nav>

        <div className="min-w-0 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {STAT_CARDS.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-light-border bg-light-surface p-3 dark:border-dark-border dark:bg-dark-surface"
              >
                <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                  {stat.label}
                </p>
                <p className="mt-1 font-display text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {PROPERTY_ROWS.map((row) => (
              <div
                key={row.name}
                className="flex items-center justify-between rounded-lg border border-light-border bg-light-surface px-3 py-2 dark:border-dark-border dark:bg-dark-surface"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    {row.name}
                  </p>
                  <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                    {row.units}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    row.tone === 'good'
                      ? 'bg-light-statusPaid/10 text-light-statusPaid dark:bg-dark-statusPaid/10 dark:text-dark-statusPaid'
                      : 'bg-light-statusNeedsReview/10 text-light-statusNeedsReview dark:bg-dark-statusNeedsReview/10 dark:text-dark-statusNeedsReview'
                  }`}
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
