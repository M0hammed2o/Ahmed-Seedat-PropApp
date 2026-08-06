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
  const parts = fields.filter(([, v]) => v !== '').map(([k, v]) => `${k}=${phpUrlEncode(v.trim())}`);
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

    it('accepts a genuinely valid ITN (correct signature + PayFast confirms VALID)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ text: async () => 'VALID' }) as unknown as typeof fetch;
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
      global.fetch = vi.fn().mockResolvedValue({ text: async () => 'INVALID' }) as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.verifyWebhookSignature(buildItnBody(), null);
      expect(result).toBe(false);
    });

    it('fails closed if the server-confirmation network call itself fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.verifyWebhookSignature(buildItnBody(), null);
      expect(result).toBe(false);
    });

    it('rejects a body with no signature field at all', async () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const result = await provider.verifyWebhookSignature('m_payment_id=x&payment_status=COMPLETE', null);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('maps COMPLETE to payment_succeeded', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const event = provider.parseWebhookEvent('m_payment_id=ref-1&pf_payment_id=999&payment_status=COMPLETE&amount_gross=299.00');
      expect(event.type).toBe('payment_succeeded');
      expect(event.providerReference).toBe('ref-1');
      expect(event.amount).toBe(299);
      expect(event.currency).toBe('ZAR');
    });

    it('maps FAILED to payment_failed', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const event = provider.parseWebhookEvent('m_payment_id=ref-1&pf_payment_id=999&payment_status=FAILED');
      expect(event.type).toBe('payment_failed');
    });

    it('maps CANCELLED to subscription_cancelled', () => {
      const provider = new PayFastBillingGatewayProvider(CONFIG);
      const event = provider.parseWebhookEvent('m_payment_id=ref-1&pf_payment_id=999&payment_status=CANCELLED');
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
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', text: async () => 'bad signature' }) as unknown as typeof fetch;
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

      await provider.refundPayment({ providerPaymentReference: 'pf-999', amount: 299, idempotencyKey: 'refund-1' });

      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain('/refunds/pf-999');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.amount).toBe('29900');
    });
  });
});
