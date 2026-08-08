import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@propvault/validation';
import { AuthScaffold, FormTextField, PrimaryButton, SocialButton } from '@/design/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';

const TERMS_VERSION = 'mobile-ui-pending-backend';
const PRIVACY_VERSION = 'mobile-ui-pending-backend';

export default function RegisterScreen() {
  const { color, radii, spacing, typeScale } = useTheme();
  const { signUp, signInWithProvider } = useAuth();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { control, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema), defaultValues: { email: '', password: '', confirmPassword: '', acceptedTermsVersion: '', acceptedPrivacyVersion: '' } });

  return (
    <AuthScaffold title="Create your account" subtitle="Start with your details. You’ll set up your profile and organisation next." footer={<Text onPress={() => router.push('/(auth)/login')} accessibilityRole="link" style={[typeScale.caption, { color: color.accent, textAlign: 'center', fontWeight: '700' }]}>Already have an account? Sign in</Text>}>
      <SocialButton label="Continue with Google" mark="G" onPress={async () => { const result = await signInWithProvider('google'); if (result.status === 'authenticated') router.replace('/'); else if (result.status === 'error') setSubmitError(result.message); }} />
      <SocialButton label="Continue with Apple" mark="●" badge="Coming soon" disabled onPress={() => {}} />
      <View style={{ height: spacing[3] }} />
      <Controller control={control} name="email" render={({ field }) => <FormTextField label="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={field.value} onChangeText={field.onChange} errorMessage={errors.email?.message} />} />
      <Controller control={control} name="password" render={({ field }) => <FormTextField label="Password" secureTextEntry autoComplete="new-password" value={field.value} onChangeText={field.onChange} errorMessage={errors.password?.message} />} />
      <Controller control={control} name="confirmPassword" render={({ field }) => <FormTextField label="Confirm password" secureTextEntry autoComplete="new-password" value={field.value} onChangeText={field.onChange} errorMessage={errors.confirmPassword?.message} />} />
      <ConsentRow label="I agree to the Terms of Service" selected={acceptedTerms} onPress={() => { const next = !acceptedTerms; setAcceptedTerms(next); setValue('acceptedTermsVersion', next ? TERMS_VERSION : '', { shouldValidate: true }); }} />
      <ConsentRow label="I agree to the Privacy Policy" selected={acceptedPrivacy} onPress={() => { const next = !acceptedPrivacy; setAcceptedPrivacy(next); setValue('acceptedPrivacyVersion', next ? PRIVACY_VERSION : '', { shouldValidate: true }); }} />
      {submitError ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginVertical: spacing[3] }]}>{submitError}</Text> : null}
      <View style={{ marginTop: spacing[4] }}><PrimaryButton label="Create account" loading={isSubmitting} onPress={handleSubmit(async (values) => { if (!acceptedTerms || !acceptedPrivacy) { setSubmitError('Accept the Terms and Privacy Policy to continue.'); return; } const result = await signUp(values.email, values.password); if (result.status === 'confirmation_sent') router.replace('/(auth)/verify-email'); else if (result.status === 'error') setSubmitError(result.message); })} /></View>
    </AuthScaffold>
  );

  function ConsentRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}><View style={{ width: 22, height: 22, borderRadius: radii.sm, borderWidth: 1, borderColor: selected ? color.accent : color.borderStrong, backgroundColor: selected ? color.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: color.accentContrast, fontWeight: '800' }}>{selected ? '✓' : ''}</Text></View><Text style={[typeScale.caption, { color: color.textSecondary, flex: 1 }]}>{label}</Text></Pressable>;
  }
}
