import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export interface BiometricLockScreenProps {
  onUnlockPress: () => void;
  onUseFullAuthPress: () => void;
  isFullAuthRequired: boolean;
  biometricLabel?: string;
}

/** Biometrics protect local access only and never replace backend identity verification. */
export function BiometricLockScreen({
  onUnlockPress,
  onUseFullAuthPress,
  isFullAuthRequired,
  biometricLabel = 'biometrics',
}: BiometricLockScreenProps) {
  const { color, spacing, radii, typeScale } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: color.surface }]}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing[6], alignItems: 'center' }}>
        <Text accessibilityRole="header" style={[typeScale.title, { color: color.textPrimary }]}>Proplyst is locked</Text>
        <Text style={[typeScale.body, { color: color.textSecondary, textAlign: 'center', marginTop: spacing[2] }]}>
          {isFullAuthRequired
            ? 'Please sign in again to continue.'
            : 'Unlock to continue—this only protects local access on this device.'}
        </Text>
        {!isFullAuthRequired ? (
          <Pressable
            onPress={onUnlockPress}
            accessibilityRole="button"
            accessibilityLabel={`Unlock with ${biometricLabel}`}
            style={({ pressed }) => ({
              minHeight: 48,
              marginTop: spacing[6],
              paddingHorizontal: spacing[6],
              paddingVertical: spacing[3],
              borderRadius: radii.md,
              backgroundColor: color.accent,
              opacity: pressed ? 0.78 : 1,
              justifyContent: 'center',
            })}
          >
            <Text style={[typeScale.body, { color: color.accentContrast }]}>Unlock with {biometricLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onUseFullAuthPress} accessibilityRole="button" style={{ minHeight: 48, marginTop: spacing[4], justifyContent: 'center' }}>
          <Text style={[typeScale.caption, { color: color.textSecondary }]}>Sign in with password instead</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
