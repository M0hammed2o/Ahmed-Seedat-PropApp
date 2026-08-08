import React from 'react';
import { Image, View, type ViewStyle } from 'react-native';

// React Native's static asset registry requires a literal require path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoSource = require('../../../../admin/branding/proplyst-logo.png');

export function ProplystLogo({ compact = false, width, style }: { compact?: boolean; width?: number; style?: ViewStyle }) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Proplyst"
      style={[
        {
          width: width ?? (compact ? 142 : 240),
          height: compact ? 64 : 112,
          overflow: 'hidden',
          borderRadius: compact ? 12 : 20,
          backgroundColor: '#030916',
        },
        style,
      ]}
    >
      <Image source={logoSource} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
    </View>
  );
}
