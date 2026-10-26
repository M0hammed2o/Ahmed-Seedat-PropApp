// Cemetery Management (migration 184): status vocabulary, colours and tenure terminology. Client-safe (no server
// imports) so the interactive layout and the server pages render the same labels.

export type CemeteryTenureModel = 'burial_rights' | 'land_sale';
export type GraveSaleStatus = 'available' | 'reserved' | 'sold' | 'unavailable';
export type GraveBurialStatus = 'unused' | 'occupied';
export type CemeteryPaymentMethod = 'bank_transfer' | 'cash' | 'eft' | 'card' | 'other';

export const SALE_STATUSES: GraveSaleStatus[] = ['available', 'reserved', 'sold', 'unavailable'];
export const PAYMENT_METHODS: CemeteryPaymentMethod[] = [
  'eft',
  'bank_transfer',
  'card',
  'cash',
  'other',
];

export const SALE_STATUS_LABEL: Record<GraveSaleStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  unavailable: 'Unavailable',
};

export const BURIAL_STATUS_LABEL: Record<GraveBurialStatus, string> = {
  unused: 'Unused',
  occupied: 'Occupied',
};

export const PAYMENT_METHOD_LABEL: Record<CemeteryPaymentMethod, string> = {
  eft: 'EFT',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
};

/** Layout colours (green available, amber reserved, blue sold, grey unavailable). Never colour-only: every tile
 * also carries its reference and an accessible label, and occupied sites get a marker. */
export const SALE_STATUS_TILE: Record<GraveSaleStatus, string> = {
  available: 'bg-success/15 border-success/60 text-foreground hover:bg-success/25',
  reserved: 'bg-warning/25 border-warning text-foreground hover:bg-warning/35',
  sold: 'bg-primary/15 border-primary/60 text-foreground hover:bg-primary/25',
  unavailable: 'bg-surface-strong border-border text-muted-foreground hover:bg-muted',
};

export const SALE_STATUS_SWATCH: Record<GraveSaleStatus, string> = {
  available: 'bg-success',
  reserved: 'bg-warning',
  sold: 'bg-primary',
  unavailable: 'bg-muted-foreground/50',
};

export const SALE_STATUS_PILL: Record<
  GraveSaleStatus,
  'success' | 'warning' | 'primary' | 'neutral'
> = {
  available: 'success',
  reserved: 'warning',
  sold: 'primary',
  unavailable: 'neutral',
};

/** Burial-rights wording is the default: most South African cemeteries grant a right of interment rather than
 * selling the land. The data model is identical; only the words change. */
export interface TenureTerms {
  sale: string;
  saleLower: string;
  sold: string;
  holder: string;
  holderLower: string;
  holders: string;
  price: string;
  recordTitle: string;
  sellAction: string;
}

export function tenureTerms(model: CemeteryTenureModel): TenureTerms {
  if (model === 'land_sale') {
    return {
      sale: 'Grave plot sale',
      saleLower: 'sale',
      sold: 'Sold',
      holder: 'Purchaser',
      holderLower: 'purchaser',
      holders: 'Purchasers',
      price: 'Selling price',
      recordTitle: 'Grave Plot Sale Agreement',
      sellAction: 'Sell site',
    };
  }
  return {
    sale: 'Grant of burial rights',
    saleLower: 'grant of rights',
    sold: 'Rights granted',
    holder: 'Rights holder',
    holderLower: 'rights holder',
    holders: 'Rights holders',
    price: 'Rights fee',
    recordTitle: 'Grant of Right of Interment',
    sellAction: 'Grant rights',
  };
}

export const TENURE_LABEL: Record<CemeteryTenureModel, string> = {
  burial_rights: 'Burial rights (right of interment)',
  land_sale: 'Grave plot sale (land)',
};

export function formatZar(n: number, opts: { cents?: boolean } = {}): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(n);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
