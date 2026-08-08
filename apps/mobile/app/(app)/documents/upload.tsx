import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ActionCard } from '@/features/portfolio/PortfolioPrimitives';
import { KeyboardScreen, PrimaryButton, ScreenHeader, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';
import { ensureDeviceMediaPermission } from '@/features/deviceMediaPermissions';
import { usePortfolioActions } from '@/features/portfolio/usePortfolioData';

export default function UploadDocument() {
  const { beginDocumentUpload } = usePortfolioActions();
  const { color, spacing, typeScale } = useTheme();
  const [asset, setAsset] = useState<{ name: string; mimeType: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] });
      const picked = result.assets?.[0];
      if (!result.canceled && picked) setAsset({ name: picked.name, mimeType: picked.mimeType ?? 'application/octet-stream' });
    } catch {
      setError('The document picker could not be opened. Try again.');
    }
  };

  const openCamera = async () => {
    setError(null);
    if (!(await ensureDeviceMediaPermission('camera'))) {
      setError('Camera access is off. You can enable it in device settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    const picked = result.assets?.[0];
    if (!result.canceled && picked) {
      setAsset({ name: `Camera capture ${new Date().toLocaleDateString('en-ZA')}.jpg`, mimeType: picked.mimeType ?? 'image/jpeg' });
    }
  };

  const upload = async () => {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const document = await beginDocumentUpload({ ...asset, linkedEntity: 'Choose link during extraction review' });
      router.replace(`/(app)/documents/${document.id}` as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardScreen>
      <ScreenHeader title="Upload document" subtitle="PDF or image" back />
      <ActionCard title="Take a photo" description="Use this device’s camera" icon="camera" onPress={openCamera} />
      <View style={{ height: spacing[3] }} />
      <ActionCard title="Choose a file" description="PDF, JPG or PNG" icon="upload" onPress={chooseFile} />
      {asset ? <View style={{ marginVertical: spacing[5] }}><StatusPill label="Ready to upload" tone="success" /><Text style={[typeScale.body, { color: color.textPrimary, marginTop: spacing[2] }]}>{asset.name}</Text></View> : <View style={{ height: spacing[5] }} />}
      {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{error}</Text> : null}
      <PrimaryButton label="Upload and process" disabled={!asset} loading={busy} onPress={upload} />
      <Text style={[typeScale.micro, { color: color.textMuted, marginTop: spacing[3] }]}>OCR and file persistence are mocked. The integration contract documents the required upload and processing states.</Text>
    </KeyboardScreen>
  );
}
