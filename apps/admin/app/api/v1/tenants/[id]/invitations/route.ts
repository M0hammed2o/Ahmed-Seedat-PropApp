import { NextResponse, type NextRequest } from 'next/server';
import { tenantInvitationCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapTenantInvitationRow, maskDestination } from '@/lib/tenantInvitations';
import { dispatchEmail } from '@/lib/emailDispatch';
import { dispatchWhatsApp, resolveOrgWhatsAppBranding } from '@/lib/whatsappDispatch';
import { buildTenantAccountInvitationVariables } from '@/lib/whatsappTemplateVariables';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { writeAuditEvent } from '@/lib/audit';
import { getAppUrl } from '@/lib/appUrl';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/tenants/:id/invitations (PRODUCT DECISION 2, 2026-08-03). agent+ only
 * (PERMISSIONS.md's "Properties/Units/Leases/Tenants: Full" floor for agent -- tenant
 * invitations are a tenant-management action). POST always issues a fresh invitation:
 * create_tenant_invitation() already revokes any prior un-accepted one for the same tenant
 * first, so this single endpoint IS "resend" and "regenerate" both -- there is no separate
 * resend endpoint, deliberately: the raw token/code is never stored (only its hash), so a later
 * literal "resend the same secret" is cryptographically impossible, not merely unbuilt. The UI
 * labels the button "Send"/"Resend"/"Regenerate" depending on whether an invitation already
 * exists; the underlying call is identical either way.
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

  const { data, error } = await supabase
    .from('tenant_invitations')
    .select('*')
    .eq('tenant_id', id)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_invitations_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ invitations: (data ?? []).map(mapTenantInvitationRow) });
}

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

  const limited = await rateLimitOrRespond(supabase, `tenant-invitation-create:${user.id}`, 20, 60);
  if (limited) return limited;

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, org_id, email, phone, full_name')
    .eq('id', id)
    .maybeSingle();
  if (tenantError) {
    return NextResponse.json(
      { error: { code: 'tenant_fetch_failed', message: tenantError.message } },
      { status: 500 },
    );
  }
  if (!tenant) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Tenant not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, tenant.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: { code: 'forbidden', message: 'You do not have permission to invite this tenant.' },
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

  const parsed = tenantInvitationCreateSchema.safeParse(body);
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

  const destination = parsed.data.deliveryChannel === 'whatsapp' ? tenant.phone : tenant.email;
  if (
    (parsed.data.deliveryChannel === 'email' || parsed.data.deliveryChannel === 'whatsapp') &&
    !destination
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'no_destination',
          message: `This tenant has no ${parsed.data.deliveryChannel === 'email' ? 'email address' : 'phone number'} on file.`,
        },
      },
      { status: 400 },
    );
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc('create_tenant_invitation', {
    p_tenant_id: id,
    p_delivery_channel: parsed.data.deliveryChannel,
    p_include_short_code: parsed.data.includeShortCode,
    p_destination_hint: destination ? maskDestination(destination) : null,
  });
  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'tenant_invitation_create_failed', message: rpcError.message } },
      { status: 500 },
    );
  }
  const created = rpcRows?.[0];
  if (!created) {
    return NextResponse.json(
      { error: { code: 'tenant_invitation_create_failed', message: 'No invitation was created.' } },
      { status: 500 },
    );
  }

  const serviceClient = getServiceRoleClient();

  // Tenant access audit logging (WORKLOG.md this date) -- covers both a genuinely first
  // invitation and a "resend" through this same endpoint (create_tenant_invitation() always
  // revokes-then-recreates, so there is no separate resend code path to log differently here);
  // never logs the token/short code itself, only the fact and channel of dispatch.
  await writeAuditEvent(serviceClient, {
    orgId: tenant.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'tenant_invitation.created',
    entityType: 'tenant_invitations',
    entityId: created.invitation_id,
    after: { tenantId: id, deliveryChannel: parsed.data.deliveryChannel },
  });

  const branding = await resolveOrgWhatsAppBranding(serviceClient, tenant.org_id);
  // Final pre-UAT engineering pass (WORKLOG.md this date), Part 15: was inlining
  // NEXT_PUBLIC_APP_URL with its own duplicate 'http://localhost:3000' fallback instead of
  // calling getAppUrl() -- a real risk (this is the tenant activation email's CTA link) if that
  // env var were ever unset in production, now closed by using the single shared helper.
  const acceptUrl = `${getAppUrl()}/activate?token=${created.token}`;

  // Overnight platform pass (WORKLOG.md this date): relatedEntityId was previously
  // `${created.invitation_id}:0` -- a string -- but both email_messages.related_entity_id and
  // whatsapp_messages.related_entity_id are real `uuid` columns (20260101000040), so either
  // dispatch call below would throw "invalid input syntax for type uuid" and this whole request
  // would fail with a 500 whenever a tenant actually had an email/phone on file (the normal
  // case) -- the same bug, independently found in owners/[id]/invitations/route.ts this same
  // pass, confirmed against a real local database rather than assumed. The ":0" suffix served no
  // purpose here either: create_tenant_invitation() mints a fresh invitation_id per call.
  if (parsed.data.deliveryChannel === 'email' && tenant.email) {
    await dispatchEmail(serviceClient, {
      orgId: tenant.org_id,
      toAddress: tenant.email,
      templateName: 'tenant_invitation',
      templateVars: {
        orgName: branding.organizationName,
        tenantName: tenant.full_name,
        acceptUrl,
        expiresAt: new Date(created.expires_at).toLocaleDateString('en-ZA'),
      },
      relatedEntityType: 'tenant_invitations',
      relatedEntityId: created.invitation_id,
      actorUserId: user.id,
    });
  } else if (parsed.data.deliveryChannel === 'whatsapp' && tenant.phone) {
    await dispatchWhatsApp(serviceClient, {
      orgId: tenant.org_id,
      toPhone: tenant.phone,
      // Final pre-production pass (WORKLOG.md 2026-08-17): real approved structure confirmed by
      // Mohammed -- organizationName, acceptUrl, supportName (3 vars). The short code is NOT a
      // separate template variable -- it's already embedded in acceptUrl's `?token=` query param,
      // so a redundant 4th `code` variable (this call site's own pre-approval guess) is dropped.
      templateName: 'tenant_account_invitation',
      variables: buildTenantAccountInvitationVariables({
        organizationName: branding.organizationName,
        acceptUrl,
        supportName: branding.supportName,
      }),
      relatedEntityType: 'tenant_invitations',
      relatedEntityId: created.invitation_id,
      actorUserId: user.id,
    });
  }

  // The plaintext token/short code is returned exactly once, in this response -- the API layer
  // never logs it, and the DB never stores it (only its hash). The UI must show it to staff now
  // or lose it forever (PRODUCT DECISION 2: "never retrieve the plaintext code again later").
  return NextResponse.json(
    {
      invitationId: created.invitation_id,
      token: created.token,
      shortCode: created.short_code,
      expiresAt: created.expires_at,
      acceptUrl,
    },
    { status: 201 },
  );
}
