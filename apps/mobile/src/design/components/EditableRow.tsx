import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme';

export function EditableRow({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric';
}) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <View style={{ paddingVertical: spacing[2] }}>
      <Text
        style={[
          typeScale.micro,
          {
            color: color.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            marginBottom: 4,
          },
        ]}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={[typeScale.body, { color: color.textPrimary, paddingVertical: 4 }]}
        accessibilityLabel={label}
      />
    </View>
  );
}
