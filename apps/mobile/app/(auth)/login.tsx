import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@propvault/validation';
import { AuthScaffold, FormTextField, PrimaryButton, SocialButton } from '@/design/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

export default function LoginScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { signIn, signInWithProvider } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [providerPending, setProviderPending] = useState(false);
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const handleResult = (result: Awaited<ReturnType<typeof signIn>>) => {
    if (result.status === 'authenticated') router.replace('/');
    else if (result.status === 'mfa_required') router.push('/(auth)/mfa-challenge' as never);
    else if (result.status === 'email_unconfirmed') router.push('/(auth)/verify-email');
    else if (result.status === 'error') setSubmitError(result.message);
  };

  return (
    <AuthScaffold title="Welcome back" subtitle="Sign in to continue to your Proplyst workspace." footer={<Text onPress={() => router.push('/(auth)/register')} accessibilityRole="link" style={[typeScale.caption, { color: color.accent, textAlign: 'center', fontWeight: '700' }]}>New to Proplyst? Create an account</Text>}>
      <SocialButton label={providerPending ? 'Connecting…' : 'Continue with Google'} mark="G" disabled={providerPending} onPress={async () => { setProviderPending(true); setSubmitError(null); const result = await signInWithProvider('google'); setProviderPending(false); handleResult(result); }} />
      <SocialButton label="Continue with Apple" mark="●" badge="Coming soon" disabled onPress={() => {}} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginVertical: spacing[4] }}><View style={{ flex: 1, height: 1, backgroundColor: color.border }} /><Text style={[typeScale.micro, { color: color.textMuted }]}>OR USE EMAIL</Text><View style={{ flex: 1, height: 1, backgroundColor: color.border }} /></View>
      <Controller control={control} name="email" render={({ field }) => <FormTextField label="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={field.value} onChangeText={field.onChange} errorMessage={errors.email?.message} />} />
      <Controller control={control} name="password" render={({ field }) => <FormTextField label="Password" secureTextEntry autoComplete="current-password" value={field.value} onChangeText={field.onChange} errorMessage={errors.password?.message} />} />
      <Text onPress={() => router.push('/(auth)/forgot-password')} accessibilityRole="link" style={[typeScale.caption, { color: color.accent, textAlign: 'right', marginBottom: spacing[4], fontWeight: '700' }]}>Forgot password?</Text>
      {submitError ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{submitError}</Text> : null}
      <PrimaryButton label="Sign in" loading={isSubmitting} onPress={handleSubmit(async (values) => { setSubmitError(null); handleResult(await signIn(values.email, values.password)); })} />
      <Text style={[typeScale.micro, { color: color.textMuted, marginTop: spacing[3], textAlign: 'center' }]}>Demo: use any valid email and password. Use mfa@example.co.za to preview MFA.</Text>
    </AuthScaffold>
  );
}
