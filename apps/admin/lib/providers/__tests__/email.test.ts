import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockEmailProvider, ResendEmailProvider, type ResendConfig } from '../email';

describe('MockEmailProvider', () => {
  it('always returns status "queued", never "sent" or "delivered"', async () => {
    const provider = new MockEmailProvider();
    const result = await provider.send({
      orgId: 'org-1',
      toAddress: 'tenant@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      subject: 'Invoice for your rental',
      bodyText: 'A new invoice is ready.',
    });
    expect(result.status).toBe('queued');
  });

  it('returns a unique providerMessageId per call', async () => {
    const provider = new MockEmailProvider();
    const first = await provider.send({
      orgId: 'org-1',
      toAddress: 'a@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      subject: 'Invoice for your rental',
      bodyText: 'A new invoice is ready.',
    });
    const second = await provider.send({
      orgId: 'org-1',
      toAddress: 'b@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      subject: 'Invoice for your rental',
      bodyText: 'A new invoice is ready.',
    });
    expect(first.providerMessageId).not.toBe(second.providerMessageId);
  });
});

const CONFIG: ResendConfig = {
  apiKey: 'test-api-key',
  fromAddress: 'PropertyVault <billing@propertyvault.example>',
};

describe('ResendEmailProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the rendered subject/body and returns status "queued" (Resend only confirms queueing, not delivery)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: 'resend-msg-123' }),
    }) as unknown as typeof fetch;
    const provider = new ResendEmailProvider(CONFIG);

    const result = await provider.send({
      orgId: 'org-1',
      toAddress: 'tenant@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      subject: 'Invoice for your rental',
      bodyText: 'A new invoice is ready.',
    });

    expect(result).toEqual({ providerMessageId: 'resend-msg-123', status: 'queued' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.from).toBe(CONFIG.fromAddress);
    expect(body.to).toBe('tenant@example.com');
    expect(body.subject).toBe('Invoice for your rental');
    expect(body.text).toBe('A new invoice is ready.');
  });

  it('throws on an error response rather than pretending the send succeeded', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers(),
      text: async () => JSON.stringify({ name: 'validation_error', message: 'Invalid `to` field' }),
    }) as unknown as typeof fetch;
    const provider = new ResendEmailProvider(CONFIG);

    await expect(
      provider.send({
        orgId: 'org-1',
        toAddress: 'not-an-email',
        templateName: 'invoice_issued',
        templateVars: {},
        subject: 'x',
        bodyText: 'y',
      }),
    ).rejects.toThrow(/validation_error/);
  });

  it('sends without attachments and only warns, rather than throwing, when attachments are requested', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: 'resend-msg-456' }),
    }) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new ResendEmailProvider(CONFIG);

    const result = await provider.send({
      orgId: 'org-1',
      toAddress: 'tenant@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      subject: 'x',
      bodyText: 'y',
      attachments: [{ documentId: 'doc-1' }],
    });

    expect(result.providerMessageId).toBe('resend-msg-456');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
