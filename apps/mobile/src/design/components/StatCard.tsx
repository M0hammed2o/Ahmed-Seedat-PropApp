import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Card } from './Card';

export interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}

export function StatCard({ label, value, tone = 'neutral' }: StatCardProps) {
  const { color, spacing, typeScale } = useTheme();
  const toneColor = {
    neutral: color.textPrimary,
    positive: color.statusPaid,
    warning: color.statusNeedsReview,
    danger: color.statusOverdue,
  }[tone];

  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <Text
        style={[
          typeScale.micro,
          { color: color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
        ]}
      >
        {label}
      </Text>
      <View style={{ marginTop: spacing[1] }}>
        <Text style={[typeScale.title, { color: toneColor }]}>{value}</Text>
      </View>
    </Card>
  );
}
