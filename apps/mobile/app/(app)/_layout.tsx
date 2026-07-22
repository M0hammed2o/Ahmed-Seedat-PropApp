import React from 'react';
import { Tabs } from 'expo-router';
import { Redirect } from 'expo-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { BiometricLockScreen } from '@/design/components';
import { useTheme } from '@/design/theme';

export default function AppLayout() {
  const { session } = useAuth();
  const { lockState, attemptBiometricUnlock, completeFullAuth } = useBiometricLock();
  const { color } = useTheme();

  if (!session) {
    return <Redirect href="/(auth)/welcome" />;
  }

  if (lockState.phase === 'locked') {
    return (
      <BiometricLockScreen
        isFullAuthRequired={lockState.requiresFullAuth}
        onUnlockPress={() => attemptBiometricUnlock()}
        onUseFullAuthPress={completeFullAuth}
      />
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: { backgroundColor: color.surfaceRaised, borderTopColor: color.border },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="properties/index" options={{ title: 'Properties' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      <Tabs.Screen name="properties/add" options={{ href: null }} />
      <Tabs.Screen name="properties/[id]/index" options={{ href: null }} />
      <Tabs.Screen name="properties/[id]/upload" options={{ href: null }} />
      <Tabs.Screen name="properties/[id]/processing" options={{ href: null }} />
      <Tabs.Screen name="properties/[id]/review" options={{ href: null }} />
      <Tabs.Screen name="properties/[id]/match" options={{ href: null }} />
      <Tabs.Screen name="properties/[id]/checklist" options={{ href: null }} />
    </Tabs>
  );
}
