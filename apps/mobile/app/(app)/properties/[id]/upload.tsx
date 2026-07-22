import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { DocumentType } from '@propvault/types';
import { DEMO_CATEGORIES } from '@/demo/mockData';
import { useDemoStore } from '@/demo/demoStore';
import { useTheme } from '@/design/theme';
import {
  Chip,
  EmptyState,
  FadeSlideIn,
  PrimaryButton,
  UploadProgress,
  type UploadStatus,
} from '@/design/components';

const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'bill', label: 'Bill / Statement' },
  { value: 'proof_of_payment', label: 'Proof of Payment' },
];

const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 7;

interface PickedFile {
  name: string;
  mimeType: string;
  size: number;
}

export default function UploadDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { color, spacing, typeScale } = useTheme();
  const addDocument = useDemoStore((s) => s.addDocument);

  const [categorySlug, setCategorySlug] = useState('water');
  const [documentType, setDocumentType] = useState<DocumentType>('bill');
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [progress, setProgress] = useState(0);

  const simulateUpload = (file: PickedFile) => {
    setPicked(file);
    setStatus('uploading');
    setProgress(0);
    let p = 0;
    const interval = setInterval(() => {
      p += 0.08 + Math.random() * 0.12;
      if (p >= 1) {
        p = 1;
        clearInterval(interval);
        setStatus('success');
      }
      setProgress(p);
    }, 180);
  };

  const pickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      simulateUpload({
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/pdf',
        size: asset.size ?? 210_000,
      });
    } catch {
      // Picker unavailable in this environment (e.g. web without file access) — fall back to a
      // representative demo file so the upload experience can still be shown end-to-end.
      simulateUpload({
        name: `${categorySlug}-statement.pdf`,
        mimeType: 'application/pdf',
        size: 214_000,
      });
    }
  };

  const pickImage = async (source: 'library' | 'camera') => {
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('permission denied');
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      simulateUpload({
        name: asset.fileName ?? `${categorySlug}-photo.jpg`,
        mimeType: 'image/jpeg',
        size: asset.fileSize ?? 1_400_000,
      });
    } catch {
      simulateUpload({
        name: `${categorySlug}-photo.jpg`,
        mimeType: 'image/jpeg',
        size: 1_400_000,
      });
    }
  };

  const handleContinue = () => {
    const doc = addDocument({
      propertyId: id,
      categorySlug,
      documentType,
      fileName: picked?.name ?? 'document.pdf',
      mimeType: picked?.mimeType ?? 'application/pdf',
      fileSizeBytes: picked?.size ?? 200_000,
      billingYear: CURRENT_YEAR,
      billingMonth: CURRENT_MONTH,
    });
    router.replace({
      pathname: `/(app)/properties/${id}/processing`,
      params: { documentId: doc.id, categorySlug, documentType },
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <FadeSlideIn>
          <Text style={[typeScale.title, { color: color.textPrimary }]}>Upload a document</Text>
          <Text
            style={[
              typeScale.body,
              { color: color.textSecondary, marginTop: spacing[1], marginBottom: spacing[5] },
            ]}
          >
            Add a bill, statement or proof of payment — PropVault will read and organise it
            automatically.
          </Text>
        </FadeSlideIn>

        <FadeSlideIn delay={60}>
          <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[2] }]}>
            Category
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing[2],
              marginBottom: spacing[5],
            }}
          >
            {DEMO_CATEGORIES.map((c) => (
              <Chip
                key={c.slug}
                label={c.label}
                selected={categorySlug === c.slug}
                onPress={() => setCategorySlug(c.slug)}
              />
            ))}
          </View>

          <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[2] }]}>
            Document type
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing[2],
              marginBottom: spacing[6],
            }}
          >
            {DOCUMENT_TYPE_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={documentType === opt.value}
                onPress={() => setDocumentType(opt.value)}
              />
            ))}
          </View>
        </FadeSlideIn>

        {!picked ? (
          <FadeSlideIn delay={100}>
            <EmptyState
              title="Add your file"
              description="Take a photo, choose an image, or select a PDF from your device."
            />
            <View style={{ gap: spacing[3], marginTop: spacing[2] }}>
              <PrimaryButton label="Take photo" onPress={() => pickImage('camera')} />
              <PrimaryButton
                label="Choose photo"
                variant="secondary"
                onPress={() => pickImage('library')}
              />
              <PrimaryButton label="Choose PDF" variant="secondary" onPress={pickPdf} />
            </View>
          </FadeSlideIn>
        ) : (
          <FadeSlideIn>
            <UploadProgress
              fileName={picked.name}
              progress={progress}
              status={status ?? 'uploading'}
              onRetry={() => simulateUpload(picked)}
              onCancel={() => {
                setPicked(null);
                setStatus(null);
                setProgress(0);
              }}
            />
            {status === 'success' ? (
              <View style={{ marginTop: spacing[5] }}>
                <PrimaryButton label="Continue" onPress={handleContinue} />
              </View>
            ) : null}
          </FadeSlideIn>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
