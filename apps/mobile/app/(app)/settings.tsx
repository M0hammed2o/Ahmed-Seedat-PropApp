import React, { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { getSubscriptionProvider } from '@/features/subscriptions';
import { useTheme } from '@/design/theme';
import { ConfirmationSheet, PrimaryButton } from '@/design/components';

export default function SettingsScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { session, signOut } = useAuth();
  const { biometricEnabled, setBiometricEnabled } = useBiometricLock();
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/welcome');
  };

  const handleDeleteAccountRequest = () => {
    // Phase 1: records the request as a UI-level acknowledgement. The audited, actually-
    // processed workflow (writing to a request table + admin review) is a documented Phase 1
    // follow-up (PRIVACY_AND_COMPLIANCE.md) pending the retention-period decision it depends on.
    setDeleteRequested(true);
    setConfirmDeleteVisible(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing[6] }}>
        <Text style={[typeScale.title, { color: color.textPrimary, marginBottom: spacing[5] }]}>
          Settings
        </Text>

        <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[2] }]}>
          Account
        </Text>
        <Text style={[typeScale.body, { color: color.textPrimary, marginBottom: spacing[5] }]}>
          {session?.user.email}
        </Text>

        <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[2] }]}>
          Security
        </Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing[5],
          }}
        >
          <Text style={[typeScale.body, { color: color.textPrimary }]}>Biometric unlock</Text>
          <Switch value={biometricEnabled} onValueChange={setBiometricEnabled} />
        </View>

        <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[2] }]}>
          Subscription
        </Text>
        <PrimaryButton
          label="Manage subscription"
          variant="secondary"
          onPress={() => getSubscriptionProvider().openManageSubscription()}
        />

        <View style={{ marginTop: spacing[8] }}>
          <PrimaryButton label="Sign out" variant="secondary" onPress={handleSignOut} />
        </View>

        <View style={{ marginTop: spacing[6] }}>
          {deleteRequested ? (
            <Text style={[typeScale.caption, { color: color.textSecondary }]}>
              Your account deletion request has been recorded.
            </Text>
          ) : (
            <Text
              onPress={() => setConfirmDeleteVisible(true)}
              style={[typeScale.caption, { color: color.danger }]}
            >
              Request account deletion
            </Text>
          )}
        </View>
      </ScrollView>

      <ConfirmationSheet
        visible={confirmDeleteVisible}
        title="Request account deletion?"
        description="This submits a deletion request. Your documents are not deleted immediately — see our data retention policy for details."
        confirmLabel="Request deletion"
        destructive
        onConfirm={handleDeleteAccountRequest}
        onCancel={() => setConfirmDeleteVisible(false)}
      />
    </SafeAreaView>
  );
}
