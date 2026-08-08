import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AuthScaffold, PrimaryButton, StatusPill } from '@/design/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

export default function VerifyEmailScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { pendingEmail, resendVerificationEmail } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  return <AuthScaffold title="Check your email" subtitle="We sent a confirmation link. Open it on this device, then return to Proplyst." footer={<Text onPress={() => router.replace('/(auth)/login')} style={[typeScale.caption, { color: color.accent, textAlign: 'center', fontWeight: '700' }]}>Use a different account</Text>}>
    <StatusPill label="Confirmation required" tone="warning" />
    <View style={{ marginTop: spacing[4], padding: spacing[4], borderRadius: 14, backgroundColor: color.surfaceStrong }}><Text style={[typeScale.caption, { color: color.textSecondary }]}>Sent to</Text><Text style={[typeScale.body, { color: color.textPrimary, fontWeight: '700', marginTop: 2 }]}>{pendingEmail ?? 'your email address'}</Text></View>
    <Text style={[typeScale.caption, { color: color.textMuted, marginTop: spacing[4] }]}>The link may expire. Do not forward the email. If it is invalid or already used, request a fresh one.</Text>
    {message ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.statusPaid, marginTop: spacing[3] }]}>{message}</Text> : null}
    <View style={{ marginTop: spacing[5], gap: spacing[3] }}><PrimaryButton label="I’ve confirmed my email" onPress={() => router.push('/(auth)/email-confirmed' as never)} /><PrimaryButton label="Resend confirmation" variant="secondary" loading={sending} onPress={async () => { setSending(true); const result = await resendVerificationEmail(); setSending(false); setMessage(result.status === 'error' ? result.message : 'A fresh confirmation email was sent.'); }} /></View>
  </AuthScaffold>;
}
