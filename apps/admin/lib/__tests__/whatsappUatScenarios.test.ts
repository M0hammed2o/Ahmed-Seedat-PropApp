import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { dispatchWhatsApp } from '../whatsappDispatch';
import {
  buildTenantAccountInvitationVariables,
  buildPaymentReceivedConfirmationVariables,
  buildPaymentConfirmationRequiredVariables,
  buildRentPaymentReminderVariables,
  buildRentOverdueNoticeVariables,
  buildMaintenanceRequestUpdateVariables,
  buildLeaseExpiryReminderVariables,
  buildOwnerMonthlyPropertySummaryVariables,
} from '../whatsappTemplateVariables';

// WhatsApp UAT scenario coverage (V1 release-gate pass).
//
// Drives one message per supported template, each carrying a distinct simulated persona, through
// the REAL dispatchWhatsApp() pipeline -- the same function every production call site uses. This
// verifies template-variable construction, the approval registry, preference gating, idempotency,
// whatsapp_messages recording and audit-event writing for all nine owner/tenant scenarios at once.
//
// Paired with WHATSAPP_UAT_OVERRIDE_NUMBER, the same table is what a reviewer runs to receive every
// persona on one handset.
//
// WHAT THIS DOES NOT PROVE: getWhatsAppProvider() falls back to MockWhatsAppProvider unless real
// Meta credentials are present, and the mock never contacts Meta. Each assertion below therefore
// checks the PIPELINE outcome (sent + recorded), and the suite reports deliveryConfigured so a
// green run is never mistaken for proof of delivery.

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000';

// Every recipient below is the fictional persona's number. With the override set they all land on
// the reviewer's handset; without it, nothing is delivered at all (mock provider).
const PERSONA_NUMBER = '+27820000001';

type Scenario = {
  label: string;
  template: Parameters<typeof dispatchWhatsApp>[1]['templateName'];
  variables: Record<string, string>;
};

const scenarios: Scenario[] = [
  {
    label: 'UAT -- Tenant: Naledi Khumalo -- Unit 4B -- rent reminder',
    template: 'rent_payment_reminder',
    variables: buildRentPaymentReminderVariables({
      amount: 'R8 500.00',
      paymentPeriod: 'October 2026',
      dueDate: '1 October 2026',
      propertyLabel: 'Berea Heights, Unit 4B',
      accountLink: `${APP}/tenant/payments`,
    }),
  },
  {
    label: 'UAT -- Tenant: Sipho Ndlovu -- Unit 2B -- rent overdue',
    template: 'rent_overdue_notice',
    variables: buildRentOverdueNoticeVariables({
      outstandingAmount: 'R7 950.00',
      tenantName: 'Sipho Ndlovu',
      propertyLabel: 'Berea Heights, Unit 3A',
      paymentPeriod: 'September 2026',
      accountLink: `${APP}/tenant/payments`,
    }),
  },
  {
    label: 'UAT -- Owner: payment awaiting confirmation (EFT)',
    template: 'payment_confirmation_required',
    variables: buildPaymentConfirmationRequiredVariables({
      amount: 'R11 450.00',
      propertyLabel: 'Ballito Beach Apartments, Apt 3',
      tenantName: 'Nozipho Mthembu',
      paymentMethod: 'EFT',
      paymentPeriod: 'September 2026',
      reviewLink: `${APP}/payments/review`,
    }),
  },
  {
    label: 'UAT -- Owner: payment awaiting confirmation (Cash)',
    template: 'payment_confirmation_required',
    variables: buildPaymentConfirmationRequiredVariables({
      amount: 'R6 000.00',
      propertyLabel: 'Musgrave Court, Apt 2',
      tenantName: 'Bongani Cele',
      // Deliberately just the method -- no collector name is invented. If the product does not know
      // who took the cash, the message must not imply that it does.
      paymentMethod: 'Cash',
      paymentPeriod: 'September 2026',
      reviewLink: `${APP}/payments/review`,
    }),
  },
  {
    label: 'UAT -- Tenant: payment confirmed receipt',
    template: 'payment_received_confirmation',
    variables: buildPaymentReceivedConfirmationVariables({
      amount: 'R8 250.00',
      propertyLabel: 'Berea Heights, Unit 2A',
      paymentPeriod: 'September 2026',
      dateConfirmed: '5 September 2026',
      accountLink: `${APP}/tenant/payments`,
    }),
  },
  {
    label: 'UAT -- Tenant: maintenance status update',
    template: 'maintenance_request_update',
    variables: buildMaintenanceRequestUpdateVariables({
      propertyLabel: 'Ballito Beach Apartments, Apt 4',
      summary: 'Electrical fault -- sparking outlet',
      status: 'In progress',
      updateMessage: 'An electrician has been assigned and will attend tomorrow morning.',
      ticketLink: `${APP}/maintenance`,
    }),
  },
  {
    label: 'UAT -- Tenant: lease expiring soon',
    template: 'lease_expiry_reminder',
    variables: buildLeaseExpiryReminderVariables({
      tenantName: 'Craig Williams',
      propertyLabel: 'Hillcrest Family Home',
      expiryDate: '26 October 2026',
      leaseLink: `${APP}/tenant/lease`,
    }),
  },
  {
    label: 'UAT -- Owner: monthly property summary',
    template: 'owner_monthly_property_summary',
    variables: buildOwnerMonthlyPropertySummaryVariables({
      month: 'September 2026',
      propertyCount: '10',
      expectedRent: 'R397 450.00',
      confirmedPaid: 'R373 250.00',
      outstanding: 'R24 200.00',
      awaitingConfirmation: '1',
      openMaintenance: '3',
      upcomingLeaseExpiries: '1',
      reportUrl: `${APP}/reports`,
    }),
  },
  {
    label: 'UAT -- Tenant: portal account invitation',
    template: 'tenant_account_invitation',
    variables: buildTenantAccountInvitationVariables({
      organizationName: 'Proplyst Demo Portfolio',
      acceptUrl: `${APP}/invite/accept`,
      supportName: 'Amaan Patel',
    }),
  },
];


describe('WhatsApp UAT scenarios (real dispatch pipeline, mock provider unless credentials set)', () => {
  it('every supported template dispatches successfully with realistic persona variables', async () => {
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .ilike('legal_name', 'Proplyst Demo Portfolio%')
      .maybeSingle();
    if (!org) {
      console.warn('Demo portfolio org not found -- run scripts/seed-proplyst-video-demo.mjs first.');
      return;
    }

    let delivered = 0;
    let mocked = 0;

    for (const s of scenarios) {
      const result = await dispatchWhatsApp(supabase, {
        orgId: org.id,
        toPhone: PERSONA_NUMBER,
        toUserId: null,
        actorUserId: null,
        templateName: s.template,
        variables: s.variables,
        relatedEntityType: 'uat_scenario',
        relatedEntityId: randomUUID(),
      });

      // A suppressed send here means a real pipeline defect (unapproved template, bad variables,
      // preference gate) -- not a delivery problem, which the mock cannot exercise either way.
      expect(result.sent, `${s.label} -> ${result.reason}`).toBe(true);
      if (result.deliveryConfigured) delivered += 1;
      else mocked += 1;
    }

    expect(delivered + mocked).toBe(scenarios.length);
    if (mocked > 0) {
      console.warn(
        `[UAT] ${mocked}/${scenarios.length} scenarios ran through MockWhatsAppProvider -- ` +
          'pipeline verified, NO message reached any phone (no Meta credentials configured).',
      );
    }
  }, 60000);

  it('every scenario template is registered and approved, so none would be rejected by Meta', async () => {
    const { isWhatsAppTemplateApproved } = await import('../whatsappTemplates');
    for (const s of scenarios) {
      expect(isWhatsAppTemplateApproved(s.template), `${s.template} not approved`).toBe(true);
    }
  });

  // The destination guarantee that makes it safe to switch real Meta credentials on. It holds
  // identically whether the provider is the mock or the real one, because the redirect happens in
  // the dispatcher before the provider is ever called -- so proving it now means turning
  // credentials on later cannot surprise anyone by messaging a real tenant.
  it('with the UAT override active, EVERY scenario is addressed to the UAT number and none to a persona number', async () => {
    const UAT_NUMBER = '+27837866021';
    vi.stubEnv('WHATSAPP_UAT_OVERRIDE_NUMBER', UAT_NUMBER);
    vi.stubEnv('NODE_ENV', 'development');

    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .ilike('legal_name', 'Proplyst Demo Portfolio%')
      .maybeSingle();
    if (!org) {
      console.warn('Demo portfolio org not found -- run scripts/seed-proplyst-video-demo.mjs first.');
      return;
    }

    const ids: string[] = [];
    for (const s of scenarios) {
      const result = await dispatchWhatsApp(supabase, {
        orgId: org.id,
        toPhone: PERSONA_NUMBER,
        toUserId: null,
        actorUserId: null,
        templateName: s.template,
        variables: s.variables,
        relatedEntityType: 'uat_destination_audit',
        relatedEntityId: randomUUID(),
      });
      expect(result.sent, `${s.label} -> ${result.reason}`).toBe(true);
      if (result.whatsappMessageId) ids.push(result.whatsappMessageId);
    }

    const { data: rows } = await supabase
      .from('whatsapp_messages')
      .select('id, to_number')
      .in('id', ids);

    expect(rows?.length).toBe(scenarios.length);
    for (const row of rows ?? []) {
      expect(row.to_number).toBe(UAT_NUMBER);
      // The decisive assertion: the persona's own number must appear nowhere.
      expect(row.to_number).not.toBe(PERSONA_NUMBER);
    }

    // The override must never have rewritten source data -- no tenant may carry the UAT number.
    const { count: tenantsWithUat } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('phone', UAT_NUMBER);
    expect(tenantsWithUat ?? 0).toBe(0);

    for (const id of ids) await supabase.from('whatsapp_messages').delete().eq('id', id);
  }, 60000);
});
