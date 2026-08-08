import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

export default function Index() {
  const { session, isLoading } = useAuth();
  const { color } = useTheme();

  if (isLoading) {
    return <View accessibilityLabel="Loading Proplyst" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface }}><ActivityIndicator color={color.accent} /></View>;
  }
  if (!session) return <Redirect href="/(auth)/welcome" />;
  if (!session.user.profileComplete) return <Redirect href={'/(onboarding)/complete-account' as never} />;
  if (!session.user.organizationId && session.user.capabilities.identity === 'manager') return <Redirect href={'/(onboarding)/organization' as never} />;
  return <Redirect href="/(app)/dashboard" />;
}
