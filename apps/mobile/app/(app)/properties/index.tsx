import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { usePropertiesQuery } from '@/features/properties/usePropertiesQuery';
import { useTheme } from '@/design/theme';
import {
  EmptyState,
  ErrorState,
  PrimaryButton,
  PropertyCard,
  SkeletonState,
} from '@/design/components';

export default function PropertiesListScreen() {
  const { color, spacing, typeScale } = useTheme();
  const propertiesQuery = usePropertiesQuery('active');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: spacing[6],
          paddingBottom: 0,
        }}
      >
        <Text style={[typeScale.title, { color: color.textPrimary }]}>Properties</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing[6] }}>
        {propertiesQuery.isLoading ? <SkeletonState rows={4} /> : null}
        {propertiesQuery.isError ? <ErrorState onRetry={() => propertiesQuery.refetch()} /> : null}
        {propertiesQuery.data && propertiesQuery.data.length === 0 ? (
          <EmptyState
            title="No properties yet"
            description="Add your first property to get started."
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
      <View style={{ padding: spacing[6] }}>
        <PrimaryButton label="Add property" onPress={() => router.push('/(app)/properties/add')} />
      </View>
    </SafeAreaView>
  );
}
