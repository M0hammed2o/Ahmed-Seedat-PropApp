import React, { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AuthScaffold, PrimaryButton, StatusPill } from '@/design/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

export default function MfaChallengeScreen() {
  const { color, radii, spacing, typeScale } = useTheme();
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<TextInput>(null);

  const verify = async () => {
    setLoading(true);
    setError(null);
    const result = await verifyMfa(code);
    setLoading(false);
    if (result.status === 'authenticated') router.replace('/');
    else if (result.status === 'error') setError(result.message);
  };

  return (
    <AuthScaffold title="Verify it’s you" subtitle="Enter the 6-digit code from your authenticator app.">
      <StatusPill label="Two-step verification" tone="info" />
      <TextInput
        ref={input}
        autoFocus
        accessibilityLabel="Authentication code"
        autoComplete="one-time-code"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={6}
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
        style={[typeScale.title, { minHeight: 64, marginVertical: spacing[5], paddingHorizontal: spacing[3], letterSpacing: 12, textAlign: 'center', color: color.textPrimary, borderWidth: 1, borderColor: error ? color.danger : color.border, borderRadius: radii.lg, backgroundColor: color.surfaceRaised }]}
      />
      {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{error}</Text> : null}
      <PrimaryButton label="Verify and continue" disabled={code.length !== 6} loading={loading} onPress={() => void verify()} />
      <View style={{ marginTop: spacing[4] }}><Text style={[typeScale.micro, { color: color.textMuted, textAlign: 'center' }]}>Demo code: 123456</Text><Text onPress={() => router.replace('/(auth)/login')} accessibilityRole="link" style={[typeScale.caption, { color: color.accent, textAlign: 'center', marginTop: spacing[3], fontWeight: '700', paddingVertical: spacing[3] }]}>Cancel sign in</Text></View>
    </AuthScaffold>
  );
}
