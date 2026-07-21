import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Property } from '@propvault/types';
import { useTheme } from '../theme';

export interface PropertyCardProps {
  property: Pick<Property, 'id' | 'nickname' | 'fullAddress' | 'propertyType'>;
  onPress?: (id: string) => void;
}

export function PropertyCard({ property, onPress }: PropertyCardProps) {
  const { color, spacing, radii, typeScale } = useTheme();
  return (
    <Pressable
      onPress={() => onPress?.(property.id)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${property.nickname}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: color.surfaceRaised,
          borderColor: color.border,
          borderRadius: radii.lg,
          padding: spacing[4],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[typeScale.heading, { color: color.textPrimary }]} numberOfLines={1}>
        {property.nickname}
      </Text>
      <Text
        style={[typeScale.caption, { color: color.textSecondary, marginTop: 2 }]}
        numberOfLines={2}
      >
        {property.fullAddress}
      </Text>
      <View style={{ marginTop: spacing[2] }}>
        <Text style={[typeScale.micro, { color: color.textMuted, textTransform: 'uppercase' }]}>
          {property.propertyType.replace('_', ' ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
