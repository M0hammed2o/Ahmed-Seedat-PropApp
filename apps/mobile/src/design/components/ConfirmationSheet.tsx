import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface ConfirmationSheetProps {
  visible: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Used before every destructive action (archive property, delete document, etc. — brief). */
export function ConfirmationSheet({
  visible,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmationSheetProps) {
  const { color, spacing, radii, typeScale } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: color.surfaceRaised, borderRadius: radii.xl, padding: spacing[5] },
          ]}
        >
          <Text style={[typeScale.heading, { color: color.textPrimary }]}>{title}</Text>
          {description ? (
            <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[2] }]}>
              {description}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: spacing[5], gap: spacing[3] }}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={[
                styles.button,
                {
                  borderColor: color.border,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Text style={[typeScale.body, { color: color.textPrimary }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              style={[
                styles.button,
                {
                  backgroundColor: destructive ? color.danger : color.accent,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Text style={[typeScale.body, { color: color.accentContrast }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {},
  button: { flex: 1, alignItems: 'center', paddingVertical: 12 },
});
