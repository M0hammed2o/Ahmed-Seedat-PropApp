import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { PropertyStatus, PropertyType } from '@propvault/types';
import { PROPERTY_TYPE_LABELS, PROPERTY_STATUS_PRESENTATION } from '@propvault/ui';
import { formatSouthAfricanNumber } from '@propvault/utils';
import { Meter } from '@/components/ui/Meter';
import { Pill, statusTone } from '@/components/ui/Pill';

export interface PropertyCardData {
  id: string;
  nickname: string;
  fullAddress: string;
  city: string;
  propertyType: PropertyType;
  status: PropertyStatus;
  imagePath: string | null;
  unitsCount: number;
  occupiedCount: number;
  monthlyIncome: number;
  outstanding: number;
}

function currency(n: number): string {
  return `R${formatSouthAfricanNumber(Math.round(n))}`;
}

// Adapted from reference/lovable-ui-reference's properties/index.tsx photographic card
// (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md) -- image band with a bottom gradient,
// status/type pills overlaid on the photo, name+address overlaid in white text, matching Lovable's
// literal layout. Lovable hotlinks unlicensed Unsplash stock photography for every card; this uses
// the property's own uploaded photo (`imagePath`) when one exists, and a self-authored, locally
// hosted placeholder graphic (apps/admin/public/property-placeholder.svg -- no external request,
// full rights) when it doesn't, per the explicit "never a hotlinked/fabricated photo" instruction.
export function PropertyCard({ property }: { property: PropertyCardData }) {
  const occupancyPct =
    property.unitsCount > 0 ? Math.round((property.occupiedCount / property.unitsCount) * 100) : 0;
  const imageSrc = property.imagePath ?? '/property-placeholder.svg';

  return (
    <Link
      href={`/properties/${property.id}`}
      className="panel group overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="relative h-[168px] overflow-hidden">
        <img
          src={imageSrc}
          alt={
            property.imagePath
              ? `${property.nickname} exterior in ${property.city}`
              : 'No property photo uploaded yet'
          }
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/55 via-transparent to-transparent" />
        <div className="absolute top-3 left-3">
          <Pill tone={statusTone(property.status)} className="bg-card/90 backdrop-blur">
            {PROPERTY_STATUS_PRESENTATION[property.status].label}
          </Pill>
        </div>
        <div className="absolute right-3 bottom-3 left-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-[17px] font-bold text-white">
              {property.nickname}
            </p>
            <p className="flex items-center gap-1 truncate text-[11px] text-white/80">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> {property.fullAddress}
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-card/90 px-2 py-1 text-[11px] font-semibold text-foreground backdrop-blur">
            {PROPERTY_TYPE_LABELS[property.propertyType]}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Income</p>
            <p className="tabular text-[15px] font-semibold text-foreground">
              {currency(property.monthlyIncome)}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Outstanding</p>
            <p
              className={`tabular text-[15px] font-semibold ${property.outstanding > 0 ? 'text-destructive' : 'text-foreground'}`}
            >
              {currency(property.outstanding)}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Units</p>
            <p className="tabular text-[15px] font-semibold text-foreground">
              {property.unitsCount}
            </p>
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Occupancy</span>
            <span className="tabular font-semibold text-foreground">{occupancyPct}%</span>
          </div>
          <Meter value={occupancyPct} tone={occupancyPct >= 90 ? 'success' : 'warning'} />
        </div>
      </div>
    </Link>
  );
}
