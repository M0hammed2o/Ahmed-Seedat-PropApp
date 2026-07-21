import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BillStatus } from '@propvault/types';
import { BILL_STATUS_PRESENTATION } from '@propvault/ui';
import { useTheme } from '../theme';

/**
 * Status is signalled by colour + icon glyph + label together — never colour alone
 * (DESIGN_SYSTEM.md accessibility rule). The icon is rendered as a simple glyph/dot here
 * rather than pulling in an icon library dependency for Phase 1.
 */
export function PaymentStatusBadge({ status }: { status: BillStatus }) {
  const { color, radii, spacing, typeScale } = useTheme();
  const presentation = BILL_STATUS_PRESENTATION[status];
  const tint = color[presentation.colorToken];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: `${tint}22`,
          borderRadius: radii.pill,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[1],
        },
      ]}
      accessibilityLabel={`Status: ${presentation.label}`}
    >
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={[typeScale.micro, { color: tint, marginLeft: 6 }]}>{presentation.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
