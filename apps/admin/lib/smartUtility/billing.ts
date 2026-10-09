import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditEvent } from '../audit';
import { consumptionForChain, sastDateString, sastInstant } from './consumption';
import { replacementChain, SMART_METER_COLUMNS, loadPoints, type SmartMeterRow } from './data';
import { computeCharge, type TariffBlock } from './tariffs';

// Utility billing (docs/SMART_UTILITIES_DECISIONS.md #8): draft charges computed from actual
// consumption and the property's tariff → landlord approval → added to DRAFT invoices via the
// existing create_manual_invoice() (accountant-gated, lease/tenant-checked). Nothing is issued,
// posted to the ledger or charged automatically; estimates, drafts and approved charges stay
// separate statuses.

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

function dateToSast(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return sastInstant(y!, m!, day!);
}

export interface GenerateChargesResult {
  created: number;
  existing: number;
  skipped: { meterId: string; label: string; reason: string }[];
}

/** Draft charges for every active unit meter on the property for [periodStart, periodEnd). */
export async function generateCharges(
  serviceClient: SupabaseClient,
  args: { propertyId: string; periodStart: string; periodEnd: string; actorUserId: string },
): Promise<GenerateChargesResult> {
  if (args.periodEnd <= args.periodStart) throw new BillingError('The period end must be after its start.');
  const start = dateToSast(args.periodStart);
  const end = dateToSast(args.periodEnd);

  const { data: meterRows } = await serviceClient.from('utility_meters').select(SMART_METER_COLUMNS).eq('property_id', args.propertyId);
  const all = (meterRows ?? []) as SmartMeterRow[];
  const unitMeters = all.filter((m) => m.active && m.unit_id && m.meter_role === 'submeter');
  const result: GenerateChargesResult = { created: 0, existing: 0, skipped: [] };
  if (unitMeters.length === 0) return result;

  const [{ data: tariffs }, { data: units }] = await Promise.all([
    serviceClient
      .from('utility_tariffs')
      .select('id, utility_type, name, fixed_charge, blocks, vat_inclusive, effective_from, effective_to')
      .eq('property_id', args.propertyId)
      .lte('effective_from', args.periodStart)
      .order('effective_from', { ascending: false }),
    serviceClient.from('units').select('id, unit_label').eq('property_id', args.propertyId),
  ]);
  const unitLabel = new Map((units ?? []).map((u) => [u.id, u.unit_label as string]));
  const chainIds = new Set(unitMeters.flatMap((m) => replacementChain(m, all).map((c) => c.id)));
  const points = await loadPoints(serviceClient, [...chainIds], new Date(start.getTime() - 3 * 86_400_000), new Date(end.getTime() + 3 * 86_400_000));

  for (const m of unitMeters) {
    const label = `${unitLabel.get(m.unit_id!) ?? 'Unit'} ${m.utility_type}`;
    const tariff = (tariffs ?? []).find(
      (t) => t.utility_type === m.utility_type && (!t.effective_to || t.effective_to >= args.periodStart),
    );
    if (!tariff) {
      result.skipped.push({ meterId: m.id, label, reason: `No ${m.utility_type} tariff effective on ${args.periodStart}.` });
      continue;
    }
    const c = consumptionForChain(
      replacementChain(m, all).map((x) => ({ points: points.get(x.id) ?? [], config: { registerDigits: x.register_digits } })),
      start,
      end,
    );
    const consumption = c.consumption === null ? null : m.utility_type === 'water' ? c.consumption / 1000 : c.consumption;
    let charge = { fixedAmount: Number(tariff.fixed_charge), usageAmount: 0, total: Number(tariff.fixed_charge), breakdown: [] as unknown[] };
    if (consumption !== null) {
      charge = computeCharge(Math.round(consumption * 10_000) / 10_000, {
        fixedCharge: Number(tariff.fixed_charge),
        blocks: tariff.blocks as TariffBlock[],
      });
    }

    // The tenant on the unit's lease during the period (if any); recharge needs one to invoice.
    const { data: leases } = await serviceClient
      .from('leases')
      .select('id, start_date, end_date, status, lease_tenants(tenant_id, is_primary)')
      .eq('unit_id', m.unit_id!)
      .lte('start_date', args.periodEnd)
      .order('start_date', { ascending: false });
    const lease = (leases ?? []).find(
      (l) => (!l.end_date || l.end_date >= args.periodStart) && ['active', 'expired', 'terminated'].includes(String(l.status)),
    );
    const tenants = (lease?.lease_tenants ?? []) as { tenant_id: string; is_primary: boolean }[];
    const tenantId = tenants.find((t) => t.is_primary)?.tenant_id ?? tenants[0]?.tenant_id ?? null;

    const { error } = await serviceClient.from('utility_charges').insert({
      org_id: m.org_id,
      property_id: m.property_id,
      unit_id: m.unit_id,
      meter_id: m.id,
      lease_id: lease?.id ?? null,
      tenant_id: tenantId,
      utility_type: m.utility_type,
      period_start: args.periodStart,
      period_end: args.periodEnd,
      opening_reading: c.startValue === null ? null : m.utility_type === 'water' ? c.startValue / 1000 : c.startValue,
      closing_reading: c.endValue === null ? null : m.utility_type === 'water' ? c.endValue / 1000 : c.endValue,
      consumption,
      consumption_quality: c.quality,
      tariff_id: tariff.id,
      tariff_snapshot: {
        name: tariff.name,
        fixedCharge: Number(tariff.fixed_charge),
        blocks: tariff.blocks,
        vatInclusive: tariff.vat_inclusive,
        effectiveFrom: tariff.effective_from,
        breakdown: charge.breakdown,
      },
      fixed_amount: charge.fixedAmount,
      usage_amount: charge.usageAmount,
      total_amount: charge.total,
      status: 'draft',
      created_by: args.actorUserId,
      notes: consumption === null ? 'Consumption could not be calculated for this period (missing readings or a reset).' : null,
    });
    if (error) {
      if (error.code === '23505') {
        result.existing += 1;
        continue;
      }
      throw new Error(`charge insert failed: ${error.message}`);
    }
    result.created += 1;
  }
  return result;
}

/** Draft → approved. A charge without a calculated consumption cannot be approved. */
export async function approveCharges(serviceClient: SupabaseClient, args: { chargeIds: string[]; propertyId: string; actorUserId: string }) {
  const { data: rows } = await serviceClient
    .from('utility_charges')
    .select('id, org_id, status, consumption')
    .in('id', args.chargeIds)
    .eq('property_id', args.propertyId);
  const eligible = (rows ?? []).filter((r) => r.status === 'draft' && r.consumption !== null);
  if (eligible.length === 0) throw new BillingError('No draft charges with a calculated consumption were selected.');
  const now = new Date().toISOString();
  await serviceClient
    .from('utility_charges')
    .update({ status: 'approved', approved_by: args.actorUserId, approved_at: now })
    .in('id', eligible.map((r) => r.id))
    .eq('status', 'draft');
  await writeAuditEvent(serviceClient, {
    orgId: eligible[0]!.org_id,
    actorUserId: args.actorUserId,
    actorType: 'user',
    action: 'utility_charges.approved',
    entityType: 'properties',
    entityId: args.propertyId,
    after: { chargeIds: eligible.map((r) => r.id) },
  });
  return { approved: eligible.length, ignored: args.chargeIds.length - eligible.length };
}

export async function voidCharges(serviceClient: SupabaseClient, args: { chargeIds: string[]; propertyId: string; actorUserId: string }) {
  const { data } = await serviceClient
    .from('utility_charges')
    .update({ status: 'void' })
    .in('id', args.chargeIds)
    .eq('property_id', args.propertyId)
    .in('status', ['draft', 'approved'])
    .select('id, org_id');
  if (data && data.length) {
    await writeAuditEvent(serviceClient, {
      orgId: data[0]!.org_id,
      actorUserId: args.actorUserId,
      actorType: 'user',
      action: 'utility_charges.voided',
      entityType: 'properties',
      entityId: args.propertyId,
      after: { chargeIds: data.map((r) => r.id) },
    });
  }
  return { voided: data?.length ?? 0 };
}

const UNIT = { water: 'kL', electricity: 'kWh' } as const;
const fmt = (n: number) => n.toLocaleString('en-ZA', { maximumFractionDigits: 3 });

/**
 * Approved charges → one DRAFT invoice per lease via create_manual_invoice(), called with the
 * caller's SESSION client so the function's own accountant/lease/tenant checks apply to the real
 * user. Charges are marked invoiced only after the invoice exists. The invoice is never issued here.
 */
export async function invoiceCharges(
  sessionClient: SupabaseClient,
  serviceClient: SupabaseClient,
  args: { chargeIds: string[]; propertyId: string; actorUserId: string; dueInDays?: number },
) {
  const { data: rows } = await serviceClient
    .from('utility_charges')
    .select('id, org_id, lease_id, tenant_id, utility_type, period_start, period_end, consumption, fixed_amount, usage_amount, total_amount, tariff_snapshot, status')
    .in('id', args.chargeIds)
    .eq('property_id', args.propertyId)
    .eq('status', 'approved');
  const ready = (rows ?? []).filter((r) => r.lease_id && r.tenant_id);
  if (ready.length === 0) throw new BillingError('Select approved charges for units with a lease and tenant.');
  const byLease = new Map<string, typeof ready>();
  for (const r of ready) byLease.set(`${r.lease_id}|${r.tenant_id}`, [...(byLease.get(`${r.lease_id}|${r.tenant_id}`) ?? []), r]);

  const today = sastDateString(new Date());
  const due = sastDateString(new Date(Date.now() + (args.dueInDays ?? 14) * 86_400_000));
  const invoices: string[] = [];
  for (const [key, charges] of byLease) {
    const [leaseId, tenantId] = key.split('|');
    const lineItems = charges.flatMap((c) => {
      const label = c.utility_type === 'water' ? 'Water' : 'Electricity';
      const period = `${c.period_start} to ${c.period_end}`;
      const lines = [
        {
          description: `${label} usage ${fmt(Number(c.consumption))} ${UNIT[c.utility_type as 'water' | 'electricity']} (${period}, ${(c.tariff_snapshot as { name?: string })?.name ?? 'tariff'})`,
          quantity: 1,
          unitPrice: Number(c.usage_amount),
        },
      ];
      if (Number(c.fixed_amount) > 0) {
        lines.push({ description: `${label} fixed charge (${period})`, quantity: 1, unitPrice: Number(c.fixed_amount) });
      }
      return lines;
    });
    const { data: invoiceId, error } = await sessionClient.rpc('create_manual_invoice', {
      p_org_id: charges[0]!.org_id,
      p_lease_id: leaseId,
      p_tenant_id: tenantId,
      p_invoice_date: today,
      p_due_date: due,
      p_reference: `UTIL-${charges[0]!.period_start}`,
      p_description: 'Utility recharge (metered)',
      p_notes: 'Generated from approved meter-based utility charges in Proplyst. Review before issuing.',
      p_line_items: lineItems,
    });
    if (error) throw new BillingError(`Could not create the draft invoice: ${error.message}`);
    await serviceClient
      .from('utility_charges')
      .update({ status: 'invoiced', invoice_id: invoiceId })
      .in('id', charges.map((c) => c.id))
      .eq('status', 'approved');
    invoices.push(invoiceId as string);
    await writeAuditEvent(serviceClient, {
      orgId: charges[0]!.org_id,
      actorUserId: args.actorUserId,
      actorType: 'user',
      action: 'utility_charges.invoiced',
      entityType: 'invoices',
      entityId: invoiceId as string,
      after: { chargeIds: charges.map((c) => c.id), draft: true },
    });
  }
  return { invoices, skippedWithoutLease: (rows ?? []).length - ready.length };
}
