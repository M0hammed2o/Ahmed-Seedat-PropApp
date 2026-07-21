import { mobileEnv } from '@/lib/supabase';
import { MockSubscriptionProvider } from './MockSubscriptionProvider';
import { RevenueCatSubscriptionProvider } from './RevenueCatSubscriptionProvider';
import type { SubscriptionProvider } from './SubscriptionProvider';

let cached: SubscriptionProvider | null = null;

/**
 * Single factory call site — screens/hooks import this, never a concrete provider class
 * directly, so switching modes never touches call sites (see SUBSCRIPTIONS.md).
 */
export function getSubscriptionProvider(): SubscriptionProvider {
  if (cached) return cached;
  if (mobileEnv.EXPO_PUBLIC_SUBSCRIPTION_MODE === 'revenuecat') {
    const key =
      mobileEnv.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS ??
      mobileEnv.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;
    if (!key) {
      throw new Error('RevenueCat API key missing while EXPO_PUBLIC_SUBSCRIPTION_MODE=revenuecat');
    }
    cached = new RevenueCatSubscriptionProvider(key);
  } else {
    cached = new MockSubscriptionProvider();
  }
  return cached;
}

export type { SubscriptionProvider, Offering } from './SubscriptionProvider';
