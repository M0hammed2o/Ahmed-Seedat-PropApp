import React from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';

/** Native stack shell shared by feature folders so iOS edge-swipe and Android Back both work. */
export function MobileEntityStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: Platform.OS === 'ios' ? 'slide_from_right' : 'default',
        gestureEnabled: true,
        fullScreenGestureEnabled: Platform.OS === 'ios',
      }}
    />
  );
}
