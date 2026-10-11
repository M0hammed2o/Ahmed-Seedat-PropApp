import { NextResponse, type NextRequest } from 'next/server';
import { utilityAlertSettingsSchema } from '@propvault/validation';
import { canWriteUtilities, forbidden, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** PUT /api/v1/properties/:id/utility-alert-settings -- per-property anomaly thresholds. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, utilityAlertSettingsSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const d = parsed.data;
  const { error } = await auth.supabase.from('utility_alert_settings').upsert(
    {
      property_id: property.id,
      org_id: property.org_id,
      discrepancy_threshold_pct: d.discrepancyThresholdPct,
      spike_multiple: d.spikeMultiple,
      night_flow_litres_per_hour: d.nightFlowLitresPerHour,
      night_base_load_ratio: d.nightBaseLoadRatio,
      vacant_water_litres_per_day: d.vacantWaterLitresPerDay,
      vacant_electricity_kwh_per_day: d.vacantElectricityKwhPerDay,
    },
    { onConflict: 'property_id' },
  );
  if (error) return serverError('alert_settings_failed', 'Could not save the thresholds.', 'utility_alert_settings.upsert', error);
  return NextResponse.json({ saved: true });
}
