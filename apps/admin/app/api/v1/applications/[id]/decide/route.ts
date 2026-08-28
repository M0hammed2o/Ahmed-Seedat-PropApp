import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applicationDecisionSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapApplicationRow } from '@/lib/leasing';
import { writeAuditEvent } from '@/lib/audit';
import { dispatchEmail } from '@/lib/emailDispatch';
import { safeErrorMessage } from '@/lib/safeError';
import {
  dispatchApplicationApprovedWhatsApp,
  dispatchApplicationDeclinedWhatsApp,
} from '@/lib/applicationNotifications';

async function loadPropertyLabel(serviceClient: SupabaseClient, applicationId: string): Promise<string> {
  const { data } = await serviceClient
    .from('applications')
    .select('units(unit_label, properties(nickname))')
    .eq('id', applicationId)
    .maybeSingle();
  const units = (data as unknown as { units: { unit_label: string; properties: { nickname: string } | null } | null } | null)?.units;
  return units?.properties?.nickname ? `${units.properties.nickname} — ${units.unit_label}` : (units?.unit_label ?? 'your rental');
}

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/applications/:id/decide. Decline is a simple single-table update (no atomicity
 * concern); approve calls approve_application() (supabase/migrations/20260101000131), which
 * atomically creates/links a tenant and a DRAFT lease (source_application_id set, tenant already
 * assigned) -- never active, never occupies the unit, never creates a rent schedule. The caller
 * takes the returned leaseId to the lease-preparation flow; occupancy/rent-schedule only happen
 * once that lease is later activated via activate_lease() (migration 20260101000078).
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

  const { data: existing, error: fetchError } = await supabase
    .from('applications')
    .select('org_id, status')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'application_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this application.', 'applications/[id]/decide.fetch'),
        },
      },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Application not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to decide this application.',
        },
      },
      { status: 403 },
    );
  }

  if (existing.status === 'decided') {
    return NextResponse.json(
      { error: { code: 'already_decided', message: 'This application has already been decided.' } },
      { status: 409 },
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

  const parsed = applicationDecisionSchema.safeParse(body);
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

  if (parsed.data.decision === 'declined') {
    const { data, error } = await supabase
      .from('applications')
      .update({
        status: 'decided',
        decision: 'declined',
        decision_reason: parsed.data.reason ?? null,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        {
          error: {
            code: 'decline_failed',
            message: safeErrorMessage(
              error,
              'Could not decline this application. Please try again, or contact support if this continues.',
              'applications/[id]/decide.decline',
            ),
          },
        },
        { status: 500 },
      );
    }

    const serviceClient = getServiceRoleClient();
    await writeAuditEvent(serviceClient, {
      orgId: existing.org_id,
      actorUserId: user.id,
      actorType: 'user',
      action: 'application.declined',
      entityType: 'applications',
      entityId: id,
      after: { reason: parsed.data.reason ?? null },
    });
    if (data.applicant_email) {
      await dispatchEmail(serviceClient, {
        orgId: existing.org_id,
        toAddress: data.applicant_email,
        templateName: 'application_declined',
        templateVars: { reason: parsed.data.reason ?? null },
        relatedEntityType: 'applications',
        relatedEntityId: id,
        actorUserId: user.id,
      });
    }
    await dispatchApplicationDeclinedWhatsApp(serviceClient, {
      orgId: existing.org_id,
      applicationId: id,
      propertyLabel: await loadPropertyLabel(serviceClient, id),
    });

    return NextResponse.json({ application: mapApplicationRow(data) });
  }

  const { data: leaseId, error: approveError } = await supabase.rpc('approve_application', {
    p_application_id: id,
    p_tenant_id: parsed.data.tenantId ?? null,
  });

  if (approveError) {
    return NextResponse.json(
      {
        error: {
          code: 'approval_failed',
          message: safeErrorMessage(
            approveError,
            'Could not approve this application. Please try again, or contact support if this continues.',
            'applications/[id]/decide.approve',
          ),
        },
      },
      { status: 500 },
    );
  }

  const { data: application, error: refetchError } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .single();
  if (refetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'application_fetch_failed',
          message: safeErrorMessage(refetchError, 'Could not reload this application.', 'applications/[id]/decide.refetch'),
        },
      },
      { status: 500 },
    );
  }

  const serviceClient = getServiceRoleClient();
  await writeAuditEvent(serviceClient, {
    orgId: existing.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'application.approved',
    entityType: 'applications',
    entityId: id,
    after: { leaseId },
  });
  if (application.applicant_email) {
    await dispatchEmail(serviceClient, {
      orgId: existing.org_id,
      toAddress: application.applicant_email,
      templateName: 'application_approved',
      templateVars: {},
      relatedEntityType: 'applications',
      relatedEntityId: id,
      actorUserId: user.id,
    });
  }
  await dispatchApplicationApprovedWhatsApp(serviceClient, {
    orgId: existing.org_id,
    applicationId: id,
    propertyLabel: await loadPropertyLabel(serviceClient, id),
  });

  return NextResponse.json({ application: mapApplicationRow(application), leaseId });
}
