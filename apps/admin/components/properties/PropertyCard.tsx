import Link from 'next/link';
import { Building2, MapPin } from 'lucide-react';
import { Meter } from '@/components/ui/Meter';
import { Pill } from '@/components/ui/Pill';

export interface PropertyCardData {
  id: string;
  nickname: string;
  fullAddress: string;
  city: string;
  propertyType: string;
  status: string;
  imagePath: string | null;
  unitsCount: number;
  occupiedCount: number;
  monthlyIncome: number;
  outstanding: number;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  inactive: 'neutral',
};

function currency(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

// Adapted from reference/lovable-ui-reference's properties/index.tsx card (UI_INTEGRATION_PLAN.md)
// -- the reference hotlinks Unsplash photography for every card; PropertyVault has no property
// photo storage wired up yet (Property.imagePath exists in the schema but is never populated), so
// every card shows a placeholder icon header instead of fabricating or hotlinking an image.
export function PropertyCard({ property }: { property: PropertyCardData }) {
  const occupancyPct = property.unitsCount > 0 ? Math.round((property.occupiedCount / property.unitsCount) * 100) : 0;

  return (
    <Link
      href={`/properties/${property.id}`}
      className="group overflow-hidden rounded-card border border-light-border bg-light-surfaceRaised shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised"
    >
      <div className="relative flex h-[120px] items-center justify-center bg-light-accentSoft dark:bg-dark-accentSoft">
        <Building2 size={32} className="text-light-accent/40 dark:text-dark-accent/40" aria-hidden="true" />
        <div className="absolute top-3 left-3">
          <Pill tone={STATUS_TONE[property.status] ?? 'neutral'} className="bg-light-surfaceRaised/90 dark:bg-dark-surfaceRaised/90">
            {property.status}
          </Pill>
        </div>
        <span className="absolute top-3 right-3 rounded-pill bg-light-surfaceRaised/90 px-2 py-1 text-[11px] font-semibold capitalize text-light-textPrimary dark:bg-dark-surfaceRaised/90 dark:text-dark-textPrimary">
          {property.propertyType.replace('_', ' ')}
        </span>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="truncate font-display text-[16px] font-bold text-light-textPrimary dark:text-dark-textPrimary">
            {property.nickname}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-light-textMuted dark:text-dark-textMuted">
            <MapPin size={12} className="shrink-0" aria-hidden="true" /> {property.fullAddress}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] tracking-wide text-light-textMuted uppercase dark:text-dark-textMuted">Income</p>
            <p className="tabular-nums-feature text-[15px] font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {currency(property.monthlyIncome)}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-wide text-light-textMuted uppercase dark:text-dark-textMuted">Outstanding</p>
            <p
              className={`tabular-nums-feature text-[15px] font-semibold ${
                property.outstanding > 0
                  ? 'text-light-statusOverdue dark:text-dark-statusOverdue'
                  : 'text-light-textPrimary dark:text-dark-textPrimary'
              }`}
            >
              {currency(property.outstanding)}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-wide text-light-textMuted uppercase dark:text-dark-textMuted">Units</p>
            <p className="tabular-nums-feature text-[15px] font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {property.unitsCount}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-light-textMuted dark:text-dark-textMuted">Occupancy</span>
            <span className="tabular-nums-feature font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {occupancyPct}%
            </span>
          </div>
          <Meter value={occupancyPct} tone={occupancyPct >= 90 ? 'success' : occupancyPct >= 50 ? 'warning' : 'destructive'} />
        </div>
      </div>
    </Link>
  );
}
