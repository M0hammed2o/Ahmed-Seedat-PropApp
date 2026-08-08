import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { useTheme } from '@/design/theme';
import { PrimaryButton, ProplystLogo, StatusPill } from '@/design/components';

export default function EnableBiometricsScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { biometricLabel, enableBiometricLock, setBiometricEnabled } = useBiometricLock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueOnboarding = () => router.push('/(onboarding)/add-first-property');

  const handleEnable = async () => {
    setBusy(true);
    setError(null);
    const result = await enableBiometricLock();
    setBusy(false);
    if (result.success) continueOnboarding();
    else setError(result.message ?? `${biometricLabel} could not be enabled.`);
  };

  const handleSkip = () => {
    setBiometricEnabled(false);
    continueOnboarding();
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minHeight: 360, padding: spacing[6], justifyContent: 'center' }}>
        <ProplystLogo compact />
        <View style={{ marginTop: spacing[6] }}><StatusPill label={`${biometricLabel} · optional`} tone="info" /></View>
        <Text accessibilityRole="header" style={[typeScale.title, { color: color.textPrimary, marginTop: spacing[3] }]}>Protect your app</Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[3] }]}>Enable {biometricLabel} to unlock Proplyst quickly. This only protects local access to your already-signed-in session on this device—it does not verify your identity to Proplyst, and no biometric data leaves your device.</Text>
        {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginTop: spacing[4] }]}>{error}</Text> : null}
      </View>
      <View style={{ padding: spacing[6], gap: spacing[3] }}>
        <PrimaryButton label={`Enable ${biometricLabel}`} loading={busy} onPress={() => void handleEnable()} />
        <PrimaryButton label="Not now" variant="secondary" disabled={busy} onPress={handleSkip} />
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}
