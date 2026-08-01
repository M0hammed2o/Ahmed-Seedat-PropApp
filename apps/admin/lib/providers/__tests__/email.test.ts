import { describe, expect, it } from 'vitest';
import { MockEmailProvider } from '../email';

describe('MockEmailProvider', () => {
  it('always returns status "queued", never "sent" or "delivered"', async () => {
    const provider = new MockEmailProvider();
    const result = await provider.send({
      orgId: 'org-1',
      toAddress: 'tenant@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
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
    });
    const second = await provider.send({
      orgId: 'org-1',
      toAddress: 'b@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
    });
    expect(first.providerMessageId).not.toBe(second.providerMessageId);
  });
});
