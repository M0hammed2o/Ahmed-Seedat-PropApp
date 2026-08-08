import { Platform } from 'react-native';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: Platform.OS === 'ios' ? 'slide_from_right' : 'default', gestureEnabled: true, fullScreenGestureEnabled: Platform.OS === 'ios' }} />;
}
