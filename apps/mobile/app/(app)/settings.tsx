import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ActionCard, ToggleRow } from '@/features/portfolio/PortfolioPrimitives';
import { Card, Chip, ProplystLogo, Screen, ScreenHeader, SectionHeader, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { useAppStore, type ColorSchemeOverride } from '@/state/useAppStore';

export default function Settings() {
  const { color, spacing, typeScale } = useTheme();
  const { session, signOut } = useAuth();
  const { biometricEnabled, biometricLabel, enableBiometricLock, setBiometricEnabled } = useBiometricLock();
  const colorSchemeOverride = useAppStore((state) => state.colorSchemeOverride);
  const setColorSchemeOverride = useAppStore((state) => state.setColorSchemeOverride);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const capabilities = session!.user.capabilities;

  const row = (
    title: string,
    description: string,
    icon: Parameters<typeof ActionCard>[0]['icon'],
    route?: string,
    badge?: string,
  ) => <View key={title} style={{ marginBottom: spacing[3] }}><ActionCard title={title} description={description} icon={icon} route={route} badge={badge} /></View>;

  const toggleBiometrics = async (enabled: boolean) => {
    setBiometricError(null);
    if (!enabled) {
      setBiometricEnabled(false);
      return;
    }
    const result = await enableBiometricLock();
    if (!result.success) setBiometricError(result.message ?? `${biometricLabel} could not be enabled.`);
  };

  const confirmSignOut = () => Alert.alert(
    'Sign out?',
    'You will need to sign in again.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/(auth)/welcome'); } },
    ],
  );

  return (
    <Screen>
      <ScreenHeader title="Settings" back />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: spacing[5], paddingBottom: spacing[8] }}>
        <View style={{ alignItems: 'center', marginBottom: spacing[4] }}>
          <ProplystLogo width={142} />
          <Text style={[typeScale.body, { color: color.textPrimary, fontWeight: '700', marginTop: spacing[3] }]}>{session?.user.displayName}</Text>
          <Text style={[typeScale.caption, { color: color.textSecondary }]}>{session?.user.email}</Text>
          <View style={{ marginTop: spacing[2] }}><StatusPill label={capabilities.identity} tone="info" /></View>
        </View>

        <SectionHeader title="Account" />
        {row('Profile', 'Name, country and mobile number', 'tenant', undefined, 'Backend pending')}
        {row('Security & MFA', 'Password and verification factors', 'security', '/(auth)/mfa-setup')}
        {row('Notifications', 'Delivery channels and alert types', 'notification', '/(app)/notifications/preferences')}
        <Card><ToggleRow label={`${biometricLabel} app lock`} description="Protect the local signed-in session" value={biometricEnabled} onChange={(enabled) => void toggleBiometrics(enabled)} /></Card>
        {biometricError ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginTop: spacing[2] }]}>{biometricError}</Text> : null}

        <SectionHeader title="Organisation" />
        {row('Organisation', session?.user.organizationName ?? 'No organisation', 'organization', undefined, capabilities.canManageOrganization ? 'Manager' : 'View only')}
        {capabilities.canInviteStaff ? row('Staff & roles', 'Invites and role assignments', 'staff', undefined, 'Backend pending') : null}
        {capabilities.canManageBilling ? row('Billing', 'Plan and payment method', 'money', undefined, 'Web managed') : null}
        {row('Linked accounts', 'Connections and providers', 'owner', undefined, 'Backend pending')}

        <SectionHeader title="App" />
        <Card>
          <Text style={[typeScale.body, { color: color.textPrimary, fontWeight: '600' }]}>Appearance</Text>
          <Text style={[typeScale.caption, { color: color.textSecondary, marginTop: spacing[1], marginBottom: spacing[3] }]}>Use the iPhone or Android system appearance, or choose a theme for Proplyst.</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
            {(['system', 'light', 'dark'] as ColorSchemeOverride[]).map((scheme) => (
              <Chip key={scheme} label={scheme.charAt(0).toUpperCase() + scheme.slice(1)} selected={colorSchemeOverride === scheme} onPress={() => setColorSchemeOverride(scheme)} />
            ))}
          </View>
        </Card>
        <View style={{ height: spacing[3] }} />
        {row('About Proplyst', 'Version 0.1.0 · shared mobile preview', 'settings')}
        {row('Privacy Policy', 'How Proplyst handles information', 'document', undefined, 'Link pending')}
        {row('Terms of Service', 'Terms for using Proplyst', 'document', undefined, 'Link pending')}

        <SectionHeader title="Session" />
        <ActionCard title="Sign out" description="Remove this session from this device" icon="security" onPress={confirmSignOut} />
      </ScrollView>
    </Screen>
  );
}
