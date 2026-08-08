import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';

export type AppIconName =
  | 'home' | 'property' | 'tenant' | 'money' | 'more' | 'lease' | 'document'
  | 'maintenance' | 'inspection' | 'meter' | 'owner' | 'report' | 'staff'
  | 'notification' | 'settings' | 'security' | 'organization' | 'search'
  | 'add' | 'back' | 'camera' | 'upload' | 'calendar' | 'unit' | 'check';

const glyphs: Record<AppIconName, string> = {
  home: '⌂', property: '▦', tenant: '♙', money: 'R', more: '•••', lease: '▤',
  document: '▱', maintenance: '◇', inspection: '✓', meter: '↗', owner: '◎',
  report: '▥', staff: '♙', notification: '●', settings: '⚙', security: '◆',
  organization: '▦', search: '⌕', add: '+', back: '‹', camera: '◉', upload: '↑',
  calendar: '□', unit: '▣', check: '✓',
};

export function AppIcon({ name, size = 20, color: override }: { name: AppIconName; size?: number; color?: string }) {
  const { color } = useTheme();
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size + 4, height: size + 4, alignItems: 'center', justifyContent: 'center' }}>
      <Text
        allowFontScaling={false}
        style={{ color: override ?? color.textSecondary, fontSize: name === 'more' ? size * 0.7 : size, lineHeight: size + 2, fontWeight: '700' }}
      >
        {glyphs[name]}
      </Text>
    </View>
  );
}
