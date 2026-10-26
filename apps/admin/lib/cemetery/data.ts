import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CemeteryPaymentMethod,
  CemeteryTenureModel,
  GraveBurialStatus,
  GraveSaleStatus,
} from '@/lib/cemetery/terms';

// Read model for Cemetery Management (migration 184). Every query runs on the caller's session client, so RLS
// (module switch + accountant+ role + organisation) decides what is visible; nothing here uses the service role.

export interface CemeteryRow {
  id: string;
  org_id: string;
  name: string;
  address_line1: string | null;
  city: string | null;
  province: string | null;
  tenure_model: CemeteryTenureModel;
  rights_term_years: number | null;
  is_demo: boolean;
  notes: string | null;
}

export interface SectionRow {
  id: string;
  cemetery_id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  sites_per_row: number;
}

export interface SiteRow {
  id: string;
  org_id: string;
  cemetery_id: string;
  section_id: string;
  site_number: number;
  reference: string;
  row_label: string | null;
  plot_position: number | null;
  length_m: number | null;
  width_m: number | null;
  site_type: string;
  max_interments: number;
  sale_status: GraveSaleStatus;
  burial_status: GraveBurialStatus;
  list_price: number | null;
  reserved_for_purchaser_id: string | null;
  reserved_until: string | null;
  reservation_notes: string | null;
  unavailable_reason: string | null;
  notes: string | null;
}

export interface PurchaserRow {
  id: string;
  org_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
  next_of_kin_relationship: string | null;
  notes: string | null;
  created_at: string;
}

export interface SaleRow {
  id: string;
  org_id: string;
  cemetery_id: string;
  site_id: string;
  purchaser_id: string;
  sale_number: string;
  tenure_model: CemeteryTenureModel;
  sale_date: string;
  price: number;
  status: 'active' | 'cancelled';
  is_demo: boolean;
  notes: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  org_id: string;
  sale_id: string;
  receipt_number: string;
  amount: number;
  paid_on: string;
  method: CemeteryPaymentMethod;
  reference: string | null;
  is_deposit: boolean;
  is_demo: boolean;
  notes: string | null;
  created_at: string;
}

export interface BurialRow {
  id: string;
  site_id: string;
  sale_id: string | null;
  deceased_full_name: string;
  date_of_birth: string | null;
  date_of_death: string | null;
  burial_date: string;
  interment_number: number;
  burial_order_number: string | null;
  funeral_undertaker: string | null;
  notes: string | null;
}

export interface SiteDocumentRow {
  id: string;
  site_id: string;
  sale_id: string | null;
  title: string;
  document_type: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** PostgREST caps a response at 1,000 rows (no max_rows override in config.toml), so lists are paged. */
async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`Failed to load ${label}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < size) break;
  }
  return out;
}

function normaliseSite(row: Record<string, unknown>): SiteRow {
  return {
    ...(row as unknown as SiteRow),
    length_m: num(row.length_m),
    width_m: num(row.width_m),
    list_price: num(row.list_price),
  };
}

function normaliseSale(row: Record<string, unknown>): SaleRow {
  return { ...(row as unknown as SaleRow), price: Number(row.price) };
}

function normalisePayment(row: Record<string, unknown>): PaymentRow {
  return { ...(row as unknown as PaymentRow), amount: Number(row.amount) };
}

export async function loadCemeteries(supabase: SupabaseClient): Promise<CemeteryRow[]> {
  const { data, error } = await supabase.from('cemeteries').select('*').order('name');
  if (error) throw new Error(`Failed to load cemeteries: ${error.message}`);
  return (data ?? []) as CemeteryRow[];
}

export async function loadPurchasers(supabase: SupabaseClient): Promise<PurchaserRow[]> {
  return fetchAll<PurchaserRow>(
    (from, to) =>
      supabase.from('cemetery_purchasers').select('*').order('full_name').range(from, to),
    'purchasers',
  );
}

export async function loadSales(
  supabase: SupabaseClient,
  filter: { cemeteryId?: string } = {},
): Promise<SaleRow[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) => {
    let q = supabase
      .from('cemetery_sales')
      .select('*')
      .order('sale_date', { ascending: false })
      .order('sale_number', { ascending: false });
    if (filter.cemeteryId) q = q.eq('cemetery_id', filter.cemeteryId);
    return q.range(from, to);
  }, 'sales');
  return rows.map(normaliseSale);
}

export async function loadPayments(
  supabase: SupabaseClient,
  filter: { saleIds?: string[] } = {},
): Promise<PaymentRow[]> {
  if (filter.saleIds && filter.saleIds.length === 0) return [];
  const rows = await fetchAll<Record<string, unknown>>((from, to) => {
    let q = supabase
      .from('cemetery_payments')
      .select('*')
      .order('paid_on', { ascending: false })
      .order('receipt_number', { ascending: false });
    if (filter.saleIds) q = q.in('sale_id', filter.saleIds);
    return q.range(from, to);
  }, 'payments');
  return rows.map(normalisePayment);
}

/** All grave sites the caller can read (optionally only some sale statuses), paged past the 1,000-row cap. */
export async function loadSites(
  supabase: SupabaseClient,
  filter: { saleStatuses?: GraveSaleStatus[] } = {},
): Promise<SiteRow[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) => {
    let q = supabase.from('cemetery_sites').select('*').order('cemetery_id').order('reference');
    if (filter.saleStatuses) q = q.in('sale_status', filter.saleStatuses);
    return q.range(from, to);
  }, 'grave sites');
  return rows.map(normaliseSite);
}

export interface SaleWithBalance extends SaleRow {
  paid: number;
  balance: number;
}

export function withBalances(sales: SaleRow[], payments: PaymentRow[]): SaleWithBalance[] {
  const paidBySale = new Map<string, number>();
  for (const p of payments) paidBySale.set(p.sale_id, (paidBySale.get(p.sale_id) ?? 0) + p.amount);
  return sales.map((s) => {
    const paid = Math.round((paidBySale.get(s.id) ?? 0) * 100) / 100;
    return {
      ...s,
      paid,
      balance: s.status === 'active' ? Math.round((s.price - paid) * 100) / 100 : 0,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Register: one cemetery's sections and sites with their current sale, rights holder, balance and burials.
// ---------------------------------------------------------------------------------------------------------------

export interface RegisterSite {
  id: string;
  reference: string;
  sectionId: string;
  sectionCode: string;
  siteNumber: number;
  rowLabel: string | null;
  plotPosition: number | null;
  saleStatus: GraveSaleStatus;
  burialStatus: GraveBurialStatus;
  siteType: string;
  maxInterments: number;
  listPrice: number | null;
  lengthM: number | null;
  widthM: number | null;
  notes: string | null;
  unavailableReason: string | null;
  reservedUntil: string | null;
  reservedFor: { id: string; name: string } | null;
  sale: {
    id: string;
    saleNumber: string;
    saleDate: string;
    price: number;
    paid: number;
    balance: number;
    isDemo: boolean;
    purchaser: { id: string; name: string; phone: string | null };
  } | null;
  burials: { name: string; burialDate: string }[];
}

export interface CemeteryRegister {
  cemetery: CemeteryRow;
  sections: SectionRow[];
  sites: RegisterSite[];
  sales: SaleWithBalance[];
  payments: PaymentRow[];
  purchasers: PurchaserRow[];
}

export async function loadCemeteryRegister(
  supabase: SupabaseClient,
  cemetery: CemeteryRow,
): Promise<CemeteryRegister> {
  const [sectionsRes, siteRows, sales, purchasers, burials] = await Promise.all([
    supabase
      .from('cemetery_sections')
      .select('*')
      .eq('cemetery_id', cemetery.id)
      .order('sort_order')
      .order('code'),
    fetchAll<Record<string, unknown>>(
      (from, to) =>
        supabase
          .from('cemetery_sites')
          .select('*')
          .eq('cemetery_id', cemetery.id)
          .order('section_id')
          .order('site_number')
          .range(from, to),
      'grave sites',
    ),
    loadSales(supabase, { cemeteryId: cemetery.id }),
    loadPurchasers(supabase),
    fetchAll<BurialRow & { site_id: string }>(
      (from, to) =>
        supabase
          .from('cemetery_burials')
          .select(
            'id, site_id, sale_id, deceased_full_name, date_of_birth, date_of_death, burial_date, interment_number, burial_order_number, funeral_undertaker, notes',
          )
          .order('burial_date')
          .range(from, to),
      'burials',
    ),
  ]);
  if (sectionsRes.error) throw new Error(`Failed to load sections: ${sectionsRes.error.message}`);
  const sections = (sectionsRes.data ?? []) as SectionRow[];
  const payments = await loadPayments(supabase, { saleIds: sales.map((s) => s.id) });
  const balances = withBalances(sales, payments);

  const sectionCode = new Map(sections.map((s) => [s.id, s.code]));
  const purchaserById = new Map(purchasers.map((p) => [p.id, p]));
  const activeSaleBySite = new Map(
    balances.filter((s) => s.status === 'active').map((s) => [s.site_id, s]),
  );
  const burialsBySite = new Map<string, { name: string; burialDate: string }[]>();
  for (const b of burials) {
    const list = burialsBySite.get(b.site_id) ?? [];
    list.push({ name: b.deceased_full_name, burialDate: b.burial_date });
    burialsBySite.set(b.site_id, list);
  }

  const sites: RegisterSite[] = siteRows.map(normaliseSite).map((s) => {
    const sale = activeSaleBySite.get(s.id);
    const holder = sale ? purchaserById.get(sale.purchaser_id) : undefined;
    const reservedFor = s.reserved_for_purchaser_id
      ? purchaserById.get(s.reserved_for_purchaser_id)
      : undefined;
    return {
      id: s.id,
      reference: s.reference,
      sectionId: s.section_id,
      sectionCode: sectionCode.get(s.section_id) ?? '?',
      siteNumber: s.site_number,
      rowLabel: s.row_label,
      plotPosition: s.plot_position,
      saleStatus: s.sale_status,
      burialStatus: s.burial_status,
      siteType: s.site_type,
      maxInterments: s.max_interments,
      listPrice: s.list_price,
      lengthM: s.length_m,
      widthM: s.width_m,
      notes: s.notes,
      unavailableReason: s.unavailable_reason,
      reservedUntil: s.reserved_until,
      reservedFor: reservedFor ? { id: reservedFor.id, name: reservedFor.full_name } : null,
      sale: sale
        ? {
            id: sale.id,
            saleNumber: sale.sale_number,
            saleDate: sale.sale_date,
            price: sale.price,
            paid: sale.paid,
            balance: sale.balance,
            isDemo: sale.is_demo,
            purchaser: {
              id: sale.purchaser_id,
              name: holder?.full_name ?? 'Unknown',
              phone: holder?.phone ?? null,
            },
          }
        : null,
      burials: burialsBySite.get(s.id) ?? [],
    };
  });

  return { cemetery, sections, sites, sales: balances, payments, purchasers };
}

// ---------------------------------------------------------------------------------------------------------------
// Metrics (cemetery overview and the main dashboard). Grave-site sales are capital receipts, reported on their own
// and never added to rental income.
// ---------------------------------------------------------------------------------------------------------------

export interface CemeteryMetrics {
  totalSites: number;
  available: number;
  reserved: number;
  sold: number;
  unavailable: number;
  occupied: number;
  salesValue: number;
  paymentsReceived: number;
  outstanding: number;
  paymentsThisMonth: number;
  salesThisMonth: number;
  salesWithBalance: number;
}

export function computeCemeteryMetrics(
  sites: Pick<SiteRow, 'sale_status' | 'burial_status'>[],
  sales: SaleWithBalance[],
  payments: PaymentRow[],
  now: Date = new Date(),
): CemeteryMetrics {
  const monthKey = now.toISOString().slice(0, 7);
  const active = sales.filter((s) => s.status === 'active');
  const activeIds = new Set(active.map((s) => s.id));
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    totalSites: sites.length,
    available: sites.filter((s) => s.sale_status === 'available').length,
    reserved: sites.filter((s) => s.sale_status === 'reserved').length,
    sold: sites.filter((s) => s.sale_status === 'sold').length,
    unavailable: sites.filter((s) => s.sale_status === 'unavailable').length,
    occupied: sites.filter((s) => s.burial_status === 'occupied').length,
    salesValue: round(active.reduce((sum, s) => sum + s.price, 0)),
    paymentsReceived: round(
      payments.filter((p) => activeIds.has(p.sale_id)).reduce((sum, p) => sum + p.amount, 0),
    ),
    outstanding: round(active.reduce((sum, s) => sum + s.balance, 0)),
    paymentsThisMonth: round(
      payments
        .filter((p) => p.paid_on.slice(0, 7) === monthKey)
        .reduce((sum, p) => sum + p.amount, 0),
    ),
    salesThisMonth: active.filter((s) => s.sale_date.slice(0, 7) === monthKey).length,
    salesWithBalance: active.filter((s) => s.balance > 0).length,
  };
}

/** Organisation-wide cemetery metrics for the main dashboard (all cemeteries the caller can read). */
export async function loadOrgCemeteryMetrics(
  supabase: SupabaseClient,
): Promise<CemeteryMetrics & { cemeteryCount: number }> {
  const [cemeteries, sites, sales] = await Promise.all([
    loadCemeteries(supabase),
    fetchAll<Pick<SiteRow, 'sale_status' | 'burial_status'>>(
      (from, to) =>
        supabase
          .from('cemetery_sites')
          .select('sale_status, burial_status')
          .order('id')
          .range(from, to),
      'grave sites',
    ),
    loadSales(supabase),
  ]);
  const payments = await loadPayments(supabase);
  return {
    ...computeCemeteryMetrics(sites, withBalances(sales, payments), payments),
    cemeteryCount: cemeteries.length,
  };
}
