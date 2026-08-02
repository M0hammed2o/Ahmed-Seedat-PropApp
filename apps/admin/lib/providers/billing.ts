import 'server-only';
import type {
  BillingGatewayProvider,
  BillingWebhookEvent,
  CancelSubscriptionResult,
  CreateCustomerInput,
  CreateCustomerResult,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  PaymentStatusResult,
  RefundPaymentInput,
  RefundResult,
} from '@propvault/types';

// Mock-first BillingGatewayProvider (SUBSCRIPTIONS.md) -- no real South African gateway account
// exists (external-service blocker, same class of gap as MockEmailProvider/MockWhatsAppProvider).
// Deterministic, not random: given the same idempotencyKey it returns the same
// providerSubscriptionId, so a caller retrying a checkout request after a network timeout doesn't
// create a second subscription against the mock either -- the abstraction's idempotency
// requirement is honoured even in mock mode, not just documented as a real-provider concern.
export class MockBillingGatewayProvider implements BillingGatewayProvider {
  readonly providerName = 'mock';

  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    console.warn('[MockBillingGatewayProvider] would create customer', { orgId: input.orgId, email: input.email });
    return { providerCustomerId: `mock-cust-${input.orgId}` };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    console.warn('[MockBillingGatewayProvider] would create subscription', {
      orgId: input.orgId,
      planCode: input.planCode,
      amount: input.amount,
    });
    const providerSubscriptionId = `mock-sub-${input.idempotencyKey}`;
    return {
      providerSubscriptionId,
      checkoutUrl: `https://mock-gateway.invalid/checkout/${providerSubscriptionId}`,
      status: 'pending',
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatusResult> {
    return { providerReference, status: 'pending' };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<CancelSubscriptionResult> {
    console.warn('[MockBillingGatewayProvider] would cancel subscription', { providerSubscriptionId });
    return { providerSubscriptionId, status: 'cancelled' };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    console.warn('[MockBillingGatewayProvider] would refund payment', { providerPaymentReference: input.providerPaymentReference });
    return { providerRefundId: `mock-refund-${input.idempotencyKey}`, status: 'refunded' };
  }

  // No real signature scheme in mock mode -- accepts any non-empty header, matching the "mock
  // never pretends to a stronger guarantee than it has" rule used for MockEmailProvider's
  // status/MockWhatsAppProvider's lifecycle, applied here to signature verification instead.
  verifyWebhookSignature(_rawBody: string, signatureHeader: string | null): boolean {
    return Boolean(signatureHeader);
  }

  parseWebhookEvent(rawBody: string): BillingWebhookEvent {
    const parsed = JSON.parse(rawBody) as Partial<BillingWebhookEvent> & Record<string, unknown>;
    if (!parsed.providerEventId || !parsed.type || !parsed.providerReference) {
      throw new Error('Malformed mock billing webhook payload');
    }
    return {
      providerEventId: String(parsed.providerEventId),
      type: parsed.type as BillingWebhookEvent['type'],
      providerReference: String(parsed.providerReference),
      orgId: (parsed.orgId as string | undefined) ?? null,
      amount: (parsed.amount as number | undefined) ?? null,
      currency: (parsed.currency as string | undefined) ?? null,
      raw: parsed,
    };
  }
}

export function getBillingGatewayProvider(): BillingGatewayProvider {
  return new MockBillingGatewayProvider();
}
