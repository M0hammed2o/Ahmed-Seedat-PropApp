import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { branding } from '@propvault/config';
import { useTheme } from '../theme';

export interface BiometricLockScreenProps {
  onUnlockPress: () => void;
  onUseFullAuthPress: () => void;
  isFullAuthRequired: boolean;
}

/**
 * Reminder embedded here deliberately (brief): biometrics protect local app access, they do
 * not verify identity to PropVault — copy below must never claim otherwise.
 */
export function BiometricLockScreen({
  onUnlockPress,
  onUseFullAuthPress,
  isFullAuthRequired,
}: BiometricLockScreenProps) {
  const { color, spacing, radii, typeScale } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: color.surface }]}>
      <View style={{ padding: spacing[6], alignItems: 'center' }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>
          {branding.productName} is locked
        </Text>
        <Text
          style={[
            typeScale.body,
            { color: color.textSecondary, textAlign: 'center', marginTop: spacing[2] },
          ]}
        >
          {isFullAuthRequired
            ? 'Please sign in again to continue.'
            : 'Unlock to continue — this only protects local access on this device.'}
        </Text>
        {!isFullAuthRequired ? (
          <Pressable
            onPress={onUnlockPress}
            accessibilityRole="button"
            accessibilityLabel="Unlock with biometrics"
            style={{
              marginTop: spacing[6],
              paddingHorizontal: spacing[6],
              paddingVertical: spacing[3],
              borderRadius: radii.md,
              backgroundColor: color.accent,
            }}
          >
            <Text style={[typeScale.body, { color: color.accentContrast }]}>Unlock</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onUseFullAuthPress}
          accessibilityRole="button"
          style={{ marginTop: spacing[4] }}
        >
          <Text style={[typeScale.caption, { color: color.textSecondary }]}>
            Sign in with password instead
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
});
