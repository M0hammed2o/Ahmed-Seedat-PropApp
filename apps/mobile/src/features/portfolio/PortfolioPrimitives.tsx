import React from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { AppIconName } from '@/design/components';
import { AppIcon, Card, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';

export function DetailRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${label}: ${value}` : undefined}
      style={{ minHeight: 54, paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: color.border, flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}
    >
      <Text style={[typeScale.caption, { color: color.textSecondary, flex: 1 }]}>{label}</Text>
      <Text selectable={!onPress} numberOfLines={3} style={[typeScale.body, { color: color.textPrimary, fontWeight: '600', maxWidth: '62%', textAlign: 'right', flexShrink: 1 }]}>{value}</Text>
      {onPress ? <Text accessible={false} style={{ color: color.textMuted, fontSize: 22 }}>›</Text> : null}
    </Pressable>
  );
}

export function SummaryCard({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  const { color, spacing, typeScale } = useTheme();
  return <Card><Text accessibilityRole="header" style={[typeScale.heading, { color: color.textPrimary, marginBottom: spacing[2] }]}>{title}</Text>{rows.map((row) => <DetailRow key={row.label} {...row} />)}</Card>;
}

export function ActionCard({
  title,
  description,
  icon,
  route,
  onPress,
  badge,
  disabled = false,
}: {
  title: string;
  description: string;
  icon: AppIconName;
  route?: string;
  onPress?: () => void;
  badge?: string;
  disabled?: boolean;
}) {
  const { color, radii, spacing, typeScale } = useTheme();
  const actionable = Boolean(route || onPress);
  const isDisabled = disabled || !actionable;
  const handlePress = () => {
    if (onPress) onPress();
    else if (route) router.push(route as never);
  };
  return (
    <Pressable
      disabled={isDisabled}
      onPress={handlePress}
      accessibilityRole={actionable ? 'button' : undefined}
      accessibilityState={actionable ? { disabled } : undefined}
      accessibilityLabel={actionable ? title : undefined}
      accessibilityHint={actionable ? description : undefined}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : disabled ? 0.58 : 1 })}
    >
      <Card style={{ minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        <View style={{ width: 46, height: 46, borderRadius: radii.lg, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' }}><AppIcon name={icon} color={color.accent} /></View>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={[typeScale.body, { color: color.textPrimary, fontWeight: '700' }]}>{title}</Text><Text style={[typeScale.caption, { color: color.textSecondary, marginTop: 2 }]}>{description}</Text></View>
        {badge ? <StatusPill label={badge} tone={disabled ? 'neutral' : 'info'} /> : actionable ? <Text accessible={false} style={{ color: color.textMuted, fontSize: 24 }}>›</Text> : null}
      </Card>
    </Pressable>
  );
}

export function ToggleRow({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (value: boolean) => void }) {
  const { color, spacing, typeScale } = useTheme();
  return <View style={{ minHeight: 60, paddingVertical: spacing[2], flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}><View style={{ flex: 1 }}><Text style={[typeScale.body, { color: color.textPrimary, fontWeight: '600' }]}>{label}</Text>{description ? <Text style={[typeScale.caption, { color: color.textSecondary, marginTop: 2 }]}>{description}</Text> : null}</View><Switch accessibilityLabel={label} accessibilityHint={description} value={value} onValueChange={onChange} trackColor={{ true: color.accent }} /></View>;
}

export function PermissionMessage({ message }: { message: string }) {
  const { color, spacing, typeScale } = useTheme();
  return <Card><View accessibilityRole="text" style={{ alignItems: 'center', paddingVertical: spacing[4] }}><AppIcon name="security" size={28} color={color.textMuted} /><Text accessibilityRole="header" style={[typeScale.heading, { color: color.textPrimary, marginTop: spacing[3] }]}>Access is limited</Text><Text style={[typeScale.caption, { color: color.textSecondary, textAlign: 'center', marginTop: spacing[2] }]}>{message}</Text></View></Card>;
}
