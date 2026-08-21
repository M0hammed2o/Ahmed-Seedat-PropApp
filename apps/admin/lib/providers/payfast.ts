import 'server-only';
import crypto from 'crypto';
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
import { branding } from '@propvault/config';
import { getAppUrl } from '@/lib/appUrl';

// Real PayFast integration (Stage 4, commercial-launch execution plan, WORKLOG.md this date).
//
// UPDATE (WORKLOG.md, follow-up session): createSubscription()'s checkout/ITN signature path
// (case 1 below) HAS now been verified against a real live round trip -- Mohammed's real sandbox
// merchant_id/merchant_key/passphrase, real requests against sandbox.payfast.co.za, a genuine
// R0.00 subscription checkout reaching PayFast's own hosted payment page (HTTP 302, not a
// signature-rejection 400). This live testing DISPROVED part of the field-order assumption below
// for the subscription-specific fields specifically -- see createSubscription()'s own comment for
// exactly what was found and fixed (billing_date's position). The pre-existing
// startSubscriptionCheckout/startPlanChangeCheckout field order (no billing_date) was
// independently confirmed to have been correct all along. `cancelSubscription`/`refundPayment`
// (the Management API, a different signature scheme, case 2 below) remain UNVERIFIED -- carry the
// least confidence of the three, see their own comments -- and getPaymentStatus() is simply not
// implemented (see its own comment). Every algorithm below was originally cross-checked against
// PayFast's own developer documentation and multiple independent working implementations
// (PHP/Node SDKs, community write-ups), not invented.
//
// Two genuinely different signature algorithms are used by PayFast, confirmed from independent
// sources, not a copy-paste of one applied to both:
//   1. Checkout form + ITN webhook: fields in SUBMISSION order (never sorted -- true in general,
//      but the subscription-specific fields have a real positional requirement, see above), skip
//      empty values, PHP-urlencode each value, join with '&', append
//      '&passphrase=<encoded passphrase>', MD5 hex.
//   2. Subscriptions/Refunds Management API (api.payfast.co.za): merchant-id/version/timestamp
//      headers plus any body fields plus passphrase, ALL fields sorted ALPHABETICALLY by key,
//      same encode+join+MD5 pattern.

export interface PayFastConfig {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  mode: 'sandbox' | 'live';
}

export function getPayFastConfig(): PayFastConfig | null {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  if (!merchantId || !merchantKey || !passphrase) return null;
  return {
    merchantId,
    merchantKey,
    passphrase,
    mode: process.env.PAYFAST_MODE === 'live' ? 'live' : 'sandbox',
  };
}

// PHP urlencode()-compatible encoding. JavaScript's encodeURIComponent leaves `!'()*~` unescaped
// (the ECMAScript "unreserved mark" set) where PHP's urlencode() escapes them, and PHP encodes
// spaces as `+` rather than `%20` -- both confirmed from multiple independent, cross-checked
// sources this session, not assumed. A mismatch here silently produces a signature PayFast will
// reject as invalid for any field containing these characters or spaces.
function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/~/g, '%7E')
    .replace(/%20/g, '+');
}

function baseUrl(config: PayFastConfig): string {
  return config.mode === 'live' ? 'https://www.payfast.co.za' : 'https://sandbox.payfast.co.za';
}

// Checkout/ITN signature: fields in the exact order provided (a Map preserves insertion order;
// an ITN's recomputation must iterate the fields in the order PayFast itself sent them, never
// re-sorted -- see verifyWebhookSignature below).
function generateFormSignature(fields: Map<string, string>, passphrase: string): string {
  const parts: string[] = [];
  for (const [key, value] of fields) {
    if (value === '' || value === undefined || value === null) continue;
    parts.push(`${key}=${phpUrlEncode(String(value).trim())}`);
  }
  let pfOutput = parts.join('&');
  if (passphrase) {
    pfOutput += `&passphrase=${phpUrlEncode(passphrase.trim())}`;
  }
  return crypto.createHash('md5').update(pfOutput).digest('hex');
}

// Management API signature: same encode+MD5 primitive, but every field (headers + body +
// passphrase) is sorted ALPHABETICALLY by key first -- a genuinely different rule from the
// checkout/ITN signature above, confirmed from a second, independent source before writing this,
// not assumed to be "the same algorithm, reused."
function generateManagementApiSignature(
  fields: Record<string, string>,
  passphrase: string,
): string {
  const withPassphrase: Record<string, string> = { ...fields, passphrase };
  const sortedKeys = Object.keys(withPassphrase).sort();
  const pfOutput = sortedKeys
    .map((key) => `${key}=${phpUrlEncode(withPassphrase[key]!.trim())}`)
    .join('&');
  return crypto.createHash('md5').update(pfOutput).digest('hex');
}

function managementApiHeaders(
  config: PayFastConfig,
  bodyFields: Record<string, string> = {},
): Record<string, string> {
  // ISO 8601 without milliseconds, matching the documented/cross-checked example exactly
  // (e.g. "2026-08-05T14:30:45") -- timezone-offset suffix was inconsistently described across
  // sources; omitted here since the concrete working code example found did not include one.
  const timestamp = new Date().toISOString().split('.')[0]!;
  const baseFields: Record<string, string> = {
    'merchant-id': config.merchantId,
    version: 'v1',
    timestamp,
  };
  const signature = generateManagementApiSignature(
    { ...baseFields, ...bodyFields },
    config.passphrase,
  );
  return { ...baseFields, signature, 'Content-Type': 'application/json' };
}

export class PayFastBillingGatewayProvider implements BillingGatewayProvider {
  readonly providerName = 'payfast';

  constructor(private readonly config: PayFastConfig) {}

  // PayFast has no separate customer-creation API -- buyer details are submitted directly with
  // each checkout request instead (see createSubscription). Structural no-op matching that
  // reality, not a missing feature -- mirrors how MockBillingGatewayProvider's own equivalent is
  // also a no-op, just for a different reason.
  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    return { providerCustomerId: `payfast-org-${input.orgId}` };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    const appUrl = getAppUrl();
    // m_payment_id is OUR OWN idempotent reference, echoed back unchanged in every ITN for this
    // subscription -- it, not any PayFast-generated id, is what correlates a later webhook back
    // to the subscription_payments row that started it (lib/billing.ts already keys on
    // provider_reference this way for the mock; PayFast's own pf_payment_id is only assigned
    // once the payment completes, too late to have been the identifier used to start it).
    const mPaymentId = input.idempotencyKey;
    // `amount` (the field PayFast charges immediately at checkout completion) is normally the
    // same as the recurring amount -- startTrialActivationCheckout() is the one caller that
    // passes initialAmount=0 so the checkout only verifies a payment method, deferring the first
    // real charge to billingDate. UNVERIFIED against a live PayFast round trip (see this file's
    // header comment) -- cross-checked against PayFast's documented subscription/trial fields,
    // not invented, but never exercised against the real gateway.
    const chargeNowAmount = input.initialAmount ?? input.amount;

    const fields = new Map<string, string>([
      ['merchant_id', this.config.merchantId],
      ['merchant_key', this.config.merchantKey],
      ['return_url', `${appUrl}/organization/billing?status=success`],
      ['cancel_url', `${appUrl}/organization/billing?status=cancelled`],
      ['notify_url', `${appUrl}/api/v1/billing/webhook`],
      ['m_payment_id', mPaymentId],
      ['amount', chargeNowAmount.toFixed(2)],
      ['item_name', `${branding.productName} subscription (${input.planCode})`],
      // Recurring billing (subscription_type=1) -- frequency 3=Monthly, 6=Annually (PayFast's own
      // numeric codes, cross-checked against multiple sources), cycles=0 means "until cancelled,"
      // matching "every organisation receives... no artificial feature restrictions" (no fixed
      // contract term).
      //
      // FIELD ORDER IS LOAD-BEARING, confirmed by a real sandbox round trip (WORKLOG.md this
      // date): PayFast's signature verification does NOT simply recompute over "whatever order
      // the client submitted" for the subscription fields, despite this file's own header
      // comment's original (documentation-only, never live-tested) claim -- billing_date MUST sit
      // between subscription_type and recurring_amount specifically. Verified empirically: this
      // exact order (subscription_type, billing_date, recurring_amount, frequency, cycles)
      // succeeds against the real sandbox with amount=0.00; appending billing_date after cycles
      // (the original position) reproducibly fails with "signature does not match" even with
      // correct real credentials. The pre-existing order without billing_date (used by
      // startSubscriptionCheckout/startPlanChangeCheckout, neither of which ever sets it) was
      // independently verified to still work unchanged.
      ['subscription_type', '1'],
      ...(input.billingDate ? ([['billing_date', input.billingDate]] as [string, string][]) : []),
      ['recurring_amount', input.amount.toFixed(2)],
      ['frequency', input.billingCycle === 'annual' ? '6' : '3'],
      ['cycles', '0'],
    ]);

    const signature = generateFormSignature(fields, this.config.passphrase);

    const params = new URLSearchParams();
    for (const [key, value] of fields) params.set(key, value);
    params.set('signature', signature);

    return {
      providerSubscriptionId: mPaymentId,
      checkoutUrl: `${baseUrl(this.config)}/eng/process?${params.toString()}`,
      status: 'pending',
    };
  }

  // Not implemented. This architecture treats the ITN webhook as the sole source of truth for
  // payment status (processBillingWebhookEvent's own documented principle: "never trust the
  // checkout-initiation response as proof of payment") -- nothing in this codebase calls
  // getPaymentStatus() today (confirmed by grep before writing this file). Rather than guess at
  // an unverified PayFast query-transaction endpoint for a method with zero current callers,
  // this throws clearly instead of silently returning a fabricated status.
  async getPaymentStatus(_providerReference: string): Promise<PaymentStatusResult> {
    throw new Error(
      'PayFastBillingGatewayProvider.getPaymentStatus is not implemented -- this architecture relies on ITN webhooks (processBillingWebhookEvent), not polling, as the source of truth for payment status.',
    );
  }

  // Subscriptions Management API (api.payfast.co.za) -- the LEAST-verified method in this file;
  // see this file's header comment. Cancelling here means the token this org's
  // organization_subscriptions row stored from its first successful ITN (provider_subscription_token,
  // migration 20260101000075) -- callers must resolve that token themselves and pass it as
  // providerSubscriptionId; this method does not look it up (no DB access from a provider class,
  // matching every other provider in this codebase, e.g. MockEmailProvider/MockWhatsAppProvider).
  async cancelSubscription(providerSubscriptionId: string): Promise<CancelSubscriptionResult> {
    const token = providerSubscriptionId;
    const testingParam = this.config.mode === 'sandbox' ? '?testing=true' : '';
    const url = `https://api.payfast.co.za/subscriptions/${encodeURIComponent(token)}/cancel${testingParam}`;
    const headers = managementApiHeaders(this.config);

    const response = await fetch(url, { method: 'PUT', headers });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `PayFast subscription cancel failed (${response.status}): ${body || response.statusText}`,
      );
    }

    return { providerSubscriptionId: token, status: 'cancelled' };
  }

  // Same Management API, same confidence caveat as cancelSubscription. providerPaymentReference
  // must be PayFast's own pf_payment_id (not our m_payment_id) -- the value ITN events carry as
  // `pf_payment_id`, distinct from the m_payment_id we generated at checkout time.
  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    const testingParam = this.config.mode === 'sandbox' ? '?testing=true' : '';
    const url = `https://api.payfast.co.za/refunds/${encodeURIComponent(input.providerPaymentReference)}${testingParam}`;
    const bodyObject: Record<string, string> = {
      reason: `${branding.productName} subscription refund`,
      ...(input.amount !== undefined ? { amount: String(Math.round(input.amount * 100)) } : {}),
    };
    const headers = managementApiHeaders(this.config, bodyObject);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObject),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`PayFast refund failed (${response.status}): ${body || response.statusText}`);
    }

    return { providerRefundId: `payfast-refund-${input.idempotencyKey}`, status: 'refunded' };
  }

  // Two independent checks, both required, matching PayFast's own documented ITN validation
  // sequence: (1) recompute the signature from the raw body and compare -- proves the payload
  // wasn't tampered with in transit and matches our shared passphrase; (2) a server-to-server
  // confirmation POST back to PayFast with the exact same raw body -- proves the request
  // actually originated from PayFast, not just someone who guessed/leaked the passphrase and can
  // forge a matching signature offline. `signatureHeader` is unused: PayFast does not send a
  // signature HTTP header for ITN -- the signature travels as a `signature` field inside the
  // form-urlencoded body itself, same shape as every other ITN field.
  async verifyWebhookSignature(rawBody: string, _signatureHeader: string | null): Promise<boolean> {
    const received = new URLSearchParams(rawBody);
    const receivedSignature = received.get('signature');
    if (!receivedSignature) return false;

    const fieldsForSignature = new Map<string, string>();
    for (const [key, value] of received) {
      if (key === 'signature') continue;
      fieldsForSignature.set(key, value);
    }
    const recomputed = generateFormSignature(fieldsForSignature, this.config.passphrase);
    if (recomputed !== receivedSignature) return false;

    try {
      const response = await fetch(`${baseUrl(this.config)}/eng/query/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: rawBody,
      });
      const text = (await response.text()).trim();
      return text === 'VALID';
    } catch (err) {
      // A network failure reaching PayFast's own confirmation endpoint is our infrastructure's
      // problem, not proof the webhook is fraudulent -- but per this method's own contract
      // (verification, not "verification unless we couldn't check"), fail closed. A dropped ITN
      // gets retried by PayFast on a non-2xx response (this codebase's own webhook route already
      // returns 400 on a false result here), so this is not a silent, permanent loss of the event.
      console.error(
        '[PayFastBillingGatewayProvider] server-to-server ITN confirmation failed',
        err,
      );
      return false;
    }
  }

  parseWebhookEvent(rawBody: string): BillingWebhookEvent {
    const fields = new URLSearchParams(rawBody);
    const paymentStatus = fields.get('payment_status');
    const mPaymentId = fields.get('m_payment_id');
    const pfPaymentId = fields.get('pf_payment_id');

    if (!mPaymentId && !pfPaymentId) {
      throw new Error('Malformed PayFast ITN payload: missing both m_payment_id and pf_payment_id');
    }

    // COMPLETE/FAILED/CANCELLED are PayFast's own documented ITN payment_status values and map
    // directly onto this codebase's BillingEventType. PayFast can also send a PENDING status
    // (e.g. an EFT payment awaiting bank confirmation) -- deliberately NOT mapped to any of the
    // four BillingEventType values (mapping it to payment_failed or payment_succeeded would be
    // actively wrong, not just incomplete), so it throws here rather than silently mis-triggering
    // a status transition. Disclosed gap, not a silent one: a real PENDING ITN will currently
    // surface as a 400 from the webhook route until this is extended, which needs a live PayFast
    // sandbox to verify PENDING's actual real-world frequency/shape against, not a guess.
    let type: BillingWebhookEvent['type'];
    if (paymentStatus === 'COMPLETE') type = 'payment_succeeded';
    else if (paymentStatus === 'FAILED') type = 'payment_failed';
    else if (paymentStatus === 'CANCELLED') type = 'subscription_cancelled';
    else
      throw new Error(
        `Unrecognized (or not-yet-handled) PayFast ITN payment_status: ${paymentStatus}`,
      );

    const raw: Record<string, unknown> = {};
    for (const [key, value] of fields) raw[key] = value;

    return {
      providerEventId: pfPaymentId ?? mPaymentId!,
      type,
      providerReference: mPaymentId ?? pfPaymentId!,
      orgId: null,
      amount: fields.has('amount_gross') ? Number(fields.get('amount_gross')) : null,
      currency: 'ZAR',
      // Only present on a subscription-type ITN (createSubscription always sets
      // subscription_type=1, so every ITN for a checkout started by this codebase should carry
      // one) -- absent on e.g. a once-off refund notification, hence nullable.
      providerSubscriptionToken: fields.get('token'),
      raw,
    };
  }
}
