import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  resolveOnboardingProgress,
  skipStaffOnboardingStep,
  markOnboardingIntroViewed,
  setWalkthroughState,
} from '../onboarding';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

describeIfSupabase('resolveOnboardingProgress (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalUserId: string;

  beforeEach(async () => {
    principalUserId = randomUUID();
    await serviceClient.auth.admin.createUser({
      email: `onboarding-${principalUserId}@test.propertyvault.example`,
      email_confirm: true,
      id: principalUserId,
    } as never);

    const { data: org, error } = await serviceClient
      .from('organizations')
      .insert({
        legal_name: `Onboarding Test Org ${Date.now()}`,
        org_type: 'agency',
        status: 'trial',
        commercial_setup_required: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    orgId = org.id;

    await serviceClient.from('organization_members').insert({
      org_id: orgId,
      user_id: principalUserId,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await serviceClient.from('organization_onboarding_state').delete().eq('org_id', orgId);
    await serviceClient.from('leases').delete().eq('org_id', orgId);
    await serviceClient.from('tenants').delete().eq('org_id', orgId);
    await serviceClient.from('units').delete().eq('org_id', orgId);
    await serviceClient.from('properties').delete().eq('org_id', orgId);
    await serviceClient.from('organization_invites').delete().eq('org_id', orgId);
    await serviceClient.from('organization_members').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(principalUserId);
  });

  it('a freshly created commercial-setup-required org starts with plan/payment-method steps incomplete', async () => {
    const progress = await resolveOnboardingProgress(serviceClient, orgId);
    const planStep = progress.steps.find((s) => s.id === 'choose_plan');
    const paymentStep = progress.steps.find((s) => s.id === 'payment_method');
    expect(planStep?.completed).toBe(false);
    expect(paymentStep?.completed).toBe(false);
    expect(progress.currentStep?.id).toBe('choose_plan');
    expect(progress.allDone).toBe(false);
  });

  it('a grandfathered org (commercial_setup_required=false) never shows plan/payment-method steps at all', async () => {
    await serviceClient
      .from('organizations')
      .update({ commercial_setup_required: false, commercial_setup_completed_at: new Date().toISOString() })
      .eq('id', orgId);

    const progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.steps.find((s) => s.id === 'choose_plan')).toBeUndefined();
    expect(progress.steps.find((s) => s.id === 'payment_method')).toBeUndefined();
  });

  it('creating a real property marks first_property complete without any explicit onboarding call', async () => {
    await serviceClient.from('properties').insert({
      org_id: orgId,
      nickname: 'Test Property',
      address_line1: '1 Test Street',
      city: 'Cape Town',
      country: 'ZA',
      property_type: 'apartment',
    });

    const progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.steps.find((s) => s.id === 'first_property')?.completed).toBe(true);
    // Units/tenants/leases still correctly incomplete -- nothing was created for them.
    expect(progress.steps.find((s) => s.id === 'first_unit')?.completed).toBe(false);
  });

  it('skipStaffOnboardingStep marks the staff step skipped without creating any staff', async () => {
    let progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.steps.find((s) => s.id === 'invite_staff')?.completed).toBe(false);
    expect(progress.steps.find((s) => s.id === 'invite_staff')?.skipped).toBe(false);

    await skipStaffOnboardingStep(serviceClient, orgId);

    progress = await resolveOnboardingProgress(serviceClient, orgId);
    const staffStep = progress.steps.find((s) => s.id === 'invite_staff')!;
    expect(staffStep.completed).toBe(false);
    expect(staffStep.skipped).toBe(true);
  });

  it('a real staff invite marks the step complete even without ever calling skipStaffOnboardingStep', async () => {
    await serviceClient.from('organization_invites').insert({
      org_id: orgId,
      email: 'staff@test.propertyvault.example',
      role: 'agent',
      invited_by: principalUserId,
    });

    const progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.steps.find((s) => s.id === 'invite_staff')?.completed).toBe(true);
  });

  it('markOnboardingIntroViewed is idempotent and only marks the specific intro named', async () => {
    await markOnboardingIntroViewed(serviceClient, orgId, 'payments');
    let progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.steps.find((s) => s.id === 'review_payments')?.completed).toBe(true);
    expect(progress.steps.find((s) => s.id === 'explore_documents')?.completed).toBe(false);

    // Calling again does not error and does not affect the other intro.
    await markOnboardingIntroViewed(serviceClient, orgId, 'payments');
    progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.steps.find((s) => s.id === 'review_payments')?.completed).toBe(true);
    expect(progress.steps.find((s) => s.id === 'explore_documents')?.completed).toBe(false);
  });

  it('percentComplete reaches 100 and allDone is true once every step is complete or skipped', async () => {
    await serviceClient
      .from('organizations')
      .update({ commercial_setup_required: false, commercial_setup_completed_at: new Date().toISOString() })
      .eq('id', orgId);
    await skipStaffOnboardingStep(serviceClient, orgId);

    const { data: property } = await serviceClient
      .from('properties')
      .insert({
        org_id: orgId,
        nickname: 'Test Property',
        address_line1: '1 Test Street',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'apartment',
      })
      .select('id')
      .single();
    const { data: unit } = await serviceClient
      .from('units')
      .insert({ org_id: orgId, property_id: property!.id, unit_label: 'Unit 1' })
      .select('id')
      .single();
    await serviceClient.from('tenants').insert({ org_id: orgId, full_name: 'Test Tenant' });
    await serviceClient.from('leases').insert({
      org_id: orgId,
      unit_id: unit!.id,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      rent_amount: 1000,
      status: 'active',
    });
    await markOnboardingIntroViewed(serviceClient, orgId, 'payments');
    await markOnboardingIntroViewed(serviceClient, orgId, 'documents');

    const progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.allDone).toBe(true);
    expect(progress.percentComplete).toBe(100);
    expect(progress.currentStep).toBeNull();
  });

  it('walkthrough state starts unset, reflects dismissed/completed, and restart clears both', async () => {
    let progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.walkthroughDismissed).toBe(false);
    expect(progress.walkthroughCompleted).toBe(false);

    await setWalkthroughState(serviceClient, orgId, 'dismissed');
    progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.walkthroughDismissed).toBe(true);
    expect(progress.walkthroughCompleted).toBe(false);

    await setWalkthroughState(serviceClient, orgId, 'completed');
    progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.walkthroughCompleted).toBe(true);

    await setWalkthroughState(serviceClient, orgId, 'restart');
    progress = await resolveOnboardingProgress(serviceClient, orgId);
    expect(progress.walkthroughDismissed).toBe(false);
    expect(progress.walkthroughCompleted).toBe(false);
  });
});
