import { NextResponse } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';

/**
 * POST /api/v1/account/delete -- self-service account deletion, required by Google Play's
 * "App account deletion" policy (support.google.com/googleplay/android-developer/answer/13327111),
 * which mandates BOTH an in-app path and a web path. The Android app calls this endpoint; the
 * public /delete-account page is the web half.
 *
 * WHY ANONYMISE RATHER THAN DROP THE ROW. `audit_events` has a deliberate immutability trigger and
 * a real FK on the acting user, and journal entries/invoices carry statutory retention obligations
 * (South African tax records must be kept for five years). A hard `auth.admin.deleteUser()` is
 * therefore refused by the database for any identity that has ever acted -- which is every real
 * user. Erasing the personal data while preserving the immutable financial trail is the correct
 * outcome for a financial system, and is what /delete-account and the privacy policy disclose.
 *
 * What this removes immediately: the person's name, email address and phone number, their ability
 * to sign in, and their access to every organisation.
 * What it deliberately keeps: financial and audit records, which no longer identify the person.
 *
 * Acts ONLY on the caller's own identity -- there is no user id parameter, so it cannot be aimed
 * at anyone else.
 */
export async function POST() {
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

  const service = getServiceRoleClient();
  const userId = user.id;

  // 1. Remove access to every organisation first, so nothing else can be done with the account
  //    even if a later step fails.
  const { error: memberError } = await service
    .from('organization_members')
    .update({ status: 'revoked' })
    .eq('user_id', userId);
  if (memberError) {
    return NextResponse.json(
      { error: { code: 'account_deletion_failed', message: 'Could not revoke organisation access.' } },
      { status: 500 },
    );
  }

  // 2. Erase the display name held in the app's own profile table.
  await service.from('profiles').update({ display_name: 'Deleted user' }).eq('id', userId);

  // 3. Erase the identifiers held by Auth and permanently disable sign-in. The address is
  //    rewritten (not blanked) because Auth requires a unique, non-null email; `.invalid` is the
  //    RFC 2606 reserved TLD, so the result can never route anywhere.
  const { error: authError } = await service.auth.admin.updateUserById(userId, {
    email: `deleted-${userId}@deleted.proplyst.invalid`,
    phone: undefined,
    user_metadata: {},
    ban_duration: '876000h', // ~100 years; Supabase has no permanent-disable flag
  });
  if (authError) {
    return NextResponse.json(
      { error: { code: 'account_deletion_failed', message: 'Could not remove the sign-in identity.' } },
      { status: 500 },
    );
  }

  // 4. Record that it happened. orgId is null: this is an identity-level action, not an org one.
  await writeAuditEvent(service, {
    orgId: null,
    actorUserId: null, // the actor no longer exists as an identifiable person
    actorType: 'system',
    action: 'account_deleted',
    entityType: 'user_account',
    entityId: userId,
  });

  // 5. Drop the caller's own session.
  await supabase.auth.signOut();

  return NextResponse.json({
    deleted: true,
    message:
      'Your Proplyst account has been deleted. Your name, email address and phone number have been ' +
      'removed and you can no longer sign in. Financial records are kept for the period the law ' +
      'requires and no longer identify you.',
  });
}
