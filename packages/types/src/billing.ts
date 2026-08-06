// Organization-level SaaS billing (SUBSCRIPTIONS.md's "organization-level web billing" section)
// -- distinct from the mobile app's RevenueCat entitlement flow. A vendor-agnostic abstraction so
// a real South African gateway (PayFast, Yoco, Stitch, ...) can be plugged in later without
// touching the subscription business logic that calls it, mirroring
// DocumentIntelligenceProvider/EmailProvider/WhatsAppProvider's shape.

export type BillingEventType = 'payment_succeeded' | 'payment_failed' | 'subscription_cancelled' | 'refund_processed';

export interface CreateCustomerInput {
  orgId: string;
  legalName: string;
  email: string;
}

export interface CreateCustomerResult {
  providerCustomerId: string;
}

export interface CreateSubscriptionInput {
  orgId: string;
  providerCustomerId: string;
  planCode: string;
  amount: number;
  currency: string;
  billingCycle: 'monthly' | 'annual';
  idempotencyKey: string;
}

export interface CreateSubscriptionResult {
  providerSubscriptionId: string;
  /** Where to send the org's staff to complete payment/mandate setup -- a real gateway's hosted
   * checkout page; the mock returns a local placeholder URL, never a real payment form. */
  checkoutUrl: string;
  status: 'pending';
}

export interface PaymentStatusResult {
  providerReference: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
}

export interface CancelSubscriptionResult {
  providerSubscriptionId: string;
  status: 'cancelled';
}

export interface RefundPaymentInput {
  providerPaymentReference: string;
  amount?: number;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'refunded';
}

/** A normalized inbound gateway event -- every real gateway's own webhook payload shape gets
 * translated into this one shape by that provider's parseWebhookEvent(), so the billing service
 * that processes events never needs to know which gateway sent them. */
export interface BillingWebhookEvent {
  providerEventId: string;
  type: BillingEventType;
  providerReference: string;
  orgId: string | null;
  amount: number | null;
  currency: string | null;
  /** The gateway's own recurring-billing token (PayFast: the ITN `token` field), present only on
   * events for a subscription-type payment. Persisted onto organization_subscriptions so a later
   * cancelSubscription() call has something real to cancel against -- distinct from
   * providerReference, which is OUR OWN idempotency key, not a gateway-issued handle. */
  providerSubscriptionToken: string | null;
  raw: Record<string, unknown>;
}

export interface BillingGatewayProvider {
  readonly providerName: string;
  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult>;
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;
  getPaymentStatus(providerReference: string): Promise<PaymentStatusResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<CancelSubscriptionResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>;
  /** Verifies an inbound webhook is genuinely from the gateway, before parseWebhookEvent() is
   * ever trusted -- must run first. Async: a real gateway's recommended verification (PayFast:
   * signature check PLUS a server-to-server confirmation POST back to the gateway, not signature
   * alone) needs a network round trip, not just a local hash comparison. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): Promise<boolean>;
  parseWebhookEvent(rawBody: string): BillingWebhookEvent;
}
