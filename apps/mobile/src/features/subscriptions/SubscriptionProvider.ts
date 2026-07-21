import type { Subscription } from '@propvault/types';

export interface Offering {
  identifier: string;
  displayName: string;
  priceString: string;
}

/**
 * Vendor-agnostic boundary over RevenueCat (brief: mock mode must fully unblock development
 * before store accounts/products exist). Neither implementation is itself the source of truth
 * for entitlement — the server-synced `subscriptions` table is (see SUBSCRIPTIONS.md); this
 * interface only drives the purchase/restore *interaction*.
 */
export interface SubscriptionProvider {
  getOfferings(): Promise<Offering[]>;
  purchase(offeringIdentifier: string): Promise<{ success: boolean }>;
  restore(): Promise<{ success: boolean }>;
  getCachedSubscriptionSnapshot(): Promise<Pick<Subscription, 'status' | 'planId'> | null>;
  openManageSubscription(): Promise<void>;
}
