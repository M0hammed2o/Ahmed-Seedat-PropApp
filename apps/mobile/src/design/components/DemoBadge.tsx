import React from 'react';
import { Text, View } from 'react-native';
import { DEMO_MODE_BANNER_TEXT } from '@propvault/config';
import { useTheme } from '../theme';

/**
 * Always visible, deliberately unmissable, whenever the app is running on mock data instead of
 * a real backend — so demo data can never be confused for a real customer's data (brief).
 */
export function DemoBadge() {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: `${color.accent}1A`,
        borderColor: color.accent,
        borderWidth: 1,
        borderRadius: radii.pill,
        paddingHorizontal: spacing[3],
        paddingVertical: 4,
      }}
    >
      <Text style={[typeScale.micro, { color: color.accent, fontWeight: '700' }]}>
        {DEMO_MODE_BANNER_TEXT}
      </Text>
    </View>
  );
}
