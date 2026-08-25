import { NextResponse, type NextRequest } from 'next/server';
import { leaseTemplateUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLeaseTemplateRow } from '@/lib/leaseTemplates';
import { writeAuditEvent } from '@/lib/audit';

const SIGNED_URL_TTL_SECONDS = 60 * 10;

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleTemplate(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  id: string,
) {
  return supabase.from('lease_templates').select('*').eq('id', id).maybeSingle();
}

/**
 * GET /api/v1/lease-templates/:id -- returns metadata plus a signed download URL, same pattern as
 * GET /api/v1/documents/:id. Used both by the settings list (download/preview) and the
 * lease-create picker (LeaseForm.tsx).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await loadVisibleTemplate(supabase, id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_template_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease template not found.' } },
      { status: 404 },
    );
  }

  const { data: signed } = await supabase.storage
    .from('documents')
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json({
    leaseTemplate: mapLeaseTemplateRow(data),
    signedUrl: signed?.signedUrl ?? null,
  });
}

/**
 * PATCH /api/v1/lease-templates/:id -- rename, archive, or (via `set_default_lease_template`,
 * migration 20260101000056) atomically make this the org's one default. A plain `.update({
 * is_default: true })` here would race the partial unique index under concurrent requests; the
 * RPC clears the previous default and sets the new one as a single statement.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const { data: existing, error: fetchError } = await loadVisibleTemplate(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'lease_template_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease template not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'manager');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only principals and managers can manage lease templates.',
        },
      },
      { status: 403 },
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

  const bodyParsed = leaseTemplateUpdateSchema.safeParse(body);
  if (!bodyParsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: bodyParsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const setDefault = bodyParsed.data.setDefault === true;

  if (setDefault) {
    const { error: rpcError } = await supabase.rpc('set_default_lease_template', {
      p_template_id: id,
    });
    if (rpcError) {
      return NextResponse.json(
        { error: { code: 'lease_template_set_default_failed', message: rpcError.message } },
        { status: 500 },
      );
    }
    // Only a real change, not a re-click of "set default" on an already-default template.
    if (!existing.is_default) {
      await writeAuditEvent(getServiceRoleClient(), {
        orgId: existing.org_id,
        actorUserId: user.id,
        actorType: 'user',
        action: 'template.default_changed',
        entityType: 'lease_templates',
        entityId: id,
        before: { wasDefault: false },
        after: { isDefault: true },
      });
    }
  }

  const patch: Record<string, unknown> = {};
  if (bodyParsed.data.name !== undefined) patch.name = bodyParsed.data.name;
  if (bodyParsed.data.status !== undefined) {
    patch.status = bodyParsed.data.status;
    // An archived template can't remain the org's default -- there'd be nothing to pick.
    if (bodyParsed.data.status === 'archived') patch.is_default = false;
  }

  if (Object.keys(patch).length === 0 && !setDefault) {
    const { data } = await loadVisibleTemplate(supabase, id);
    return NextResponse.json({ leaseTemplate: mapLeaseTemplateRow(data!) });
  }

  const { data, error } =
    Object.keys(patch).length > 0
      ? await supabase.from('lease_templates').update(patch).eq('id', id).select('*').single()
      : await loadVisibleTemplate(supabase, id);

  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_template_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ leaseTemplate: mapLeaseTemplateRow(data!) });
}
