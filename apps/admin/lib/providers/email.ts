import 'server-only';
import { Resend } from 'resend';
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

export interface ResendConfig {
  apiKey: string;
  fromAddress: string;
}

export function getResendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !fromAddress) return null;
  return { apiKey, fromAddress };
}

// Real Resend integration (Stage 5, commercial-launch execution plan, WORKLOG.md this date).
// Deliberately does NOT resolve `input.attachments` (documentId -> file bytes) -- doing so would
// mean this provider class reaching into Supabase Storage/the documents table itself, which no
// other provider in this codebase does (payfast.ts's own comment: "no DB access from a provider
// class"). Confirmed via grep before writing this: zero real callers currently pass `attachments`
// to dispatchEmail() at all, so this is a disclosed, currently-unreachable gap, not a silent drop
// of something in active use -- logged loudly if it ever is exercised, rather than guessed at.
//
// No real Resend account/API key exists in this environment (external-service blocker, same class
// of gap as PayFast -- TECHNICAL_DEBT_REGISTER.md TD-36/TD-37) -- never sent a real email via this
// path this session.
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;

  constructor(private readonly config: ResendConfig) {
    this.client = new Resend(config.apiKey);
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (input.attachments && input.attachments.length > 0) {
      console.warn(
        '[ResendEmailProvider] attachments were requested but are not implemented (no DB access from a provider class) -- sending without them',
        { orgId: input.orgId, documentIds: input.attachments.map((a) => a.documentId) },
      );
    }

    const { data, error } = await this.client.emails.send({
      from: this.config.fromAddress,
      to: input.toAddress,
      subject: input.subject,
      text: input.bodyText,
      replyTo: input.replyTo,
    });

    if (error) {
      throw new Error(`Resend send failed: ${error.name} - ${error.message}`);
    }
    if (!data) {
      throw new Error('Resend send returned no data and no error -- unexpected response shape');
    }

    // Resend's synchronous response only confirms acceptance into their send queue, not final
    // delivery -- 'queued' here, exactly like the mock, for the same EMAIL.md §2 reason (real
    // delivery/bounce state arrives later via webhook, not fabricated here).
    return { providerMessageId: data.id, status: 'queued' };
  }
}

export function getEmailProvider(): EmailProvider {
  const resendConfig = getResendConfig();
  if (resendConfig) {
    return new ResendEmailProvider(resendConfig);
  }
  return new MockEmailProvider();
}

// Overnight platform pass (WORKLOG.md this date): closes a real gap found while diagnosing "owner
// and staff invitations show pending but no email ever arrives" -- dispatchEmail()'s result never
// distinguished "really handed to Resend" from "silently mocked because RESEND_API_KEY/
// RESEND_FROM_ADDRESS aren't set," so every caller (and the UI built on top of it) treated a mock
// no-op exactly like a real send. This is the one place that distinction is now made, so it can't
// drift out of sync with getEmailProvider()'s own fallback logic.
export function isEmailProviderConfigured(): boolean {
  return getResendConfig() !== null;
}
