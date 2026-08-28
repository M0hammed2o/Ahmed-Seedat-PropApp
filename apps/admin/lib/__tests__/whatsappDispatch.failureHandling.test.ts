import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dispatchWhatsApp } from '../whatsappDispatch';
import * as whatsappTemplates from '../whatsappTemplates';

// WhatsApp launch-completion pass (WORKLOG.md 2026-08-27): flipping application_invitation/
// application_documents_requested/application_approved/application_declined/lease_ready to
// approved:true makes dispatchWhatsApp() reach the real provider call for the first time -- before
// this pass, neither the provider call nor the whatsapp_messages insert was wrapped in a try/catch,
// so a network failure calling Meta (or a genuine DB insert error) would throw all the way up
// through every call site (decide/route.ts, send/route.ts, ...), turning a successfully-completed
// core action (an application already approved, a lease already sent) into a misleading 500 to the
// caller. These are pure unit tests (mocked provider + a minimal fake Supabase client) proving the
// fix: dispatchWhatsApp() now fails soft, returning `{ sent: false, reason: 'send_failed' }`,
// exactly the "A WhatsApp failure must NOT roll back a successfully completed core business
// action" + "safe provider error handling" requirements for this pass.
//
// lease_ready is used as the template under test specifically because it has no entry in
// whatsappDispatch.ts's internal TEMPLATE_CATEGORY map -- so the org/user notification_preferences
// lookups are skipped entirely, keeping the fake client's required surface minimal (just the
// existing-message idempotency check, then the insert).

const mockSendTemplateMessage = vi.fn();
vi.mock('../providers/whatsapp', () => ({
  getWhatsAppProvider: () => ({ sendTemplateMessage: mockSendTemplateMessage }),
  isWhatsAppProviderConfigured: () => true,
}));

function buildFakeServiceClient(opts: {
  existingMessage?: { id: string } | null;
  insertError?: { message: string } | null;
  insertedId?: string;
}) {
  return {
    from: (table: string) => {
      if (table === 'whatsapp_messages') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: opts.existingMessage ?? null, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve(
                  opts.insertError
                    ? { data: null, error: opts.insertError }
                    : { data: { id: opts.insertedId ?? 'msg-1' }, error: null },
                ),
            }),
          }),
        };
      }
      // writeAuditEvent's own insert (only reached on the success path -- actorUserId is null in
      // every test here, so resolveActorSnapshot short-circuits and never queries a table itself).
      if (table === 'audit_events') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`buildFakeServiceClient: unexpected table "${table}"`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchWhatsApp -- failure resilience (WORKLOG.md 2026-08-27)', () => {
  it('never throws when the real provider call fails (e.g. network error calling Meta) -- returns sent:false, reason:send_failed', async () => {
    mockSendTemplateMessage.mockRejectedValue(new Error('ECONNREFUSED talking to Meta'));
    const client = buildFakeServiceClient({ existingMessage: null });

    const result = await dispatchWhatsApp(client as unknown as Parameters<typeof dispatchWhatsApp>[0], {
      orgId: 'org-1',
      toPhone: '+27821234567',
      templateName: 'lease_ready',
      variables: { organizationName: 'Acme', propertyLabel: 'Property A', leaseUrl: 'https://x/my-lease' },
      relatedEntityType: 'leases',
      relatedEntityId: 'lease-1',
      actorUserId: null,
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('send_failed');
  });

  it('never throws when the whatsapp_messages insert fails after a successful provider send -- returns sent:false, reason:send_failed', async () => {
    mockSendTemplateMessage.mockResolvedValue({ providerMessageId: 'wamid-1' });
    const client = buildFakeServiceClient({
      existingMessage: null,
      insertError: { message: 'relation "whatsapp_messages" constraint violation' },
    });

    const result = await dispatchWhatsApp(client as unknown as Parameters<typeof dispatchWhatsApp>[0], {
      orgId: 'org-1',
      toPhone: '+27821234567',
      templateName: 'lease_ready',
      variables: { organizationName: 'Acme', propertyLabel: 'Property A', leaseUrl: 'https://x/my-lease' },
      relatedEntityType: 'leases',
      relatedEntityId: 'lease-1',
      actorUserId: null,
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('send_failed');
  });

  it('never surfaces the raw provider error message in the returned result (logged server-side only)', async () => {
    mockSendTemplateMessage.mockRejectedValue(
      new Error('Meta API secret token abc123 rejected: invalid credentials'),
    );
    const client = buildFakeServiceClient({ existingMessage: null });

    const result = await dispatchWhatsApp(client as unknown as Parameters<typeof dispatchWhatsApp>[0], {
      orgId: 'org-1',
      toPhone: '+27821234567',
      templateName: 'lease_ready',
      variables: {},
      relatedEntityType: 'leases',
      relatedEntityId: 'lease-1',
      actorUserId: null,
    });

    expect(JSON.stringify(result)).not.toContain('abc123');
    expect(JSON.stringify(result)).not.toContain('secret token');
  });

  it('still succeeds normally when the provider send works (control case, proves the try/catch did not break the happy path)', async () => {
    mockSendTemplateMessage.mockResolvedValue({ providerMessageId: 'wamid-2' });
    const client = buildFakeServiceClient({ existingMessage: null, insertedId: 'msg-42' });

    const result = await dispatchWhatsApp(client as unknown as Parameters<typeof dispatchWhatsApp>[0], {
      orgId: 'org-1',
      toPhone: '+27821234567',
      templateName: 'lease_ready',
      variables: {},
      relatedEntityType: 'leases',
      relatedEntityId: 'lease-1',
      actorUserId: null,
    });

    expect(result.sent).toBe(true);
    expect(result.whatsappMessageId).toBe('msg-42');
  });

  // All 13 registered templates are approved as of this same pass (whatsappTemplates.ts,
  // 2026-08-27 reconciliation) -- there is currently no real registered template name left to
  // exercise the "unapproved template blocked before any provider call" safety gate against
  // end-to-end (applicationAndLeaseWhatsApp.test.ts's old "template-approval gate" describe block
  // relied on these same 5 templates being unapproved, and is updated this same pass to match the
  // new, true state). The gate itself (dispatchWhatsApp checks isWhatsAppTemplateApproved() before
  // ever calling getWhatsAppProvider()) is still real, still load-bearing production logic for
  // whichever template Meta hasn't approved next -- proven here at the unit level via a scoped
  // spy on the registry check (not a file-wide mock, which would also defang the "control case"
  // success test above), so this safety property keeps direct test coverage.
  it('the approval gate blocks a real send and never calls the provider when isWhatsAppTemplateApproved() is false', async () => {
    const approvalSpy = vi.spyOn(whatsappTemplates, 'isWhatsAppTemplateApproved').mockReturnValue(false);
    const client = buildFakeServiceClient({ existingMessage: null });

    const result = await dispatchWhatsApp(client as unknown as Parameters<typeof dispatchWhatsApp>[0], {
      orgId: 'org-1',
      toPhone: '+27821234567',
      templateName: 'lease_ready',
      variables: {},
      relatedEntityType: 'leases',
      relatedEntityId: 'lease-1',
      actorUserId: null,
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('template_not_approved');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();

    approvalSpy.mockRestore();
  });
});
