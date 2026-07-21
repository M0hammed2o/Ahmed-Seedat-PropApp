import { Linking, Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import type { Subscription } from '@propvault/types';
import type { Offering, SubscriptionProvider } from './SubscriptionProvider';

/**
 * Real RevenueCat SDK integration. Gated behind `EXPO_PUBLIC_SUBSCRIPTION_MODE=revenuecat` and
 * real product identifiers — not exercised until those exist (see SUBSCRIPTIONS.md, TODO.md).
 * Note this class never itself decides entitlement for gating purposes; callers still read the
 * server-synced `subscriptions` table as the trusted source (see SECURITY.md).
 */
export class RevenueCatSubscriptionProvider implements SubscriptionProvider {
  constructor(private readonly apiKey: string) {
    Purchases.configure({ apiKey: this.apiKey });
  }

  async getOfferings(): Promise<Offering[]> {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current) return [];
    return current.availablePackages.map((pkg) => ({
      identifier: pkg.identifier,
      displayName: pkg.product.title,
      priceString: pkg.product.priceString,
    }));
  }

  async purchase(offeringIdentifier: string): Promise<{ success: boolean }> {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages.find(
      (p) => p.identifier === offeringIdentifier,
    );
    if (!pkg) return { success: false };
    try {
      await Purchases.purchasePackage(pkg);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async restore(): Promise<{ success: boolean }> {
    try {
      await Purchases.restorePurchases();
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async getCachedSubscriptionSnapshot(): Promise<Pick<Subscription, 'status' | 'planId'> | null> {
    // Intentionally does not attempt to derive status from RevenueCat's local CustomerInfo for
    // gating purposes — the server-synced `subscriptions` table (webhook-fed) is the source of
    // truth. This is used only for optimistic UI while that fetch is in flight.
    return null;
  }

  async openManageSubscription(): Promise<void> {
    const url =
      Platform.OS === 'ios'
        ? 'itms-apps://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    await Linking.openURL(url);
  }
}
