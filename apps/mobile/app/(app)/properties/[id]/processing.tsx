import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import type { DocumentType } from '@propvault/types';
import { MockDocumentIntelligenceProvider } from '@/features/documentIntelligence/MockDocumentIntelligenceProvider';
import { useTheme } from '@/design/theme';
import { Card, FadeSlideIn, PulsingDot } from '@/design/components';

const STEPS = [
  'Reading document',
  'Extracting text',
  'Understanding document',
  'Matching property',
  'Matching payment',
] as const;

const provider = new MockDocumentIntelligenceProvider();

export default function ProcessingScreen() {
  const { id, documentId, categorySlug, documentType } = useLocalSearchParams<{
    id: string;
    documentId: string;
    categorySlug: string;
    documentType: DocumentType;
  }>();
  const { color, spacing, typeScale } = useTheme();
  const [stepIndex, setStepIndex] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    // Exercises the real MockDocumentIntelligenceProvider interface (see
    // DOCUMENT_INTELLIGENCE.md) so the timing/shape of this screen matches what production
    // extraction will actually do — the visible step list is presentational pacing on top of it.
    provider.classify({ documentId, storagePath: '', mimeType: 'application/pdf' });

    let cancelled = false;
    let i = 0;
    const advance = () => {
      if (cancelled) return;
      i += 1;
      if (i >= STEPS.length) {
        setComplete(true);
        setTimeout(() => {
          if (!cancelled) {
            router.replace({
              pathname: `/(app)/properties/${id}/review`,
              params: { documentId, categorySlug, documentType },
            });
          }
        }, 650);
        return;
      }
      setStepIndex(i);
      setTimeout(advance, 700 + Math.random() * 300);
    };
    const first = setTimeout(advance, 700);
    return () => {
      cancelled = true;
      clearTimeout(first);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface, justifyContent: 'center' }}>
      <View style={{ padding: spacing[6] }}>
        <FadeSlideIn>
          <View style={{ alignItems: 'center', marginBottom: spacing[6] }}>
            <PulsingDot size={14} />
            <Text
              style={[
                typeScale.title,
                { color: color.textPrimary, marginTop: spacing[4], textAlign: 'center' },
              ]}
            >
              AI is analysing your document…
            </Text>
            <Text
              style={[
                typeScale.caption,
                { color: color.textMuted, marginTop: spacing[1], textAlign: 'center' },
              ]}
            >
              This usually takes a few seconds.
            </Text>
          </View>
        </FadeSlideIn>

        <Card>
          {STEPS.map((label, i) => {
            const done = i < stepIndex || complete;
            const active = i === stepIndex && !complete;
            return (
              <View
                key={label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: spacing[3],
                  borderBottomWidth: i === STEPS.length - 1 ? 0 : 1,
                  borderBottomColor: color.border,
                }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    marginRight: spacing[3],
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: done
                      ? color.statusPaid
                      : active
                        ? `${color.accent}22`
                        : 'transparent',
                    borderWidth: done ? 0 : 1,
                    borderColor: color.border,
                  }}
                >
                  {done ? (
                    <Text style={{ color: color.accentContrast, fontSize: 12, fontWeight: '700' }}>
                      ✓
                    </Text>
                  ) : active ? (
                    <PulsingDot size={6} />
                  ) : null}
                </View>
                <Text
                  style={[
                    typeScale.body,
                    {
                      color: done
                        ? color.textPrimary
                        : active
                          ? color.textPrimary
                          : color.textMuted,
                      fontWeight: active ? '600' : '400',
                    },
                  ]}
                >
                  {label}
                </Text>
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing[3] }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                marginRight: spacing[3],
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: complete ? color.statusPaid : 'transparent',
                borderWidth: complete ? 0 : 1,
                borderColor: color.border,
              }}
            >
              {complete ? (
                <Text style={{ color: color.accentContrast, fontSize: 12, fontWeight: '700' }}>
                  ✓
                </Text>
              ) : null}
            </View>
            <Text
              style={[
                typeScale.body,
                {
                  color: complete ? color.statusPaid : color.textMuted,
                  fontWeight: complete ? '700' : '400',
                },
              ]}
            >
              Complete
            </Text>
          </View>
        </Card>
      </View>
    </SafeAreaView>
  );
}
