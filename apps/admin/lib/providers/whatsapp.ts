import 'server-only';
import type {
  InboundWhatsAppEvent,
  SendWhatsAppTemplateInput,
  SendWhatsAppTemplateResult,
  WhatsAppProvider,
  WhatsAppStatusCallback,
} from '@propvault/types';

// Mock-first WhatsAppProvider (WHATSAPP.md §5) -- no real BSP/Meta account exists
// (external-service blocker). Deterministic, synchronous responses only -- WHATSAPP.md §5
// describes the mock as also "simulating the queued->sent->delivered lifecycle on a timer," which
// is deliberately NOT implemented here: no webhook handler or scheduled job consumes it yet (both
// need a real provider account to be worth building against), so a timer with no consumer would
// be speculative scaffolding. sendTemplateMessage() returning a real, usable providerMessageId is
// what actually unblocks building the dispatcher/resolution logic against this interface; the
// lifecycle-simulation half is deferred until something needs to demo it.
export class MockWhatsAppProvider implements WhatsAppProvider {
  async sendTemplateMessage(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult> {
    console.warn('[MockWhatsAppProvider] would send template', {
      orgId: input.orgId,
      to: input.to,
      templateName: input.templateName,
    });
    return { providerMessageId: `mock-whatsapp-${crypto.randomUUID()}` };
  }

  verifyWebhookSignature(_rawBody: string, _signatureHeader: string): boolean {
    // No real webhook secret exists in mock mode -- always "verifies" so the rest of the pipeline
    // (parseInboundEvent, resolution) can be exercised. A real provider implementation MUST
    // perform genuine HMAC verification here (WHATSAPP.md §4) before this is ever wired to a real
    // webhook route.
    return true;
  }

  parseInboundEvent(rawBody: unknown): InboundWhatsAppEvent {
    return { kind: 'message', rawPayload: rawBody };
  }

  parseStatusCallback(rawBody: unknown): WhatsAppStatusCallback {
    const payload = rawBody as { providerMessageId?: string; status?: string };
    return {
      providerMessageId: payload.providerMessageId ?? 'unknown',
      status: (payload.status as WhatsAppStatusCallback['status']) ?? 'sent',
    };
  }
}

export function getWhatsAppProvider(): WhatsAppProvider {
  return new MockWhatsAppProvider();
}
