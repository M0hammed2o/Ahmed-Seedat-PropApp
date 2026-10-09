import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyPropertyStaff } from '../notify';
import { analyseDay, DEFAULT_THRESHOLDS, estimateCost, type AlertThresholds } from './anomalies';
import {
  bucketConsumption,
  consumptionForChain,
  consumptionForPeriod,
  lastCompleteBillingPeriod,
  sastDateString,
  sastInstant,
  sastParts,
} from './consumption';
import { loadPoints, replacementChain, SMART_METER_COLUMNS, type SmartMeterRow } from './data';
import { reconcile } from './reconciliation';
import { duePeriod, generateSubmission, sendDueDeliveries, syncDeliveryStatuses } from './submissions';
import { runPollSync } from './sync';

// runSmartUtilityJob (docs/SMART_UTILITY_ARCHITECTURE.md §9). Appended to POST
// /api/v1/system/daily-jobs and exposed separately as POST /api/v1/system/smart-utility-jobs. Each
// step is caught independently so one failing step never blocks the others.

export interface SmartUtilityJobResult {
  pollSync: { attempted: number; succeeded: number; failed: number } | { error: string };
  health: { stale: number; offline: number; alerts: number } | { error: string };
  anomalies: { metersAnalysed: number; alertsCreated: number } | { error: string };
  reconciliation: { scopes: number; alertsCreated: number } | { error: string };
  snapshots: { created: number } | { error: string };
  reminders: { sent: number } | { error: string };
  submissions: { generated: number } | { error: string };
  deliveries: { attempted: number; sent: number; failed: number; exhausted: number } | { error: string };
  statusSync: { changed: number } | { error: string };
}

async function step<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    console.error('[smart-utility-job] step failed', err);
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

interface AlertInsert {
  org_id: string;
  property_id: string;
  meter_id: string | null;
  unit_id: string | null;
  utility_type: 'water' | 'electricity';
  rule: string;
  severity: string;
  title: string;
  message: string;
  period_start: string | null;
  period_end: string | null;
  details: Record<string, unknown>;
  estimated_cost: number | null;
  dedupe_key: string;
}

/** Inserts alerts that don't exist yet (dedupe_key) and notifies staff once per new alert. */
async function insertAlerts(serviceClient: SupabaseClient, alerts: AlertInsert[]): Promise<number> {
  let created = 0;
  for (const a of alerts) {
    const { data, error } = await serviceClient
      .from('utility_alerts')
      .upsert(a, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`alert insert failed: ${error.message}`);
    if (data && data.length > 0) {
      created += 1;
      await notifyPropertyStaff(serviceClient, {
        orgId: a.org_id,
        propertyId: a.property_id,
        type: 'utility_alert',
        title: a.title,
        body: a.message,
        relatedEntityType: 'utility_alerts',
        relatedEntityId: data[0]!.id,
        minRole: 'viewer',
      });
    }
  }
  return created;
}

async function loadThresholds(serviceClient: SupabaseClient): Promise<Map<string, AlertThresholds & { discrepancyPct: number }>> {
  const { data } = await serviceClient.from('utility_alert_settings').select('*');
  const map = new Map<string, AlertThresholds & { discrepancyPct: number }>();
  for (const r of data ?? []) {
    map.set(r.property_id, {
      spikeMultiple: Number(r.spike_multiple),
      nightFlowLitresPerHour: Number(r.night_flow_litres_per_hour),
      nightBaseLoadRatio: Number(r.night_base_load_ratio),
      vacantWaterLitresPerDay: Number(r.vacant_water_litres_per_day),
      vacantElectricityKwhPerDay: Number(r.vacant_electricity_kwh_per_day),
      discrepancyPct: Number(r.discrepancy_threshold_pct),
    });
  }
  return map;
}

function thresholdsFor(map: Map<string, AlertThresholds & { discrepancyPct: number }>, propertyId: string) {
  return map.get(propertyId) ?? { ...DEFAULT_THRESHOLDS, discrepancyPct: 15 };
}

export async function runHealthSweep(serviceClient: SupabaseClient, now: Date) {
  const { data: meters, error } = await serviceClient
    .from('utility_meters')
    .select('id, org_id, property_id, unit_id, utility_type, meter_number, serial_number, expected_interval_minutes, last_reading_at, health_status, created_at')
    .eq('active', true)
    .neq('connectivity', 'manual')
    .not('expected_interval_minutes', 'is', null);
  if (error) throw new Error(error.message);
  let stale = 0;
  let offline = 0;
  const alerts: AlertInsert[] = [];
  for (const m of meters ?? []) {
    const staleAfter = 3 * m.expected_interval_minutes * 60_000;
    const last = new Date(m.last_reading_at ?? m.created_at).getTime();
    const age = now.getTime() - last;
    const next = age > staleAfter + 86_400_000 ? 'offline' : age > staleAfter ? 'stale' : m.last_reading_at ? 'online' : 'unknown';
    if (next !== m.health_status) {
      await serviceClient.from('utility_meters').update({ health_status: next }).eq('id', m.id);
    }
    if (next === 'stale') stale += 1;
    if (next === 'offline') {
      offline += 1;
      alerts.push({
        org_id: m.org_id,
        property_id: m.property_id,
        meter_id: m.id,
        unit_id: m.unit_id,
        utility_type: m.utility_type,
        rule: 'meter_offline',
        severity: 'warning',
        title: `Meter ${m.meter_number ?? m.serial_number ?? ''} is offline`.trim(),
        message: `No reading has arrived since ${m.last_reading_at ? sastDateString(new Date(m.last_reading_at)) : 'it was added'}. Check the gateway power and connection, or the device battery.`,
        period_start: m.last_reading_at,
        period_end: now.toISOString(),
        details: { lastReadingAt: m.last_reading_at, expectedIntervalMinutes: m.expected_interval_minutes },
        estimated_cost: null,
        dedupe_key: `offline:${m.id}:${sastDateString(now)}`,
      });
    }
  }
  return { stale, offline, alerts: await insertAlerts(serviceClient, alerts) };
}

/** Daily anomaly rules over the last complete SAST day. */
export async function runDailyAnomalies(serviceClient: SupabaseClient, now: Date) {
  const today = sastParts(now);
  const dayEnd = sastInstant(today.year, today.month, today.day);
  const dayStart = new Date(dayEnd.getTime() - 86_400_000);
  const historyStart = new Date(dayStart.getTime() - 14 * 86_400_000);
  const dayKey = sastDateString(dayStart);

  const { data: meters, error } = await serviceClient
    .from('utility_meters')
    .select(SMART_METER_COLUMNS)
    .eq('active', true)
    .neq('connectivity', 'manual');
  if (error) throw new Error(error.message);
  const list = (meters ?? []) as SmartMeterRow[];
  if (list.length === 0) return { metersAnalysed: 0, alertsCreated: 0 };

  const unitIds = [...new Set(list.map((m) => m.unit_id).filter((u): u is string => !!u))];
  const { data: units } = unitIds.length
    ? await serviceClient.from('units').select('id, status, unit_label').in('id', unitIds)
    : { data: [] as { id: string; status: string; unit_label: string }[] };
  const unitById = new Map((units ?? []).map((u) => [u.id, u]));
  const thresholds = await loadThresholds(serviceClient);
  const points = await loadPoints(serviceClient, list.map((m) => m.id), historyStart, dayEnd);

  const alerts: AlertInsert[] = [];
  for (const m of list) {
    const pts = points.get(m.id) ?? [];
    if (pts.length < 2) continue;
    const cfg = { registerDigits: m.register_digits };
    const days = bucketConsumption(pts, historyStart, dayEnd, 1440, cfg, 30);
    const hourly =
      (m.expected_interval_minutes ?? 1440) <= 60
        ? bucketConsumption(pts, dayStart, dayEnd, 60, cfg, 3).map((b) => b.consumption)
        : [];
    const unit = m.unit_id ? unitById.get(m.unit_id) : undefined;
    const label = unit ? `${unit.unit_label} ${m.utility_type} meter` : `${m.meter_role} ${m.utility_type} meter`;
    const candidates = analyseDay({
      utilityType: m.utility_type,
      meterLabel: label,
      hourly,
      dayTotal: days[days.length - 1]?.consumption ?? null,
      history: days.slice(0, -1).map((d) => d.consumption),
      unitVacant: unit?.status === 'vacant',
      thresholds: thresholdsFor(thresholds, m.property_id),
    });
    for (const c of candidates) {
      alerts.push({
        org_id: m.org_id,
        property_id: m.property_id,
        meter_id: m.id,
        unit_id: m.unit_id,
        utility_type: m.utility_type,
        rule: c.rule,
        severity: c.severity,
        title: c.title,
        message: c.message,
        period_start: dayStart.toISOString(),
        period_end: dayEnd.toISOString(),
        details: c.details,
        estimated_cost: estimateCost(m.utility_type, c.excessConsumption, m.tariff_per_unit === null ? null : Number(m.tariff_per_unit)),
        dedupe_key: `${c.rule}:${m.id}:${dayKey}`,
      });
    }
  }
  return { metersAnalysed: list.length, alertsCreated: await insertAlerts(serviceClient, alerts) };
}

/** Per-scope reconciliation for the property's last complete billing period. */
export async function reconcileProperty(
  client: SupabaseClient,
  propertyId: string,
  period: { start: Date; end: Date },
  thresholdPct: number,
  meters?: SmartMeterRow[],
) {
  const all =
    meters ??
    (((await client.from('utility_meters').select(SMART_METER_COLUMNS).eq('property_id', propertyId)).data ?? []) as SmartMeterRow[]);
  const mains = all.filter((m) => m.active && (m.meter_role === 'main' || m.meter_role === 'check'));
  const points = await loadPoints(
    client,
    all.map((m) => m.id),
    new Date(period.start.getTime() - 3 * 86_400_000),
    new Date(period.end.getTime() + 3 * 86_400_000),
  );
  const chainConsumption = (m: SmartMeterRow) =>
    consumptionForChain(
      replacementChain(m, all).map((c) => ({ points: points.get(c.id) ?? [], config: { registerDigits: c.register_digits } })),
      period.start,
      period.end,
    );

  const { data: units } = await client.from('units').select('id, unit_label').eq('property_id', propertyId);
  const unitLabel = new Map((units ?? []).map((u) => [u.id, u.unit_label]));

  return mains.map((main) => {
    let subs = all.filter((m) => m.active && m.parent_meter_id === main.id);
    if (subs.length === 0 && main.meter_role === 'main') {
      // No explicit hierarchy: every active unit submeter of the same utility (and building, if set).
      subs = all.filter(
        (m) =>
          m.active &&
          m.meter_role === 'submeter' &&
          m.utility_type === main.utility_type &&
          (main.building_id === null || m.building_id === main.building_id),
      );
    }
    const mainC = chainConsumption(main);
    const result = reconcile({
      main: { meterId: main.id, consumption: mainC.consumption, quality: mainC.quality },
      submeters: subs.map((s) => {
        const c = chainConsumption(s);
        return {
          meterId: s.id,
          label: (s.unit_id && unitLabel.get(s.unit_id)) || s.meter_number || s.serial_number || 'Submeter',
          consumption: c.consumption,
          quality: c.quality,
        };
      }),
      thresholdPct,
    });
    return { main, result };
  });
}

export async function runMonthlyReconciliation(serviceClient: SupabaseClient, now: Date) {
  // Only on a property's billing day (default the 1st): the period that ended at 00:00 SAST today
  // is reconciled exactly once.
  const today = sastParts(now);
  const { data: mainMeters } = await serviceClient
    .from('utility_meters')
    .select('property_id')
    .eq('active', true)
    .in('meter_role', ['main', 'check']);
  const propertyIds = [...new Set((mainMeters ?? []).map((m) => m.property_id))];
  if (propertyIds.length === 0) return { scopes: 0, alertsCreated: 0 };
  const { data: settings } = await serviceClient
    .from('municipal_submission_settings')
    .select('property_id, billing_day')
    .in('property_id', propertyIds);
  const billingDay = new Map((settings ?? []).map((s) => [s.property_id, s.billing_day as number]));
  const thresholds = await loadThresholds(serviceClient);

  let scopes = 0;
  const alerts: AlertInsert[] = [];
  for (const propertyId of propertyIds) {
    const day = billingDay.get(propertyId) ?? 1;
    if (today.day !== day) continue;
    const period = lastCompleteBillingPeriod(now, day);
    const t = thresholdsFor(thresholds, propertyId);
    const results = await reconcileProperty(serviceClient, propertyId, period, t.discrepancyPct);
    for (const { main, result } of results) {
      scopes += 1;
      if (result.status !== 'above_threshold') continue;
      const unit = main.utility_type === 'water' ? 'kL' : 'kWh';
      const toDisplay = (v: number) => (main.utility_type === 'water' ? v / 1000 : v);
      alerts.push({
        org_id: main.org_id,
        property_id: main.property_id,
        meter_id: main.id,
        unit_id: null,
        utility_type: main.utility_type,
        rule: 'main_submeter_discrepancy',
        severity: 'warning',
        title: `Unallocated ${main.utility_type} use: ${result.unallocatedPct}% of the main meter`,
        message:
          `Main meter: ${toDisplay(result.main!).toFixed(2)} ${unit}; units combined: ${toDisplay(result.submeterTotal).toFixed(2)} ${unit}; ` +
          `unallocated: ${toDisplay(result.unallocated!).toFixed(2)} ${unit}. This may be common-area use, timing differences between readings, measurement error or a leak.`,
        period_start: period.start.toISOString(),
        period_end: period.end.toISOString(),
        details: { ...result, thresholdPct: t.discrepancyPct },
        estimated_cost: estimateCost(
          main.utility_type,
          result.unallocated,
          main.tariff_per_unit === null ? null : Number(main.tariff_per_unit),
        ),
        dedupe_key: `discrepancy:${main.id}:${sastDateString(period.start)}`,
      });
    }
  }
  return { scopes, alertsCreated: await insertAlerts(serviceClient, alerts) };
}

/**
 * Monthly snapshots (meter_period_snapshots): on each property's billing day, the just-ended period's
 * opening/closing/consumption per physical meter. Idempotent (unique meter_id + period_start).
 */
export async function runMonthlySnapshots(serviceClient: SupabaseClient, now: Date) {
  const today = sastParts(now);
  const { data: meters } = await serviceClient
    .from('utility_meters')
    .select(SMART_METER_COLUMNS)
    .or(`active.eq.true,decommissioned_at.gte.${new Date(now.getTime() - 62 * 86_400_000).toISOString()}`);
  const list = (meters ?? []) as SmartMeterRow[];
  if (list.length === 0) return { created: 0 };
  const propertyIds = [...new Set(list.map((m) => m.property_id))];
  const { data: settings } = await serviceClient
    .from('municipal_submission_settings')
    .select('property_id, billing_day')
    .in('property_id', propertyIds);
  const billingDay = new Map((settings ?? []).map((s) => [s.property_id, s.billing_day as number]));
  const due = list.filter((m) => today.day === (billingDay.get(m.property_id) ?? 1));
  if (due.length === 0) return { created: 0 };
  let created = 0;
  const byProperty = new Map<string, SmartMeterRow[]>();
  for (const m of due) byProperty.set(m.property_id, [...(byProperty.get(m.property_id) ?? []), m]);
  for (const [propertyId, ms] of byProperty) {
    const period = lastCompleteBillingPeriod(now, billingDay.get(propertyId) ?? 1);
    const points = await loadPoints(serviceClient, ms.map((m) => m.id), new Date(period.start.getTime() - 3 * 86_400_000), new Date(period.end.getTime() + 3 * 86_400_000));
    const rows = ms.map((m) => {
      const c = consumptionForPeriod(points.get(m.id) ?? [], period.start, period.end, { registerDigits: m.register_digits });
      return {
        org_id: m.org_id,
        property_id: m.property_id,
        meter_id: m.id,
        period_start: period.start.toISOString(),
        period_end: period.end.toISOString(),
        opening_value: c.startValue,
        closing_value: c.endValue,
        consumption: c.consumption,
        quality: c.quality,
        reset_in_period: c.resetInPeriod,
      };
    });
    const { data, error } = await serviceClient
      .from('meter_period_snapshots')
      .upsert(rows, { onConflict: 'meter_id,period_start', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`snapshot insert failed: ${error.message}`);
    created += data?.length ?? 0;
  }
  return { created };
}

/** Daily reminder for packs still awaiting approval (at most once per day per pack). */
export async function runApprovalReminders(serviceClient: SupabaseClient, now: Date) {
  const cutoff = new Date(now.getTime() - 20 * 3_600_000).toISOString();
  const { data } = await serviceClient
    .from('municipal_submissions')
    .select('id, org_id, property_id, period_start, period_end, reminder_sent_at, created_at')
    .eq('status', 'pending_approval')
    .lte('created_at', cutoff)
    .or(`reminder_sent_at.is.null,reminder_sent_at.lte.${cutoff}`)
    .limit(200);
  let sent = 0;
  for (const sub of data ?? []) {
    await notifyPropertyStaff(serviceClient, {
      orgId: sub.org_id,
      propertyId: sub.property_id,
      type: 'municipal_submission_reminder',
      title: 'Meter readings still awaiting your approval',
      body: `The ${sub.period_start} to ${sub.period_end} reading pack has not been approved yet. Municipal submission windows are short.`,
      relatedEntityType: 'municipal_submissions',
      relatedEntityId: sub.id,
      minRole: 'accountant',
    });
    await serviceClient.from('municipal_submissions').update({ reminder_sent_at: now.toISOString() }).eq('id', sub.id);
    sent += 1;
  }
  return { sent };
}

export async function runDueSubmissions(serviceClient: SupabaseClient, now: Date) {
  const { data: settings, error } = await serviceClient
    .from('municipal_submission_settings')
    .select('property_id, billing_day, lead_days')
    .eq('enabled', true);
  if (error) throw new Error(error.message);
  let generated = 0;
  for (const s of settings ?? []) {
    const period = duePeriod(now, s.billing_day, s.lead_days);
    if (!period) continue;
    const res = await generateSubmission(serviceClient, { propertyId: s.property_id, period, actorUserId: null, now });
    if (res.created) generated += 1;
  }
  return { generated };
}

export async function runSmartUtilityJob(
  serviceClient: SupabaseClient,
  now: Date = new Date(),
): Promise<SmartUtilityJobResult> {
  return {
    // Poll first so the health sweep and rules see the freshest data.
    pollSync: await step(() => runPollSync(serviceClient, { now })),
    health: await step(() => runHealthSweep(serviceClient, now)),
    anomalies: await step(() => runDailyAnomalies(serviceClient, now)),
    reconciliation: await step(() => runMonthlyReconciliation(serviceClient, now)),
    snapshots: await step(() => runMonthlySnapshots(serviceClient, now)),
    reminders: await step(() => runApprovalReminders(serviceClient, now)),
    submissions: await step(() => runDueSubmissions(serviceClient, now)),
    deliveries: await step(() => sendDueDeliveries(serviceClient, { now })),
    statusSync: await step(async () => ({ changed: await syncDeliveryStatuses(serviceClient, now) })),
  };
}

export function jobFailed(result: SmartUtilityJobResult): boolean {
  return Object.values(result).some((v) => v && typeof v === 'object' && 'error' in v);
}
