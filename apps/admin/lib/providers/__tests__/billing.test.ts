import { describe, expect, it } from 'vitest';
import { MockBillingGatewayProvider } from '../billing';

describe('MockBillingGatewayProvider', () => {
  it('createSubscription is deterministic for the same idempotencyKey (no duplicate resource on retry)', async () => {
    const provider = new MockBillingGatewayProvider();
    const input = {
      orgId: 'org-1',
      providerCustomerId: 'cust-1',
      planCode: 'propvault_base',
      amount: 499,
      currency: 'ZAR',
      billingCycle: 'monthly' as const,
      idempotencyKey: 'checkout-org-1-attempt-1',
    };
    const first = await provider.createSubscription(input);
    const second = await provider.createSubscription(input);
    expect(first.providerSubscriptionId).toBe(second.providerSubscriptionId);
  });

  it('createSubscription returns different ids for different idempotencyKeys', async () => {
    const provider = new MockBillingGatewayProvider();
    const first = await provider.createSubscription({
      orgId: 'org-1',
      providerCustomerId: 'cust-1',
      planCode: 'propvault_base',
      amount: 499,
      currency: 'ZAR',
      billingCycle: 'monthly',
      idempotencyKey: 'attempt-1',
    });
    const second = await provider.createSubscription({
      orgId: 'org-1',
      providerCustomerId: 'cust-1',
      planCode: 'propvault_base',
      amount: 499,
      currency: 'ZAR',
      billingCycle: 'monthly',
      idempotencyKey: 'attempt-2',
    });
    expect(first.providerSubscriptionId).not.toBe(second.providerSubscriptionId);
  });

  it('never returns a real-looking checkout URL -- always the mock-gateway.invalid host', async () => {
    const provider = new MockBillingGatewayProvider();
    const result = await provider.createSubscription({
      orgId: 'org-1',
      providerCustomerId: 'cust-1',
      planCode: 'propvault_base',
      amount: 499,
      currency: 'ZAR',
      billingCycle: 'monthly',
      idempotencyKey: 'attempt-1',
    });
    expect(new URL(result.checkoutUrl).hostname).toBe('mock-gateway.invalid');
  });

  it('verifyWebhookSignature rejects a missing signature header', async () => {
    const provider = new MockBillingGatewayProvider();
    expect(await provider.verifyWebhookSignature('{}', null)).toBe(false);
    expect(await provider.verifyWebhookSignature('{}', 'any-non-empty-value')).toBe(true);
  });

  it('parseWebhookEvent rejects a malformed payload rather than silently defaulting fields', () => {
    const provider = new MockBillingGatewayProvider();
    expect(() => provider.parseWebhookEvent(JSON.stringify({ type: 'payment_succeeded' }))).toThrow();
  });

  it('parseWebhookEvent round-trips a well-formed payload', () => {
    const provider = new MockBillingGatewayProvider();
    const event = provider.parseWebhookEvent(
      JSON.stringify({
        providerEventId: 'evt_123',
        type: 'payment_succeeded',
        providerReference: 'mock-sub-abc',
        orgId: 'org-1',
        amount: 499,
        currency: 'ZAR',
      }),
    );
    expect(event).toMatchObject({
      providerEventId: 'evt_123',
      type: 'payment_succeeded',
      providerReference: 'mock-sub-abc',
      orgId: 'org-1',
      amount: 499,
      currency: 'ZAR',
    });
  });
});
