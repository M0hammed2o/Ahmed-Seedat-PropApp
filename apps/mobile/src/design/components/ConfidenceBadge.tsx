import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const { color, radii, spacing, typeScale } = useTheme();
  const pct = Math.round(confidence * 100);
  const tone =
    pct >= 85 ? color.statusPaid : pct >= 65 ? color.statusNeedsReview : color.statusOverdue;
  const label =
    pct >= 85
      ? 'High confidence'
      : pct >= 65
        ? 'Medium confidence'
        : 'Low confidence — please check';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: `${tone}1A`,
        borderRadius: radii.pill,
        paddingHorizontal: spacing[3],
        paddingVertical: 4,
      }}
    >
      <Text style={[typeScale.micro, { color: tone, fontWeight: '700' }]}>
        {pct}% · {label}
      </Text>
    </View>
  );
}
