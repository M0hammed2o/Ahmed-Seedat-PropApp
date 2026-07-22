import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { formatYearMonth } from '@propvault/utils';
import { useMonthlyChecklist } from '@/demo/demoSelectors';
import { useDemoStore } from '@/demo/demoStore';
import { useTheme } from '@/design/theme';
import { AnimatedProgressBar, Card, FadeSlideIn, PrimaryButton } from '@/design/components';

const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 7;

function statusFor(row: ReturnType<typeof useMonthlyChecklist>[number]): {
  glyph: string;
  label: string;
  toneKey: 'statusPaid' | 'statusOverdue' | 'statusNeedsReview' | 'textMuted';
} {
  if (!row.document) return { glyph: '❌', label: 'Missing', toneKey: 'statusOverdue' };
  if (!row.bill) return { glyph: '…', label: 'Processing', toneKey: 'statusNeedsReview' };
  if (row.bill.status === 'paid') return { glyph: '✓', label: 'Paid', toneKey: 'statusPaid' };
  if (row.bill.status === 'overdue')
    return { glyph: '⚠', label: 'Overdue', toneKey: 'statusOverdue' };
  if (row.bill.status === 'needs_review')
    return { glyph: '⚠', label: 'Needs review', toneKey: 'statusNeedsReview' };
  if (row.bill.status === 'processing')
    return { glyph: '…', label: 'Processing', toneKey: 'statusNeedsReview' };
  return { glyph: '•', label: 'Awaiting payment', toneKey: 'statusNeedsReview' };
}

export default function MonthlyChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { color, spacing, typeScale } = useTheme();
  const property = useDemoStore((s) => s.properties.find((p) => p.id === id));
  const rows = useMonthlyChecklist(id, CURRENT_YEAR, CURRENT_MONTH);

  const expectedRows = rows.filter((r) => r.isExpected);
  const satisfied = expectedRows.filter((r) => r.bill?.status === 'paid').length;
  const completionPercent =
    expectedRows.length === 0 ? 100 : Math.round((satisfied / expectedRows.length) * 100);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing[6] }}>
        <FadeSlideIn>
          <Text style={[typeScale.title, { color: color.textPrimary }]}>
            {formatYearMonth({ year: CURRENT_YEAR, month: CURRENT_MONTH })}
          </Text>
          <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[1] }]}>
            {property?.nickname}
          </Text>
        </FadeSlideIn>

        <FadeSlideIn delay={60}>
          <Card style={{ marginTop: spacing[5] }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <Text style={[typeScale.heading, { color: color.textPrimary }]}>Completion</Text>
              <Text style={[typeScale.title, { color: color.accent }]}>{completionPercent}%</Text>
            </View>
            <View style={{ marginTop: spacing[3] }}>
              <AnimatedProgressBar progress={completionPercent / 100} />
            </View>
          </Card>
        </FadeSlideIn>

        <View style={{ marginTop: spacing[6], gap: spacing[3] }}>
          {rows.map((row, i) => {
            const s = statusFor(row);
            const tone = color[s.toneKey];
            return (
              <FadeSlideIn key={row.categorySlug} delay={100 + i * 50}>
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Text style={{ color: tone, fontSize: 18, width: 28 }}>{s.glyph}</Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[typeScale.body, { color: color.textPrimary, fontWeight: '600' }]}
                        >
                          {row.label}
                        </Text>
                        {row.bill?.amountDue ? (
                          <Text style={[typeScale.micro, { color: color.textMuted, marginTop: 2 }]}>
                            R{row.bill.amountDue.toFixed(2)}
                          </Text>
                        ) : !row.isExpected ? (
                          <Text style={[typeScale.micro, { color: color.textMuted, marginTop: 2 }]}>
                            Not expected this month
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <Text style={[typeScale.caption, { color: tone, fontWeight: '700' }]}>
                      {s.label}
                    </Text>
                  </View>
                </Card>
              </FadeSlideIn>
            );
          })}
        </View>

        <View style={{ marginTop: spacing[7] }}>
          <PrimaryButton
            label="Upload missing document"
            onPress={() => router.push(`/(app)/properties/${id}/upload`)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
