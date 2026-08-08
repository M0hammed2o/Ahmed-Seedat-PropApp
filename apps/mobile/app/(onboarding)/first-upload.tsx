import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '@/design/theme';
import { EmptyState, PrimaryButton } from '@/design/components';

/**
 * Phase 1: guides the user to the dashboard rather than performing a real upload here — the
 * full tactile upload experience (progress/retry/cancel) is a Phase 2 item (TODO.md); the
 * document-metadata schema and storage path convention are already defined (SECURITY.md,
 * DATABASE.md) so this screen becomes "real" without restructuring anything.
 */
export default function FirstUploadScreen() {
  const { color, spacing, typeScale } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minHeight: 300 }}>
        <Text
          style={[
            typeScale.title,
            { color: color.textPrimary, padding: spacing[6], paddingBottom: 0 },
          ]}
        >
          Upload your first bill
        </Text>
        <EmptyState
          title="Ready when you are"
          description="You can upload a bill, statement or proof of payment for this property any time from its detail screen."
        />
      </View>
      <View style={{ padding: spacing[6] }}>
        <PrimaryButton label="Go to dashboard" onPress={() => router.replace('/(app)/dashboard')} />
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}
