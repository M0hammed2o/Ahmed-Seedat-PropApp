import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayFastBillingGatewayProvider, type PayFastConfig } from '../payfast';

const CONFIG: PayFastConfig = {
  merchantId: '10000100',
  merchantKey: 'test-merchant-key',
  passphrase: 'test-passphrase',
  mode: 'sandbox',
};

// Same phpUrlEncode semantics the provider itself implements, reimplemented independently here
// so these tests actually verify the algorithm rather than tautologically calling the same
// private logic under test. Cross-checked against PHP urlencode() behaviour during this session
// (spaces -> '+', `!'()*~` percent-encoded, unlike JS's default encodeURIComponent).
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

function independentFormSignature(fields: [string, string][], passphrase: string): string {
  const parts = fields
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${phpUrlEncode(v.trim())}`);
  let pfOutput = parts.join('&');
  if (passphrase) pfOutput += `&passphrase=${phpUrlEncode(passphrase.trim())}`;
  return crypto.createHash('md5').update(pfOutput).digest('hex');
}

describe('PayFastBillingGatewayProvider', () => {
  describe('createSubscription', () => {
    it('produces a checkout URL whose signature matches an independently-computed one', async () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.createSubscription({
        orgId: 'org-1',
        providerCustomerId: 'cust-1',
        planCode: 'starter',
        amount: 299,
        currency: 'ZAR',
        billingCycle: 'monthly',
        idempotencyKey: 'checkout-org-1-attempt-1',
      });

      const url = new URL(result.checkoutUrl);
      expect(url.hostname).toBe('sandbox.payfast.co.za');
      expect(url.pathname).toBe('/eng/process');

      const params = url.searchParams;
      const signature = params.get('signature')!;
      const fieldsInOrder: [string, string][] = [];
      for (const [key, value] of params) {
        if (key === 'signature') continue;
        fieldsInOrder.push([key, value]);
      }
      const expectedSignature = independentFormSignature(fieldsInOrder, CONFIG.passphrase);
      expect(signature).toBe(expectedSignature);
    });

    it('sets recurring-billing fields for a real subscription, never a once-off charge', async () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.createSubscription({
        orgId: 'org-1',
        providerCustomerId: 'cust-1',
        planCode: 'professional',
        amount: 699,
        currency: 'ZAR',
        billingCycle: 'monthly',
        idempotencyKey: 'checkout-org-1-attempt-2',
      });
      const params = new URL(result.checkoutUrl).searchParams;
      expect(params.get('subscription_type')).toBe('1');
      expect(params.get('frequency')).toBe('3');
      expect(params.get('cycles')).toBe('0');
      expect(params.get('recurring_amount')).toBe('699.00');
    });

    it('places billing_date between subscription_type and recurring_amount -- field order is load-bearing, not client-arbitrary', async () => {
      // Regression test for a real bug found via a live PayFast sandbox round trip (WORKLOG.md
      // this date, real merchant credentials, real HTTP requests): PayFast's signature
      // verification for the subscription fields does NOT tolerate "whatever order the client
      // submitted" the way this file's own header comment originally (incorrectly, pre-live-
      // testing) assumed -- billing_date appended after cycles reproducibly failed with "signature
      // does not match" against the real gateway; moving it to this exact position (right after
      // subscription_type, before recurring_amount) reproducibly succeeded (HTTP 302 to a real
      // PayFast hosted payment page). This test can't itself hit the real gateway, so it pins the
      // known-correct field ORDER directly -- if this ever silently regresses, this test catches
      // it before a live round trip would be needed to notice again.
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.createSubscription({
        orgId: 'org-1',
        providerCustomerId: 'cust-1',
        planCode: 'starter_monthly',
        amount: 299,
        initialAmount: 0,
        billingDate: '2026-09-20',
        currency: 'ZAR',
        billingCycle: 'monthly',
        idempotencyKey: 'checkout-org-1-trial',
      });
      const url = new URL(result.checkoutUrl);
      const keysInOrder = [...url.searchParams.keys()];
      const subscriptionTypeIdx = keysInOrder.indexOf('subscription_type');
      const billingDateIdx = keysInOrder.indexOf('billing_date');
      const recurringAmountIdx = keysInOrder.indexOf('recurring_amount');
      expect(subscriptionTypeIdx).toBeGreaterThanOrEqual(0);
      expect(billingDateIdx).toBeGreaterThanOrEqual(0);
      expect(recurringAmountIdx).toBeGreaterThanOrEqual(0);
      expect(subscriptionTypeIdx).toBeLessThan(billingDateIdx);
      expect(billingDateIdx).toBeLessThan(recurringAmountIdx);
      expect(url.searchParams.get('amount')).toBe('0.00');
    });

    it('maps an annual billing cycle to PayFast frequency code 6', async () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.createSubscription({
        orgId: 'org-1',
        providerCustomerId: 'cust-1',
        planCode: 'business',
        amount: 1499,
        currency: 'ZAR',
        billingCycle: 'annual',
        idempotencyKey: 'checkout-org-1-attempt-3',
      });
      expect(new URL(result.checkoutUrl).searchParams.get('frequency')).toBe('6');
    });

    // R0-to-R5 revision (WORKLOG.md this date): the once-off card-verification fee charged now
    // (`amount`) must never leak into or get confused with the plan's own recurring price
    // (`recurring_amount`) -- these are two genuinely separate PayFast fields, and mixing them up
    // would either overcharge the customer today or undercharge every renewal after the trial.
    // Parametrized across all three tiers x both billing cycles, matching exactly what
    // startTrialActivationCheckout() can request in production -- "do not assume annual behaviour"
    // applies here too, so it's exercised explicitly rather than inferred from the monthly case.
    const PLAN_PRICES: Array<{ planCode: string; billingCycle: 'monthly' | 'annual'; amount: number }> = [
      { planCode: 'starter_monthly', billingCycle: 'monthly', amount: 299 },
      { planCode: 'professional_monthly', billingCycle: 'monthly', amount: 699 },
      { planCode: 'business_monthly', billingCycle: 'monthly', amount: 1999 },
      { planCode: 'starter_annual', billingCycle: 'annual', amount: 299 * 12 * 0.85 },
      { planCode: 'professional_annual', billingCycle: 'annual', amount: 699 * 12 * 0.85 },
      { planCode: 'business_annual', billingCycle: 'annual', amount: 1999 * 12 * 0.85 },
    ];
    for (const { planCode, billingCycle, amount } of PLAN_PRICES) {
      it(`keeps the R5 verification fee separate from the ${planCode} recurring amount`, async () => {
        const provider = new PayFastBillingGatewayProvider(CONFIG);
        const result = await provider.createSubscription({
          orgId: 'org-1',
          providerCustomerId: 'cust-1',
          planCode,
          amount,
          initialAmount: 5,
          billingDate: '2026-09-28',
          currency: 'ZAR',
          billingCycle,
          idempotencyKey: `checkout-org-1-${planCode}`,
        });
        const params = new URL(result.checkoutUrl).searchParams;
        expect(params.get('amount')).toBe('5.00');
        expect(params.get('recurring_amount')).toBe(amount.toFixed(2));
        expect(params.get('recurring_amount')).not.toBe(params.get('amount'));
        expect(params.get('frequency')).toBe(billingCycle === 'annual' ? '6' : '3');
      });
    }
  });

  describe('verifyWebhookSignature', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    function buildItnBody(overrides: Record<string, string> = {}): string {
      const fields: [string, string][] = [
        ['m_payment_id', 'checkout-org-1-attempt-1'],
        ['pf_payment_id', '123456'],
        ['payment_status', 'COMPLETE'],
        ['amount_gross', '299.00'],
        ...Object.entries(overrides),
      ];
      const signature = independentFormSignature(fields, CONFIG.passphrase);
      const params = new URLSearchParams();
      for (const [k, v] of fields) params.set(k, v);
      params.set('signature', signature);
      return params.toString();
    }

    it('accepts a real-shaped ITN with empty-string fields (a genuine PayFast ITN always includes item_name, name_first, custom_str1-5, etc., empty whenever unused)', async () => {
      // Regression test for a real bug found via a live PayFast sandbox ITN round trip (WORKLOG.md
      // this date): PayFast's OWN signature computation includes every field it sends, even ones
      // with an empty string value -- generateFormSignature (used for the outbound checkout, where
      // "skip empty" is correct) was being reused here too, silently dropping those fields and
      // never matching a real ITN's signature. buildItnBody() above only ever includes 4 non-empty
      // fields, which is why the existing tests never caught this -- "skip empty" and "include
      // empty" produce identical output when there's nothing empty to differ on. This test
      // deliberately includes empty-string fields, matching real ITN shape, and signs them the way
      // PayFast itself does (nothing skipped).
      global.fetch = vi
        .fn()
        .mockResolvedValue({ text: async () => 'VALID' }) as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);

      const fields: [string, string][] = [
        ['m_payment_id', 'checkout-org-1-trial'],
        ['pf_payment_id', '3339654'],
        ['payment_status', 'COMPLETE'],
        ['item_name', ''],
        ['item_description', ''],
        ['amount_gross', '0.00'],
        ['amount_fee', '0.00'],
        ['amount_net', '0.00'],
        ['name_first', ''],
        ['name_last', ''],
        ['email_address', ''],
        ['merchant_id', CONFIG.merchantId],
        ['token', 'a-real-looking-token'],
        ['billing_date', '2026-09-20'],
      ];
      // Signs EVERY field, including the empty-string ones -- matching PayFast's own algorithm,
      // deliberately NOT independentFormSignature's "skip empty" behaviour above.
      const parts = fields.map(([k, v]) => `${k}=${v}`);
      const signature = crypto
        .createHash('md5')
        .update(`${parts.join('&')}&passphrase=${CONFIG.passphrase}`)
        .digest('hex');
      const params = new URLSearchParams();
      for (const [k, v] of fields) params.set(k, v);
      params.set('signature', signature);

      const result = await provider.verifyWebhookSignature(params.toString(), null);
      expect(result).toBe(true);
    });

    it('accepts a genuinely valid ITN (correct signature + PayFast confirms VALID)', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({ text: async () => 'VALID' }) as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.verifyWebhookSignature(buildItnBody(), null);
      expect(result).toBe(true);
    });

    it('rejects an ITN whose signature does not match its (possibly tampered) fields, WITHOUT calling PayFast at all', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);

      // Tamper: change the amount after the signature was computed over the original amount --
      // exactly the attack a signature check exists to catch.
      const body = buildItnBody().replace('amount_gross=299.00', 'amount_gross=9999.00');
      const result = await provider.verifyWebhookSignature(body, null);

      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects an ITN with a correct signature if PayFast's own server-confirmation says INVALID", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({ text: async () => 'INVALID' }) as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.verifyWebhookSignature(buildItnBody(), null);
      expect(result).toBe(false);
    });

    it('fails closed if the server-confirmation network call itself fails', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.verifyWebhookSignature(buildItnBody(), null);
      expect(result).toBe(false);
    });

    it('rejects a body with no signature field at all', async () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.verifyWebhookSignature(
        'm_payment_id=x&payment_status=COMPLETE',
        null,
      );
      expect(result).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('maps COMPLETE to payment_succeeded', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const event = provider.parseWebhookEvent(
        'm_payment_id=ref-1&pf_payment_id=999&payment_status=COMPLETE&amount_gross=299.00',
      );
      expect(event.type).toBe('payment_succeeded');
      expect(event.providerReference).toBe('ref-1');
      expect(event.amount).toBe(299);
      expect(event.currency).toBe('ZAR');
    });

    it('maps FAILED to payment_failed', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const event = provider.parseWebhookEvent(
        'm_payment_id=ref-1&pf_payment_id=999&payment_status=FAILED',
      );
      expect(event.type).toBe('payment_failed');
    });

    it('maps CANCELLED to subscription_cancelled', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const event = provider.parseWebhookEvent(
        'm_payment_id=ref-1&pf_payment_id=999&payment_status=CANCELLED',
      );
      expect(event.type).toBe('subscription_cancelled');
    });

    it('throws on an unrecognized payment_status rather than silently mis-mapping it', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      expect(() =>
        provider.parseWebhookEvent('m_payment_id=ref-1&pf_payment_id=999&payment_status=PENDING'),
      ).toThrow();
    });

    it('throws on a payload missing both id fields', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      expect(() => provider.parseWebhookEvent('payment_status=COMPLETE')).toThrow();
    });
  });

  describe('cancelSubscription', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('PUTs to the subscriptions cancel endpoint with the management-api headers', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
      global.fetch = fetchSpy as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);

      const result = await provider.cancelSubscription('token-abc-123');

      expect(result).toEqual({ providerSubscriptionId: 'token-abc-123', status: 'cancelled' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain('/subscriptions/token-abc-123/cancel');
      expect(options.method).toBe('PUT');
      expect(options.headers['merchant-id']).toBe(CONFIG.merchantId);
      expect(options.headers.version).toBe('v1');
      expect(options.headers.signature).toBeTruthy();
    });

    it('throws on a non-2xx response rather than pretending the cancellation succeeded', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'bad signature',
      }) as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      await expect(provider.cancelSubscription('token-abc-123')).rejects.toThrow(/403/);
    });
  });

  describe('refundPayment', () => {
    let originalFetch: typeof fetch;
    beforeEach(() => {
      originalFetch = global.fetch;
    });
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('POSTs to the refunds endpoint with the amount converted to cents', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
      global.fetch = fetchSpy as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);

      await provider.refundPayment({
        providerPaymentReference: 'pf-999',
        amount: 299,
        idempotencyKey: 'refund-1',
      });

      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain('/refunds/pf-999');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.amount).toBe('29900');
    });
  });
});
