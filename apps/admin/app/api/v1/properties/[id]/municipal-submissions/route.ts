import { NextResponse, type NextRequest } from 'next/server';
import { submissionGenerateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { billingPeriodContaining, sastInstant } from '@/lib/smartUtility/consumption';
import { canWriteUtilities, forbidden, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { generateSubmission } from '@/lib/smartUtility/submissions';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/properties/:id/municipal-submissions -- prepare a municipal reading pack now (for the
 * last complete billing period, or the period starting `periodStart`). Idempotent per period. The
 * pack is NOT sent here: manual mode → draft for the owner to download; approval mode → awaits
 * approval; automatic (flag on) → queued only to authorised recipients.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, submissionGenerateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();

  try {
    const service = getServiceRoleClient();
    let period: { start: Date; end: Date } | undefined;
    if (parsed.data.periodStart) {
      const [y, m, d] = parsed.data.periodStart.split('-').map(Number);
      const { data: settings } = await service
        .from('municipal_submission_settings')
        .select('billing_day')
        .eq('property_id', property.id)
        .maybeSingle();
      const billingDay = settings?.billing_day ?? 1;
      period = billingPeriodContaining(sastInstant(y!, m!, d!, 12), billingDay);
    }
    const result = await generateSubmission(service, { propertyId: property.id, period, actorUserId: auth.user.id });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return serverError('submission_generate_failed', 'Could not prepare the reading pack.', 'municipal_submissions.generate', error);
  }
}
