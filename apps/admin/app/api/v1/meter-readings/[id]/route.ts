import { NextResponse, type NextRequest } from 'next/server';
import { meterReadingReviewSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { canWriteUtilities, forbidden, jsonError, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/meter-readings/:id {decision: 'verified' | 'rejected', note?} — a person reviews a
 * person-entered reading (dial + photo). Rejecting also excludes it from every consumption
 * calculation (status → rejected). Device readings need no review. Never set by OCR/AI.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, meterReadingReviewSchema);
  if ('response' in parsed) return parsed.response;
  const { data: reading } = await auth.supabase
    .from('meter_telemetry_readings')
    .select('id, org_id, property_id, meter_id, source, verification_status, read_at, value')
    .eq('id', id)
    .maybeSingle();
  if (!reading) return notFound('Reading');
  if (!(await canWriteUtilities(auth.supabase, reading.org_id, reading.property_id))) return forbidden();
  if (reading.verification_status === 'not_required') {
    return jsonError(409, 'not_reviewable', 'Device readings are not reviewed manually.');
  }
  const now = new Date().toISOString();
  const service = getServiceRoleClient();
  const { error } = await service
    .from('meter_telemetry_readings')
    .update({
      verification_status: parsed.data.decision,
      verified_by: auth.user.id,
      verified_at: now,
      verification_note: parsed.data.note || null,
      status: parsed.data.decision === 'rejected' ? 'rejected' : 'valid',
      status_reason: parsed.data.decision === 'rejected' ? 'rejected on review' : null,
    })
    .eq('id', id);
  if (error) return serverError('reading_review_failed', 'Could not save the review.', 'meter_readings.review', error);
  await writeAuditEvent(service, {
    orgId: reading.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: `meter_reading.${parsed.data.decision}`,
    entityType: 'meter_telemetry_readings',
    entityId: id,
    before: { verificationStatus: reading.verification_status },
    after: { verificationStatus: parsed.data.decision, note: parsed.data.note ?? null },
  });
  return NextResponse.json({ verificationStatus: parsed.data.decision, verifiedAt: now });
}
