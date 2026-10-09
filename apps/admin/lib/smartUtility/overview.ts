import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_THRESHOLDS } from './anomalies';
import { getMunicipality } from './catalog';
import {
  billingPeriodContaining,
  bucketConsumption,
  consumptionForChain,
  lastCompleteBillingPeriod,
  sastDateString,
  sastInstant,
  sastParts,
} from './consumption';
import { loadPoints, replacementChain, SMART_METER_COLUMNS, type SmartMeterRow } from './data';
import { reconcileProperty } from './jobs';
import { isAutoSubmissionEnabled } from './submissions';

// GET /api/v1/properties/:id/smart-utility payload. Uses the CALLER's session client throughout, so
// every row is RLS-scoped (can_read_property_utilities).

function toDisplay(utilityType: 'water' | 'electricity', base: number | null): number | null {
  if (base === null) return null;
  const v = utilityType === 'water' ? base / 1000 : base;
  return Math.round(v * 1000) / 1000;
}

export async function loadSmartUtilityOverview(client: SupabaseClient, propertyId: string, now = new Date()) {
  const [metersRes, unitsRes, buildingsRes, integrationsRes, alertsRes, subSettingsRes, alertSettingsRes, recipientsRes, submissionsRes] =
    await Promise.all([
      client.from('utility_meters').select(SMART_METER_COLUMNS).eq('property_id', propertyId).order('created_at'),
      client.from('units').select('id, unit_label, status, building_id').eq('property_id', propertyId).order('unit_label'),
      client.from('property_buildings').select('id, name, sort_order').eq('property_id', propertyId).order('sort_order'),
      client
        .from('meter_integrations')
        .select('id, provider, name, token_prefix, status, last_seen_at, rotated_at, revoked_at, previous_token_expires_at, created_at')
        .eq('property_id', propertyId)
        .order('created_at'),
      client
        .from('utility_alerts')
        .select('id, meter_id, unit_id, utility_type, rule, severity, title, message, period_start, period_end, estimated_cost, status, created_at, details')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(50),
      client.from('municipal_submission_settings').select('*').eq('property_id', propertyId).maybeSingle(),
      client.from('utility_alert_settings').select('*').eq('property_id', propertyId).maybeSingle(),
      client.from('municipal_submission_recipients').select('*').eq('property_id', propertyId).order('created_at'),
      client
        .from('municipal_submissions')
        .select('id, period_start, period_end, status, mode, approved_at, sent_at, scheduled_for, acceptance_status, submission_reference, acceptance_notes, created_at, report, municipal_submission_deliveries(id, recipient_email, recipient_type, status, attempts, last_attempt_at, next_attempt_at, last_error)')
        .eq('property_id', propertyId)
        .order('period_start', { ascending: false })
        .limit(12),
    ]);
  for (const r of [metersRes, unitsRes, buildingsRes, integrationsRes, alertsRes, recipientsRes, submissionsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const meters = (metersRes.data ?? []) as SmartMeterRow[];
  const subSettings = subSettingsRes.data;
  const billingDay: number = subSettings?.billing_day ?? 1;
  const current = billingPeriodContaining(now, billingDay);
  const lastComplete = lastCompleteBillingPeriod(now, billingDay);

  const today = sastParts(now);
  const seriesEnd = sastInstant(today.year, today.month, today.day);
  const seriesStart = new Date(seriesEnd.getTime() - 30 * 86_400_000);
  // Weekly view covers 12 weeks; monthly history comes from meter_period_snapshots (job-written).
  const weeklyStart = new Date(seriesEnd.getTime() - 84 * 86_400_000);
  const loadFrom = new Date(Math.min(weeklyStart.getTime(), lastComplete.start.getTime()) - 3 * 86_400_000);
  const points = await loadPoints(client, meters.map((m) => m.id), loadFrom, now);
  const { data: snapshotRows } = await client
    .from('meter_period_snapshots')
    .select('meter_id, period_start, period_end, consumption, quality')
    .eq('property_id', propertyId)
    .order('period_start', { ascending: false })
    .limit(500);
  const sumSeries = (series: { date: string; consumption: number | null }[][]) =>
    (series[0] ?? []).map((d, i) => ({
      date: d.date,
      consumption: series.every((s) => s[i]?.consumption !== null && s[i] !== undefined)
        ? Math.round(series.reduce((a, s) => a + (s[i]?.consumption ?? 0), 0) * 1000) / 1000
        : null,
    }));
  const monthlyFor = (meterIds: string[], utilityType: 'water' | 'electricity') => {
    const byPeriod = new Map<string, { total: number; complete: boolean; count: number }>();
    for (const row of snapshotRows ?? []) {
      if (!meterIds.includes(row.meter_id)) continue;
      const key = String(row.period_start).slice(0, 10);
      const cur = byPeriod.get(key) ?? { total: 0, complete: true, count: 0 };
      cur.total += row.consumption === null ? 0 : Number(row.consumption);
      cur.complete = cur.complete && row.quality === 'complete' && row.consumption !== null;
      cur.count += 1;
      byPeriod.set(key, cur);
    }
    return [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([periodStart, v]) => ({
        periodStart,
        consumption: toDisplay(utilityType, v.total),
        quality: v.complete && v.count === meterIds.length ? 'complete' : 'partial',
      }));
  };

  const meterSummaries = meters.map((m) => {
    const chain = replacementChain(m, meters).map((c) => ({
      points: points.get(c.id) ?? [],
      config: { registerDigits: c.register_digits },
    }));
    const periodToDate = consumptionForChain(chain, current.start, now);
    const daily = bucketConsumption(points.get(m.id) ?? [], seriesStart, seriesEnd, 1440, { registerDigits: m.register_digits }, 30);
    const weekly = bucketConsumption(points.get(m.id) ?? [], weeklyStart, seriesEnd, 7 * 1440, { registerDigits: m.register_digits }, 7 * 24);
    // Missing readings: expected vs received in the last 24 h (connected meters with an interval).
    const dayAgo = now.getTime() - 86_400_000;
    const received = (points.get(m.id) ?? []).filter((p) => new Date(p.readAt).getTime() >= dayAgo).length;
    const expected =
      m.connectivity !== 'manual' && m.expected_interval_minutes && m.expected_interval_minutes <= 1440
        ? Math.floor(1440 / m.expected_interval_minutes)
        : null;
    const pts = points.get(m.id) ?? [];
    const latestPoint = pts[pts.length - 1];
    const consumption = toDisplay(m.utility_type, periodToDate.consumption);
    const tariff = m.tariff_per_unit === null ? null : Number(m.tariff_per_unit);
    return {
      id: m.id,
      unitId: m.unit_id,
      buildingId: m.building_id,
      utilityType: m.utility_type,
      meterNumber: m.meter_number,
      meterRole: m.meter_role,
      ownership: m.ownership,
      parentMeterId: m.parent_meter_id,
      manufacturer: m.manufacturer,
      model: m.model,
      serialNumber: m.serial_number,
      location: m.location,
      installedDate: m.installed_date,
      connectivity: m.connectivity,
      integrationId: m.integration_id,
      externalDeviceId: m.external_device_id,
      externalChannel: m.external_channel,
      multiplier: Number(m.multiplier),
      registerDigits: m.register_digits,
      expectedIntervalMinutes: m.expected_interval_minutes,
      tariffPerUnit: tariff,
      municipalAccountNumber: m.municipal_account_number,
      lastReadingAt: m.last_reading_at,
      lastReading: toDisplay(m.utility_type, m.last_reading_value === null ? null : Number(m.last_reading_value)),
      lastSyncAt: m.last_sync_at,
      healthStatus: m.connectivity === 'manual' ? 'manual' : m.health_status,
      replacedMeterId: m.replaced_meter_id,
      decommissionedAt: m.decommissioned_at,
      active: m.active,
      displayUnit: m.utility_type === 'water' ? 'kL' : 'kWh',
      periodToDate: { consumption, quality: periodToDate.quality },
      estimatedCostToDate: consumption !== null && tariff !== null ? Math.round(consumption * tariff * 100) / 100 : null,
      daily: daily.map((d) => ({ date: sastDateString(d.start), consumption: toDisplay(m.utility_type, d.consumption) })),
      weekly: weekly.map((d) => ({ date: sastDateString(d.start), consumption: toDisplay(m.utility_type, d.consumption) })),
      readingsLast24h: { expected, received, missing: expected === null ? null : Math.max(0, expected - received) },
      latestReadingStatus: latestPoint?.status ?? null,
    };
  });

  // Property totals: main meters when present (avoids double counting), else the sum of submeters.
  const totals = (['water', 'electricity'] as const).map((utilityType) => {
    const active = meterSummaries.filter((m) => m.active && m.utilityType === utilityType);
    const mains = active.filter((m) => m.meterRole === 'main');
    const basis = mains.length > 0 ? mains : active.filter((m) => m.meterRole === 'submeter');
    const known = basis.filter((m) => m.periodToDate.consumption !== null);
    return {
      utilityType,
      displayUnit: utilityType === 'water' ? 'kL' : 'kWh',
      basis: mains.length > 0 ? 'main_meter' : 'sum_of_submeters',
      consumption: known.length ? Math.round(known.reduce((s, m) => s + (m.periodToDate.consumption ?? 0), 0) * 1000) / 1000 : null,
      estimatedCost: known.some((m) => m.estimatedCostToDate !== null)
        ? Math.round(known.reduce((s, m) => s + (m.estimatedCostToDate ?? 0), 0) * 100) / 100
        : null,
      meterCount: active.length,
      daily: sumSeries(basis.map((m) => m.daily)),
      weekly: sumSeries(basis.map((m) => m.weekly)),
      monthly: monthlyFor(basis.map((m) => m.id), utilityType),
    };
  });

  // Unit comparison for the current period: each unit's own meters, per utility.
  const unitComparison = (unitsRes.data ?? []).map((u) => {
    const own = meterSummaries.filter((m) => m.active && m.unitId === u.id);
    const pick = (t: 'water' | 'electricity') => {
      const ms = own.filter((m) => m.utilityType === t);
      const known = ms.filter((m) => m.periodToDate.consumption !== null);
      return ms.length === 0
        ? null
        : {
            consumption: known.length ? Math.round(known.reduce((a, m) => a + (m.periodToDate.consumption ?? 0), 0) * 1000) / 1000 : null,
            partial: ms.some((m) => m.periodToDate.quality !== 'complete'),
            estimatedCost: known.some((m) => m.estimatedCostToDate !== null)
              ? Math.round(known.reduce((a, m) => a + (m.estimatedCostToDate ?? 0), 0) * 100) / 100
              : null,
          };
    };
    return { unitId: u.id, unitLabel: u.unit_label, status: u.status, water: pick('water'), electricity: pick('electricity') };
  });

  const alertSettings = alertSettingsRes.data;
  const discrepancyPct = alertSettings ? Number(alertSettings.discrepancy_threshold_pct) : 15;
  const reconciliation = (await reconcileProperty(client, propertyId, lastComplete, discrepancyPct, meters)).map(
    ({ main, result }) => ({
      mainMeterId: main.id,
      utilityType: main.utility_type,
      displayUnit: main.utility_type === 'water' ? 'kL' : 'kWh',
      main: toDisplay(main.utility_type, result.main),
      submeterTotal: toDisplay(main.utility_type, result.submeterTotal),
      unallocated: toDisplay(main.utility_type, result.unallocated),
      unallocatedPct: result.unallocatedPct,
      status: result.status,
      approximate: result.approximate,
      missing: result.missing,
      submeters: result.submeters.map((s) => ({ ...s, consumption: toDisplay(main.utility_type, s.consumption) })),
    }),
  );

  const municipality = getMunicipality(subSettings?.municipality_code);
  return {
    generatedAt: now.toISOString(),
    period: {
      current: { start: sastDateString(current.start), end: sastDateString(new Date(current.end.getTime() - 1)) },
      lastComplete: { start: sastDateString(lastComplete.start), end: sastDateString(new Date(lastComplete.end.getTime() - 1)) },
      billingDay,
    },
    totals,
    meters: meterSummaries,
    units: unitsRes.data ?? [],
    unitComparison,
    buildings: buildingsRes.data ?? [],
    integrations: integrationsRes.data ?? [],
    alerts: alertsRes.data ?? [],
    reconciliation,
    alertSettings: alertSettings
      ? {
          discrepancyThresholdPct: Number(alertSettings.discrepancy_threshold_pct),
          spikeMultiple: Number(alertSettings.spike_multiple),
          nightFlowLitresPerHour: Number(alertSettings.night_flow_litres_per_hour),
          nightBaseLoadRatio: Number(alertSettings.night_base_load_ratio),
          vacantWaterLitresPerDay: Number(alertSettings.vacant_water_litres_per_day),
          vacantElectricityKwhPerDay: Number(alertSettings.vacant_electricity_kwh_per_day),
        }
      : { discrepancyThresholdPct: 15, ...DEFAULT_THRESHOLDS },
    submission: {
      settings: subSettings
        ? {
            municipalityCode: subSettings.municipality_code,
            municipalAccountNumber: subSettings.municipal_account_number,
            mode: subSettings.mode,
            billingDay: subSettings.billing_day,
            leadDays: subSettings.lead_days,
            includePhotos: subSettings.include_photos,
            enabled: subSettings.enabled,
            ccEmails: (subSettings.cc_emails as string[] | null) ?? [],
            accountHolderName: subSettings.account_holder_name as string | null,
            customMessage: subSettings.custom_message as string | null,
            subjectTemplate: subSettings.subject_template as string | null,
            bodyTemplate: subSettings.body_template as string | null,
            includeFields: (subSettings.include_fields as Record<string, boolean> | null) ?? {},
            scheduleEnabled: subSettings.schedule_enabled === true,
            templateApprovedAt: subSettings.template_approved_at as string | null,
          }
        : null,
      municipality,
      autoSubmissionEnabled: isAutoSubmissionEnabled(),
      recipients: (recipientsRes.data ?? []).map((r) => ({
        id: r.id,
        email: r.email,
        label: r.label,
        recipientType: r.recipient_type,
        authorisedAt: r.authorised_at,
        active: r.active,
      })),
      history: (submissionsRes.data ?? []).map((s) => ({
        id: s.id,
        periodStart: s.period_start,
        periodEnd: s.period_end,
        status: s.status,
        mode: s.mode,
        approvedAt: s.approved_at,
        sentAt: s.sent_at,
        acceptanceStatus: s.acceptance_status,
        submissionReference: s.submission_reference,
        acceptanceNotes: s.acceptance_notes,
        createdAt: s.created_at,
        report: s.report,
        deliveries: (s.municipal_submission_deliveries ?? []).map((d: Record<string, unknown>) => ({
          id: d.id,
          recipientEmail: d.recipient_email,
          recipientType: d.recipient_type,
          status: d.status,
          attempts: d.attempts,
          lastAttemptAt: d.last_attempt_at,
          nextAttemptAt: d.next_attempt_at,
          lastError: d.last_error,
        })),
      })),
    },
  };
}

export type SmartUtilityOverview = Awaited<ReturnType<typeof loadSmartUtilityOverview>>;
