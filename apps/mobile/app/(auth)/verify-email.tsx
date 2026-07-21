import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '@/design/theme';
import { PrimaryButton } from '@/design/components';

export default function VerifyEmailScreen() {
  const { color, spacing, typeScale } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <View style={{ flex: 1, padding: spacing[6], justifyContent: 'center' }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>Check your email</Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[3] }]}>
          We sent a verification link to your email address. Open it to verify your account, then
          continue below.
        </Text>
      </View>
      <View style={{ padding: spacing[6] }}>
        <PrimaryButton label="Continue" onPress={() => router.replace('/(onboarding)/paywall')} />
      </View>
    </SafeAreaView>
  );
}
