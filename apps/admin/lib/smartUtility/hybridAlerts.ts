import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bucketConsumption, sastDateString, sastInstant, sastParts } from './consumption';
import { loadPoints, SMART_METER_COLUMNS, type SmartMeterRow } from './data';
import { loadHybridDashboard } from './hybridDashboard';

// Hybrid-supply and billing-workflow alerts (docs/HYBRID_UTILITIES_ARCHITECTURE.md §H). The evaluators are pure;
// the runner gathers data with the service client and hands alerts to the shared insertAlerts() (dedupe_key,
// one staff notification per new alert). Keys are scoped per source/meter per DAY, per invoice, or per WEEK, so
// a persisting condition never produces more than one alert in that window.

export interface HybridAlert {
  org_id: string;
  property_id: string;
  meter_id: string | null;
  unit_id: string | null;
  supply_source_id?: string | null;
  utility_type: 'water' | 'electricity';
  rule: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  period_start: string | null;
  period_end: string | null;
  details: Record<string, unknown>;
  estimated_cost: number | null;
  dedupe_key: string;
}

export interface LevelSource {
  id: string;
  name: string;
  source_type: string;
  utility_type: 'water' | 'electricity';
  low_level_pct: number;
  high_level_pct: number;
  capacity_value: number | null;
  capacity_unit: string | null;
}

/** Level → percentage (litres need a litre capacity), or null. */
export function levelPct(source: LevelSource, metric: string, value: number): number | null {
  if (metric.endsWith('_pct')) return value;
  if (metric === 'tank_level_litres' && source.capacity_unit === 'litres' && source.capacity_value) return (value / source.capacity_value) * 100;
  return null;
}

/** Tank low / overflow, battery low, generator fuel low. */
export function evaluateLevel(source: LevelSource, metric: string, value: number): { rule: string; severity: HybridAlert['severity']; title: string; message: string } | null {
  const pct = levelPct(source, metric, value);
  if (pct === null) return null;
  const p = Math.round(pct * 10) / 10;
  if (source.source_type === 'storage_tank' || source.source_type === 'rainwater') {
    if (pct <= source.low_level_pct) {
      return { rule: 'tank_low', severity: pct <= source.low_level_pct / 2 ? 'critical' : 'warning', title: `${source.name} is low (${p}%)`, message: `The tank level is at ${p}%, below the ${source.low_level_pct}% threshold. Check supply, pumps and usage.` };
    }
    if (pct >= source.high_level_pct) {
      return { rule: 'tank_overflow', severity: 'warning', title: `${source.name} may overflow (${p}%)`, message: `The tank level is at ${p}%, at or above ${source.high_level_pct}%. Check the float valve or inflow control.` };
    }
  }
  if (source.source_type === 'battery' && metric === 'battery_soc_pct' && pct <= source.low_level_pct) {
    return { rule: 'battery_issue', severity: 'warning', title: `${source.name} charge is low (${p}%)`, message: `Battery state of charge is ${p}%, below ${source.low_level_pct}%. Expect reduced backup during load-shedding.` };
  }
  if (source.source_type === 'generator' && metric === 'fuel_level_pct' && pct <= source.low_level_pct) {
    return { rule: 'generator_abnormal', severity: 'warning', title: `${source.name} fuel is low (${p}%)`, message: `Generator fuel is at ${p}%. Refuel before the next outage.` };
  }
  return null;
}

/** Median of known values (≥ 5 needed), or null. */
export function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length < 5) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Solar far below its recent median (generation), or a pump far above its recent median (pump energy). */
export function evaluateDaily(kind: 'generation' | 'pump_energy', yesterday: number | null, history: (number | null)[]) {
  const m = median(history);
  if (yesterday === null || m === null) return null;
  if (kind === 'generation' && m >= 1 && yesterday < m * 0.25) {
    return { rule: 'solar_issue', ratio: yesterday / m, median: m };
  }
  if (kind === 'pump_energy' && m >= 0.5 && yesterday > m * 2.5) {
    return { rule: 'pump_abnormal', ratio: yesterday / m, median: m };
  }
  return null;
}

export function evaluateRunHours(hours: number, expected: number | null): boolean {
  return expected !== null && expected > 0 ? hours > expected * 1.5 && hours - expected >= 1 : false;
}

function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
}

export async function runHybridAlerts(
  serviceClient: SupabaseClient,
  now: Date,
  insert: (alerts: HybridAlert[]) => Promise<number>,
): Promise<{ evaluated: number; alertsCreated: number }> {
  const today = sastParts(now);
  const dayEnd = sastInstant(today.year, today.month, today.day);
  const dayStart = new Date(dayEnd.getTime() - 86_400_000);
  const dayKey = sastDateString(dayStart);
  const alerts: HybridAlert[] = [];
  let evaluated = 0;

  // 1. Levels: latest reading in the last 24 h per source.
  const { data: sources } = await serviceClient
    .from('utility_supply_sources')
    .select('id, org_id, property_id, name, source_type, utility_type, low_level_pct, high_level_pct, capacity_value, capacity_unit, expected_daily_run_hours, unit_id')
    .eq('active', true);
  const sourceIds = (sources ?? []).map((s) => s.id);
  if (sourceIds.length) {
    const { data: readings } = await serviceClient
      .from('utility_source_readings')
      .select('source_id, metric, value, read_at')
      .in('source_id', sourceIds)
      .gte('read_at', new Date(now.getTime() - 86_400_000).toISOString())
      .order('read_at', { ascending: false })
      .limit(20_000);
    const seen = new Set<string>();
    for (const r of readings ?? []) {
      if (r.metric === 'run_hours' || seen.has(`${r.source_id}:${r.metric}`)) continue;
      seen.add(`${r.source_id}:${r.metric}`);
      const s = sources!.find((x) => x.id === r.source_id)!;
      evaluated += 1;
      const hit = evaluateLevel(
        { ...s, low_level_pct: Number(s.low_level_pct), high_level_pct: Number(s.high_level_pct), capacity_value: s.capacity_value === null ? null : Number(s.capacity_value) },
        r.metric,
        Number(r.value),
      );
      if (!hit) continue;
      alerts.push({
        org_id: s.org_id,
        property_id: s.property_id,
        meter_id: null,
        unit_id: s.unit_id,
        supply_source_id: s.id,
        utility_type: s.utility_type,
        ...hit,
        period_start: null,
        period_end: null,
        details: { metric: r.metric, value: Number(r.value), readAt: r.read_at },
        estimated_cost: null,
        dedupe_key: `${hit.rule}:${s.id}:${sastDateString(now)}`,
      });
    }
    // Generator run hours logged for yesterday vs expected.
    const generators = (sources ?? []).filter((s) => s.source_type === 'generator' && s.expected_daily_run_hours !== null);
    if (generators.length) {
      const { data: logs } = await serviceClient
        .from('utility_source_logs')
        .select('source_id, quantity')
        .eq('log_type', 'run_hours')
        .in('source_id', generators.map((g) => g.id))
        .gte('occurred_at', dayStart.toISOString())
        .lt('occurred_at', dayEnd.toISOString());
      for (const g of generators) {
        const hours = (logs ?? []).filter((l) => l.source_id === g.id).reduce((a, l) => a + Number(l.quantity ?? 0), 0);
        evaluated += 1;
        if (!evaluateRunHours(hours, Number(g.expected_daily_run_hours))) continue;
        alerts.push({
          org_id: g.org_id,
          property_id: g.property_id,
          meter_id: null,
          unit_id: null,
          supply_source_id: g.id,
          utility_type: 'electricity',
          rule: 'generator_abnormal',
          severity: 'warning',
          title: `${g.name} ran ${hours} h on ${dayKey}`,
          message: `Logged run time ${hours} h is well above the expected ${Number(g.expected_daily_run_hours)} h. Check for extended outages, a stuck transfer switch or misuse.`,
          period_start: dayKey,
          period_end: dayKey,
          details: { hours, expected: Number(g.expected_daily_run_hours) },
          estimated_cost: null,
          dedupe_key: `generator_hours:${g.id}:${dayKey}`,
        });
      }
    }
  }

  // 2. Solar generation and borehole pump energy vs their own 14-day median.
  const { data: kindMeters } = await serviceClient
    .from('utility_meters')
    .select(SMART_METER_COLUMNS)
    .eq('active', true)
    .in('measurement_kind', ['generation', 'pump_energy']);
  const km = (kindMeters ?? []) as SmartMeterRow[];
  if (km.length) {
    const histStart = new Date(dayStart.getTime() - 14 * 86_400_000);
    const points = await loadPoints(serviceClient, km.map((m) => m.id), new Date(histStart.getTime() - 86_400_000), new Date(dayEnd.getTime() + 3_600_000));
    for (const m of km) {
      const days = bucketConsumption(points.get(m.id) ?? [], histStart, dayEnd, 1440, { registerDigits: m.register_digits }, 30).map((b) => b.consumption);
      evaluated += 1;
      const hit = evaluateDaily(m.measurement_kind as 'generation' | 'pump_energy', days[days.length - 1] ?? null, days.slice(0, -1));
      if (!hit) continue;
      const label = m.location || m.meter_number || 'meter';
      alerts.push({
        org_id: m.org_id,
        property_id: m.property_id,
        meter_id: m.id,
        unit_id: m.unit_id,
        supply_source_id: m.supply_source_id,
        utility_type: 'electricity',
        rule: hit.rule,
        severity: 'warning',
        title: hit.rule === 'solar_issue' ? `Solar output low on ${dayKey} (${label})` : `Borehole pump energy high on ${dayKey} (${label})`,
        message:
          hit.rule === 'solar_issue'
            ? `Generation was ${Math.round(hit.ratio * 100)}% of the recent daily median (${hit.median.toFixed(1)} kWh). Heavy cloud can cause this; if the sky was clear, check the inverter, isolators and panels.`
            : `Pump energy was ${hit.ratio.toFixed(1)}× the recent daily median (${hit.median.toFixed(1)} kWh). Check for a leak after the pump, a failed float switch or a pump running dry.`,
        period_start: dayKey,
        period_end: dayKey,
        details: { ratio: hit.ratio, median: hit.median },
        estimated_cost: null,
        dedupe_key: `${hit.rule}:${m.id}:${dayKey}`,
      });
    }
  }

  // 3. Missing readings: a connected meter that still reports, but fewer than half of the expected readings.
  const { data: connected } = await serviceClient
    .from('utility_meters')
    .select('id, org_id, property_id, unit_id, utility_type, expected_interval_minutes, meter_number, location, health_status')
    .eq('active', true)
    .neq('connectivity', 'manual')
    .not('expected_interval_minutes', 'is', null)
    .lte('expected_interval_minutes', 720);
  if ((connected ?? []).length) {
    const counts = new Map<string, number>();
    const ids = connected!.map((m) => m.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data: rows } = await serviceClient
        .from('meter_telemetry_readings')
        .select('meter_id')
        .in('meter_id', ids.slice(i, i + 200))
        .gte('read_at', new Date(now.getTime() - 86_400_000).toISOString())
        .limit(50_000);
      for (const r of rows ?? []) counts.set(r.meter_id, (counts.get(r.meter_id) ?? 0) + 1);
    }
    for (const m of connected!) {
      const expected = Math.floor(1440 / Number(m.expected_interval_minutes));
      const received = counts.get(m.id) ?? 0;
      evaluated += 1;
      if (received === 0 || received >= expected / 2) continue; // none at all = offline (health sweep)
      alerts.push({
        org_id: m.org_id,
        property_id: m.property_id,
        meter_id: m.id,
        unit_id: m.unit_id,
        utility_type: m.utility_type,
        rule: 'missing_readings',
        severity: 'info',
        title: `Missing readings: ${m.location || m.meter_number || 'meter'}`,
        message: `${received} of about ${expected} expected readings arrived in the last 24 hours. Check signal strength or the gateway; consumption may be estimated.`,
        period_start: dayKey,
        period_end: dayKey,
        details: { received, expected },
        estimated_cost: null,
        dedupe_key: `missing_readings:${m.id}:${sastDateString(now)}`,
      });
    }
  }

  // 4. Charges awaiting approval for more than 3 days: one alert per property per week.
  const { data: drafts } = await serviceClient
    .from('utility_charges')
    .select('org_id, property_id, utility_type, total_amount, created_at')
    .eq('status', 'draft')
    .lt('created_at', new Date(now.getTime() - 3 * 86_400_000).toISOString())
    .limit(20_000);
  const draftByProp = new Map<string, { org: string; count: number; amount: number; utility: 'water' | 'electricity' }>();
  for (const d of drafts ?? []) {
    const cur = draftByProp.get(d.property_id) ?? { org: d.org_id, count: 0, amount: 0, utility: d.utility_type };
    cur.count += 1;
    cur.amount += Number(d.total_amount);
    draftByProp.set(d.property_id, cur);
  }
  const week = isoWeekKey(now);
  for (const [propertyId, d] of draftByProp) {
    evaluated += 1;
    alerts.push({
      org_id: d.org,
      property_id: propertyId,
      meter_id: null,
      unit_id: null,
      utility_type: d.utility,
      rule: 'charges_awaiting_approval',
      severity: 'info',
      title: `${d.count} utility charge${d.count === 1 ? '' : 's'} awaiting approval`,
      message: `Draft utility charges totalling R${d.amount.toFixed(2)} have waited more than 3 days. Review, approve or void them; nothing is invoiced until you do.`,
      period_start: null,
      period_end: null,
      details: { count: d.count, amount: Math.round(d.amount * 100) / 100 },
      estimated_cost: null,
      dedupe_key: `charges_awaiting_approval:${propertyId}:${week}`,
    });
  }

  // 5. Utility invoices issued and unpaid more than 7 days after the due date.
  const { data: invoiced } = await serviceClient
    .from('utility_charges')
    .select('org_id, property_id, unit_id, utility_type, invoice_id')
    .eq('status', 'invoiced')
    .not('invoice_id', 'is', null)
    .limit(20_000);
  const invoiceIds = [...new Set((invoiced ?? []).map((c) => c.invoice_id as string))];
  const overdueBefore = sastDateString(new Date(now.getTime() - 7 * 86_400_000));
  for (let i = 0; i < invoiceIds.length; i += 150) {
    const { data: invs } = await serviceClient
      .from('invoices')
      .select('id, amount, period, status, voided_at, invoice_payments(amount, reversed_at)')
      .in('id', invoiceIds.slice(i, i + 150))
      .eq('status', 'issued')
      .is('voided_at', null)
      .lt('period', overdueBefore);
    for (const inv of invs ?? []) {
      const paid = ((inv.invoice_payments ?? []) as { amount: number; reversed_at: string | null }[]).filter((p) => !p.reversed_at).reduce((a, p) => a + Number(p.amount), 0);
      const outstanding = Math.round((Number(inv.amount) - paid) * 100) / 100;
      evaluated += 1;
      if (outstanding <= 0) continue;
      const c = invoiced!.find((x) => x.invoice_id === inv.id)!;
      alerts.push({
        org_id: c.org_id,
        property_id: c.property_id,
        meter_id: null,
        unit_id: c.unit_id,
        utility_type: c.utility_type,
        rule: 'utility_invoice_unpaid',
        severity: 'warning',
        title: `Utility invoice unpaid (R${outstanding.toFixed(2)})`,
        message: `An invoice containing utility charges was due on ${inv.period} and still has R${outstanding.toFixed(2)} outstanding.`,
        period_start: null,
        period_end: null,
        details: { invoiceId: inv.id, outstanding },
        estimated_cost: null,
        dedupe_key: `utility_invoice_unpaid:${inv.id}`,
      });
    }
  }

  // 6. Hybrid balance gap for the previous calendar month (evaluated on the 1st–3rd; deduped per month).
  if (today.day <= 3 && (sources ?? []).length) {
    const prevMonthStart = sastInstant(today.month === 1 ? today.year - 1 : today.year, today.month === 1 ? 12 : today.month - 1, 1);
    const from = sastDateString(prevMonthStart);
    const to = sastDateString(sastInstant(today.year, today.month, 1));
    const { data: settings } = await serviceClient.from('utility_alert_settings').select('property_id, discrepancy_threshold_pct');
    const threshold = new Map((settings ?? []).map((s) => [s.property_id, Number(s.discrepancy_threshold_pct)]));
    const hybridProps = [...new Map((sources ?? []).map((s) => [s.property_id, s.org_id])).entries()];
    for (const [propertyId, orgId] of hybridProps) {
      const dash = await loadHybridDashboard(serviceClient, propertyId, { from, to });
      for (const [utility, pct, variance, unit] of [
        ['electricity', dash.electricity.variancePct, dash.electricity.variance.value, 'kWh'],
        ['water', dash.water.variancePct, dash.water.variance.value, 'kL'],
      ] as const) {
        evaluated += 1;
        if (pct === null || variance === null || Math.abs(pct) <= (threshold.get(propertyId) ?? 15)) continue;
        alerts.push({
          org_id: orgId,
          property_id: propertyId,
          meter_id: null,
          unit_id: null,
          utility_type: utility,
          rule: 'reconciliation_gap',
          severity: 'warning',
          title: `${utility === 'water' ? 'Water' : 'Electricity'} supply vs use gap of ${pct}% (${from.slice(0, 7)})`,
          message: `Supply (all sources) and measured use differ by ${variance} ${unit}. Possible causes: unmetered loads, losses, a leak, a faulty meter, or missing source data. This is not proof of theft.`,
          period_start: from,
          period_end: to,
          details: { variance, variancePct: pct },
          estimated_cost: null,
          dedupe_key: `reconciliation_gap:${propertyId}:${utility}:${from}`,
        });
      }
    }
  }

  return { evaluated, alertsCreated: await insert(alerts) };
}
