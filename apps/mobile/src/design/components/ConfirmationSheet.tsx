import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss confirmation" style={styles.dismissArea} onPress={onCancel} />
        <SafeAreaView
          edges={['bottom']}
          accessibilityViewIsModal
          onAccessibilityEscape={onCancel}
          style={[
            styles.sheet,
            {
              backgroundColor: color.surfaceRaised,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              padding: spacing[5],
            },
          ]}
        >
          <Text accessibilityRole="header" style={[typeScale.heading, { color: color.textPrimary }]}>{title}</Text>
          {description ? (
            <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[2] }]}>
              {description}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: spacing[5], gap: spacing[3] }}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
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
              accessibilityLabel={confirmLabel}
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
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  dismissArea: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  button: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
});
