import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dispatchWhatsApp, resolveWhatsAppUatOverride } from '../whatsappDispatch';

// V1 release-gate pass: WHATSAPP_UAT_OVERRIDE_NUMBER lets one reviewer's handset receive every
// template/persona during UAT without editing real tenant phone numbers to achieve it. Because a
// misconfigured deploy of this variable would funnel every customer's messages to a single phone,
// the production block below is the single most important assertion in this file.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const UAT_NUMBER = '+27837866021';
const TENANT_NUMBER = '+27821234567';

describe('resolveWhatsAppUatOverride (pure)', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('is inactive when the variable is unset -- the normal production path', () => {
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', '');
    expect(resolveWhatsAppUatOverride(TENANT_NUMBER)).toEqual({ kind: 'inactive' });
  });

  it('redirects to the override number when set outside production', () => {
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', UAT_NUMBER);
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveWhatsAppUatOverride(TENANT_NUMBER)).toEqual({ kind: 'redirect', to: UAT_NUMBER });
  });

  it('IGNORES the override in production and logs an error -- a misconfigured deploy must never redirect real customer messages', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', UAT_NUMBER);
    vi.stubEnv('NODE_ENV', 'production');

    expect(resolveWhatsAppUatOverride(TENANT_NUMBER)).toEqual({ kind: 'inactive' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('IGNORED'));
  });

  // toE164() validates E.164 but never converts, so the local form of this very number does not
  // parse. Failing closed here is the whole point: ignoring it would deliver to the real tenant,
  // which is exactly what setting the variable was meant to prevent.
  it('BLOCKS the send when the override is set in local format rather than E.164', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', '083 786 6021');
    vi.stubEnv('NODE_ENV', 'development');

    expect(resolveWhatsAppUatOverride(TENANT_NUMBER)).toEqual({
      kind: 'blocked',
      reason: 'invalid_uat_override_number',
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('+27837866021'));
  });

  it('BLOCKS rather than falls through for any unparseable override', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', 'not-a-number');
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveWhatsAppUatOverride(TENANT_NUMBER)).toMatchObject({ kind: 'blocked' });
  });

  it('is inactive when the override equals the intended recipient (no redirect to record)', () => {
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', UAT_NUMBER);
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveWhatsAppUatOverride(UAT_NUMBER)).toEqual({ kind: 'inactive' });
  });
});

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

describeIfSupabase('dispatchWhatsApp with UAT override (real local Supabase)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const originalEnv = { ...process.env };
  let orgId: string;

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { data: org, error } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `WhatsApp UAT Override Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (error) throw error;
    orgId = org.id;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('audit_events').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
  });

  it('records the number actually messaged, not the intended one, and preserves the intended recipient in the audit trail', async () => {
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', UAT_NUMBER);
    vi.stubEnv('NODE_ENV', 'development');

    const entityId = crypto.randomUUID();
    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: TENANT_NUMBER,
      templateName: 'rent_payment_reminder',
      variables: { tenantName: 'Naledi Khumalo', amount: 'R8 500', dueDate: '2026-10-01' },
      actorUserId: null,
      relatedEntityType: 'rent_schedules',
      relatedEntityId: entityId,
    });
    expect(result.sent).toBe(true);

    const { data: row } = await serviceClient
      .from('whatsapp_messages')
      .select('to_number')
      .eq('id', result.whatsappMessageId!)
      .single();
    // The ledger must never claim the tenant was contacted when the message went to the UAT handset.
    expect(row!.to_number).toBe(UAT_NUMBER);
    expect(row!.to_number).not.toBe(TENANT_NUMBER);

    const { data: audit } = await serviceClient
      .from('audit_events')
      .select('after')
      .eq('org_id', orgId)
      .eq('action', 'whatsapp_sent')
      .maybeSingle();
    expect(audit!.after).toMatchObject({
      uatOverride: true,
      intendedRecipient: TENANT_NUMBER,
      toNumber: UAT_NUMBER,
    });
  });

  it('leaves the recipient untouched and writes no override marker when the variable is unset', async () => {
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', '');

    const entityId = crypto.randomUUID();
    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: TENANT_NUMBER,
      templateName: 'rent_payment_reminder',
      variables: { tenantName: 'Naledi Khumalo', amount: 'R8 500', dueDate: '2026-10-01' },
      actorUserId: null,
      relatedEntityType: 'rent_schedules',
      relatedEntityId: entityId,
    });
    expect(result.sent).toBe(true);

    const { data: row } = await serviceClient
      .from('whatsapp_messages')
      .select('to_number')
      .eq('id', result.whatsappMessageId!)
      .single();
    expect(row!.to_number).toBe(TENANT_NUMBER);

    const { data: audit } = await serviceClient
      .from('audit_events')
      .select('after')
      .eq('org_id', orgId)
      .eq('action', 'whatsapp_sent')
      .maybeSingle();
    expect(audit!.after).not.toHaveProperty('uatOverride');
  });

  it('still honours notification-preference suppression while the override is active (a redirected test message obeys the same gates)', async () => {
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', UAT_NUMBER);
    vi.stubEnv('NODE_ENV', 'development');

    await serviceClient
      .from('organization_notification_settings')
      .insert({ org_id: orgId, category: 'rent', whatsapp_enabled: false });

    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: TENANT_NUMBER,
      templateName: 'rent_payment_reminder',
      variables: { tenantName: 'Naledi Khumalo', amount: 'R8 500', dueDate: '2026-10-01' },
      actorUserId: null,
      relatedEntityType: 'rent_schedules',
      relatedEntityId: crypto.randomUUID(),
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('preference_disabled');
    await serviceClient.from('organization_notification_settings').delete().eq('org_id', orgId);
  });

  it('suppresses the send entirely when the override is misconfigured -- never falls through to the real tenant', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', '083 786 6021'); // local format, not E.164
    vi.stubEnv('NODE_ENV', 'development');

    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: TENANT_NUMBER,
      templateName: 'rent_payment_reminder',
      variables: { tenantName: 'Naledi Khumalo', amount: 'R8 500', dueDate: '2026-10-01' },
      actorUserId: null,
      relatedEntityType: 'rent_schedules',
      relatedEntityId: crypto.randomUUID(),
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('uat_override_invalid');

    // Nothing may be recorded as sent to the real tenant.
    const { count } = await serviceClient
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('to_number', TENANT_NUMBER);
    expect(count ?? 0).toBe(0);
  });
});
