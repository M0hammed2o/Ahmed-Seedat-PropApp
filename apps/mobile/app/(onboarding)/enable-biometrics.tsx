import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { useTheme } from '@/design/theme';
import { PrimaryButton } from '@/design/components';

export default function EnableBiometricsScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { setBiometricEnabled } = useBiometricLock();

  const handleEnable = () => {
    setBiometricEnabled(true);
    router.push('/(onboarding)/add-first-property');
  };

  const handleSkip = () => {
    setBiometricEnabled(false);
    router.push('/(onboarding)/add-first-property');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <View style={{ flex: 1, padding: spacing[6], justifyContent: 'center' }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>Protect your app</Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[3] }]}>
          Enable Face ID / Touch ID to unlock PropVault quickly. This only protects local access to
          your already-signed-in session on this device — it is not used to verify your identity to
          PropVault, and no biometric data ever leaves your device.
        </Text>
      </View>
      <View style={{ padding: spacing[6], gap: spacing[3] }}>
        <PrimaryButton label="Enable biometric unlock" onPress={handleEnable} />
        <PrimaryButton label="Not now" variant="secondary" onPress={handleSkip} />
      </View>
    </SafeAreaView>
  );
}
