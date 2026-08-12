import { NextResponse, type NextRequest } from 'next/server';
import { propertyRuleVersionCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/property-rules/:id/versions -- adds a new DRAFT version to an existing rule,
 * pointing at an already-uploaded `documents` row (upload happens through the existing document
 * upload path first, exactly like a lease/bill document -- this route never touches storage).
 * Thin wrapper over create_property_rule_version(), which does the real authorization/validation.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }
  const parsed = propertyRuleVersionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { data: versionId, error } = await supabase.rpc('create_property_rule_version', {
    p_rule_id: id,
    p_document_id: parsed.data.documentId,
    p_effective_date: parsed.data.effectiveDate,
    p_expiry_date: parsed.data.expiryDate ?? null,
    p_acknowledgement_required: parsed.data.acknowledgementRequired,
  });
  if (error) {
    const forbidden = /permission|agent/i.test(error.message);
    const notFound = /not found/i.test(error.message);
    return NextResponse.json(
      {
        error: {
          code: forbidden ? 'forbidden' : notFound ? 'not_found' : 'rule_version_create_failed',
          message: error.message,
        },
      },
      { status: forbidden ? 403 : notFound ? 404 : 500 },
    );
  }

  const { data: version } = await supabase
    .from('property_rule_versions')
    .select('org_id')
    .eq('id', versionId)
    .maybeSingle();
  if (version) {
    const serviceClient = getServiceRoleClient();
    await writeAuditEvent(serviceClient, {
      orgId: version.org_id,
      actorUserId: user.id,
      actorType: 'user',
      action: 'property_rule_version.created',
      entityType: 'property_rule_versions',
      entityId: versionId,
      after: { ruleId: id, documentId: parsed.data.documentId },
    });
  }

  return NextResponse.json({ versionId }, { status: 201 });
}
