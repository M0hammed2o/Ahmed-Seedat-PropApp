import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: PrimaryButtonProps) {
  const { color, spacing, radii, typeScale } = useTheme();
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(loading), disabled: disabled || loading }}
      style={({ pressed }) => ({
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing[3],
        borderRadius: radii.md,
        backgroundColor: isPrimary ? color.accent : 'transparent',
        borderWidth: isPrimary ? 0 : StyleSheet.hairlineWidth,
        borderColor: color.border,
        opacity: disabled || loading ? 0.6 : pressed ? 0.78 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? color.accentContrast : color.textPrimary} />
      ) : (
        <Text
          style={[
            typeScale.body,
            { color: isPrimary ? color.accentContrast : color.textPrimary, fontWeight: '600' },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
