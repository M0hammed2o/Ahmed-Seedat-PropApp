import { NextResponse, type NextRequest } from 'next/server';
import { referralPartnerUpdateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * PATCH /api/v1/admin/referral-partners/:id -- super_admin only. Today this only toggles
 * `active` (the sole field the referrals admin UI's toggle needs), kept as its own route file
 * rather than folded into the collection route so it mirrors this codebase's existing
 * collection-vs-item route-file split (e.g. applications/[id]/access-tokens).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = referralPartnerUpdateSchema.safeParse(body);
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

  const serviceClient = getServiceRoleClient();
  const { data: before } = await serviceClient
    .from('referral_partners')
    .select('id, active')
    .eq('id', id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json(
      { error: { code: 'referral_partner_not_found', message: 'Referral partner not found.' } },
      { status: 404 },
    );
  }

  const { data, error } = await serviceClient
    .from('referral_partners')
    .update({ active: parsed.data.active })
    .eq('id', id)
    .select('id, name, referral_code, active, created_at, created_by')
    .single();
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'referral_partner_update_failed',
          message: safeErrorMessage(
            error,
            'Could not update this referral partner. Please try again, or contact support if this continues.',
            'referralPartners.update',
          ),
        },
      },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'referral_partner.active_toggled',
    entityType: 'referral_partners',
    entityId: data.id,
    before: { active: before.active },
    after: { active: data.active },
  });

  return NextResponse.json({
    referralPartner: {
      id: data.id,
      name: data.name,
      referralCode: data.referral_code,
      active: data.active,
      createdAt: data.created_at,
      createdBy: data.created_by,
    },
  });
}
