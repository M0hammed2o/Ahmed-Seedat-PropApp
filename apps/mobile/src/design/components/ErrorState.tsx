import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  message = 'Something went wrong. Please try again.',
  onRetry,
}: ErrorStateProps) {
  const { color, spacing, radii, typeScale } = useTheme();
  return (
    <View style={[styles.container, { padding: spacing[6] }]} accessibilityRole="alert">
      <Text style={[typeScale.body, { color: color.danger, textAlign: 'center' }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={{
            marginTop: spacing[3],
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[2],
            borderRadius: radii.md,
            backgroundColor: color.accent,
          }}
        >
          <Text style={[typeScale.body, { color: color.accentContrast }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
