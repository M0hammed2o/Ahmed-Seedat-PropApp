import { NextResponse, type NextRequest } from 'next/server';
import { municipalSubmissionSettingsSchema } from '@propvault/validation';
import { getMunicipality } from '@/lib/smartUtility/catalog';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** PUT /api/v1/properties/:id/municipal-submissions/settings -- municipality, mode, window. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, municipalSubmissionSettingsSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();

  const d = parsed.data;
  if (d.municipalityCode && !getMunicipality(d.municipalityCode)) {
    return jsonError(400, 'unknown_municipality', 'Choose a municipality from the list (or "Other").');
  }
  const municipality = getMunicipality(d.municipalityCode);
  if (d.mode === 'automatic' && municipality && !municipality.emailSubmission && municipality.code !== 'other') {
    return jsonError(
      400,
      'automatic_not_supported',
      `${municipality.name} has no verified email submission channel, so automatic sending is not available. Use manual mode and submit through the municipality's own app or portal.`,
    );
  }

  const { error } = await auth.supabase.from('municipal_submission_settings').upsert(
    {
      property_id: property.id,
      org_id: property.org_id,
      municipality_code: d.municipalityCode ?? null,
      municipal_account_number: d.municipalAccountNumber || null,
      mode: d.mode,
      billing_day: d.billingDay,
      lead_days: d.leadDays,
      include_photos: d.includePhotos,
      enabled: d.enabled,
      updated_by: auth.user.id,
    },
    { onConflict: 'property_id' },
  );
  if (error) return serverError('submission_settings_failed', 'Could not save the settings.', 'submission_settings.upsert', error);
  return NextResponse.json({ saved: true });
}
