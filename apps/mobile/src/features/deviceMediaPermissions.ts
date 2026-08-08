import { Alert, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export type DeviceMediaSource = 'camera' | 'photos';

export function deviceMediaPermissionCopy(source: DeviceMediaSource) {
  const deviceLabel = Platform.OS === 'ios' ? 'iPhone Settings' : 'device settings';
  if (source === 'camera') {
    return {
      title: 'Camera access needed',
      message: `Allow camera access in ${deviceLabel} to capture property photos and documents.`,
    };
  }
  return {
    title: 'Photo access needed',
    message: `Allow photo-library access in ${deviceLabel} to choose property and document images.`,
  };
}

export async function ensureDeviceMediaPermission(source: DeviceMediaSource): Promise<boolean> {
  const getPermission = source === 'camera'
    ? ImagePicker.getCameraPermissionsAsync
    : ImagePicker.getMediaLibraryPermissionsAsync;
  const requestPermission = source === 'camera'
    ? ImagePicker.requestCameraPermissionsAsync
    : ImagePicker.requestMediaLibraryPermissionsAsync;

  const existing = await getPermission();
  const permission = existing.granted ? existing : await requestPermission();
  if (permission.granted) return true;

  const copy = deviceMediaPermissionCopy(source);
  Alert.alert(copy.title, copy.message, [
    { text: 'Not now', style: 'cancel' },
    ...(permission.canAskAgain
      ? []
      : [{ text: 'Open Settings', onPress: () => void Linking.openSettings() }]),
  ]);
  return false;
}
