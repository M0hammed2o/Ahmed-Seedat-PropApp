import React from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { BiometricLockProvider } from '@/features/biometrics/BiometricLockProvider';
import { ErrorBoundary } from '@/design/components';
import { RepositoryProvider } from '@/data/RepositoryProvider';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <RepositoryProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <BiometricLockProvider>
                <StatusBar style="auto" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    animation: Platform.OS === 'ios' ? 'slide_from_right' : 'default',
                    gestureEnabled: true,
                    fullScreenGestureEnabled: Platform.OS === 'ios',
                  }}
                />
              </BiometricLockProvider>
            </AuthProvider>
          </QueryClientProvider>
        </RepositoryProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
