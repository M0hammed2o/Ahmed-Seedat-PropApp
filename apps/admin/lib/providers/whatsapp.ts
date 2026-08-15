import 'server-only';
import crypto from 'crypto';
import type {
  InboundWhatsAppEvent,
  SendWhatsAppTemplateInput,
  SendWhatsAppTemplateResult,
  WhatsAppProvider,
  WhatsAppStatusCallback,
  WhatsAppWebhookEventKind,
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

  // No real BSP payload shape exists in mock mode -- a status-callback mock payload always has a
  // `status` field (parseStatusCallback below), a message mock payload never does, so that field's
  // presence is what distinguishes them here, mirroring MockEmailProvider.parseWebhookEvent's own
  // convention of parsing a well-defined mock shape rather than blindly wrapping the input.
  classifyWebhookEvent(rawBody: unknown): WhatsAppWebhookEventKind {
    const payload = rawBody as { status?: string };
    return payload.status ? 'status_callback' : 'message';
  }

  parseInboundEvent(rawBody: unknown): InboundWhatsAppEvent {
    const payload = rawBody as { from?: string; body?: string; providerMessageId?: string };
    return {
      kind: 'message',
      from: payload.from,
      body: payload.body,
      providerMessageId: payload.providerMessageId,
      rawPayload: rawBody,
    };
  }

  parseStatusCallback(rawBody: unknown): WhatsAppStatusCallback {
    const payload = rawBody as {
      providerMessageId?: string;
      status?: string;
      failureReason?: string;
    };
    return {
      providerMessageId: payload.providerMessageId ?? 'unknown',
      status: (payload.status as WhatsAppStatusCallback['status']) ?? 'sent',
      failureReason: payload.failureReason,
    };
  }
}

export interface MetaWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  webhookSecret: string;
  templateLanguage: string;
  /** V1 communications productionisation (WORKLOG.md this date): a SEPARATE secret from
   * webhookSecret -- Meta's webhook setup has two distinct values: the app secret used for
   * X-Hub-Signature-256 HMAC over every POST (webhookSecret), and an arbitrary string Mohammed
   * himself chooses and enters into both this env var and the Meta App Dashboard's "Verify Token"
   * field, checked only during the one-time GET handshake when the callback URL is registered.
   * Optional here (unlike the other three) since the GET handshake is a one-time setup step, not
   * every-request traffic -- POST delivery (the real ongoing traffic) works without it. */
  webhookVerifyToken?: string;
}

export function getMetaWhatsAppConfig(): MetaWhatsAppConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!accessToken || !phoneNumberId || !webhookSecret) return null;
  // No documented per-org template-language convention exists (WHATSAPP.md is silent on this) --
  // defaults to en_US, the common case, but this is a real assumption: Meta template approval is
  // language-specific, and a mismatch here would make every send fail with a template-not-found
  // error from Meta, not a silent wrong-language send. Override via WHATSAPP_TEMPLATE_LANGUAGE if
  // the approved templates use a different locale code.
  return {
    accessToken,
    phoneNumberId,
    webhookSecret,
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en_US',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  };
}

const META_GRAPH_API_VERSION = 'v21.0';

// Real Meta WhatsApp Cloud API integration (Stage 5, commercial-launch execution plan, WORKLOG.md
// this date), direct (no BSP middleman), per Mohammed's vendor decision this date.
//
// No real Meta Business/WhatsApp Business Platform account exists in this environment
// (external-service blocker, same class of gap as PayFast/Resend -- TECHNICAL_DEBT_REGISTER.md
// TD-36/37/38) -- sendTemplateMessage has never completed a live round trip. The signature-check
// primitive (verifyWebhookSignature) is ordinary HMAC-SHA256 with no external round trip needed,
// so it's exercised by real unit tests below despite that; sendTemplateMessage necessarily cannot
// be, the same limitation as every other real provider added this session.
//
// V1 communications productionisation (WORKLOG.md this date): closes TD-38's inbound half --
// POST /api/v1/webhooks/whatsapp (whatsappDispatch.ts's processWhatsAppWebhookEvent) now calls
// classifyWebhookEvent/parseStatusCallback/parseInboundEvent/verifyWebhookSignature for real,
// covering signature verification and delivery-status tracking end to end. WHATSAPP.md §1.2's
// resolution branching (0/1/2+ matches) is wired too, via resolve_whatsapp_sender() -- but that
// RPC's only populate path, the OTP-verification flow that writes verified_phone_numbers, remains
// undesigned (WHATSAPP.md's own "Unresolved" section), so in practice every real inbound message
// resolves to 0 matches (UNAUTHENTICATED) today. The full conversational disambiguation round trip
// (auto-replying, tracking whatsapp_conversation_state across a multi-message exchange) is
// deliberately NOT built against a table that cannot yet be non-empty -- speculative scaffolding
// for a prerequisite that doesn't exist, not a scoped-down version of a real, reachable feature.
export class MetaWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly config: MetaWhatsAppConfig) {}

  async sendTemplateMessage(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult> {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${this.config.phoneNumberId}/messages`;

    // Meta template parameters are POSITIONAL ({{1}}, {{2}}, ...), not named -- relies on the
    // caller (whatsappDispatch.ts) having built `variables` with keys in the same order the
    // approved template's placeholders expect. JS preserves string-key insertion order, so this
    // holds as long as the caller does; there is no way for this provider to verify that from a
    // plain Record<string, string>, a real gap disclosed here rather than silently assumed safe.
    const parameters = Object.values(input.variables).map((value) => ({
      type: 'text',
      text: value,
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: input.to.replace(/^\+/, ''), // Meta expects digits only, no leading '+'
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: this.config.templateLanguage },
          components: parameters.length > 0 ? [{ type: 'body', parameters }] : undefined,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Meta WhatsApp send failed (${response.status}): ${body || response.statusText}`,
      );
    }

    const json = (await response.json()) as { messages?: { id: string }[] };
    const messageId = json.messages?.[0]?.id;
    if (!messageId) {
      throw new Error(
        'Meta WhatsApp send returned 2xx but no message id -- unexpected response shape',
      );
    }

    return { providerMessageId: messageId };
  }

  // WHATSAPP.md §4: X-Hub-Signature-256, HMAC-SHA256 over the raw payload, keyed by the app
  // secret (WHATSAPP_WEBHOOK_SECRET). Synchronous -- unlike PayFast's ITN, Meta's signature is a
  // pure local HMAC comparison with no server-to-server confirmation step, matching this
  // interface method's own non-async signature.
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    const expected = `sha256=${crypto.createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex')}`;
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(signatureHeader);
    if (expectedBuffer.length !== receivedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  // Real Meta shape: entry[].changes[].value.{messages,statuses} -- whichever key is present (and
  // non-empty) tells the route which of the two parse methods below to call, without the route
  // itself needing to know this BSP-specific structure.
  classifyWebhookEvent(rawBody: unknown): WhatsAppWebhookEventKind {
    const value = extractChangeValue(rawBody);
    if (value?.messages && value.messages.length > 0) return 'message';
    if (value?.statuses && value.statuses.length > 0) return 'status_callback';
    return 'unknown';
  }

  // Meta's webhook payload nests both inbound messages and status callbacks under the identical
  // entry[].changes[].value shape, distinguished by which key is present -- this method only
  // handles the `messages` case; parseStatusCallback below handles `statuses`. No live route calls
  // either yet (see this file's header comment) so this is unverified against a real payload
  // beyond matching Meta's documented schema.
  parseInboundEvent(rawBody: unknown): InboundWhatsAppEvent {
    const value = extractChangeValue(rawBody);
    const message = value?.messages?.[0];
    if (!message) {
      throw new Error(
        'Meta WhatsApp webhook payload has no entry[].changes[].value.messages[0] -- not an inbound message event',
      );
    }
    return {
      kind: 'message',
      from: message.from ? `+${message.from}` : undefined,
      body: message.text?.body,
      providerMessageId: message.id,
      rawPayload: rawBody,
    };
  }

  parseStatusCallback(rawBody: unknown): WhatsAppStatusCallback {
    const value = extractChangeValue(rawBody);
    const status = value?.statuses?.[0];
    if (!status) {
      throw new Error(
        'Meta WhatsApp webhook payload has no entry[].changes[].value.statuses[0] -- not a status callback event',
      );
    }
    return {
      providerMessageId: status.id,
      status: status.status as WhatsAppStatusCallback['status'],
      failureReason: status.errors?.[0]?.title,
    };
  }
}

interface MetaWebhookChangeValue {
  messages?: { id?: string; from?: string; text?: { body?: string } }[];
  statuses?: { id: string; status: string; errors?: { title?: string }[] }[];
}

function extractChangeValue(rawBody: unknown): MetaWebhookChangeValue | undefined {
  const payload = rawBody as { entry?: { changes?: { value?: MetaWebhookChangeValue }[] }[] };
  return payload.entry?.[0]?.changes?.[0]?.value;
}

export function getWhatsAppProvider(): WhatsAppProvider {
  const metaConfig = getMetaWhatsAppConfig();
  if (metaConfig) {
    return new MetaWhatsAppProvider(metaConfig);
  }
  return new MockWhatsAppProvider();
}

// Overnight platform pass (WORKLOG.md this date): mirrors isEmailProviderConfigured() (email.ts)
// for the same reason -- dispatchWhatsApp() needs a way to tell a caller/UI "this was mocked, no
// real message left the server" that can't drift out of sync with getWhatsAppProvider()'s own
// fallback logic.
export function isWhatsAppProviderConfigured(): boolean {
  return getMetaWhatsAppConfig() !== null;
}
