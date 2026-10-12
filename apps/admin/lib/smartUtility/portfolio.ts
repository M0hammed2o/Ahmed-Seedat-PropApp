import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll, fetchAllIn } from './data';

// Portfolio utilities summary across every property the caller can read (session client → RLS). Monthly trends
// come from job-written meter_period_snapshots, so a large portfolio never loads raw telemetry here; the property
// dashboard (hybridDashboard.ts) does the detailed, any-range work.

const CHUNK = 150;

type Ordered<T> = { order: (column: string) => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> } };

/** Chunked by id (URL length) AND paged (the API returns at most 1 000 rows per request; a 150-property chunk of
 * monthly snapshots alone can hold tens of thousands). */
async function inChunks<T>(ids: string[], load: (chunk: string[]) => Ordered<T>): Promise<T[]> {
  return fetchAllIn<T>(ids, (chunk, f, t) => load(chunk).order('id').range(f, t), CHUNK);
}

export async function loadUtilityPortfolio(client: SupabaseClient, opts: { months?: number } = {}) {
  const months = Math.min(Math.max(opts.months ?? 12, 1), 24);
  const meterRows = await fetchAll<{ id: string; property_id: string; utility_type: string; meter_role: string; measurement_kind: string | null; active: boolean }>((f, t) =>
    client.from('utility_meters').select('id, property_id, utility_type, meter_role, measurement_kind, active').order('id').range(f, t),
  );
  const sourceRows = await fetchAll<{ id: string; property_id: string; utility_type: string; source_type: string; active: boolean }>((f, t) =>
    client.from('utility_supply_sources').select('id, property_id, utility_type, source_type, active').order('id').range(f, t),
  );
  const propertyIds = [...new Set([...(meterRows ?? []).map((m) => m.property_id), ...(sourceRows ?? []).map((s) => s.property_id)])];
  if (propertyIds.length === 0) return { properties: [], totals: null, monthly: [] };

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);
  const sinceDate = since.toISOString().slice(0, 10);

  const [properties, alerts, charges, snapshots] = await Promise.all([
    inChunks<{ id: string; nickname: string | null; address_line1: string | null; city: string | null }>(propertyIds, (c) =>
      client.from('properties').select('id, nickname, address_line1, city').in('id', c),
    ),
    inChunks<{ property_id: string; severity: string; rule: string }>(propertyIds, (c) =>
      client.from('utility_alerts').select('property_id, severity, rule').eq('status', 'open').in('property_id', c),
    ),
    inChunks<{ property_id: string; status: string; total_amount: number; invoice_id: string | null; dispute_status: string; utility_type: string }>(propertyIds, (c) =>
      client.from('utility_charges').select('property_id, status, total_amount, invoice_id, dispute_status, utility_type').neq('status', 'void').gte('period_start', sinceDate).in('property_id', c),
    ),
    inChunks<{ property_id: string; meter_id: string; period_start: string; consumption: number | null; quality: string }>(propertyIds, (c) =>
      client.from('meter_period_snapshots').select('property_id, meter_id, period_start, consumption, quality').gte('period_start', sinceDate).in('property_id', c),
    ),
  ]);

  // Unpaid utility invoices: issued, not voided, payments below amount.
  const invoiceIds = [...new Set(charges.filter((c) => c.status === 'invoiced' && c.invoice_id).map((c) => c.invoice_id!))];
  const invoices = await inChunks<{ id: string; status: string; amount: number; voided_at: string | null; period: string; invoice_payments: { amount: number; reversed_at: string | null }[] }>(
    invoiceIds,
    (c) => client.from('invoices').select('id, status, amount, voided_at, period, invoice_payments(amount, reversed_at)').in('id', c),
  );
  const unpaidByInvoice = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== 'issued' || inv.voided_at) continue;
    const paid = (inv.invoice_payments ?? []).filter((p) => !p.reversed_at).reduce((a, p) => a + Math.round(Number(p.amount) * 100), 0);
    const outstanding = Math.round(Number(inv.amount) * 100) - paid;
    if (outstanding > 0) unpaidByInvoice.set(inv.id, outstanding);
  }

  // Monthly consumption basis per property & utility: consumption-kind main meters when present, else submeters.
  const metersByProp = new Map<string, typeof meterRows>();
  for (const m of meterRows ?? []) metersByProp.set(m.property_id, [...(metersByProp.get(m.property_id) ?? []), m]);
  const basisMeterIds = new Set<string>();
  for (const [, ms] of metersByProp) {
    for (const t of ['water', 'electricity']) {
      const cons = (ms ?? []).filter((m) => m.utility_type === t && (m.measurement_kind ?? 'consumption') === 'consumption');
      const mains = cons.filter((m) => m.meter_role === 'main');
      for (const m of mains.length ? mains : cons.filter((x) => x.meter_role === 'submeter')) basisMeterIds.add(m.id);
    }
  }
  const meterType = new Map((meterRows ?? []).map((m) => [m.id, m.utility_type as 'water' | 'electricity']));
  const monthlyMap = new Map<string, { water: number; electricity: number; partial: boolean }>();
  const latestByProp = new Map<string, { period: string; water: number | null; electricity: number | null }>();
  for (const s of snapshots) {
    if (!basisMeterIds.has(s.meter_id)) continue;
    const t = meterType.get(s.meter_id)!;
    const display = s.consumption === null ? 0 : t === 'water' ? Number(s.consumption) / 1000 : Number(s.consumption);
    const key = String(s.period_start).slice(0, 7);
    const cur = monthlyMap.get(key) ?? { water: 0, electricity: 0, partial: false };
    cur[t] += display;
    cur.partial = cur.partial || s.quality !== 'complete' || s.consumption === null;
    monthlyMap.set(key, cur);
    const latest = latestByProp.get(s.property_id);
    if (!latest || String(s.period_start) > latest.period) {
      latestByProp.set(s.property_id, { period: String(s.period_start), water: null, electricity: null });
    }
  }
  for (const s of snapshots) {
    if (!basisMeterIds.has(s.meter_id)) continue;
    const latest = latestByProp.get(s.property_id)!;
    if (String(s.period_start) !== latest.period) continue;
    const t = meterType.get(s.meter_id)!;
    const display = s.consumption === null ? 0 : t === 'water' ? Number(s.consumption) / 1000 : Number(s.consumption);
    latest[t] = Math.round(((latest[t] ?? 0) + display) * 1000) / 1000;
  }

  const rows = properties
    .map((p) => {
      const ownAlerts = alerts.filter((a) => a.property_id === p.id);
      const ownCharges = charges.filter((c) => c.property_id === p.id);
      const sum = (xs: typeof ownCharges) => Math.round(xs.reduce((a, c) => a + Number(c.total_amount), 0) * 100) / 100;
      const unpaidIds = [...new Set(ownCharges.filter((c) => c.invoice_id && unpaidByInvoice.has(c.invoice_id)).map((c) => c.invoice_id!))];
      const ms = metersByProp.get(p.id) ?? [];
      return {
        propertyId: p.id,
        name: p.nickname || p.address_line1 || 'Property',
        city: p.city,
        meters: ms.filter((m) => m.active).length,
        sources: (sourceRows ?? []).filter((s) => s.property_id === p.id && s.active).map((s) => s.source_type),
        alerts: { open: ownAlerts.length, critical: ownAlerts.filter((a) => a.severity === 'critical').length, warning: ownAlerts.filter((a) => a.severity === 'warning').length },
        charges: {
          draftCount: ownCharges.filter((c) => c.status === 'draft').length,
          draftAmount: sum(ownCharges.filter((c) => c.status === 'draft')),
          approvedNotInvoiced: sum(ownCharges.filter((c) => c.status === 'approved')),
          disputed: ownCharges.filter((c) => c.dispute_status === 'open').length,
        },
        unpaidInvoices: { count: unpaidIds.length, outstanding: Math.round(unpaidIds.reduce((a, id) => a + (unpaidByInvoice.get(id) ?? 0), 0)) / 100 },
        lastPeriod: latestByProp.get(p.id) ?? null,
      };
    })
    .sort((a, b) => b.alerts.critical - a.alerts.critical || b.alerts.open - a.alerts.open || a.name.localeCompare(b.name));

  return {
    properties: rows,
    totals: {
      properties: rows.length,
      openAlerts: rows.reduce((a, r) => a + r.alerts.open, 0),
      criticalAlerts: rows.reduce((a, r) => a + r.alerts.critical, 0),
      chargesAwaitingApproval: rows.reduce((a, r) => a + r.charges.draftCount, 0),
      draftAmount: Math.round(rows.reduce((a, r) => a + r.charges.draftAmount, 0) * 100) / 100,
      unpaidInvoices: rows.reduce((a, r) => a + r.unpaidInvoices.count, 0),
      unpaidOutstanding: Math.round(rows.reduce((a, r) => a + r.unpaidInvoices.outstanding, 0) * 100) / 100,
    },
    monthly: [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, waterKl: Math.round(v.water * 1000) / 1000, electricityKwh: Math.round(v.electricity * 1000) / 1000, partial: v.partial })),
  };
}

export type UtilityPortfolio = Awaited<ReturnType<typeof loadUtilityPortfolio>>;
