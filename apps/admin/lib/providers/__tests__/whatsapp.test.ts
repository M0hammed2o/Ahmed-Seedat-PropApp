import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockWhatsAppProvider, MetaWhatsAppProvider, type MetaWhatsAppConfig } from '../whatsapp';

describe('MockWhatsAppProvider', () => {
  it('returns a providerMessageId from sendTemplateMessage', async () => {
    const provider = new MockWhatsAppProvider();
    const result = await provider.sendTemplateMessage({
      to: '+27000000001',
      templateName: 'rent_overdue_notice',
      variables: { tenant_first_name: 'Test' },
      orgId: 'org-1',
    });
    expect(result.providerMessageId).toMatch(/^mock-whatsapp-/);
  });

  it('returns a providerMessageId from sendFreeformMessage', async () => {
    const provider = new MockWhatsAppProvider();
    const result = await provider.sendFreeformMessage({
      to: '+27000000001',
      body: 'Test freeform reply',
      orgId: 'org-1',
    });
    expect(result.providerMessageId).toMatch(/^mock-whatsapp-freeform-/);
  });

  it('parseInboundEvent wraps the raw payload as a message event', () => {
    const provider = new MockWhatsAppProvider();
    const event = provider.parseInboundEvent({ from: '+27000000001', text: 'hi' });
    expect(event.kind).toBe('message');
  });

  it('parseStatusCallback extracts providerMessageId and status, defaulting status to "sent"', () => {
    const provider = new MockWhatsAppProvider();
    const callback = provider.parseStatusCallback({ providerMessageId: 'abc-123' });
    expect(callback.providerMessageId).toBe('abc-123');
    expect(callback.status).toBe('sent');
  });
});

const CONFIG: MetaWhatsAppConfig = {
  accessToken: 'test-access-token',
  phoneNumberId: '1234567890',
  webhookSecret: 'test-webhook-secret',
  templateLanguage: 'en_US',
};

describe('MetaWhatsAppProvider', () => {
  describe('sendTemplateMessage', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('POSTs to the Graph API messages endpoint with positional template parameters', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.ABC123' }] }),
      });
      global.fetch = fetchSpy as unknown as typeof fetch;
      const provider = new MetaWhatsAppProvider(CONFIG);

      const result = await provider.sendTemplateMessage({
        to: '+27821234567',
        templateName: 'rent_overdue_notice',
        variables: { tenant_first_name: 'Jane', amount: 'R1,200' },
        orgId: 'org-1',
      });

      expect(result.providerMessageId).toBe('wamid.ABC123');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe(`https://graph.facebook.com/v21.0/${CONFIG.phoneNumberId}/messages`);
      expect(options.headers.Authorization).toBe(`Bearer ${CONFIG.accessToken}`);
      const body = JSON.parse(options.body);
      expect(body.to).toBe('27821234567'); // leading '+' stripped
      expect(body.template.name).toBe('rent_overdue_notice');
      expect(body.template.language.code).toBe('en_US');
      // Positional, in insertion order -- {{1}}=Jane, {{2}}=R1,200, never named.
      expect(body.template.components[0].parameters).toEqual([
        { type: 'text', text: 'Jane' },
        { type: 'text', text: 'R1,200' },
      ]);
    });

    it('throws on a non-2xx response rather than pretending the send succeeded', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid OAuth access token',
      }) as unknown as typeof fetch;
      const provider = new MetaWhatsAppProvider(CONFIG);
      await expect(
        provider.sendTemplateMessage({
          to: '+27821234567',
          templateName: 'rent_overdue_notice',
          variables: {},
          orgId: 'org-1',
        }),
      ).rejects.toThrow(/401/);
    });
  });

  describe('sendFreeformMessage', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('POSTs a type:text message to the Graph API messages endpoint', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.FREEFORM1' }] }),
      });
      global.fetch = fetchSpy as unknown as typeof fetch;
      const provider = new MetaWhatsAppProvider(CONFIG);

      const result = await provider.sendFreeformMessage({
        to: '+27821234567',
        body: 'Your maintenance ticket has been updated.',
        orgId: 'org-1',
      });

      expect(result.providerMessageId).toBe('wamid.FREEFORM1');
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe(`https://graph.facebook.com/v21.0/${CONFIG.phoneNumberId}/messages`);
      const body = JSON.parse(options.body);
      expect(body.to).toBe('27821234567');
      expect(body.type).toBe('text');
      expect(body.text.body).toBe('Your maintenance ticket has been updated.');
      // No template field on a freeform send.
      expect(body.template).toBeUndefined();
    });

    it('throws on a non-2xx response rather than pretending the send succeeded', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Message outside the 24-hour customer service window',
      }) as unknown as typeof fetch;
      const provider = new MetaWhatsAppProvider(CONFIG);
      await expect(
        provider.sendFreeformMessage({ to: '+27821234567', body: 'Hi', orgId: 'org-1' }),
      ).rejects.toThrow(/400/);
    });
  });

  describe('verifyWebhookSignature', () => {
    function independentSignature(rawBody: string, secret: string): string {
      return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    }

    it('accepts a signature independently recomputed with the same secret', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      const rawBody = JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: '27821234567' }] } }] }],
      });
      const signature = independentSignature(rawBody, CONFIG.webhookSecret);
      expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
    });

    it('rejects a tampered body whose signature no longer matches', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      const rawBody = JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: '27821234567' }] } }] }],
      });
      const signature = independentSignature(rawBody, CONFIG.webhookSecret);
      const tamperedBody = rawBody.replace('27821234567', '27899999999');
      expect(provider.verifyWebhookSignature(tamperedBody, signature)).toBe(false);
    });

    it('rejects a missing signature header', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      expect(provider.verifyWebhookSignature('{}', '')).toBe(false);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      const rawBody = '{"entry":[]}';
      const wrongSignature = independentSignature(rawBody, 'a-different-secret');
      expect(provider.verifyWebhookSignature(rawBody, wrongSignature)).toBe(false);
    });
  });

  describe('parseInboundEvent', () => {
    it('extracts the message body and E.164 sender from a real Meta webhook shape', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      const event = provider.parseInboundEvent({
        entry: [
          {
            changes: [
              { value: { messages: [{ from: '27821234567', text: { body: 'hi there' } }] } },
            ],
          },
        ],
      });
      expect(event.kind).toBe('message');
      expect(event.from).toBe('+27821234567');
      expect(event.body).toBe('hi there');
    });

    it('throws on a payload with no messages array (e.g. a status-only payload)', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      expect(() =>
        provider.parseInboundEvent({
          entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'sent' }] } }] }],
        }),
      ).toThrow();
    });
  });

  describe('parseStatusCallback', () => {
    it('extracts providerMessageId and status from a real Meta webhook shape', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      const callback = provider.parseStatusCallback({
        entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
      });
      expect(callback.providerMessageId).toBe('wamid.X');
      expect(callback.status).toBe('delivered');
    });

    it('surfaces a failure reason when present', () => {
      const provider = new MetaWhatsAppProvider(CONFIG);
      const callback = provider.parseStatusCallback({
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.X',
                      status: 'failed',
                      errors: [{ title: 'Message undeliverable' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(callback.failureReason).toBe('Message undeliverable');
    });
  });
});
