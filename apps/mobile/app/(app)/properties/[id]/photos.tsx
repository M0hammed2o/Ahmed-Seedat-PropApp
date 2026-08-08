import React, { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { AppIcon, Card, PrimaryButton, Screen, ScreenHeader, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';
import { ensureDeviceMediaPermission, type DeviceMediaSource } from '@/features/deviceMediaPermissions';

export default function PropertyPhotosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { color, radii, spacing, typeScale } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const pick = async (source: DeviceMediaSource) => {
    setMessage(null);
    setIsError(false);
    if (!(await ensureDeviceMediaPermission(source))) {
      setMessage(`${source === 'camera' ? 'Camera' : 'Photo-library'} access is off. You can enable it in device settings.`);
      setIsError(true);
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const asset = result.assets?.[0];
    if (!result.canceled && asset) {
      setUri(asset.uri);
      setMessage('Photo selected locally. Upload will begin after the media backend is connected.');
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Property photos" subtitle={`Property ${id}`} back />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, padding: spacing[5], paddingBottom: spacing[8] }}>
        {uri ? (
          <Image source={{ uri }} resizeMode="cover" accessibilityLabel="Selected property photo" style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radii.panel }} />
        ) : (
          <Card style={{ minHeight: 220, backgroundColor: color.surfaceStrong, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: radii.panel, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="camera" size={30} color={color.accent} /></View>
            <Text accessibilityRole="header" style={[typeScale.heading, { color: color.textPrimary, marginTop: spacing[4] }]}>Add a cover photo</Text>
            <Text style={[typeScale.body, { color: color.textSecondary, textAlign: 'center', marginTop: spacing[2] }]}>Take a photo or choose one from the device.</Text>
          </Card>
        )}
        {message ? <View style={{ marginTop: spacing[3] }}><StatusPill label={message} tone={isError ? 'danger' : 'info'} /></View> : null}
        <View style={{ gap: spacing[3], marginTop: 'auto', paddingTop: spacing[6] }}>
          <PrimaryButton label="Take photo" onPress={() => pick('camera')} />
          <PrimaryButton label="Choose from photos" variant="secondary" onPress={() => pick('photos')} />
        </View>
      </ScrollView>
    </Screen>
  );
}
