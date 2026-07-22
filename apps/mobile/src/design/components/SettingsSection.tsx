import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Card } from './Card';

export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <View style={{ marginBottom: spacing[6] }}>
      <Text
        style={[
          typeScale.micro,
          {
            color: color.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            marginBottom: spacing[2],
          },
        ]}
      >
        {title}
      </Text>
      <Card style={{ padding: 0 }}>{children}</Card>
    </View>
  );
}

export function SettingsRow({
  label,
  value,
  onPress,
  right,
  isLast,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  isLast?: boolean;
}) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing[4],
        paddingVertical: spacing[3],
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: color.border,
      }}
    >
      <Text
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        style={[typeScale.body, { color: color.textPrimary }]}
      >
        {label}
      </Text>
      {right ? (
        right
      ) : value ? (
        <Text style={[typeScale.body, { color: color.textMuted }]}>{value}</Text>
      ) : null}
    </View>
  );
}
