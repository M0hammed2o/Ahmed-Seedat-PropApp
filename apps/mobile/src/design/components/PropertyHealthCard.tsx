import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Card } from './Card';
import { AnimatedProgressBar } from './AnimatedProgressBar';

export type PropertyHealthStatus =
  'paid' | 'unpaid' | 'overdue' | 'needs_review' | 'processing' | 'missing';

export interface PropertyHealthItem {
  categorySlug: string;
  label: string;
  status: PropertyHealthStatus;
}

const GLYPH: Record<PropertyHealthItem['status'], string> = {
  paid: '✓',
  unpaid: '•',
  overdue: '⚠',
  needs_review: '⚠',
  processing: '…',
  missing: '❌',
};

const LABEL_SUFFIX: Record<PropertyHealthItem['status'], string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  needs_review: 'Needs review',
  processing: 'Processing',
  missing: 'Missing',
};

export function PropertyHealthCard({
  score,
  items,
}: {
  score: number;
  items: PropertyHealthItem[];
}) {
  const { color, spacing, typeScale } = useTheme();
  const tone =
    score >= 85 ? color.statusPaid : score >= 60 ? color.statusNeedsReview : color.statusOverdue;

  return (
    <Card>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
      >
        <Text style={[typeScale.heading, { color: color.textPrimary }]}>Property Health</Text>
        <Text style={[typeScale.title, { color: tone }]}>{score}%</Text>
      </View>
      <View style={{ marginTop: spacing[3], marginBottom: spacing[4] }}>
        <AnimatedProgressBar
          progress={score / 100}
          colorToken={score >= 85 ? 'statusPaid' : score >= 60 ? 'accent' : 'statusOverdue'}
        />
      </View>
      {items.map((item) => {
        const itemColor =
          item.status === 'paid'
            ? color.statusPaid
            : item.status === 'missing' || item.status === 'overdue'
              ? color.statusOverdue
              : color.statusNeedsReview;
        return (
          <View
            key={item.categorySlug}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[1] }}
          >
            <Text style={{ color: itemColor, width: 20, fontWeight: '700' }}>
              {GLYPH[item.status]}
            </Text>
            <Text style={[typeScale.body, { color: color.textPrimary }]}>
              {item.label} <Text style={{ color: itemColor }}>{LABEL_SUFFIX[item.status]}</Text>
            </Text>
          </View>
        );
      })}
    </Card>
  );
}
