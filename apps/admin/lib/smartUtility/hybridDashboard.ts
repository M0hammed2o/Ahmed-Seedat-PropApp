import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickTariff, TARIFF_COLUMNS, toTariffV2, type TariffRow } from './billing';
import { bucketConsumption, consumptionForChain, sastDateString, sastInstant } from './consumption';
import { loadPoints, replacementChain, SMART_METER_COLUMNS, type SmartMeterRow } from './data';
import { electricityBalance, waterBalance, type BalanceMeter, type BalanceSource, type TankLevels } from './hybridBalance';
import { computeTariffCharge } from './tariffEngine';

// Property utilities dashboard for any date range (docs/HYBRID_UTILITIES_ARCHITECTURE.md §G). Session client →
// RLS-scoped. Every figure carries its basis (measured / derived / logged / estimated / missing); nothing is
// silently zero-filled.

const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 366;

function toSast(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return sastInstant(y!, m!, day!);
}

export interface RangeQuery {
  from: string; // inclusive date
  to: string; // exclusive date
}

export function parseRange(from: string | null, to: string | null, now = new Date()): RangeQuery | { error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = sastDateString(now);
  const end = to && re.test(to) ? to : new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const start = from && re.test(from) ? from : new Date(Date.parse(`${end}T00:00:00Z`) - 30 * DAY_MS).toISOString().slice(0, 10);
  if ((from && !re.test(from)) || (to && !re.test(to))) return { error: 'Dates must be YYYY-MM-DD.' };
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
  if (days <= 0) return { error: 'The end date must be after the start date.' };
  if (days > MAX_RANGE_DAYS) return { error: `Choose at most ${MAX_RANGE_DAYS} days.` };
  return { from: start, to: end };
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const factor = (t: 'water' | 'electricity') => (t === 'water' ? 1000 : 1);

export async function loadHybridDashboard(client: SupabaseClient, propertyId: string, range: RangeQuery) {
  const start = toSast(range.from);
  const end = toSast(range.to);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  const bucketMinutes = days <= 62 ? 1440 : 7 * 1440;

  const [metersRes, sourcesRes, unitsRes, tariffsRes, chargesRes, logsRes, alertsRes] = await Promise.all([
    client.from('utility_meters').select(SMART_METER_COLUMNS).eq('property_id', propertyId),
    client.from('utility_supply_sources').select('id, name, utility_type, source_type, active, capacity_value, capacity_unit, low_level_pct, high_level_pct, level_metric, expected_daily_run_hours').eq('property_id', propertyId),
    client.from('units').select('id, unit_label, status').eq('property_id', propertyId).order('unit_label'),
    client.from('utility_tariffs').select(TARIFF_COLUMNS).eq('property_id', propertyId),
    client
      .from('utility_charges')
      .select('id, unit_id, utility_type, charge_type, status, total_amount, vat_amount, period_start, dispute_status')
      .eq('property_id', propertyId)
      .neq('status', 'void')
      .gte('period_start', range.from)
      .lt('period_start', range.to),
    client
      .from('utility_source_logs')
      .select('source_id, log_type, occurred_at, quantity, quantity_unit, cost_amount')
      .eq('property_id', propertyId)
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString()),
    client.from('utility_alerts').select('id, rule, severity, status').eq('property_id', propertyId).eq('status', 'open'),
  ]);
  for (const r of [metersRes, sourcesRes, unitsRes, tariffsRes, chargesRes, logsRes]) if (r.error) throw new Error(r.error.message);

  const meters = (metersRes.data ?? []) as SmartMeterRow[];
  const sources = sourcesRes.data ?? [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const active = meters.filter((m) => m.active || (m.decommissioned_at && m.decommissioned_at >= range.from));
  const points = await loadPoints(client, meters.map((m) => m.id), new Date(start.getTime() - 3 * DAY_MS), new Date(end.getTime() + 3 * DAY_MS));

  const usage = new Map<string, { consumption: number | null; quality: 'complete' | 'partial' | 'insufficient' }>();
  for (const m of active) {
    const c = consumptionForChain(
      replacementChain(m, meters).map((x) => ({ points: points.get(x.id) ?? [], config: { registerDigits: x.register_digits } })),
      start,
      end,
    );
    usage.set(m.id, { consumption: c.consumption === null ? null : round(c.consumption / factor(m.utility_type)), quality: c.quality });
  }
  // Replaced meters are counted through their successor's chain only.
  const replaced = new Set(meters.map((m) => m.replaced_meter_id).filter(Boolean));
  const balanceMeters: BalanceMeter[] = active
    .filter((m) => !replaced.has(m.id))
    .map((m) => ({
      id: m.id,
      label: m.location || m.meter_number || m.serial_number || 'Meter',
      utilityType: m.utility_type,
      measurementKind: m.measurement_kind ?? 'consumption',
      meterRole: m.meter_role,
      parentMeterId: m.parent_meter_id,
      unitId: m.unit_id,
      sourceType: m.supply_source_id ? (sourceById.get(m.supply_source_id)?.source_type ?? null) : null,
      consumption: usage.get(m.id)?.consumption ?? null,
      quality: usage.get(m.id)?.quality ?? 'insufficient',
    }));
  const balanceSources: BalanceSource[] = sources.map((s) => ({ id: s.id, name: s.name, utilityType: s.utility_type, sourceType: s.source_type, active: s.active }));

  // Tank levels at the range boundaries (nearest reading within 6 h).
  const tankIds = sources.filter((s) => s.source_type === 'storage_tank').map((s) => s.id);
  const levelRows = tankIds.length
    ? (
        await client
          .from('utility_source_readings')
          .select('source_id, metric, value, read_at')
          .in('source_id', tankIds)
          .in('metric', ['tank_level_litres', 'tank_level_pct'])
          .gte('read_at', new Date(start.getTime() - 6 * 3_600_000).toISOString())
          .lte('read_at', new Date(end.getTime() + 6 * 3_600_000).toISOString())
          .order('read_at')
          .limit(20_000)
      ).data ?? []
    : [];
  const litresAt = (sourceId: string, at: Date): number | null => {
    const s = sourceById.get(sourceId)!;
    let best: { diff: number; litres: number } | null = null;
    for (const r of levelRows) {
      if (r.source_id !== sourceId) continue;
      const diff = Math.abs(new Date(r.read_at).getTime() - at.getTime());
      if (diff > 6 * 3_600_000) continue;
      const litres =
        r.metric === 'tank_level_litres'
          ? Number(r.value)
          : s.capacity_unit === 'litres' && s.capacity_value
            ? (Number(r.value) / 100) * Number(s.capacity_value)
            : null;
      if (litres === null) continue;
      if (!best || diff < best.diff) best = { diff, litres };
    }
    return best ? round(best.litres, 1) : null;
  };
  const tanks: TankLevels[] = tankIds.map((id) => ({ sourceId: id, startLitres: litresAt(id, start), endLitres: litresAt(id, end) }));
  const logs = logsRes.data ?? [];
  const tankerKl = logs
    .filter((l) => l.log_type === 'tanker_delivery' && l.quantity !== null)
    .map((l) => ({ sourceId: l.source_id, kl: l.quantity_unit === 'litres' ? Number(l.quantity) / 1000 : Number(l.quantity) }));

  const electricity = electricityBalance(balanceMeters, balanceSources);
  const water = waterBalance(balanceMeters, balanceSources, tanks, tankerKl);

  // Daily (≤ 62 days) or weekly series per utility and measurement kind, for the source-mix chart.
  const series = (['electricity', 'water'] as const).map((utilityType) => {
    const kinds = [...new Set(balanceMeters.filter((m) => m.utilityType === utilityType).map((m) => m.measurementKind))];
    return {
      utilityType,
      bucket: bucketMinutes === 1440 ? 'day' : 'week',
      kinds: kinds.map((kind) => {
        const ms = active.filter((m) => !replaced.has(m.id) && m.utility_type === utilityType && (m.measurement_kind ?? 'consumption') === kind);
        // For consumption, the property total is main meters when present (no double counting).
        const basis = kind === 'consumption' && ms.some((m) => m.meter_role === 'main') ? ms.filter((m) => m.meter_role === 'main') : ms;
        const perMeter = basis.map((m) =>
          bucketConsumption(points.get(m.id) ?? [], start, end, bucketMinutes, { registerDigits: m.register_digits }, bucketMinutes === 1440 ? 30 : 7 * 24),
        );
        return {
          kind,
          points: (perMeter[0] ?? []).map((b, i) => ({
            date: sastDateString(b.start),
            value: perMeter.every((p) => p[i]?.consumption !== null && p[i] !== undefined)
              ? round(perMeter.reduce((a, p) => a + (p[i]?.consumption ?? 0), 0) / factor(utilityType))
              : null,
          })),
        };
      }),
    };
  });

  // Recovery: what was recharged vs an ESTIMATE of what supply cost (property tariff on grid/municipal intake +
  // logged fuel and tanker costs). Municipal bills themselves are the authority; this is a guide.
  const tariffs = (tariffsRes.data ?? []) as TariffRow[];
  const charges = chargesRes.data ?? [];
  const recovery = (['electricity', 'water'] as const).map((utilityType) => {
    const own = charges.filter((c) => c.utility_type === utilityType);
    const sum = (rows: typeof own) => Math.round(rows.reduce((a, c) => a + Number(c.total_amount), 0) * 100) / 100;
    const intakeKinds = utilityType === 'electricity' ? ['grid_import'] : ['source_supply'];
    let intake = balanceMeters.filter(
      (m) => m.utilityType === utilityType && intakeKinds.includes(m.measurementKind) && (utilityType === 'electricity' || m.sourceType === 'municipal'),
    );
    if (intake.length === 0) intake = balanceMeters.filter((m) => m.utilityType === utilityType && m.measurementKind === 'consumption' && m.meterRole === 'main');
    const intakeQty = intake.every((m) => m.consumption !== null) && intake.length ? intake.reduce((a, m) => a + (m.consumption ?? 0), 0) : null;
    const tariff = pickTariff(tariffs, utilityType, null, range.from);
    let gridCost: number | null = null;
    if (tariff && intakeQty !== null) {
      const r = computeTariffCharge(toTariffV2(tariff), { consumption: intakeQty, segmentStart: start, segmentEnd: end, periodDays: days });
      gridCost = r.ok ? r.totals.inclCents / 100 : null;
    }
    const sourceIdsOfUtility = new Set(sources.filter((s) => s.utility_type === utilityType).map((s) => s.id));
    const logged = logs.filter((l) => sourceIdsOfUtility.has(l.source_id) && ['fuel_purchase', 'tanker_delivery'].includes(l.log_type));
    const loggedCost = Math.round(logged.reduce((a, l) => a + Number(l.cost_amount ?? 0), 0) * 100) / 100;
    const maintenanceCost =
      Math.round(
        logs.filter((l) => sourceIdsOfUtility.has(l.source_id) && ['maintenance', 'service'].includes(l.log_type)).reduce((a, l) => a + Number(l.cost_amount ?? 0), 0) * 100,
      ) / 100;
    const estimatedSupplyCost = gridCost === null && loggedCost === 0 ? null : Math.round(((gridCost ?? 0) + loggedCost) * 100) / 100;
    const recharged = sum(own.filter((c) => c.status === 'approved' || c.status === 'invoiced'));
    return {
      utilityType,
      charges: { draft: sum(own.filter((c) => c.status === 'draft')), approved: sum(own.filter((c) => c.status === 'approved')), invoiced: sum(own.filter((c) => c.status === 'invoiced')) },
      disputed: own.filter((c) => c.dispute_status === 'open').length,
      intakeQuantity: intakeQty === null ? null : round(intakeQty),
      gridOrMunicipalCost: gridCost === null ? null : Math.round(gridCost * 100) / 100,
      gridCostBasis: gridCost === null ? 'missing' : 'estimated',
      tariffName: tariff?.name ?? null,
      loggedSupplyCost: loggedCost,
      maintenanceCost,
      estimatedSupplyCost,
      recoveryPct: estimatedSupplyCost && estimatedSupplyCost > 0 ? Math.round((recharged / estimatedSupplyCost) * 1000) / 10 : null,
    };
  });

  // Source status: latest level vs thresholds; generator hours from logs.
  const latestLevels = sources.length
    ? (
        await client
          .from('utility_source_readings')
          .select('source_id, metric, value, read_at')
          .in('source_id', sources.map((s) => s.id))
          .gte('read_at', new Date(Date.now() - 7 * DAY_MS).toISOString())
          .order('read_at', { ascending: false })
          .limit(1000)
      ).data ?? []
    : [];
  const sourceStatus = sources.map((s) => {
    const latest = latestLevels.find((r) => r.source_id === s.id && r.metric !== 'run_hours') ?? null;
    let pct: number | null = null;
    if (latest) {
      if (latest.metric.endsWith('_pct')) pct = Number(latest.value);
      else if (latest.metric === 'tank_level_litres' && s.capacity_unit === 'litres' && s.capacity_value) pct = round((Number(latest.value) / Number(s.capacity_value)) * 100, 1);
    }
    const runHours = logs.filter((l) => l.source_id === s.id && l.log_type === 'run_hours').reduce((a, l) => a + Number(l.quantity ?? 0), 0);
    const fuelLitres = logs.filter((l) => l.source_id === s.id && ['fuel_added', 'fuel_purchase'].includes(l.log_type) && l.quantity_unit === 'litres').reduce((a, l) => a + Number(l.quantity ?? 0), 0);
    return {
      id: s.id,
      name: s.name,
      utilityType: s.utility_type,
      sourceType: s.source_type,
      active: s.active,
      metered: balanceMeters.some((m) => m.sourceType === s.source_type && m.utilityType === s.utility_type),
      level: latest ? { metric: latest.metric, value: Number(latest.value), pct, readAt: latest.read_at } : null,
      levelStatus: pct === null ? 'unknown' : pct <= Number(s.low_level_pct) ? 'low' : pct >= Number(s.high_level_pct) ? 'high' : 'normal',
      runHours: runHours || null,
      fuelLitres: fuelLitres || null,
    };
  });

  const units = (unitsRes.data ?? []).map((u) => {
    const own = balanceMeters.filter((m) => m.unitId === u.id && m.measurementKind === 'consumption');
    const pick = (t: 'water' | 'electricity') => {
      const ms = own.filter((m) => m.utilityType === t);
      if (ms.length === 0) return null;
      const known = ms.filter((m) => m.consumption !== null);
      return {
        consumption: known.length ? round(known.reduce((a, m) => a + (m.consumption ?? 0), 0)) : null,
        partial: ms.some((m) => m.quality !== 'complete'),
        charged: Math.round(charges.filter((c) => c.unit_id === u.id && c.utility_type === t).reduce((a, c) => a + Number(c.total_amount), 0) * 100) / 100,
      };
    };
    return { unitId: u.id, unitLabel: u.unit_label, status: u.status, water: pick('water'), electricity: pick('electricity') };
  });

  return {
    range: { ...range, days },
    electricity,
    water,
    series,
    recovery,
    sources: sourceStatus,
    units,
    openAlerts: (alertsRes.data ?? []).length,
    notes: [
      'Supply cost is an estimate from your tariff and logged costs; the municipal account is authoritative.',
      'Solar self-use and site supply are derived from measured registers and never billed directly.',
    ],
  };
}

export type HybridDashboard = Awaited<ReturnType<typeof loadHybridDashboard>>;
