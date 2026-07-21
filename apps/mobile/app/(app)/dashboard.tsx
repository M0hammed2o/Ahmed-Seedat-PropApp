import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePropertiesQuery } from '@/features/properties/usePropertiesQuery';
import { useTheme } from '@/design/theme';
import { EmptyState, ErrorState, PropertyCard, SkeletonState } from '@/design/components';

/**
 * Prioritises action over decorative stats (brief). Full "due soon / overdue / missing
 * documents / awaiting review" counts depend on bills/documents existing, which Phase 2's real
 * upload flow populates — Phase 1 shows the property list and a quick-add action, which is
 * everything that's true to show right now rather than fabricated placeholder numbers.
 */
export default function DashboardScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { session } = useAuth();
  const propertiesQuery = usePropertiesQuery('active');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing[6] }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>
          Welcome{session?.user.email ? `, ${session.user.email.split('@')[0]}` : ''}
        </Text>
        <Text
          style={[
            typeScale.body,
            { color: color.textSecondary, marginTop: spacing[1], marginBottom: spacing[5] },
          ]}
        >
          Here's what's happening across your properties.
        </Text>

        {propertiesQuery.isLoading ? <SkeletonState rows={3} /> : null}
        {propertiesQuery.isError ? <ErrorState onRetry={() => propertiesQuery.refetch()} /> : null}
        {propertiesQuery.data && propertiesQuery.data.length === 0 ? (
          <EmptyState
            title="No properties yet"
            description="Add your first property to start tracking bills and documents."
          />
        ) : null}

        <View style={{ gap: spacing[3] }}>
          {propertiesQuery.data?.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              onPress={(id) => router.push(`/(app)/properties/${id}`)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
