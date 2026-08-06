import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

/**
 * Entry redirect: unauthenticated → onboarding welcome; authenticated → the main app.
 * Onboarding-resume logic (which step to land on) lives in the (onboarding) layout itself,
 * not here, so this stays a single, simple routing decision.
 */
export default function Index() {
  const { session, isLoading, configError } = useAuth();
  const { color, spacing, typeScale } = useTheme();

  if (configError) {
    // EXPO_PUBLIC_DEMO_MODE=false but Supabase isn't actually configured — a real deployment
    // misconfiguration. Shown as a clear message instead of a crash (launch-readiness audit,
    // 2026-07-22) — the fix is an environment variable, not something the app can recover from.
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.surface,
          padding: spacing[6],
        }}
      >
        <Text style={[typeScale.heading, { color: color.textPrimary, textAlign: 'center' }]}>
          Configuration needed
        </Text>
        <Text
          style={[
            typeScale.body,
            { color: color.textSecondary, marginTop: spacing[2], textAlign: 'center' },
          ]}
        >
          PropVault isn't connected to a project. Set EXPO_PUBLIC_SUPABASE_URL and
          EXPO_PUBLIC_SUPABASE_ANON_KEY, or set EXPO_PUBLIC_DEMO_MODE=true to run on demo data.
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.surface,
        }}
      >
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/welcome" />;
  }

  return <Redirect href="/(app)/dashboard" />;
}
