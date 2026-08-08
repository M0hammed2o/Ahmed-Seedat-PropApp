import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { AuthScaffold, PrimaryButton, StatusPill } from '@/design/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

export default function EmailConfirmedScreen() {
  const started = useRef(false);
  const { color, spacing, typeScale } = useTheme();
  const { completeEmailConfirmation } = useAuth();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeEmailConfirmation().then((result) => { if (result.status === 'error') setError(result.message); else setReady(true); });
  }, [completeEmailConfirmation]);
  return <AuthScaffold title={error ? 'This link could not be confirmed' : 'Email confirmed'} subtitle={error ? 'The link may have expired or already been used.' : 'Your email is verified. Let’s finish setting up your Proplyst account.'}>
    <StatusPill label={error ? 'Link expired or used' : ready ? 'Verified' : 'Confirming…'} tone={error ? 'danger' : ready ? 'success' : 'info'} />
    {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginTop: spacing[4] }]}>{error}</Text> : null}
    <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[5], marginBottom: spacing[5] }]}>{error ? 'Request a fresh confirmation email or sign in if you have already verified this address.' : 'Next you’ll add your name and mobile number, then create or join an organisation.'}</Text>
    <PrimaryButton disabled={!ready && !error} label={error ? 'Request a new link' : 'Complete account'} onPress={() => router.replace((error ? '/(auth)/verify-email' : '/(onboarding)/complete-account') as never)} />
  </AuthScaffold>;
}
