import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { getSubscriptionProvider } from '@/features/subscriptions';
import { useTheme } from '@/design/theme';
import { PrimaryButton } from '@/design/components';

export default function RestorePurchasesScreen() {
  const { color, spacing, typeScale } = useTheme();
  const [status, setStatus] = useState<'idle' | 'restoring' | 'done' | 'failed'>('idle');

  const handleRestore = async () => {
    setStatus('restoring');
    try {
      const result = await getSubscriptionProvider().restore();
      setStatus(result.success ? 'done' : 'failed');
      if (result.success) router.push('/(onboarding)/enable-biometrics');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minHeight: 300, padding: spacing[6], justifyContent: 'center' }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>Restore purchases</Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[3] }]}>
          Already subscribed on another device? Restore your existing subscription.
        </Text>
        {status === 'failed' ? (
          <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginTop: spacing[3] }]}>
            We couldn't find an active subscription to restore.
          </Text>
        ) : null}
      </View>
      <View style={{ padding: spacing[6] }}>
        <PrimaryButton
          label="Restore purchases"
          loading={status === 'restoring'}
          onPress={handleRestore}
        />
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}
