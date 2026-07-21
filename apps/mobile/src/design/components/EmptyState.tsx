import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <View style={[styles.container, { padding: spacing[6] }]} accessibilityRole="text">
      <Text style={[typeScale.heading, { color: color.textPrimary, textAlign: 'center' }]}>
        {title}
      </Text>
      {description ? (
        <Text
          style={[
            typeScale.body,
            { color: color.textSecondary, textAlign: 'center', marginTop: spacing[2] },
          ]}
        >
          {description}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing[4] }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
