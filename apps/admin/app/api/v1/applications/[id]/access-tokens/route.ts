import { NextResponse, type NextRequest } from 'next/server';
import { applicationAccessTokenCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { dispatchEmail } from '@/lib/emailDispatch';
import { dispatchApplicationInvitationWhatsApp } from '@/lib/applicationNotifications';
import { getAppUrl } from '@/lib/appUrl';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/applications/:id/access-tokens (launch-hardening pass, WORKLOG.md 2026-08-26,
 * Section 2: staff previously had zero visibility into whether an applicant had ever been
 * invited -- the only place a token/email was created was a route nothing in the UI called).
 * Returns the most recent token (active or not) plus the delivery status of its invitation email,
 * so the UI can show "Invitation sent" / "Awaiting applicant" / "Applicant opened the link" /
 * "Invitation failed" / "Never invited" without ever exposing the token itself.
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

  const { data: token, error } = await supabase
    .from('application_access_tokens')
    .select('id, delivery_channel, destination_hint, expires_at, last_accessed_at, revoked_at, created_at')
    .eq('application_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'access_token_fetch_failed', message: 'Could not load invitation status.' } },
      { status: 500 },
    );
  }
  if (!token) {
    return NextResponse.json({ accessToken: null, email: null });
  }

  let email: { status: string } | null = null;
  if (token.delivery_channel === 'email') {
    const { data: emailRow } = await supabase
      .from('email_messages')
      .select('status')
      .eq('related_entity_type', 'application_access_tokens')
      .eq('related_entity_id', token.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    email = emailRow ? { status: emailRow.status } : null;
  }

  return NextResponse.json({
    accessToken: {
      deliveryChannel: token.delivery_channel,
      destinationHint: token.destination_hint,
      expiresAt: token.expires_at,
      lastAccessedAt: token.last_accessed_at,
      revokedAt: token.revoked_at,
      createdAt: token.created_at,
      isCurrent: token.revoked_at === null,
    },
    email,
  });
}

/**
 * POST /api/v1/applications/:id/access-tokens (Phase 4, migration 20260101000132). Issues (or
 * re-issues, revoking any prior active one) the secure applicant-intake link. RLS on
 * application_access_tokens + create_application_access_token()'s own internal check both already
 * enforce agent+/property-access -- this route does not duplicate that check, only surfaces the
 * RPC's own authorization failure as a normal error response. The plaintext token is returned
 * exactly once, here, to the issuing staff member's own response -- it is never stored, never
 * logged, and the caller is responsible for actually delivering it (email/WhatsApp send, Phase 11-13).
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

  const parsed = applicationAccessTokenCreateSchema.safeParse(body);
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

  const { data, error } = await supabase
    .rpc('create_application_access_token', {
      p_application_id: id,
      p_delivery_channel: parsed.data.deliveryChannel,
      p_destination_hint: parsed.data.destinationHint ?? null,
    })
    .single();

  if (error) {
    // error.message here is the RPC's own raise-exception text (e.g. "Caller does not have
    // permission to invite this applicant" or "Application not found") -- deliberately not
    // resolved via the shared safeguard below, since these are already friendly, intentional
    // application-level messages, not raw driver/constraint text.
    return NextResponse.json(
      { error: { code: 'access_token_create_failed', message: error.message } },
      { status: 400 },
    );
  }

  const row = data as { token_id: string; token: string; expires_at: string };
  const serviceClient = getServiceRoleClient();
  let emailResult: { sent: boolean; deliveryConfigured: boolean } | null = null;

  const { data: application } = await supabase
    .from('applications')
    .select('org_id, applicant_email, organizations(trading_name, legal_name), units(unit_label, properties(nickname))')
    .eq('id', id)
    .maybeSingle();
  const app = application as unknown as {
    org_id: string;
    applicant_email: string | null;
    organizations: { trading_name: string | null; legal_name: string } | null;
    units: { unit_label: string; properties: { nickname: string } | null } | null;
  } | null;

  if (app) {
    await writeAuditEvent(serviceClient, {
      orgId: app.org_id,
      actorUserId: user.id,
      actorType: 'user',
      action: 'application.invitation_sent',
      entityType: 'application_access_tokens',
      entityId: row.token_id,
      after: { applicationId: id, deliveryChannel: parsed.data.deliveryChannel },
    });

    if (parsed.data.deliveryChannel === 'email' && app.applicant_email) {
      emailResult = await dispatchEmail(serviceClient, {
        orgId: app.org_id,
        toAddress: app.applicant_email,
        templateName: 'application_invitation',
        templateVars: {
          orgName: app.organizations?.trading_name ?? app.organizations?.legal_name ?? 'Your landlord',
          propertyLabel: app.units?.properties?.nickname
            ? `${app.units.properties.nickname} — ${app.units.unit_label}`
            : (app.units?.unit_label ?? 'a rental'),
          applyUrl: `${getAppUrl()}/apply/${row.token}`,
          expiresAt: new Date(row.expires_at).toLocaleDateString('en-ZA'),
        },
        relatedEntityType: 'application_access_tokens',
        relatedEntityId: row.token_id,
        actorUserId: user.id,
      });
    } else if (parsed.data.deliveryChannel === 'whatsapp') {
      // Realistically always ineligible at this exact moment -- no applicant_whatsapp_consents
      // row can exist yet (the applicant hasn't had a chance to opt in), so the very first
      // message can only ever go by email. Still wired through the same eligibility check as
      // every later application WhatsApp event, both to prove "no consent -> blocked" holds here
      // too and so this call site doesn't need special-casing once a future consent-on-invite flow
      // (e.g. a phone number collected at invite time with a pre-checked opt-in) is ever added.
      await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId: app.org_id,
        applicationId: id,
        // Same fresh-per-call id the email dispatch above already uses (row.token_id) -- a
        // "Resend invitation" issues a brand new token, and must be able to send a new WhatsApp
        // message too, not be silently swallowed by dispatchWhatsApp's own already-sent guard
        // keyed on the (unchanged) applicationId (WORKLOG.md 2026-08-27).
        dispatchId: row.token_id,
        propertyLabel: app.units?.properties?.nickname
          ? `${app.units.properties.nickname} — ${app.units.unit_label}`
          : (app.units?.unit_label ?? 'a rental'),
        applyUrl: `${getAppUrl()}/apply/${row.token}`,
      });
    }
  }

  return NextResponse.json(
    {
      accessToken: { id: row.token_id, token: row.token, expiresAt: row.expires_at },
      email: emailResult,
    },
    { status: 201 },
  );
}
