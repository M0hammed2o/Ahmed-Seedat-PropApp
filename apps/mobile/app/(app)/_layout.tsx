import React from 'react';
import { Platform, type ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { AppIcon, BiometricLockScreen, type AppIconName } from '@/design/components';
import { useTheme } from '@/design/theme';

const hiddenRoutes = [
  'search', 'settings', 'units', 'leases', 'documents', 'maintenance', 'inspections',
  'meters', 'owners', 'reports', 'notifications',
] as const;

function tabIcon(name: AppIconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => <AppIcon name={name} size={size} color={String(color)} />;
}

export default function AppLayout() {
  const { session } = useAuth();
  const { lockState, biometricLabel, attemptBiometricUnlock, completeFullAuth } = useBiometricLock();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  if (!session) return <Redirect href="/(auth)/welcome" />;
  if (lockState.phase === 'locked') return <BiometricLockScreen biometricLabel={biometricLabel} isFullAuthRequired={lockState.requiresFullAuth} onUnlockPress={() => attemptBiometricUnlock()} onUseFullAuthPress={completeFullAuth} />;
  return <Tabs screenOptions={{ headerShown: false, animation: Platform.OS === 'ios' ? 'shift' : 'none', tabBarActiveTintColor: color.accent, tabBarInactiveTintColor: color.textMuted, tabBarHideOnKeyboard: true, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, tabBarItemStyle: { paddingTop: 4, paddingBottom: Math.max(insets.bottom, 6) }, tabBarStyle: { backgroundColor: color.surfaceRaised, borderTopColor: color.border, height: 58 + insets.bottom, paddingBottom: 0 } }}>
    <Tabs.Screen name="dashboard" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
    <Tabs.Screen name="properties" options={{ title: 'Properties', tabBarIcon: tabIcon('property') }} />
    <Tabs.Screen name="tenants" options={{ title: 'Tenants', tabBarIcon: tabIcon('tenant') }} />
    <Tabs.Screen name="accounting" options={{ title: 'Accounting', tabBarIcon: tabIcon('money') }} />
    <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more') }} />
    {hiddenRoutes.map((name) => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
  </Tabs>;
}
