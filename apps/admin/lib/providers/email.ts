import 'server-only';
import type { EmailProvider, SendEmailInput, SendEmailResult } from '@propvault/types';

// Mock-first EmailProvider (EMAIL.md §2) -- no real vendor account exists (external-service
// blocker). Logs the constructed message and returns 'queued' -- never 'sent'/'delivered'.
// This is a hard rule, not a simplification to relax later in mock mode: EMAIL.md §2 is explicit
// that email_messages.status is read by invoice/statement detail views as delivery *proof*, so a
// mock that fabricated progression would make the audit trail lie. Contrast with
// MockWhatsAppProvider (WHATSAPP.md §5), which is documented as simulating a queued->sent->
// delivered lifecycle -- the two mocks are deliberately NOT symmetric, matching their source
// documents' different rules, not an oversight.
export class MockEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.warn('[MockEmailProvider] would send', {
      orgId: input.orgId,
      toAddress: input.toAddress,
      templateName: input.templateName,
      attachmentCount: input.attachments?.length ?? 0,
    });
    return { providerMessageId: `mock-email-${crypto.randomUUID()}`, status: 'queued' };
  }
}

export function getEmailProvider(): EmailProvider {
  return new MockEmailProvider();
}
