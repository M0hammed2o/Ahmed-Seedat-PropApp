import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { AnimatedProgressBar } from './AnimatedProgressBar';
import { SuccessCheck } from './SuccessCheck';
import { PrimaryButton } from './PrimaryButton';

export type UploadStatus = 'uploading' | 'success' | 'error';

export interface UploadProgressProps {
  fileName: string;
  progress: number; // 0-1
  status: UploadStatus;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function UploadProgress({
  fileName,
  progress,
  status,
  onRetry,
  onCancel,
}: UploadProgressProps) {
  const { color, spacing, radii, typeScale } = useTheme();

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radii.lg,
        padding: spacing[5],
        backgroundColor: color.surfaceRaised,
        alignItems: status === 'success' ? 'center' : 'stretch',
      }}
    >
      {status === 'success' ? (
        <>
          <SuccessCheck />
          <Text style={[typeScale.heading, { color: color.textPrimary, marginTop: spacing[3] }]}>
            Upload complete
          </Text>
          <Text
            style={[typeScale.caption, { color: color.textMuted, marginTop: spacing[1] }]}
            numberOfLines={1}
          >
            {fileName}
          </Text>
        </>
      ) : (
        <>
          <Text style={[typeScale.body, { color: color.textPrimary }]} numberOfLines={1}>
            {fileName}
          </Text>
          <View style={{ marginTop: spacing[3] }}>
            <AnimatedProgressBar
              progress={progress}
              colorToken={status === 'error' ? 'statusOverdue' : 'accent'}
            />
          </View>
          <Text
            style={[
              typeScale.micro,
              { color: status === 'error' ? color.danger : color.textMuted, marginTop: spacing[2] },
            ]}
          >
            {status === 'error'
              ? 'Upload failed — check your connection and try again.'
              : `${Math.round(progress * 100)}% uploaded`}
          </Text>
          {status === 'error' ? (
            <View style={{ flexDirection: 'row', gap: spacing[3], marginTop: spacing[3] }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Retry" onPress={() => onRetry?.()} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Cancel" variant="secondary" onPress={() => onCancel?.()} />
              </View>
            </View>
          ) : (
            <Text
              onPress={onCancel}
              style={[typeScale.caption, { color: color.textSecondary, marginTop: spacing[3] }]}
            >
              Cancel
            </Text>
          )}
        </>
      )}
    </View>
  );
}
