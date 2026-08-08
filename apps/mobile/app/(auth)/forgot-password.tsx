import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@propvault/validation';
import { AuthScaffold, FormTextField, PrimaryButton, StatusPill } from '@/design/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

export default function ForgotPasswordScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { sendPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  return <AuthScaffold title="Reset your password" subtitle="Enter your email and we’ll send secure reset instructions." footer={<Text onPress={() => router.back()} style={[typeScale.caption, { color: color.accent, textAlign: 'center', fontWeight: '700' }]}>Back to sign in</Text>}>
    {sent ? <><StatusPill label="Email sent" tone="success" /><Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[4] }]}>If an account exists for that address, the reset email is on its way. Check spam or junk if it does not arrive.</Text><Text style={[typeScale.caption, { color: color.textMuted, marginTop: spacing[3] }]}>For security, the email does not reveal whether an account exists.</Text></> : <><Controller control={control} name="email" render={({ field }) => <FormTextField label="Email address" autoCapitalize="none" keyboardType="email-address" value={field.value} onChangeText={field.onChange} errorMessage={errors.email?.message} />} />{error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{error}</Text> : null}<PrimaryButton label="Send reset email" loading={isSubmitting} onPress={handleSubmit(async ({ email }) => { const result = await sendPasswordReset(email); if (result.status === 'error') setError(result.message); else setSent(true); })} /></>}
  </AuthScaffold>;
}
