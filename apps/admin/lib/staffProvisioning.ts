import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrganizationMemberRole, PropertyAccessMode, StaffPropertyRole } from '@propvault/types';
import { branding } from '@propvault/config';
import { dispatchEmail } from './emailDispatch';
import { getAppUrl } from './appUrl';

// Provisioned-staff account model (this date, "Proplyst Provisioned Staff Account" implementation).
// This file owns everything the provision_staff_member()/activate_staff_provision() SQL RPCs
// cannot do themselves -- calling the Supabase Admin (GoTrue) API and dispatching branded email --
// mirroring lib/billing.ts's own established split (SQL owns the transactional entitlement/state
// logic; TypeScript owns the external-system orchestration around it).

export interface SelectedPropertyInput {
  propertyId: string;
  propertyRole: StaffPropertyRole;
}

export interface ProvisionStaffMemberInput {
  orgId: string;
  email: string;
  fullName: string | null;
  role: OrganizationMemberRole;
  propertyAccessMode: PropertyAccessMode;
  selectedProperties: SelectedPropertyInput[];
}

export type StaffProvisionEmailOutcome = 'activation_sent' | 'notification_sent' | 'send_failed';

export interface ProvisionStaffMemberResult {
  provisionId: string;
  isExistingActiveUser: boolean;
  membershipActivated: boolean;
  emailDeliveryConfigured: boolean | null;
  emailOutcome: StaffProvisionEmailOutcome;
}

/**
 * Orchestrates one "Add staff member" submission. The RPC call (`sessionClient`, the caller's own
 * session -- provision_staff_member() checks `auth.uid()` for its manager+ authorization, exactly
 * like accept_organization_invite() does) does every authorization/seat/membership/property-access
 * decision; this function only ever branches on ITS return value, never re-derives any of that
 * itself. `serviceClient` is used solely for the two things the RPC structurally cannot do:
 * calling the GoTrue Admin API and dispatching email.
 */
export async function provisionStaffMember(
  sessionClient: SupabaseClient,
  serviceClient: SupabaseClient,
  actorUserId: string,
  input: ProvisionStaffMemberInput,
): Promise<ProvisionStaffMemberResult> {
  const { data, error } = await sessionClient.rpc('provision_staff_member', {
    p_org_id: input.orgId,
    p_email: input.email,
    p_full_name: input.fullName,
    p_role: input.role,
    p_property_access_mode: input.propertyAccessMode,
    p_selected_properties: input.selectedProperties.map((sp) => ({
      propertyId: sp.propertyId,
      propertyRole: sp.propertyRole,
    })),
  });
  if (error) throw new Error(error.message);
  const row = (data as ProvisionStaffMemberRpcRow[])[0];
  if (!row) throw new Error('provision_staff_member returned no row');

  const { data: org } = await serviceClient
    .from('organizations')
    .select('legal_name')
    .eq('id', input.orgId)
    .maybeSingle();
  const orgName = org?.legal_name ?? `a ${branding.productName} organization`;

  if (row.is_existing_active_user) {
    // Real, already-password-capable identity -- provisioning already completed the membership.
    // No auth link of any kind is ever sent here -- they already have credentials and sign in
    // normally, exactly per the target flow's explicit "no activation/password setup step".
    let emailDeliveryConfigured: boolean | null = null;
    try {
      const result = await dispatchEmail(serviceClient, {
        orgId: input.orgId,
        toAddress: input.email,
        toUserId: row.auth_user_id,
        templateName: 'staff_added_existing_user',
        templateVars: { orgName, role: input.role },
        relatedEntityType: 'organization_staff_provisions',
        relatedEntityId: row.provision_id,
        actorUserId,
      });
      emailDeliveryConfigured = result.deliveryConfigured;
    } catch (err) {
      console.error('[staffProvisioning] existing-user notification dispatch failed', err);
    }
    return {
      provisionId: row.provision_id,
      isExistingActiveUser: true,
      membershipActivated: true,
      emailDeliveryConfigured,
      emailOutcome: 'notification_sent',
    };
  }

  // New email, or a passwordless leftover identity from a previously interrupted attempt (orphan
  // scenario B/C) -- provision_staff_member() only ever returns auth_user_id here as null (a
  // genuinely new email never had one) or a real, still-passwordless id (the exact recovery case);
  // either way, calling generateLink({type:'invite'}) is the correct, safe next step: GoTrue
  // creates the user if none exists, or re-issues a fresh invite link for the existing-but-never-
  // activated one, in both cases WITHOUT ever creating a second identity for the same email.
  const emailOutcome = await sendActivationLink(serviceClient, {
    provisionId: row.provision_id,
    orgId: input.orgId,
    orgName,
    email: input.email,
    role: input.role,
    actorUserId,
    dispatchAttempt: 0,
  });
  return {
    provisionId: row.provision_id,
    isExistingActiveUser: false,
    membershipActivated: false,
    emailDeliveryConfigured: emailOutcome.emailDeliveryConfigured,
    emailOutcome: emailOutcome.outcome,
  };
}

interface ProvisionStaffMemberRpcRow {
  is_existing_active_user: boolean;
  auth_user_id: string | null;
  provision_id: string;
  membership_activated: boolean;
}

/**
 * (Re-)issues a GoTrue invite link for a pending provision and dispatches the branded activation
 * email. Shared by the initial provision call and the explicit "Resend activation" action --
 * exactly the same call either way, since generateLink({type:'invite'}) is itself idempotent-safe
 * to call again for the same not-yet-activated email (GoTrue reuses the existing user; it does
 * NOT create a second one -- this is also test scenario C's "auth user reused" requirement and the
 * orphan-recovery path's own safety net, not two different code paths).
 *
 * Orphan-prevention (audit scenario A -- DB provisioning already committed, this is the ONLY step
 * that can still fail): if generateLink() itself fails, the provisions row is marked
 * 'pending_send_failed' and NOTHING else is touched -- no membership, no seat consumed (seats are
 * only ever consumed at activate_staff_provision() time, never here), fully retryable by calling
 * this same function again later. If generateLink() succeeds but the FOLLOW-UP row update below
 * fails, the auth user now exists or was reused but the row still shows its old status -- the next
 * call to provision_staff_member() for the same email will find that passwordless identity via
 * its own auth.users lookup and route back through this exact function again, which is the
 * self-healing property the audit called for, made concrete rather than assumed.
 */
export async function sendActivationLink(
  serviceClient: SupabaseClient,
  input: {
    provisionId: string;
    orgId: string;
    orgName: string;
    email: string;
    role: OrganizationMemberRole;
    actorUserId: string;
    /** 0 for the initial send, the resend route's own incremented counter thereafter --
     *  dispatchEmail() is idempotent on (relatedEntityType, relatedEntityId, templateName), so
     *  without a distinct value per attempt every resend would be silently absorbed by that same
     *  guard (organization-invites/resend/route.ts's own already-documented real bug, avoided
     *  here from the start rather than found live a second time). */
    dispatchAttempt: number;
  },
): Promise<{ outcome: StaffProvisionEmailOutcome; emailDeliveryConfigured: boolean | null }> {
  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { redirectTo: `${getAppUrl()}/staff/activate` },
  });

  if (linkError || !linkData?.properties?.hashed_token || !linkData.user?.id) {
    // Never logs the token/link itself -- only that generation failed, matching this codebase's
    // established "correlation info only, never the secret" logging convention.
    console.error('[staffProvisioning] generateLink(invite) failed', {
      provisionId: input.provisionId,
      code: linkError?.code,
      status: linkError?.status,
    });
    await serviceClient
      .from('organization_staff_provisions')
      .update({ status: 'pending_send_failed' })
      .eq('id', input.provisionId);
    return { outcome: 'send_failed', emailDeliveryConfigured: null };
  }

  const { data: provisionRow, error: updateError } = await serviceClient
    .from('organization_staff_provisions')
    .update({
      auth_user_id: linkData.user.id,
      token_hash: linkData.properties.hashed_token,
      status: 'awaiting_activation',
      // resend_count is deliberately not touched here -- the resend route increments it itself
      // before calling this function, so this update never resets a real resend count back down.
    })
    .eq('id', input.provisionId)
    .select('expires_at')
    .single();

  if (updateError || !provisionRow) {
    // The GoTrue identity now exists (or was reused) but our own row update failed -- do NOT
    // silently claim success. Leave the row as it was (still 'pending' or whatever it was before
    // this call); the next provision/resend attempt for this email will find the real,
    // now-passwordless auth user via provision_staff_member()'s own lookup and safely resume from
    // here -- never a duplicate identity, never a falsely-activated membership.
    console.error('[staffProvisioning] provisions row update after generateLink failed', {
      provisionId: input.provisionId,
      authUserId: linkData.user.id,
    });
    return { outcome: 'send_failed', emailDeliveryConfigured: null };
  }

  const activateUrl = `${getAppUrl()}/staff/activate?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=invite`;

  let emailDeliveryConfigured: boolean | null = null;
  try {
    const result = await dispatchEmail(serviceClient, {
      orgId: input.orgId,
      toAddress: input.email,
      toUserId: linkData.user.id,
      templateName: 'staff_activation',
      templateVars: {
        orgName: input.orgName,
        role: input.role,
        activateUrl,
        expiresAt: new Date(provisionRow.expires_at).toLocaleDateString('en-ZA'),
      },
      relatedEntityType: `organization_staff_provisions:${input.dispatchAttempt}`,
      relatedEntityId: input.provisionId,
      actorUserId: input.actorUserId,
    });
    emailDeliveryConfigured = result.deliveryConfigured;
  } catch (err) {
    console.error('[staffProvisioning] activation email dispatch failed', err);
  }

  return { outcome: 'activation_sent', emailDeliveryConfigured };
}
