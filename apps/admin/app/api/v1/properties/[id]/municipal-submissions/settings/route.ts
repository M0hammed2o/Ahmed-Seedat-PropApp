import { NextResponse, type NextRequest } from 'next/server';
import { municipalSubmissionSettingsSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { getMunicipality } from '@/lib/smartUtility/catalog';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { approvalIsCurrent, invalidateTemplateApproval, loadTemplateContext } from '@/lib/smartUtility/reporting';
import { normaliseFields, unknownPlaceholders } from '@/lib/smartUtility/templates';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PUT /api/v1/properties/:id/municipal-submissions/settings — municipality, mode, window, CC,
 * account holder, custom message, subject/body templates, field toggles and the schedule switch.
 * Any change to what would be SENT withdraws the owner's template approval (and so switches
 * scheduled sending off); scheduled sending can only be switched on against a current approval.
 */
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
  const unknown = [...unknownPlaceholders(d.subjectTemplate ?? ''), ...unknownPlaceholders(d.bodyTemplate ?? '')];
  if (unknown.length) {
    return jsonError(400, 'unknown_placeholders', `Unknown placeholders: ${unknown.map((u) => `{{${u}}}`).join(', ')}.`);
  }

  const service = getServiceRoleClient();
  const before = await loadTemplateContext(service, property.id);
  const row: Record<string, unknown> = {
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
  };
  if (d.ccEmails !== undefined) row.cc_emails = [...new Set(d.ccEmails)];
  if (d.accountHolderName !== undefined) row.account_holder_name = d.accountHolderName || null;
  if (d.customMessage !== undefined) row.custom_message = d.customMessage || null;
  if (d.subjectTemplate !== undefined) row.subject_template = d.subjectTemplate || null;
  if (d.bodyTemplate !== undefined) row.body_template = d.bodyTemplate || null;
  if (d.includeFields !== undefined) row.include_fields = normaliseFields(d.includeFields);

  const { error } = await auth.supabase.from('municipal_submission_settings').upsert(row, { onConflict: 'property_id' });
  if (error) return serverError('submission_settings_failed', 'Could not save the settings.', 'submission_settings.upsert', error);

  // Account number / municipality also appear in the sent pack, so they count as content too.
  const after = await loadTemplateContext(service, property.id);
  const contentChanged =
    after.currentHash !== before.currentHash ||
    (before.settings?.municipal_account_number ?? null) !== (row.municipal_account_number ?? null) ||
    (before.settings?.municipality_code ?? null) !== (row.municipality_code ?? null) ||
    // Photos are attachments of the sent email, so switching them on/off is a content change too.
    (before.settings ? before.settings.include_photos !== row.include_photos : false);
  let approvalWithdrawn = false;
  if (contentChanged) {
    approvalWithdrawn = await invalidateTemplateApproval(service, {
      propertyId: property.id,
      orgId: property.org_id,
      actorUserId: auth.user.id,
      reason: 'settings changed',
    });
  }

  if (d.scheduleEnabled !== undefined) {
    const ctx = approvalWithdrawn ? await loadTemplateContext(service, property.id) : after;
    if (d.scheduleEnabled) {
      if (!approvalIsCurrent(ctx)) {
        return jsonError(409, 'template_not_approved', 'Preview and approve the email before enabling scheduled sending.', {
          saved: true,
        });
      }
      if (ctx.authorisedRecipients.length === 0) {
        return jsonError(409, 'no_authorised_recipients', 'Add and authorise at least one recipient first.', { saved: true });
      }
    }
    const { error: schedError } = await service
      .from('municipal_submission_settings')
      .update({ schedule_enabled: d.scheduleEnabled })
      .eq('property_id', property.id);
    if (schedError) return serverError('schedule_failed', 'Could not change scheduled sending.', 'submission_settings.schedule', schedError);
  }
  return NextResponse.json({ saved: true, approvalWithdrawn });
}
