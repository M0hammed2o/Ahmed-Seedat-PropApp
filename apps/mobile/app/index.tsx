import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

/**
 * Entry redirect: unauthenticated → onboarding welcome; authenticated → the main app.
 * Onboarding-resume logic (which step to land on) lives in the (onboarding) layout itself,
 * not here, so this stays a single, simple routing decision.
 */
export default function Index() {
  const { session, isLoading } = useAuth();
  const { color } = useTheme();

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
