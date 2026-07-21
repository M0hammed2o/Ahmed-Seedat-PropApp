import { MockSubscriptionProvider } from '../MockSubscriptionProvider';

describe('MockSubscriptionProvider', () => {
  it('has no active subscription before any purchase', async () => {
    const provider = new MockSubscriptionProvider();
    const snapshot = await provider.getCachedSubscriptionSnapshot();
    expect(snapshot).toBeNull();
  });

  it('becomes active after a successful purchase', async () => {
    const provider = new MockSubscriptionProvider();
    const result = await provider.purchase('propvault_base');
    expect(result.success).toBe(true);
    const snapshot = await provider.getCachedSubscriptionSnapshot();
    expect(snapshot?.status).toBe('active');
  });

  it('restore activates a subscription for a user who has not purchased yet (expired subscription / restore purchases flow)', async () => {
    const provider = new MockSubscriptionProvider();
    const result = await provider.restore();
    expect(result.success).toBe(true);
    const snapshot = await provider.getCachedSubscriptionSnapshot();
    expect(snapshot?.status).toBe('active');
  });

  it('returns exactly one offering for the single V1 plan', async () => {
    const provider = new MockSubscriptionProvider();
    const offerings = await provider.getOfferings();
    expect(offerings).toHaveLength(1);
    expect(offerings[0]?.identifier).toBe('propvault_base');
  });
});
