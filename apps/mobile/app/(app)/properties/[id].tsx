import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import {
  usePropertyQuery,
  useArchivePropertyMutation,
} from '@/features/properties/usePropertiesQuery';
import { useTheme } from '@/design/theme';
import { ConfirmationSheet, ErrorState, PrimaryButton, SkeletonState } from '@/design/components';

/**
 * Property detail + monthly checklist entry point. The checklist itself (per-category
 * paid/unpaid/overdue/missing) reads `calculate_monthly_checklist` (DATABASE.md) — its full UI
 * is a Phase 2 item once real documents/bills exist to populate it (TODO.md); this screen
 * establishes the navigation destination and archive action now.
 */
export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { color, spacing, typeScale } = useTheme();
  const propertyQuery = usePropertyQuery(id);
  const archiveMutation = useArchivePropertyMutation();
  const [confirmArchiveVisible, setConfirmArchiveVisible] = useState(false);

  if (propertyQuery.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
        <SkeletonState rows={4} />
      </SafeAreaView>
    );
  }

  if (propertyQuery.isError || !propertyQuery.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
        <ErrorState onRetry={() => propertyQuery.refetch()} />
      </SafeAreaView>
    );
  }

  const property = propertyQuery.data;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing[6] }}>
        <Text style={[typeScale.title, { color: color.textPrimary }]}>{property.nickname}</Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[1] }]}>
          {property.fullAddress}
        </Text>

        <View style={{ marginTop: spacing[6] }}>
          <Text style={[typeScale.heading, { color: color.textPrimary }]}>
            This month's checklist
          </Text>
          <Text style={[typeScale.caption, { color: color.textMuted, marginTop: spacing[2] }]}>
            Upload a bill for this property to see it appear here.
          </Text>
        </View>
      </ScrollView>

      <View style={{ padding: spacing[6] }}>
        <PrimaryButton
          label="Archive property"
          variant="secondary"
          onPress={() => setConfirmArchiveVisible(true)}
        />
      </View>

      <ConfirmationSheet
        visible={confirmArchiveVisible}
        title="Archive this property?"
        description="Archived properties are hidden from your active list but nothing is deleted — you can restore them any time."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => {
          await archiveMutation.mutateAsync(property.id);
          setConfirmArchiveVisible(false);
          router.back();
        }}
        onCancel={() => setConfirmArchiveVisible(false)}
      />
    </SafeAreaView>
  );
}
