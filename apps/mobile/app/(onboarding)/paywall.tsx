import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PROPVAULT_BASE_PLAN } from '@propvault/config';
import { getSubscriptionProvider, type Offering } from '@/features/subscriptions';
import { useTheme } from '@/design/theme';
import { PrimaryButton } from '@/design/components';

/** SubscriptionPaywall (brief component list) — Phase 1 implementation, mock-mode by default. */
export default function PaywallScreen() {
  const { color, spacing, typeScale } = useTheme();
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSubscriptionProvider().getOfferings().then(setOfferings).catch(() => {
      setError('Plans could not be loaded on this preview client. Try again or use the mock subscription build.');
    });
  }, []);

  const handleSubscribe = async () => {
    setPurchasing(true);
    setError(null);
    try {
      const result = await getSubscriptionProvider().purchase(PROPVAULT_BASE_PLAN.planId);
      if (result.success) router.push('/(onboarding)/enable-biometrics');
      else setError('The preview purchase was not completed.');
    } catch {
      setError('Purchases require the matching iOS or Android development build.');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minHeight: 320, padding: spacing[6], justifyContent: 'center' }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>
          Proplyst plan preview
        </Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[3] }]}>
          Up to {PROPVAULT_BASE_PLAN.limits.maxProperties} properties,{' '}
          {PROPVAULT_BASE_PLAN.limits.storageAllowanceMb}MB of document storage, and automatic bill
          organisation.
        </Text>
        <Text style={[typeScale.caption, { color: color.textMuted, marginTop: spacing[4] }]}>
          Price: {offerings[0]?.priceString ?? PROPVAULT_BASE_PLAN.monthlyPrice} — final pricing to
          be confirmed before launch.
        </Text>
        {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginTop: spacing[4] }]}>{error}</Text> : null}
      </View>
      <View style={{ padding: spacing[6], gap: spacing[3] }}>
        <PrimaryButton label="Subscribe" loading={purchasing} onPress={handleSubscribe} />
        <PrimaryButton
          label="Restore purchases"
          variant="secondary"
          onPress={() => router.push('/(onboarding)/restore')}
        />
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}
