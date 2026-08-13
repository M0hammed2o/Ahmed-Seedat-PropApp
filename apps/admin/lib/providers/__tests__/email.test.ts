import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockEmailProvider, ResendEmailProvider, type ResendConfig } from '../email';

describe('MockEmailProvider', () => {
  it('exposes a stable providerName', () => {
    expect(new MockEmailProvider().providerName).toBe('mock');
  });

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

  it('exposes a stable providerName', () => {
    expect(new ResendEmailProvider(CONFIG).providerName).toBe('resend');
  });
});

// Infrastructure hardening pass (WORKLOG.md this date): the webhook signature verification is
// pure local HMAC (no real Resend account/network needed to test it exhaustively) -- computes a
// genuinely valid Svix signature independently here (same documented algorithm the implementation
// uses, not importing internals), so a passing test proves real interoperability, not a tautology.
const WEBHOOK_SECRET =
  'whsec_' + Buffer.from('a-test-signing-secret-32-bytes!!').toString('base64');

function signSvix(id: string, timestamp: string, body: string, secret = WEBHOOK_SECRET): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${body}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

describe('ResendEmailProvider webhook verification', () => {
  const originalEnv = process.env.RESEND_WEBHOOK_SECRET;
  afterEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = originalEnv;
  });

  it('accepts a genuinely validly-signed payload', () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const provider = new ResendEmailProvider(CONFIG);
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
    const id = 'msg_test123';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const ok = provider.verifyWebhookSignature(body, {
      id,
      timestamp,
      signature: signSvix(id, timestamp, body),
    });
    expect(ok).toBe(true);
  });

  it('rejects a tampered body even with an otherwise-valid signature', () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const provider = new ResendEmailProvider(CONFIG);
    const originalBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
    const id = 'msg_test123';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(id, timestamp, originalBody);
    const tamperedBody = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'em_ATTACKER' },
    });
    expect(provider.verifyWebhookSignature(tamperedBody, { id, timestamp, signature })).toBe(false);
  });

  it('rejects a signature produced with the wrong secret', () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const provider = new ResendEmailProvider(CONFIG);
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
    const id = 'msg_test123';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const wrongSecret =
      'whsec_' + Buffer.from('a-completely-different-secret!!').toString('base64');
    const ok = provider.verifyWebhookSignature(body, {
      id,
      timestamp,
      signature: signSvix(id, timestamp, body, wrongSecret),
    });
    expect(ok).toBe(false);
  });

  it('rejects when any header is missing', () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const provider = new ResendEmailProvider(CONFIG);
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
    expect(
      provider.verifyWebhookSignature(body, { id: null, timestamp: '123', signature: 'v1,x' }),
    ).toBe(false);
    expect(
      provider.verifyWebhookSignature(body, { id: 'msg_1', timestamp: null, signature: 'v1,x' }),
    ).toBe(false);
    expect(
      provider.verifyWebhookSignature(body, { id: 'msg_1', timestamp: '123', signature: null }),
    ).toBe(false);
  });

  it('rejects a stale timestamp even with a correct signature (replay protection)', () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const provider = new ResendEmailProvider(CONFIG);
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
    const id = 'msg_test123';
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1 hour old
    const ok = provider.verifyWebhookSignature(body, {
      id,
      timestamp: staleTimestamp,
      signature: signSvix(id, staleTimestamp, body),
    });
    expect(ok).toBe(false);
  });

  it('fails closed (rejects everything) when RESEND_WEBHOOK_SECRET is not configured', () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const provider = new ResendEmailProvider(CONFIG);
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
    const id = 'msg_test123';
    const timestamp = String(Math.floor(Date.now() / 1000));
    // Signed with a secret that isn't configured anywhere -- must still fail, not "trust anyway".
    const ok = provider.verifyWebhookSignature(body, {
      id,
      timestamp,
      signature: signSvix(id, timestamp, body),
    });
    expect(ok).toBe(false);
  });

  it('never leaks the configured secret in its return value or thrown errors', () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const provider = new ResendEmailProvider(CONFIG);
    const result = provider.verifyWebhookSignature('bad body', {
      id: 'x',
      timestamp: '1',
      signature: 'v1,bad',
    });
    expect(String(result)).not.toContain(WEBHOOK_SECRET.replace('whsec_', ''));
  });

  it('parses a valid Resend delivered event', () => {
    const provider = new ResendEmailProvider(CONFIG);
    const event = provider.parseWebhookEvent(
      JSON.stringify({
        type: 'email.delivered',
        created_at: '2026-08-13T10:00:00Z',
        data: { email_id: 'em_abc' },
      }),
    );
    expect(event.type).toBe('delivered');
    expect(event.providerMessageId).toBe('em_abc');
  });

  it('parses a bounced event and extracts bounce sub-type when present', () => {
    const provider = new ResendEmailProvider(CONFIG);
    const event = provider.parseWebhookEvent(
      JSON.stringify({
        type: 'email.bounced',
        created_at: '2026-08-13T10:00:00Z',
        data: { email_id: 'em_abc', bounce: { type: 'Permanent' } },
      }),
    );
    expect(event.type).toBe('bounced');
    expect(event.bounceType).toBe('Permanent');
  });

  it('maps an unrecognized-but-validly-shaped event type to "other" rather than throwing', () => {
    const provider = new ResendEmailProvider(CONFIG);
    const event = provider.parseWebhookEvent(
      JSON.stringify({
        type: 'email.opened',
        created_at: '2026-08-13T10:00:00Z',
        data: { email_id: 'em_abc' },
      }),
    );
    expect(event.type).toBe('other');
  });

  it('throws on malformed JSON', () => {
    const provider = new ResendEmailProvider(CONFIG);
    expect(() => provider.parseWebhookEvent('not json')).toThrow();
  });

  it('throws on valid JSON missing required fields', () => {
    const provider = new ResendEmailProvider(CONFIG);
    expect(() => provider.parseWebhookEvent(JSON.stringify({ type: 'email.delivered' }))).toThrow();
    expect(() =>
      provider.parseWebhookEvent(JSON.stringify({ data: { email_id: 'em_1' } })),
    ).toThrow();
  });
});
