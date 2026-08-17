import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveEligibleOwnerRecipients, notifyOwnersOfPaymentReport } from '../paymentReports';

// WhatsApp V1 completion pass, Phases A/B (WORKLOG.md this date). Real integration coverage for
// the owner-recipient resolution + notification dispatch layer -- the RPC-level correctness
// (confirm/reject/no-ledger-effect/idempotency) is already covered by
// supabase/tests/payment_reports_and_phone_verification.test.sql; this file covers the
// TypeScript-layer logic that sits above those RPCs (which owners are eligible, per-recipient
// dispatch, multi-owner fan-out).

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

describeIfSupabase(
  'resolveEligibleOwnerRecipients / notifyOwnersOfPaymentReport (real local Supabase integration)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orgId: string;
    let propertyId: string;
    const ownerUserIds: string[] = [];
    const ownerIds: string[] = [];

    beforeEach(async () => {
      const { data: org } = await serviceClient
        .from('organizations')
        .insert({ legal_name: `PaymentReports Vitest Org ${Date.now()}`, org_type: 'agency' })
        .select('id')
        .single();
      orgId = org!.id;

      const { data: placeholderAuth } = await serviceClient.auth.admin.createUser({
        email: `pr-placeholder-${Date.now()}@propertyvault.example`,
        password: 'TestPassw0rd!23',
        email_confirm: true,
      });
      ownerUserIds.push(placeholderAuth!.user!.id);

      const { data: property } = await serviceClient
        .from('properties')
        .insert({
          org_id: orgId,
          owner_user_id: placeholderAuth!.user!.id,
          nickname: 'PR Vitest Property',
          address_line1: '1 Test St',
          city: 'Cape Town',
        })
        .select('id')
        .single();
      propertyId = property!.id;

      // Owner A: linked (user_id set) + phone on file -- eligible.
      const { data: authA } = await serviceClient.auth.admin.createUser({
        email: `pr-owner-a-${Date.now()}@propertyvault.example`,
        password: 'TestPassw0rd!23',
        email_confirm: true,
      });
      const { data: ownerA } = await serviceClient
        .from('owners')
        .insert({
          org_id: orgId,
          name: 'Owner A',
          owner_type: 'individual',
          status: 'active',
          user_id: authA!.user!.id,
          phone: '+27821111111',
        })
        .select('id')
        .single();
      await serviceClient
        .from('property_owners')
        .insert({ property_id: propertyId, owner_id: ownerA!.id, ownership_pct: 40 });
      ownerUserIds.push(authA!.user!.id);
      ownerIds.push(ownerA!.id);

      // Owner B: linked + phone -- also eligible (multi-owner case).
      const { data: authB } = await serviceClient.auth.admin.createUser({
        email: `pr-owner-b-${Date.now()}@propertyvault.example`,
        password: 'TestPassw0rd!23',
        email_confirm: true,
      });
      const { data: ownerB } = await serviceClient
        .from('owners')
        .insert({
          org_id: orgId,
          name: 'Owner B',
          owner_type: 'individual',
          status: 'active',
          user_id: authB!.user!.id,
          phone: '+27822222222',
        })
        .select('id')
        .single();
      await serviceClient
        .from('property_owners')
        .insert({ property_id: propertyId, owner_id: ownerB!.id, ownership_pct: 30 });
      ownerUserIds.push(authB!.user!.id);
      ownerIds.push(ownerB!.id);

      // Owner C: NOT linked (no user_id) -- must be excluded (no real account to notify).
      await serviceClient
        .from('owners')
        .insert({
          org_id: orgId,
          name: 'Owner C Unlinked',
          owner_type: 'individual',
          status: 'active',
          phone: '+27823333333',
        })
        .select('id')
        .single()
        .then(async ({ data }) => {
          if (data)
            await serviceClient
              .from('property_owners')
              .insert({ property_id: propertyId, owner_id: data.id, ownership_pct: 15 });
        });

      // Owner D: linked but NO phone -- must be excluded (nothing to send to).
      const { data: authD } = await serviceClient.auth.admin.createUser({
        email: `pr-owner-d-${Date.now()}@propertyvault.example`,
        password: 'TestPassw0rd!23',
        email_confirm: true,
      });
      const { data: ownerD } = await serviceClient
        .from('owners')
        .insert({
          org_id: orgId,
          name: 'Owner D No Phone',
          owner_type: 'individual',
          status: 'active',
          user_id: authD!.user!.id,
        })
        .select('id')
        .single();
      await serviceClient
        .from('property_owners')
        .insert({ property_id: propertyId, owner_id: ownerD!.id, ownership_pct: 15 });
      ownerUserIds.push(authD!.user!.id);
    });

    afterEach(async () => {
      await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
      await serviceClient.from('property_owners').delete().eq('property_id', propertyId);
      await serviceClient.from('owners').delete().eq('org_id', orgId);
      await serviceClient.from('properties').delete().eq('id', propertyId);
      await serviceClient.from('organizations').delete().eq('id', orgId);
      for (const uid of ownerUserIds) {
        await serviceClient.auth.admin.deleteUser(uid).catch(() => {});
      }
    });

    it('resolves only linked owners with a phone on file -- excludes unlinked and phone-less owners', async () => {
      const recipients = await resolveEligibleOwnerRecipients(serviceClient, propertyId);
      expect(recipients).toHaveLength(2);
      expect(recipients.map((r) => r.phone).sort()).toEqual(['+27821111111', '+27822222222']);
    });

    it('dispatches an independent whatsapp_messages intent per eligible owner, never "the org" as one recipient', async () => {
      const paymentReportId = crypto.randomUUID();
      await notifyOwnersOfPaymentReport(serviceClient, {
        orgId,
        propertyId,
        paymentReportId,
        amount: 5000,
        tenantId: crypto.randomUUID(),
        paymentMethod: 'eft',
        paymentDate: '2026-03-15',
      });

      // No real Meta credentials exist in this test environment, so dispatchWhatsApp's
      // template-approval gate (Phase K) doesn't apply here -- it only blocks the moment a REAL
      // Meta API call would otherwise be made (deliveryConfigured === true). Locally, MockWhatsAppProvider
      // sends both, proving the real behavioural contract this test protects: TWO independent rows,
      // one per eligible owner, each keyed by its own related_entity_type -- never a single send
      // deduplicated across both owners.
      const { data: messages } = await serviceClient
        .from('whatsapp_messages')
        .select('related_entity_type')
        .eq('related_entity_id', paymentReportId);
      expect(messages).toHaveLength(2);
      expect(new Set(messages!.map((m) => m.related_entity_type)).size).toBe(2);
      expect(messages!.every((m) => m.related_entity_type.startsWith('payment_report:'))).toBe(
        true,
      );
    });

    it('returns an empty recipient list for a property with no property_owners rows at all (no throw)', async () => {
      const recipients = await resolveEligibleOwnerRecipients(serviceClient, crypto.randomUUID());
      expect(recipients).toEqual([]);
    });
  },
);
