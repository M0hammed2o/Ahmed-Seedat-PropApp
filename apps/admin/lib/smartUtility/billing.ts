import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditEvent } from '../audit';
import { bucketConsumption, consumptionForChain, sastDateString, sastInstant, type MeterReadingPoint } from './consumption';
import { loadPoints, replacementChain, SMART_METER_COLUMNS, type SmartMeterRow } from './data';
import { allocateCents, centsToNumber, toScaled } from './money';
import { computeTariffCharge, type Block, type ChargeResult, type Season, type TariffV2, type TouPeriod } from './tariffEngine';

// Utility billing v2 (docs/HYBRID_UTILITIES_ARCHITECTURE.md §E). Charges come ONLY from an explicit billing
// arrangement per unit and utility — the system never assumes a tenant may be charged. Charges are draft
// estimates → landlord approval → added to DRAFT invoices (never issued here). Every charge stores an immutable
// calculation snapshot; approved charges cannot change (DB trigger). Regulatory review flags are attached,
// never auto-resolved.

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

const DAY_MS = 86_400_000;

function dateToSast(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return sastInstant(y!, m!, day!);
}
function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export interface TariffRow {
  id: string;
  name: string;
  utility_type: 'water' | 'electricity';
  tariff_kind: TariffV2['kind'];
  fixed_charge: number | string;
  blocks: Block[];
  tou_periods: TouPeriod[];
  seasons: Season[];
  vat_inclusive: boolean;
  vat_rate: number | string;
  prorate_blocks: boolean;
  unit_id: string | null;
  supply_source_type: string | null;
  effective_from: string;
  effective_to: string | null;
  requires_review: boolean;
}

export const TARIFF_COLUMNS =
  'id, name, utility_type, tariff_kind, fixed_charge, blocks, tou_periods, seasons, vat_inclusive, vat_rate, prorate_blocks, unit_id, supply_source_type, effective_from, effective_to, requires_review';

export function toTariffV2(t: TariffRow): TariffV2 {
  return {
    id: t.id,
    name: t.name,
    kind: t.tariff_kind,
    utilityType: t.utility_type,
    fixedCharge: t.fixed_charge,
    blocks: t.blocks ?? [],
    touPeriods: t.tou_periods ?? [],
    seasons: t.seasons ?? [],
    vatInclusive: t.vat_inclusive,
    vatRate: t.vat_rate,
    prorateBlocks: t.prorate_blocks,
  };
}

/** Unit-specific tariff first, then property tariff; effective on the period start. */
export function pickTariff(tariffs: TariffRow[], utilityType: string, unitId: string | null, onDate: string): TariffRow | null {
  const effective = tariffs.filter(
    (t) => t.utility_type === utilityType && t.effective_from <= onDate && (!t.effective_to || t.effective_to >= onDate) && !t.supply_source_type,
  );
  const byDate = (a: TariffRow, b: TariffRow) => b.effective_from.localeCompare(a.effective_from);
  return effective.filter((t) => unitId && t.unit_id === unitId).sort(byDate)[0] ?? effective.filter((t) => !t.unit_id).sort(byDate)[0] ?? null;
}

export interface Segment {
  leaseId: string;
  tenantId: string | null;
  start: string;
  end: string;
}

export interface LeaseRow {
  id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  lease_tenants?: { tenant_id: string; is_primary: boolean }[] | null;
}

/**
 * Pure: lease segments inside [from, to) (dates; end exclusive), or a refusal when the lease data cannot be billed
 * safely. A terminated/expired lease without an end date has an unknown last day (end_lease() records only the
 * status), and overlapping leases on one unit would bill the same consumption twice — both are refused, never guessed.
 */
export function segmentsFromLeases(leases: LeaseRow[], from: string, to: string): { segments: Segment[]; problem: string | null } {
  const out: Segment[] = [];
  for (const l of [...leases].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
    if (l.start_date >= to) continue;
    if (!l.end_date && l.status !== 'active') {
      return { segments: [], problem: `A ${l.status} lease starting ${l.start_date} has no end date: set the lease end date before billing.` };
    }
    const leaseEndExclusive = l.end_date ? addDays(l.end_date, 1) : null;
    if (leaseEndExclusive && leaseEndExclusive <= from) continue;
    const start = l.start_date > from ? l.start_date : from;
    const end = leaseEndExclusive && leaseEndExclusive < to ? leaseEndExclusive : to;
    if (end <= start) continue;
    const prev = out[out.length - 1];
    if (prev && start < prev.end) {
      return { segments: [], problem: `Leases overlap (${prev.start}–${addDays(prev.end, -1)} and from ${start}): correct the lease dates before billing.` };
    }
    const tenants = (l.lease_tenants ?? []) as { tenant_id: string; is_primary: boolean }[];
    out.push({ leaseId: l.id, tenantId: tenants.find((t) => t.is_primary)?.tenant_id ?? tenants[0]?.tenant_id ?? null, start, end });
  }
  return { segments: out, problem: null };
}

/** Lease segments of a unit inside [from, to). */
export async function leaseSegments(serviceClient: SupabaseClient, unitId: string, from: string, to: string) {
  const { data: leases, error } = await serviceClient
    .from('leases')
    .select('id, start_date, end_date, status, lease_tenants(tenant_id, is_primary)')
    .eq('unit_id', unitId)
    .lt('start_date', to)
    .in('status', ['active', 'expired', 'terminated'])
    .order('start_date');
  if (error) throw new Error(`lease lookup failed: ${error.message}`);
  return segmentsFromLeases((leases ?? []) as LeaseRow[], from, to);
}

/** The part of [from, to) covered by an arrangement (effective_to is inclusive), or null. */
export function arrangementWindow(a: { effective_from: string; effective_to: string | null }, from: string, to: string): { from: string; to: string } | null {
  const s = a.effective_from > from ? a.effective_from : from;
  const endExclusive = a.effective_to ? addDays(a.effective_to, 1) : null;
  const e = endExclusive && endExclusive < to ? endExclusive : to;
  return e > s ? { from: s, to: e } : null;
}

/**
 * Splits a segment where a different tariff takes effect, so each piece is priced at the tariff in force (e.g. the
 * 1 July municipal increase). Returns pieces with their tariff, or the days no tariff covers.
 */
export function splitByTariff(
  tariffs: TariffRow[],
  utilityType: string,
  unitId: string | null,
  seg: { start: string; end: string },
): { pieces: { start: string; end: string; tariff: TariffRow }[]; uncovered: string | null } {
  const cuts = new Set<string>([seg.start]);
  for (const t of tariffs) {
    if (t.utility_type !== utilityType) continue;
    for (const d of [t.effective_from, t.effective_to ? addDays(t.effective_to, 1) : null]) {
      if (d && d > seg.start && d < seg.end) cuts.add(d);
    }
  }
  const sorted = [...cuts].sort();
  const pieces: { start: string; end: string; tariff: TariffRow }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const e = sorted[i + 1] ?? seg.end;
    const t = pickTariff(tariffs, utilityType, unitId, s);
    if (!t) return { pieces: [], uncovered: s };
    const last = pieces[pieces.length - 1];
    if (last && last.tariff.id === t.id) last.end = e;
    else pieces.push({ start: s, end: e, tariff: t });
  }
  return { pieces, uncovered: null };
}

export function reviewFlags(utilityType: string, tariff: TariffRow | null, result: ChargeResult | null): string[] {
  const flags = new Set<string>(result?.flags ?? []);
  if (utilityType === 'electricity') flags.add('electricity_resale_nersa_review');
  if (utilityType === 'water') flags.add('water_services_intermediary_review');
  if (tariff?.requires_review) flags.add('tariff_marked_for_review');
  return [...flags];
}

export interface GenerateChargesResult {
  created: number;
  existing: number;
  skipped: { unitId: string; label: string; reason: string }[];
}

interface Ctx {
  service: SupabaseClient;
  propertyId: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  periodDays: number;
  actorUserId: string | null;
  meters: SmartMeterRow[];
  tariffs: TariffRow[];
  unitLabels: Map<string, string>;
  unitSize: Map<string, number | null>;
  points: Map<string, MeterReadingPoint[]>;
}

async function insertCharge(ctx: Ctx, row: Record<string, unknown>): Promise<'created' | 'existing'> {
  const { data, error } = await ctx.service.from('utility_charges').insert(row).select('id, lease_id, total_amount, amount_excl_vat, vat_amount, calculation').single();
  if (error) {
    // 23505: same live charge key; 23P01: overlaps a live charge of the same unit/utility/type (migration 179) —
    // e.g. a re-run after a meter replacement or an arrangement change. Never billed twice.
    if (error.code === '23505' || error.code === '23P01') return 'existing';
    throw new Error(`charge insert failed: ${error.message}`);
  }
  await applyOpenCredits(
    ctx.service,
    data.id as string,
    data.lease_id as string | null,
    Number(data.total_amount),
    data.calculation as Record<string, unknown> | null,
    data.amount_excl_vat === null ? null : Number(data.amount_excl_vat),
    data.vat_amount === null ? null : Number(data.vat_amount),
  );
  return 'created';
}

/** Consumption of one meter chain over [start, end) in display units. */
function chainConsumption(ctx: Ctx, meter: SmartMeterRow, start: string, end: string) {
  const c = consumptionForChain(
    replacementChain(meter, ctx.meters).map((x) => ({ points: ctx.points.get(x.id) ?? [], config: { registerDigits: x.register_digits } })),
    dateToSast(start),
    dateToSast(end),
  );
  const factor = meter.utility_type === 'water' ? 1000 : 1;
  return {
    consumption: c.consumption === null ? null : c.consumption / factor,
    quality: c.quality,
    opening: c.startValue === null ? null : c.startValue / factor,
    closing: c.endValue === null ? null : c.endValue / factor,
  };
}

function hourlyFor(ctx: Ctx, meter: SmartMeterRow, start: string, end: string) {
  const factor = meter.utility_type === 'water' ? 1000 : 1;
  return bucketConsumption(ctx.points.get(meter.id) ?? [], dateToSast(start), dateToSast(end), 60, { registerDigits: meter.register_digits }, 3).map(
    (b) => ({ start: b.start, value: b.consumption === null ? null : b.consumption / factor }),
  );
}

function dailyFor(ctx: Ctx, meter: SmartMeterRow, start: string, end: string) {
  const factor = meter.utility_type === 'water' ? 1000 : 1;
  return bucketConsumption(ctx.points.get(meter.id) ?? [], dateToSast(start), dateToSast(end), 1440, { registerDigits: meter.register_digits }, 30).map(
    (b) => ({ date: sastDateString(b.start), value: b.consumption === null ? null : b.consumption / factor }),
  );
}

function money(result: ChargeResult) {
  const usage = result.lines.filter((l) => l.kind === 'usage').reduce((a, l) => a + l.inclCents, 0);
  const fixed = result.lines.filter((l) => l.kind === 'fixed').reduce((a, l) => a + l.inclCents, 0);
  return {
    usage_amount: usage / 100,
    fixed_amount: fixed / 100,
    total_amount: result.totals.inclCents / 100,
    amount_excl_vat: result.totals.exclCents / 100,
    vat_amount: result.totals.vatCents / 100,
  };
}

export async function generateCharges(
  serviceClient: SupabaseClient,
  args: { propertyId: string; periodStart: string; periodEnd: string; actorUserId: string | null },
): Promise<GenerateChargesResult> {
  if (args.periodEnd <= args.periodStart) throw new BillingError('The period end must be after its start.');
  const periodDays = daysBetween(args.periodStart, args.periodEnd);
  const { data: property } = await serviceClient.from('properties').select('id, org_id').eq('id', args.propertyId).single();
  if (!property) throw new BillingError('Property not found.');

  const [{ data: meterRows }, { data: tariffs }, { data: units }, { data: arrangements }] = await Promise.all([
    serviceClient.from('utility_meters').select(SMART_METER_COLUMNS).eq('property_id', args.propertyId).eq('org_id', property.org_id),
    serviceClient.from('utility_tariffs').select(TARIFF_COLUMNS).eq('property_id', args.propertyId).eq('org_id', property.org_id),
    serviceClient.from('units').select('id, unit_label, size_sqm').eq('property_id', args.propertyId),
    serviceClient
      .from('utility_billing_arrangements')
      .select('id, unit_id, utility_type, arrangement, invoice_mode, allocation_group_id, fixed_amount, allowance_quantity, effective_from, effective_to')
      .eq('property_id', args.propertyId)
      .lt('effective_from', args.periodEnd),
  ]);
  const meters = (meterRows ?? []) as SmartMeterRow[];
  const start = dateToSast(args.periodStart);
  const end = dateToSast(args.periodEnd);
  const points = await loadPoints(serviceClient, meters.map((m) => m.id), new Date(start.getTime() - 3 * DAY_MS), new Date(end.getTime() + 3 * DAY_MS));
  const ctx: Ctx = {
    service: serviceClient,
    propertyId: args.propertyId,
    orgId: property.org_id,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    periodDays,
    actorUserId: args.actorUserId,
    meters,
    tariffs: (tariffs ?? []) as TariffRow[],
    unitLabels: new Map((units ?? []).map((u) => [u.id, u.unit_label as string])),
    unitSize: new Map((units ?? []).map((u) => [u.id, u.size_sqm === null ? null : Number(u.size_sqm)])),
    points,
  };
  const result: GenerateChargesResult = { created: 0, existing: 0, skipped: [] };
  const active = (arrangements ?? []).filter((a) => !a.effective_to || a.effective_to >= args.periodStart);
  const count = (r: 'created' | 'existing') => (r === 'created' ? (result.created += 1) : (result.existing += 1));

  // Units with meters but no arrangement are reported, never charged.
  for (const m of meters.filter((x) => x.active && x.unit_id && x.meter_role === 'submeter' && x.measurement_kind === 'consumption')) {
    if (!active.some((a) => a.unit_id === m.unit_id && a.utility_type === m.utility_type)) {
      result.skipped.push({ unitId: m.unit_id!, label: `${ctx.unitLabels.get(m.unit_id!) ?? 'Unit'} ${m.utility_type}`, reason: 'No billing arrangement — set one before any charge is calculated.' });
    }
  }

  const sharedDone = new Set<string>();
  for (const a of active) {
    const label = `${ctx.unitLabels.get(a.unit_id) ?? 'Unit'} ${a.utility_type}`;
    if (['landlord_paid', 'included_in_rent', 'tenant_direct'].includes(a.arrangement)) {
      result.skipped.push({ unitId: a.unit_id, label, reason: `Arrangement "${a.arrangement.replace(/_/g, ' ')}": nothing to recharge.` });
      continue;
    }
    if (a.arrangement === 'shared_allocation') {
      if (!sharedDone.has(a.allocation_group_id)) {
        sharedDone.add(a.allocation_group_id);
        await allocateSharedMeter(ctx, a.allocation_group_id, active, result);
      }
      continue;
    }
    // Only the part of the period this arrangement covers (a mid-period change closes the old one the day before).
    const window = arrangementWindow(a, args.periodStart, args.periodEnd);
    if (!window) continue;
    const leases = await leaseSegments(serviceClient, a.unit_id, window.from, window.to);
    if (leases.problem) {
      result.skipped.push({ unitId: a.unit_id, label, reason: leases.problem });
      continue;
    }
    const segments = leases.segments;
    if (segments.length === 0) {
      result.skipped.push({ unitId: a.unit_id, label, reason: 'No lease during this period (vacant): nothing to recharge.' });
      continue;
    }
    if (a.arrangement === 'fixed_allowance') {
      for (const seg of segments) {
        const segDays = daysBetween(seg.start, seg.end);
        const cents = allocateCents(BigInt(Math.round(Number(a.fixed_amount) * 100)), [BigInt(segDays), BigInt(periodDays - segDays)])[0]!;
        const total = centsToNumber(cents);
        count(
          await insertCharge(ctx, {
            org_id: ctx.orgId,
            property_id: ctx.propertyId,
            unit_id: a.unit_id,
            meter_id: null,
            arrangement_id: a.id,
            lease_id: seg.leaseId,
            tenant_id: seg.tenantId,
            utility_type: a.utility_type,
            charge_type: 'allowance_fee',
            period_start: args.periodStart,
            period_end: args.periodEnd,
            segment_start: seg.start,
            segment_end: seg.end,
            proration_factor: segDays / periodDays,
            consumption: null,
            consumption_quality: 'complete',
            fixed_amount: total,
            usage_amount: 0,
            total_amount: total,
            amount_excl_vat: null,
            vat_amount: null,
            calculation: { kind: 'fixed_allowance', fixedAmount: Number(a.fixed_amount), segmentDays: segDays, periodDays, note: 'Agreed fixed monthly utility amount (VAT treatment per lease).' },
            review_flags: reviewFlags(a.utility_type, null, null),
            created_by: args.actorUserId,
          }),
        );
      }
      if (!a.allowance_quantity) continue; // pure fixed fee: no metered excess
    }
    // The unit's OWN consumption submeters only (never check/main meters, never generation/battery/pump/source).
    const unitMeters = meters.filter(
      (m) => m.active && m.unit_id === a.unit_id && m.utility_type === a.utility_type && m.measurement_kind === 'consumption' && m.meter_role === 'submeter',
    );
    if (unitMeters.length === 0) {
      result.skipped.push({ unitId: a.unit_id, label, reason: 'No consumption submeter for this unit.' });
      continue;
    }
    for (const seg of segments) {
      const split = splitByTariff(ctx.tariffs, a.utility_type, a.unit_id, seg);
      if (split.uncovered) {
        result.skipped.push({ unitId: a.unit_id, label, reason: `No ${a.utility_type} tariff effective on ${split.uncovered}.` });
        continue;
      }
      for (const piece of split.pieces) {
        const tariff = piece.tariff;
        const tou = tariff.tariff_kind === 'tou';
        const chains = unitMeters.map((m) => replacementChain(m, meters));
        let refusal: string | null = null;
        if (tou && a.arrangement === 'fixed_allowance') {
          refusal = 'A time-of-use tariff cannot be combined with an included allowance: use a block or flat tariff for this arrangement.';
        } else if (tou && (unitMeters.length > 1 || chains.some((c) => c.length > 1))) {
          refusal = 'Time-of-use pricing needs one meter with no replacement in the period.';
        }
        // Several meters of the same utility in one unit (e.g. geyser + plugs) are one supply: one fixed charge and
        // one set of block allowances on their combined use.
        const parts = unitMeters.map((m) => chainConsumption(ctx, m, piece.start, piece.end));
        const known = parts.every((p) => p.consumption !== null);
        const consumption = known ? Math.round(parts.reduce((x, p) => x + (p.consumption ?? 0), 0) * 10_000) / 10_000 : null;
        const quality = parts.some((p) => p.quality === 'insufficient') ? 'insufficient' : parts.some((p) => p.quality === 'partial') ? 'partial' : 'complete';
        const single = unitMeters.length === 1 ? parts[0]! : null;
        const calc: ChargeResult = refusal
          ? { ok: false, refusal, lines: [], totals: { exclCents: 0, vatCents: 0, inclCents: 0 }, prorationFactor: daysBetween(piece.start, piece.end) / periodDays, notes: [], flags: [] }
          : computeTariffCharge(a.arrangement === 'fixed_allowance' ? { ...toTariffV2(tariff), fixedCharge: 0 } : toTariffV2(tariff), {
              consumption,
              segmentStart: dateToSast(piece.start),
              segmentEnd: dateToSast(piece.end),
              periodDays,
              daily: unitMeters.length === 1 ? dailyFor(ctx, unitMeters[0]!, piece.start, piece.end) : undefined,
              hourly: tou ? hourlyFor(ctx, unitMeters[0]!, piece.start, piece.end) : undefined,
              allowanceQuantity: a.arrangement === 'fixed_allowance' ? Number(a.allowance_quantity) : null,
            });
        const amounts = calc.ok ? money(calc) : { usage_amount: 0, fixed_amount: 0, total_amount: 0, amount_excl_vat: null, vat_amount: null };
        const tariffNote = split.pieces.length > 1 ? `Tariff changed within the period: priced ${piece.start} to ${addDays(piece.end, -1)} at "${tariff.name}".` : null;
        count(
          await insertCharge(ctx, {
            org_id: ctx.orgId,
            property_id: ctx.propertyId,
            unit_id: a.unit_id,
            meter_id: unitMeters.length === 1 ? unitMeters[0]!.id : null,
            arrangement_id: a.id,
            lease_id: seg.leaseId,
            tenant_id: seg.tenantId,
            utility_type: a.utility_type,
            charge_type: a.arrangement === 'fixed_allowance' ? 'excess' : 'consumption',
            period_start: args.periodStart,
            period_end: args.periodEnd,
            segment_start: piece.start,
            segment_end: piece.end,
            proration_factor: calc.prorationFactor,
            opening_reading: single ? single.opening : null,
            closing_reading: single ? single.closing : null,
            consumption,
            consumption_quality: quality,
            tariff_id: tariff.id,
            tariff_snapshot: { ...tariff },
            calculation: {
              ...calc,
              meterIds: unitMeters.map((m) => m.id),
              meters: parts.map((p, i) => ({ meterId: unitMeters[i]!.id, consumption: p.consumption, quality: p.quality, opening: p.opening, closing: p.closing })),
            },
            ...amounts,
            review_flags: reviewFlags(a.utility_type, tariff, calc),
            notes: calc.ok ? tariffNote : calc.refusal,
            created_by: args.actorUserId,
          }),
        );
      }
    }
  }
  return result;
}

/** Shared meter: price the meter's full-period use once, then split the rand amount exactly by weights. */
async function allocateSharedMeter(
  ctx: Ctx,
  groupId: string,
  arrangements: { id: string; unit_id: string; utility_type: string; arrangement: string; allocation_group_id: string | null; effective_from: string; effective_to: string | null }[],
  result: GenerateChargesResult,
) {
  const { data: group } = await ctx.service
    .from('utility_allocation_groups')
    .select('id, meter_id, name, method, landlord_share_pct, active, utility_allocation_members(unit_id, percentage, occupants)')
    .eq('id', groupId)
    .single();
  if (!group || !group.active) return;
  const meter = ctx.meters.find((m) => m.id === group.meter_id);
  if (!meter) return;
  const tariff = pickTariff(ctx.tariffs, meter.utility_type, null, ctx.periodStart);
  const members = (group.utility_allocation_members ?? []) as { unit_id: string; percentage: number | null; occupants: number | null }[];
  if (!tariff) {
    for (const mem of members) result.skipped.push({ unitId: mem.unit_id, label: group.name, reason: `No ${meter.utility_type} tariff effective on ${ctx.periodStart}.` });
    return;
  }
  // The shared meter is priced once for the whole period; a tariff change inside it cannot be split per tenant.
  const split = splitByTariff(ctx.tariffs, meter.utility_type, null, { start: ctx.periodStart, end: ctx.periodEnd });
  if (split.uncovered || split.pieces.length !== 1) {
    for (const mem of members) {
      result.skipped.push({ unitId: mem.unit_id, label: group.name, reason: 'The tariff changes within this period: calculate the shared meter for each tariff period separately.' });
    }
    return;
  }
  const c = chainConsumption(ctx, meter, ctx.periodStart, ctx.periodEnd);
  const calc = computeTariffCharge(toTariffV2(tariff), {
    consumption: c.consumption,
    segmentStart: dateToSast(ctx.periodStart),
    segmentEnd: dateToSast(ctx.periodEnd),
    periodDays: ctx.periodDays,
    daily: dailyFor(ctx, meter, ctx.periodStart, ctx.periodEnd),
    hourly: tariff.tariff_kind === 'tou' ? hourlyFor(ctx, meter, ctx.periodStart, ctx.periodEnd) : undefined,
  });
  if (!calc.ok) {
    for (const mem of members) result.skipped.push({ unitId: mem.unit_id, label: group.name, reason: calc.refusal ?? 'Could not price the shared meter.' });
    return;
  }
  // Weights per member (scaled): the landlord share is carved out first.
  const weight = (mem: (typeof members)[number]): bigint => {
    if (group.method === 'percentage') return toScaled(mem.percentage ?? 0);
    if (group.method === 'floor_area') return toScaled(ctx.unitSize.get(mem.unit_id) ?? 0);
    if (group.method === 'occupancy') return BigInt(mem.occupants ?? 0) * 1_000_000n;
    return 1_000_000n;
  };
  const recoverableShare = (100 - Number(group.landlord_share_pct)) / 100;
  const memberWeights = members.map(weight);
  const memberWeightSum = memberWeights.reduce((x, y) => x + y, 0n);
  if (memberWeightSum === 0n) {
    for (const mem of members) result.skipped.push({ unitId: mem.unit_id, label: group.name, reason: `Allocation weights are all zero (${group.method}).` });
    return;
  }
  // percentage method: member percentages already exclude the landlord share; others scale by recoverable share
  const totalIncl = BigInt(calc.totals.inclCents);
  const totalExcl = BigInt(calc.totals.exclCents);
  const recoverIncl = group.method === 'percentage' ? totalIncl : (totalIncl * BigInt(Math.round(recoverableShare * 1_000_000))) / 1_000_000n;
  const recoverExcl = group.method === 'percentage' ? totalExcl : (totalExcl * BigInt(Math.round(recoverableShare * 1_000_000))) / 1_000_000n;
  const weightsWithLandlord = group.method === 'percentage' ? [...memberWeights, toScaled(group.landlord_share_pct)] : memberWeights;
  const inclParts = allocateCents(recoverIncl, weightsWithLandlord);
  const exclParts = allocateCents(recoverExcl, weightsWithLandlord);

  for (let i = 0; i < members.length; i++) {
    const mem = members[i]!;
    const arrangement = arrangements.find((a) => a.unit_id === mem.unit_id && a.allocation_group_id === groupId && a.arrangement === 'shared_allocation');
    const label = `${ctx.unitLabels.get(mem.unit_id) ?? 'Unit'} (${group.name})`;
    if (!arrangement) {
      result.skipped.push({ unitId: mem.unit_id, label, reason: 'Unit is in the shared group but has no shared-allocation arrangement: not charged.' });
      continue;
    }
    // Only the days this member's arrangement covers; days outside it stay with the landlord.
    const window = arrangementWindow(arrangement, ctx.periodStart, ctx.periodEnd);
    if (!window) continue;
    const leases = await leaseSegments(ctx.service, mem.unit_id, window.from, window.to);
    if (leases.problem) {
      result.skipped.push({ unitId: mem.unit_id, label, reason: leases.problem });
      continue;
    }
    const segments = leases.segments;
    if (segments.length === 0) {
      result.skipped.push({ unitId: mem.unit_id, label, reason: 'Vacant during this period: its share stays with the landlord.' });
      continue;
    }
    // Split the unit's share across its lease segments by days; uncovered days stay with the landlord.
    const segDays = segments.map((s) => BigInt(daysBetween(s.start, s.end)));
    const vacantDays = BigInt(ctx.periodDays) - segDays.reduce((x, y) => x + y, 0n);
    const segIncl = allocateCents(inclParts[i]!, [...segDays, vacantDays > 0n ? vacantDays : 0n]);
    const segExcl = allocateCents(exclParts[i]!, [...segDays, vacantDays > 0n ? vacantDays : 0n]);
    const share = Number(memberWeights[i]!) / Number(memberWeightSum);
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]!;
      const incl = segIncl[s]!;
      const excl = segExcl[s]!;
      const r = await insertCharge(ctx, {
        org_id: ctx.orgId,
        property_id: ctx.propertyId,
        unit_id: mem.unit_id,
        meter_id: meter.id,
        arrangement_id: arrangement.id,
        allocation_group_id: groupId,
        allocation_share: Math.round(share * recoverableShare * 1_000_000) / 1_000_000,
        lease_id: seg.leaseId,
        tenant_id: seg.tenantId,
        utility_type: meter.utility_type,
        charge_type: 'allocation',
        period_start: ctx.periodStart,
        period_end: ctx.periodEnd,
        segment_start: seg.start,
        segment_end: seg.end,
        proration_factor: Number(segDays[s]!) / ctx.periodDays,
        consumption: c.consumption === null ? null : Math.round(c.consumption * share * recoverableShare * Number(segDays[s]!) / ctx.periodDays * 1000) / 1000,
        consumption_quality: c.quality,
        tariff_id: tariff.id,
        tariff_snapshot: { ...tariff },
        calculation: {
          kind: 'shared_allocation',
          group: group.name,
          method: group.method,
          landlordSharePct: Number(group.landlord_share_pct),
          meterConsumption: c.consumption,
          meterCost: calc.totals,
          unitShare: share,
          segmentDays: Number(segDays[s]!),
          periodDays: ctx.periodDays,
          meterCalculation: calc,
        },
        usage_amount: centsToNumber(incl),
        fixed_amount: 0,
        total_amount: centsToNumber(incl),
        amount_excl_vat: centsToNumber(excl),
        vat_amount: centsToNumber(incl - excl),
        review_flags: [...reviewFlags(meter.utility_type, tariff, calc), 'shared_meter_allocation_requires_lease_clause'],
        created_by: ctx.actorUserId,
      });
      if (r === 'created') result.created += 1;
      else result.existing += 1;
    }
  }
}

/**
 * VAT inside a VAT-inclusive total after a credit or adjustment changed it: the same proportion as the original
 * calculation (so any VAT rate is respected), half-up to the cent; excl = total − VAT. Null stays null (no VAT shown).
 */
export function rescaleVat(origTotal: number, origExcl: number | null, origVat: number | null, newTotal: number): { excl: number | null; vat: number | null } {
  if (origVat === null || origExcl === null) return { excl: null, vat: null };
  const ot = BigInt(Math.round(origTotal * 100));
  const ov = BigInt(Math.round(origVat * 100));
  const nt = BigInt(Math.round(newTotal * 100));
  if (ot === 0n) return { excl: newTotal, vat: 0 };
  const num = ov * nt * 2n + ot; // half-up for non-negative values
  const vat = num / (ot * 2n);
  return { excl: Number(nt - vat) / 100, vat: Number(vat) / 100 };
}

/**
 * Applies open utility credits of the same lease to a new charge (never below zero). Which credits were used is
 * recorded on the charge (calculation.creditsApplied) so voiding the charge gives them back.
 */
async function applyOpenCredits(
  serviceClient: SupabaseClient,
  chargeId: string,
  leaseId: string | null,
  total: number,
  calculation: Record<string, unknown> | null,
  excl: number | null = null,
  vat: number | null = null,
) {
  if (!leaseId || total <= 0) return;
  const { data: credits } = await serviceClient
    .from('utility_credits')
    .select('id, remaining')
    .eq('lease_id', leaseId)
    .eq('status', 'open')
    .order('created_at');
  let left = Math.round(total * 100);
  let applied = 0;
  const used: { creditId: string; amount: number }[] = [];
  for (const c of credits ?? []) {
    if (left <= 0) break;
    const rem = Math.round(Number(c.remaining) * 100);
    const use = Math.min(rem, left);
    // Compare-and-set on `remaining`: a concurrent run that already spent this credit updates nothing here.
    const { data: took } = await serviceClient
      .from('utility_credits')
      .update({ remaining: (rem - use) / 100, status: rem - use === 0 ? 'applied' : 'open' })
      .eq('id', c.id)
      .eq('status', 'open')
      .eq('remaining', Number(c.remaining))
      .select('id');
    if (!took || took.length === 0) continue;
    left -= use;
    applied += use;
    used.push({ creditId: c.id, amount: use / 100 });
  }
  if (applied > 0) {
    await serviceClient
      .from('utility_charges')
      .update({
        credit_applied: applied / 100,
        total_amount: left / 100,
        ...(() => {
          const v = rescaleVat(total, excl, vat, left / 100);
          return { amount_excl_vat: v.excl, vat_amount: v.vat };
        })(),
        calculation: { ...(calculation ?? {}), creditsApplied: used, beforeCredit: { total, excl, vat } },
      })
      .eq('id', chargeId);
  }
}

async function chargesFor(serviceClient: SupabaseClient, ids: string[], propertyId: string) {
  const { data } = await serviceClient
    .from('utility_charges')
    .select('id, org_id, status, consumption, charge_type, dispute_status, total_amount, calculation, lease_id, tenant_id, arrangement_id')
    .in('id', ids)
    .eq('property_id', propertyId);
  return data ?? [];
}

export async function approveCharges(serviceClient: SupabaseClient, args: { chargeIds: string[]; propertyId: string; actorUserId: string }) {
  const rows = await chargesFor(serviceClient, args.chargeIds, args.propertyId);
  const eligible = rows.filter(
    (r) =>
      r.status === 'draft' &&
      r.dispute_status !== 'open' &&
      !(r.charge_type === 'consumption' || r.charge_type === 'excess' ? r.consumption === null || (r.calculation as { ok?: boolean } | null)?.ok === false : false),
  );
  if (eligible.length === 0) throw new BillingError('No approvable charges selected (drafts only; not disputed; consumption calculated).');
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
    .select('id, org_id, calculation');
  // Give back any credits the voided charges consumed.
  for (const row of data ?? []) {
    const used = ((row.calculation as { creditsApplied?: { creditId: string; amount: number }[] } | null)?.creditsApplied ?? []);
    for (const u of used) {
      const { data: credit } = await serviceClient.from('utility_credits').select('id, remaining, status').eq('id', u.creditId).maybeSingle();
      if (!credit || credit.status === 'cancelled') continue;
      await serviceClient
        .from('utility_credits')
        .update({ remaining: Math.round((Number(credit.remaining) + u.amount) * 100) / 100, status: 'open' })
        .eq('id', credit.id);
    }
  }
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

/** Manual adjustment on a DRAFT charge (audited); approved charges are immutable. */
export async function adjustCharge(serviceClient: SupabaseClient, args: { chargeId: string; propertyId: string; amount: number; reason: string; actorUserId: string }) {
  const { data: c } = await serviceClient
    .from('utility_charges')
    .select('id, org_id, status, total_amount, adjustment_total, amount_excl_vat, vat_amount')
    .eq('id', args.chargeId)
    .eq('property_id', args.propertyId)
    .single();
  if (!c) throw new BillingError('Charge not found.');
  if (c.status !== 'draft') throw new BillingError('Only draft charges can be adjusted; void and recalculate, or record a credit after invoicing.');
  const newTotal = Math.round((Number(c.total_amount) + args.amount) * 100) / 100;
  if (newTotal < 0) throw new BillingError('An adjustment cannot make the charge negative.');
  await serviceClient.from('utility_charge_adjustments').insert({ org_id: c.org_id, property_id: args.propertyId, charge_id: c.id, amount: args.amount, reason: args.reason, created_by: args.actorUserId });
  await serviceClient
    .from('utility_charges')
    .update({
      total_amount: newTotal,
      adjustment_total: Math.round((Number(c.adjustment_total) + args.amount) * 100) / 100,
      ...(() => {
        const v = rescaleVat(Number(c.total_amount), c.amount_excl_vat === null ? null : Number(c.amount_excl_vat), c.vat_amount === null ? null : Number(c.vat_amount), newTotal);
        return { amount_excl_vat: v.excl, vat_amount: v.vat };
      })(),
    })
    .eq('id', c.id)
    .eq('status', 'draft');
  return { total: newTotal };
}

export async function disputeCharge(serviceClient: SupabaseClient, args: { chargeId: string; propertyId: string; action: 'open' | 'resolve'; text: string; actorUserId: string }) {
  const now = new Date().toISOString();
  const patch =
    args.action === 'open'
      ? { dispute_status: 'open', dispute_reason: args.text, disputed_at: now, dispute_resolution: null, dispute_resolved_at: null }
      : { dispute_status: 'resolved', dispute_resolution: args.text, dispute_resolved_at: now };
  const { data } = await serviceClient.from('utility_charges').update(patch).eq('id', args.chargeId).eq('property_id', args.propertyId).neq('status', 'void').select('id, org_id').single();
  if (!data) throw new BillingError('Charge not found.');
  await writeAuditEvent(serviceClient, {
    orgId: data.org_id,
    actorUserId: args.actorUserId,
    actorType: 'user',
    action: `utility_charge.dispute_${args.action === 'open' ? 'opened' : 'resolved'}`,
    entityType: 'utility_charges',
    entityId: data.id,
    after: { text: args.text },
  });
  return { disputeStatus: patch.dispute_status };
}

/** A credit against an INVOICED charge (the invoice may already be issued/paid); applied to the next charge. */
export async function creditCharge(serviceClient: SupabaseClient, args: { chargeId: string; propertyId: string; amount: number; reason: string; actorUserId: string }) {
  const { data: c } = await serviceClient
    .from('utility_charges')
    .select('id, org_id, status, total_amount, lease_id, tenant_id, unit_id')
    .eq('id', args.chargeId)
    .eq('property_id', args.propertyId)
    .single();
  if (!c) throw new BillingError('Charge not found.');
  if (c.status !== 'invoiced' || !c.lease_id) throw new BillingError('Credits are for invoiced charges; void or adjust drafts instead.');
  const { data: prior } = await serviceClient.from('utility_credits').select('amount').eq('source_charge_id', c.id).neq('status', 'cancelled');
  const already = (prior ?? []).reduce((a, p) => a + Number(p.amount), 0);
  if (args.amount + already > Number(c.total_amount) + 0.0001) throw new BillingError('Credits cannot exceed the charged amount.');
  const { data } = await serviceClient
    .from('utility_credits')
    .insert({ org_id: c.org_id, property_id: args.propertyId, lease_id: c.lease_id, tenant_id: c.tenant_id, unit_id: c.unit_id, source_charge_id: c.id, amount: args.amount, remaining: args.amount, reason: args.reason, created_by: args.actorUserId })
    .select('id')
    .single();
  return { creditId: data!.id };
}

const UNIT = { water: 'kL', electricity: 'kWh' } as const;
const fmt = (n: number) => n.toLocaleString('en-ZA', { maximumFractionDigits: 3 });
const rand = (n: number) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Approved charges → DRAFT invoices via create_manual_invoice()/update_manual_invoice() on the caller's SESSION
 * (their accountant/lease/tenant checks apply). invoice_mode 'with_draft_invoice' appends to an existing DRAFT
 * manual invoice of the lease due in the same month; otherwise a separate draft. Never issued here.
 */
export async function invoiceCharges(
  sessionClient: SupabaseClient,
  serviceClient: SupabaseClient,
  args: { chargeIds: string[]; propertyId: string; actorUserId: string; dueInDays?: number },
) {
  const { data: rows } = await serviceClient
    .from('utility_charges')
    .select('id, org_id, lease_id, tenant_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption, total_amount, vat_amount, tariff_snapshot, calculation, status, dispute_status, credit_applied, adjustment_total, arrangement_id, utility_billing_arrangements(invoice_mode), units(unit_label)')
    .in('id', args.chargeIds)
    .eq('property_id', args.propertyId)
    .eq('status', 'approved');
  const ready = (rows ?? []).filter((r) => r.lease_id && r.tenant_id && r.dispute_status !== 'open' && Number(r.total_amount) > 0);
  if (ready.length === 0) throw new BillingError('Select approved, undisputed charges (above R0) for units with a lease and tenant.');
  const byLease = new Map<string, typeof ready>();
  for (const r of ready) byLease.set(`${r.lease_id}|${r.tenant_id}`, [...(byLease.get(`${r.lease_id}|${r.tenant_id}`) ?? []), r]);

  const today = sastDateString(new Date());
  const due = sastDateString(new Date(Date.now() + (args.dueInDays ?? 14) * DAY_MS));
  const invoices: { invoiceId: string; mode: 'separate' | 'appended' }[] = [];
  for (const [key, candidates] of byLease) {
    const [leaseId, tenantId] = key.split('|') as [string, string];
    // Claim the charges first (approved → invoiced, conditional): a concurrent request or double click that already
    // claimed them gets nothing here, so the same charge can never land on two invoices.
    const { data: claimed, error: claimError } = await serviceClient
      .from('utility_charges')
      .update({ status: 'invoiced' })
      .in('id', candidates.map((c) => c.id))
      .eq('status', 'approved')
      .select('id');
    if (claimError) throw new Error(`could not claim charges: ${claimError.message}`);
    const claimedIds = new Set((claimed ?? []).map((c) => c.id as string));
    const charges = candidates.filter((c) => claimedIds.has(c.id));
    if (charges.length === 0) continue;
    const release = () => serviceClient.from('utility_charges').update({ status: 'approved' }).in('id', [...claimedIds]).eq('status', 'invoiced').is('invoice_id', null);
    const lines = charges.map((c) => {
      const label = c.utility_type === 'water' ? 'Water' : 'Electricity';
      const period = `${c.segment_start ?? c.period_start} to ${addDays(c.segment_end ?? c.period_end, -1)}`;
      const kind =
        c.charge_type === 'allocation' ? 'shared meter share' : c.charge_type === 'allowance_fee' ? 'fixed utility amount' : c.charge_type === 'excess' ? 'usage above allowance' : 'usage';
      const qty = c.consumption !== null && c.charge_type !== 'allowance_fee' ? ` ${fmt(Number(c.consumption))} ${UNIT[c.utility_type as 'water' | 'electricity']}` : '';
      const vat = Number(c.vat_amount ?? 0) > 0 ? `, incl. VAT ${rand(Number(c.vat_amount))}` : '';
      const credit = Number(c.credit_applied) > 0 ? `, after credit ${rand(Number(c.credit_applied))}` : '';
      // Metered charges untouched by a credit or adjustment show usage and fixed charge as separate lines (as the
      // municipal account does); otherwise one line carrying the final amount, with the detail on the statement.
      const calcLines = ((c.calculation as { lines?: { kind: string; inclCents: number }[] } | null)?.lines ?? []);
      const usageCents = calcLines.filter((l) => l.kind === 'usage').reduce((a, l) => a + l.inclCents, 0);
      const fixedCents = calcLines.filter((l) => l.kind === 'fixed').reduce((a, l) => a + l.inclCents, 0);
      const untouched = Number(c.credit_applied) === 0 && Number(c.adjustment_total) === 0;
      if ((c.charge_type === 'consumption' || c.charge_type === 'excess') && untouched && fixedCents > 0 && usageCents + fixedCents === Math.round(Number(c.total_amount) * 100)) {
        return [
          { description: `${label} ${kind}${qty} (${period})`.slice(0, 500), quantity: 1, unitPrice: usageCents / 100 },
          { description: `${label} fixed charge (${period}${vat})`.slice(0, 500), quantity: 1, unitPrice: fixedCents / 100 },
        ].filter((l) => l.unitPrice > 0);
      }
      return [{ description: `${label} ${kind}${qty} (${period}${vat}${credit})`.slice(0, 500), quantity: 1, unitPrice: Number(c.total_amount) }];
    }).flat();
    const wantsAppend = charges.some((c) => (c.utility_billing_arrangements as { invoice_mode?: string } | null)?.invoice_mode === 'with_draft_invoice');
    let invoiceId: string | null = null;
    let mode: 'separate' | 'appended' = 'separate';
    if (wantsAppend) {
      const month = due.slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      const nextMonth = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
      const { data: draft } = await sessionClient
        .from('invoices')
        .select('id, period, reference, description, notes, invoice_line_items(description, quantity, unit_price, sort_order)')
        .eq('lease_id', leaseId)
        .eq('status', 'draft')
        .eq('source', 'manual')
        .gte('period', `${month}-01`)
        .lt('period', nextMonth)
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (draft) {
        const existing = ((draft.invoice_line_items ?? []) as { description: string; quantity: number; unit_price: number; sort_order: number }[])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unit_price) }));
        const { error } = await sessionClient.rpc('update_manual_invoice', {
          p_invoice_id: draft.id,
          p_invoice_date: today,
          p_due_date: draft.period,
          p_reference: draft.reference,
          p_description: draft.description,
          p_notes: draft.notes,
          p_line_items: [...existing, ...lines],
        });
        if (error) {
          await release();
          throw new BillingError(`Could not add to the draft invoice: ${error.message}`);
        }
        invoiceId = draft.id as string;
        mode = 'appended';
      }
    }
    if (!invoiceId) {
      const { data, error } = await sessionClient.rpc('create_manual_invoice', {
        p_org_id: charges[0]!.org_id,
        p_lease_id: leaseId,
        p_tenant_id: tenantId,
        p_invoice_date: today,
        p_due_date: due,
        p_reference: `UTIL-${charges[0]!.period_start}`,
        p_description: 'Utility recharge (metered)',
        p_notes: 'Generated from approved utility charges in Proplyst. Review before issuing. VAT is shown per line where applicable.',
        p_line_items: lines,
      });
      if (error) {
        await release();
        throw new BillingError(`Could not create the draft invoice: ${error.message}`);
      }
      invoiceId = data as string;
    }
    await serviceClient.from('utility_charges').update({ invoice_id: invoiceId }).in('id', charges.map((c) => c.id)).eq('status', 'invoiced');
    invoices.push({ invoiceId, mode });
    await writeAuditEvent(serviceClient, {
      orgId: charges[0]!.org_id,
      actorUserId: args.actorUserId,
      actorType: 'user',
      action: mode === 'appended' ? 'utility_charges.appended_to_draft_invoice' : 'utility_charges.invoiced',
      entityType: 'invoices',
      entityId: invoiceId,
      after: { chargeIds: charges.map((c) => c.id), draft: true },
    });
  }
  return { invoices: invoices.map((i) => i.invoiceId), modes: invoices, skipped: (rows ?? []).length - ready.length };
}

/** One meter's usage over [start, end) dates — the same path billing uses (replacement chain, SAST days). */
export async function meterUsage(client: SupabaseClient, meterId: string, start: string, end: string) {
  const { data: meter } = await client.from('utility_meters').select(SMART_METER_COLUMNS).eq('id', meterId).maybeSingle();
  if (!meter) return null;
  const m = meter as SmartMeterRow;
  const { data: siblings } = await client.from('utility_meters').select(SMART_METER_COLUMNS).eq('property_id', m.property_id);
  const all = (siblings ?? []) as SmartMeterRow[];
  const s = dateToSast(start);
  const e = dateToSast(end);
  const chain = replacementChain(m, all);
  const points = await loadPoints(client, chain.map((x) => x.id), new Date(s.getTime() - 3 * DAY_MS), new Date(e.getTime() + 3 * DAY_MS));
  const ctx = { meters: all, points } as unknown as Ctx;
  return {
    meter: m,
    ...chainConsumption(ctx, m, start, end),
    daily: dailyFor(ctx, m, start, end),
    hourly: hourlyFor(ctx, m, start, end),
  };
}
