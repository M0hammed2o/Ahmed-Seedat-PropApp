import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme';

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: spacing[4],
        paddingVertical: spacing[2],
        borderRadius: radii.pill,
        backgroundColor: selected ? color.accent : color.surfaceRaised,
        borderWidth: 1,
        borderColor: selected ? color.accent : color.border,
      }}
    >
      <Text
        style={[
          typeScale.caption,
          { color: selected ? color.accentContrast : color.textPrimary, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
