import { Pill, type PillTone } from '@/components/ui/Pill';

// Real equivalent of Lovable's static sidebar "Collection health 94.2%" card
// (reference/lovable-ui-reference app-shell.tsx SidebarBody) -- same markup, real numbers from
// apps/admin/app/(dashboard)/layout.tsx's loadCollectionHealth() (Lovable-adoption batch,
// 2026-08-04).
export function CollectionHealthWidget({
  pct,
  outstanding,
  tenantsInArrears,
}: {
  pct: number;
  outstanding: number;
  tenantsInArrears: number;
}) {
  const tone: PillTone = pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'destructive';
  return (
    <div className="rounded-xl bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Collection health</p>
        <Pill tone={tone}>{pct}%</Pill>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-strong">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {outstanding > 0
          ? `R${outstanding.toLocaleString('en-ZA')} outstanding across ${tenantsInArrears} ${tenantsInArrears === 1 ? 'tenant' : 'tenants'}.`
          : 'No outstanding rent right now.'}
      </p>
    </div>
  );
}
