import { describe, expect, it } from 'vitest';
import { MockWhatsAppProvider } from '../whatsapp';

describe('MockWhatsAppProvider', () => {
  it('returns a providerMessageId from sendTemplateMessage', async () => {
    const provider = new MockWhatsAppProvider();
    const result = await provider.sendTemplateMessage({
      to: '+27000000001',
      templateName: 'rent_overdue_material',
      variables: { tenant_first_name: 'Test' },
      orgId: 'org-1',
    });
    expect(result.providerMessageId).toMatch(/^mock-whatsapp-/);
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
