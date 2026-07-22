import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePropertiesQuery } from '@/features/properties/usePropertiesQuery';
import { useDashboardStats } from '@/demo/demoSelectors';
import { DEMO_MODE } from '@/lib/supabase';
import { useTheme } from '@/design/theme';
import {
  AnimatedProgressBar,
  Card,
  DemoBadge,
  EmptyState,
  ErrorState,
  FadeSlideIn,
  PropertyCard,
  SkeletonState,
  StatCard,
} from '@/design/components';

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { session } = useAuth();
  const propertiesQuery = usePropertiesQuery('active');
  const stats = useDashboardStats();

  const firstName =
    session?.user.user_metadata?.display_name?.split(' ')[0] ??
    session?.user.email?.split('@')[0] ??
    'there';
  const greeting = greetingForHour(new Date().getHours());

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing[6], paddingBottom: spacing[8] }}>
        <FadeSlideIn>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <View>
              <Text style={[typeScale.title, { color: color.textPrimary }]}>
                {greeting}, {firstName}
              </Text>
              <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[1] }]}>
                Here's what's happening across your properties.
              </Text>
            </View>
            {DEMO_MODE ? <DemoBadge /> : null}
          </View>
        </FadeSlideIn>

        {propertiesQuery.isLoading ? <SkeletonState rows={3} /> : null}
        {propertiesQuery.isError ? (
          <ErrorState onRetry={() => propertiesQuery.refetch?.()} />
        ) : null}

        {!propertiesQuery.isLoading && !propertiesQuery.isError ? (
          <>
            <FadeSlideIn delay={60}>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing[3],
                  marginTop: spacing[6],
                }}
              >
                <StatCard label="Properties" value={stats.propertyCount} />
                <StatCard
                  label="Due soon"
                  value={stats.billsDueSoon}
                  tone={stats.billsDueSoon > 0 ? 'warning' : 'neutral'}
                />
                <StatCard
                  label="Overdue"
                  value={stats.billsOverdue}
                  tone={stats.billsOverdue > 0 ? 'danger' : 'neutral'}
                />
                <StatCard
                  label="Needs review"
                  value={stats.documentsAwaitingReview}
                  tone={stats.documentsAwaitingReview > 0 ? 'warning' : 'neutral'}
                />
              </View>
            </FadeSlideIn>

            <FadeSlideIn delay={120}>
              <Card style={{ marginTop: spacing[5] }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <Text style={[typeScale.heading, { color: color.textPrimary }]}>
                    July completion
                  </Text>
                  <Text style={[typeScale.heading, { color: color.accent }]}>
                    {stats.monthlyCompletionPercent}%
                  </Text>
                </View>
                <View style={{ marginTop: spacing[3] }}>
                  <AnimatedProgressBar progress={stats.monthlyCompletionPercent / 100} />
                </View>
                <Text
                  style={[typeScale.caption, { color: color.textMuted, marginTop: spacing[2] }]}
                >
                  {stats.missingDocuments === 0
                    ? 'All expected documents are in for this month.'
                    : `${stats.missingDocuments} expected document${stats.missingDocuments === 1 ? '' : 's'} still missing this month.`}
                </Text>
              </Card>
            </FadeSlideIn>

            <FadeSlideIn delay={160}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: spacing[7],
                }}
              >
                <Text style={[typeScale.heading, { color: color.textPrimary }]}>Properties</Text>
                <Text
                  onPress={() => router.push('/(app)/properties')}
                  style={[typeScale.caption, { color: color.accent }]}
                >
                  View all
                </Text>
              </View>
            </FadeSlideIn>

            {propertiesQuery.data && propertiesQuery.data.length === 0 ? (
              <EmptyState
                title="No properties yet"
                description="Add your first property to start tracking bills and documents."
              />
            ) : null}

            <View style={{ gap: spacing[3], marginTop: spacing[3] }}>
              {propertiesQuery.data?.slice(0, 4).map((property, i) => (
                <FadeSlideIn key={property.id} delay={200 + i * 60}>
                  <PropertyCard
                    property={property}
                    onPress={(id) => router.push(`/(app)/properties/${id}`)}
                  />
                </FadeSlideIn>
              ))}
            </View>

            {stats.recentUploads.length > 0 ? (
              <FadeSlideIn delay={280}>
                <Text
                  style={[
                    typeScale.heading,
                    { color: color.textPrimary, marginTop: spacing[7], marginBottom: spacing[3] },
                  ]}
                >
                  Recent uploads
                </Text>
                <Card>
                  {stats.recentUploads.map((doc, i) => (
                    <View
                      key={doc.id}
                      style={{
                        paddingVertical: spacing[2],
                        borderBottomWidth: i === stats.recentUploads.length - 1 ? 0 : 1,
                        borderBottomColor: color.border,
                      }}
                    >
                      <Text
                        style={[typeScale.body, { color: color.textPrimary }]}
                        numberOfLines={1}
                      >
                        {doc.originalFileName}
                      </Text>
                      <Text style={[typeScale.micro, { color: color.textMuted, marginTop: 2 }]}>
                        {new Date(doc.createdAt).toLocaleDateString('en-ZA', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </Text>
                    </View>
                  ))}
                </Card>
              </FadeSlideIn>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
