import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { branding } from '@propvault/config';
import { useTheme } from '@/design/theme';
import { PrimaryButton } from '@/design/components';

export default function WelcomeScreen() {
  const { color, spacing, typeScale } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: color.surface }]}>
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing[6] }}>
        <Text style={[typeScale.display, { color: color.textPrimary }]}>
          {branding.productName}
        </Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[3] }]}>
          {branding.tagline} Keep every bill, statement and proof of payment for every property you
          own — organised, searchable, and protected behind biometric app lock.
        </Text>
      </View>
      <View style={{ padding: spacing[6], gap: spacing[3] }}>
        <PrimaryButton label="Create an account" onPress={() => router.push('/(auth)/register')} />
        <PrimaryButton
          label="I already have an account"
          variant="secondary"
          onPress={() => router.push('/(auth)/login')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
