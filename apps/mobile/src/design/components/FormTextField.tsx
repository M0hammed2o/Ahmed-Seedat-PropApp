import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from '../theme';

export interface FormTextFieldProps extends TextInputProps {
  label: string;
  errorMessage?: string;
}

export function FormTextField({ label, errorMessage, style, ...inputProps }: FormTextFieldProps) {
  const { color, spacing, radii, typeScale } = useTheme();
  return (
    <View style={{ marginBottom: spacing[4] }}>
      <Text style={[typeScale.caption, { color: color.textSecondary, marginBottom: spacing[1] }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={color.textMuted}
        style={[
          styles.input,
          {
            borderColor: errorMessage ? color.danger : color.border,
            borderRadius: radii.md,
            color: color.textPrimary,
            paddingHorizontal: spacing[3],
          },
          style,
        ]}
        {...inputProps}
      />
      {errorMessage ? (
        <Text style={[typeScale.micro, { color: color.danger, marginTop: spacing[1] }]}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, height: 48, fontSize: 15 },
});
