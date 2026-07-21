import { Linking, Platform } from 'react-native';
import type { Subscription, SubscriptionStatus } from '@propvault/types';
import { PROPVAULT_BASE_PLAN } from '@propvault/config';
import type { Offering, SubscriptionProvider } from './SubscriptionProvider';

/**
 * Simulates the full offerings/purchase/restore lifecycle with zero store account — the
 * default in Phase 1 (`EXPO_PUBLIC_SUBSCRIPTION_MODE=mock`). Lets the paywall, restore flow,
 * and entitlement gating be built and tested end-to-end before RevenueCat products exist.
 */
export class MockSubscriptionProvider implements SubscriptionProvider {
  private mockStatus: SubscriptionStatus = 'unknown';

  async getOfferings(): Promise<Offering[]> {
    return [
      {
        identifier: PROPVAULT_BASE_PLAN.planId,
        displayName: PROPVAULT_BASE_PLAN.displayName,
        priceString: 'TO_BE_CONFIRMED',
      },
    ];
  }

  async purchase(_offeringIdentifier: string): Promise<{ success: boolean }> {
    this.mockStatus = 'active';
    return { success: true };
  }

  async restore(): Promise<{ success: boolean }> {
    this.mockStatus = this.mockStatus === 'unknown' ? 'active' : this.mockStatus;
    return { success: true };
  }

  async getCachedSubscriptionSnapshot(): Promise<Pick<Subscription, 'status' | 'planId'> | null> {
    if (this.mockStatus === 'unknown') return null;
    return { status: this.mockStatus, planId: PROPVAULT_BASE_PLAN.planId };
  }

  async openManageSubscription(): Promise<void> {
    const url =
      Platform.OS === 'ios'
        ? 'itms-apps://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    await Linking.openURL(url);
  }

  /** Test/dev-only helper — not part of the SubscriptionProvider interface. */
  __setMockStatus(status: SubscriptionStatus): void {
    this.mockStatus = status;
  }
}
