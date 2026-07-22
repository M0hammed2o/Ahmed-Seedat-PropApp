import React, { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { branding } from '@propvault/config';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { getSubscriptionProvider } from '@/features/subscriptions';
import { useDemoStore } from '@/demo/demoStore';
import { DEMO_MODE } from '@/lib/supabase';
import { useAppStore, type ColorSchemeOverride } from '@/state/useAppStore';
import { useTheme } from '@/design/theme';
import {
  AnimatedProgressBar,
  Chip,
  ConfirmationSheet,
  DemoBadge,
  FadeSlideIn,
  PrimaryButton,
  SettingsRow,
  SettingsSection,
} from '@/design/components';

export default function SettingsScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { session, signOut } = useAuth();
  const { biometricEnabled, setBiometricEnabled } = useBiometricLock();
  const subscription = useDemoStore((s) => s.subscription);
  const {
    colorSchemeOverride,
    setColorSchemeOverride,
    notificationsEnabled,
    setNotificationsEnabled,
  } = useAppStore();
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/welcome');
  };

  const storagePercent = Math.round(
    (subscription.storageUsedMb / subscription.storageAllowanceMb) * 100,
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing[6] }}>
        <FadeSlideIn>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: spacing[6],
            }}
          >
            <Text style={[typeScale.title, { color: color.textPrimary }]}>Settings</Text>
            {DEMO_MODE ? <DemoBadge /> : null}
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={40}>
          <SettingsSection title="Profile">
            <SettingsRow label="Name" value={session?.user.user_metadata?.display_name ?? '—'} />
            <SettingsRow label="Email" value={session?.user.email} isLast />
          </SettingsSection>
        </FadeSlideIn>

        <FadeSlideIn delay={80}>
          <SettingsSection title="Subscription">
            <SettingsRow label="Plan" value="PropVault Base" />
            <SettingsRow
              label="Status"
              value={subscription.status === 'active' ? 'Active' : subscription.status}
            />
            <SettingsRow
              label="Renews"
              value={new Date(subscription.renewalDate).toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
              isLast
            />
          </SettingsSection>
          <View style={{ marginTop: -spacing[3], marginBottom: spacing[3] }}>
            <PrimaryButton
              label="Manage subscription"
              variant="secondary"
              onPress={() => getSubscriptionProvider().openManageSubscription()}
            />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={120}>
          <SettingsSection title="Storage">
            <View style={{ padding: spacing[4] }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginBottom: spacing[2],
                }}
              >
                <Text style={[typeScale.body, { color: color.textPrimary }]}>
                  {(subscription.storageUsedMb / 1024).toFixed(2)}GB of{' '}
                  {(subscription.storageAllowanceMb / 1024).toFixed(0)}GB used
                </Text>
                <Text style={[typeScale.body, { color: color.textMuted }]}>{storagePercent}%</Text>
              </View>
              <AnimatedProgressBar
                progress={storagePercent / 100}
                colorToken={storagePercent > 85 ? 'statusOverdue' : 'accent'}
              />
            </View>
          </SettingsSection>
        </FadeSlideIn>

        <FadeSlideIn delay={160}>
          <SettingsSection title="Security">
            <SettingsRow
              label="Biometric unlock"
              right={<Switch value={biometricEnabled} onValueChange={setBiometricEnabled} />}
              isLast
            />
          </SettingsSection>
        </FadeSlideIn>

        <FadeSlideIn delay={200}>
          <SettingsSection title="Notifications">
            <SettingsRow
              label="Push notifications"
              right={
                <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} />
              }
              isLast
            />
          </SettingsSection>
        </FadeSlideIn>

        <FadeSlideIn delay={240}>
          <Text
            style={[
              typeScale.micro,
              {
                color: color.textMuted,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                marginBottom: spacing[2],
              },
            ]}
          >
            Appearance
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[6] }}>
            {(['system', 'light', 'dark'] as ColorSchemeOverride[]).map((mode) => (
              <Chip
                key={mode}
                label={mode[0]!.toUpperCase() + mode.slice(1)}
                selected={colorSchemeOverride === mode}
                onPress={() => setColorSchemeOverride(mode)}
              />
            ))}
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={280}>
          <SettingsSection title="About">
            <SettingsRow label="Version" value="0.1.0 (Phase 2 demo)" />
            <SettingsRow
              label="Privacy Policy"
              onPress={() => {}}
              right={<Text style={{ color: color.textMuted }}>›</Text>}
            />
            <SettingsRow
              label="Terms of Service"
              onPress={() => {}}
              right={<Text style={{ color: color.textMuted }}>›</Text>}
              isLast
            />
          </SettingsSection>
        </FadeSlideIn>

        <FadeSlideIn delay={320}>
          <PrimaryButton label="Sign out" variant="secondary" onPress={handleSignOut} />
        </FadeSlideIn>

        <FadeSlideIn delay={360}>
          <View style={{ marginTop: spacing[6], alignItems: 'center' }}>
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
            <Text style={[typeScale.micro, { color: color.textMuted, marginTop: spacing[3] }]}>
              {branding.productName} © 2026
            </Text>
          </View>
        </FadeSlideIn>
      </ScrollView>

      <ConfirmationSheet
        visible={confirmDeleteVisible}
        title="Request account deletion?"
        description="This submits a deletion request. Your documents are not deleted immediately — see our data retention policy for details."
        confirmLabel="Request deletion"
        destructive
        onConfirm={() => {
          setDeleteRequested(true);
          setConfirmDeleteVisible(false);
        }}
        onCancel={() => setConfirmDeleteVisible(false)}
      />
    </SafeAreaView>
  );
}
