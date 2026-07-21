import React, { useState } from 'react';
import { Text, View } from 'react-native';
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
    const result = await getSubscriptionProvider().restore();
    setStatus(result.success ? 'done' : 'failed');
    if (result.success) {
      router.push('/(onboarding)/enable-biometrics');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <View style={{ flex: 1, padding: spacing[6], justifyContent: 'center' }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>Restore purchases</Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[3] }]}>
          Already subscribed on another device? Restore your existing subscription.
        </Text>
        {status === 'failed' ? (
          <Text style={[typeScale.caption, { color: color.danger, marginTop: spacing[3] }]}>
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
    </SafeAreaView>
  );
}
