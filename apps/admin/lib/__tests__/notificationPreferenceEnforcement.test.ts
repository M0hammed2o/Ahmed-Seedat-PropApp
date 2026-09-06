import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { dispatchWhatsApp } from '../whatsappDispatch';
import { dispatchEmail } from '../emailDispatch';

// External-communications release-gate pass: notification preferences must be enforced
// SERVER-SIDE, in the dispatcher, not merely reflected in a settings screen. A preference that is
// only honoured by the UI is not a preference -- any other code path that dispatches would ignore
// it, and the user would keep receiving messages they switched off.
//
// The decisive property tested here is CHANNEL INDEPENDENCE: switching WhatsApp off for a category
// must not silently switch email off for that same category (and vice versa). A shared "notify me"
// flag masquerading as per-channel controls would pass a naive single-channel test and fail this.
//
// Both levels of the hierarchy are covered: organization_notification_settings (an org-wide
// default) and notification_preferences (a specific user narrowing it further).
//
// PUSH IS DELIBERATELY ABSENT. notification_preferences.push_enabled is stored and returned by the
// preferences API, but no code path anywhere sends a push notification -- device-push-tokens only
// registers and unregisters tokens. There is therefore no dispatcher to enforce push preferences
// against, and asserting on one would be inventing coverage for a channel that does not send.

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

describeIfSupabase('notification preference enforcement (server-side, real local Supabase)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let userId: string;
  const phone = '+27820000901';
  const email = () => `pref-${randomUUID().slice(0, 8)}@proplyst-demo.local`;

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { data: org, error } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Pref Enforcement Org ${Date.now()}-${randomUUID().slice(0, 6)}`, org_type: 'agency' })
      .select('id')
      .single();
    if (error) throw error;
    orgId = org.id;

    const { data: user, error: userErr } = await serviceClient.auth.admin.createUser({
      email: email(),
      password: 'PrefTest2026!',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    userId = user.user.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('email_messages').delete().eq('org_id', orgId);
    await serviceClient.from('audit_events').delete().eq('org_id', orgId);
    await serviceClient.from('notification_preferences').delete().eq('user_id', userId);
    await serviceClient.from('organization_notification_settings').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(userId);
  });

  async function sendWhatsApp() {
    return dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: phone,
      toUserId: userId,
      actorUserId: null,
      templateName: 'maintenance_request_update',
      variables: {
        propertyLabel: 'Berea Heights, Unit 2A',
        summary: 'Leaking tap',
        status: 'In progress',
        updateMessage: 'A plumber has been assigned.',
        ticketLink: 'http://127.0.0.1:3000/maintenance',
      },
      relatedEntityType: 'maintenance_tickets',
      relatedEntityId: randomUUID(),
    });
  }

  // maintenance_update is the email counterpart of the WhatsApp maintenance_request_update
  // template, and both map to the 'maintenance' category -- which is what makes the
  // channel-independence assertions below meaningful. (Most email templates are deliberately
  // ungated transactional messages; see emailDispatch.ts's TEMPLATE_CATEGORY rationale.)
  async function sendEmail() {
    return dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'pref-target@proplyst-demo.local',
      toUserId: userId,
      actorUserId: null,
      templateName: 'maintenance_update',
      templateVars: {
        propertyAddress: 'Berea Heights, Unit 2A',
        status: 'In progress',
        updateMessage: 'A plumber has been assigned.',
      },
      relatedEntityType: 'maintenance_tickets',
      relatedEntityId: randomUUID(),
    });
  }

  it('sends on both channels when no preference row exists at all (default enabled)', async () => {
    const wa = await sendWhatsApp();
    const em = await sendEmail();
    expect(wa.sent, `whatsapp: ${wa.reason}`).toBe(true);
    expect(em.sent, `email: ${em.reason}`).toBe(true);
  });

  it('suppresses WhatsApp but STILL SENDS email when the user disables WhatsApp for that category', async () => {
    await serviceClient.from('notification_preferences').insert({
      user_id: userId,
      category: 'maintenance',
      whatsapp_enabled: false,
      email_enabled: true,
    });

    const wa = await sendWhatsApp();
    expect(wa.sent).toBe(false);
    expect(wa.reason).toBe('preference_disabled');

    // The whole point: channels are independent. Turning WhatsApp off must not mute email too.
    const em = await sendEmail();
    expect(em.sent, `email should still send: ${em.reason}`).toBe(true);

    // And nothing may have been recorded as a WhatsApp send.
    const { count } = await serviceClient
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    expect(count ?? 0).toBe(0);
  });

  it('suppresses email but STILL SENDS WhatsApp when the user disables email for that category', async () => {
    await serviceClient.from('notification_preferences').insert({
      user_id: userId,
      category: 'maintenance',
      whatsapp_enabled: true,
      email_enabled: false,
    });

    const em = await sendEmail();
    expect(em.sent).toBe(false);
    expect(em.reason).toBe('preference_disabled');

    const wa = await sendWhatsApp();
    expect(wa.sent, `whatsapp should still send: ${wa.reason}`).toBe(true);
  });

  it('an ORG-level disable suppresses the channel even with no per-user row', async () => {
    await serviceClient.from('organization_notification_settings').insert({
      org_id: orgId,
      category: 'maintenance',
      whatsapp_enabled: false,
    });

    const wa = await sendWhatsApp();
    expect(wa.sent).toBe(false);
    expect(wa.reason).toBe('preference_disabled');
  });

  it('a preference for a DIFFERENT category does not suppress this one', async () => {
    // Disabling rent must not leak across into maintenance.
    await serviceClient.from('notification_preferences').insert({
      user_id: userId,
      category: 'rent',
      whatsapp_enabled: false,
      email_enabled: false,
    });

    const wa = await sendWhatsApp();
    const em = await sendEmail();
    expect(wa.sent, `whatsapp: ${wa.reason}`).toBe(true);
    expect(em.sent, `email: ${em.reason}`).toBe(true);
  });

  it('the UAT override does not bypass preference suppression', async () => {
    // A redirected UAT message must obey exactly the same gates a real one would -- otherwise UAT
    // would prove the pipeline works while hiding that a suppression rule is broken.
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', '+27837866021');
    vi.stubEnv('NODE_ENV', 'development');

    await serviceClient.from('notification_preferences').insert({
      user_id: userId,
      category: 'maintenance',
      whatsapp_enabled: false,
    });

    const wa = await sendWhatsApp();
    expect(wa.sent).toBe(false);
    expect(wa.reason).toBe('preference_disabled');
  });
});
