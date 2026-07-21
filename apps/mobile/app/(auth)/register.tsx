import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@propvault/validation';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';
import { FormTextField, PrimaryButton } from '@/design/components';

// Placeholder terms/privacy version identifiers — real copy + versioning is a Phase 1
// follow-up (PRIVACY_AND_COMPLIANCE.md); the acceptance record itself is fully wired.
const CURRENT_TERMS_VERSION = '2026-07-21';
const CURRENT_PRIVACY_VERSION = '2026-07-21';

export default function RegisterScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { signUp } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      acceptedPrivacyVersion: CURRENT_PRIVACY_VERSION,
    },
  });

  const onSubmit = async (values: RegisterInput) => {
    setSubmitError(null);
    const { error } = await signUp(values.email, values.password);
    if (error) {
      setSubmitError(error);
      return;
    }
    router.replace('/(auth)/verify-email');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typeScale.title, { color: color.textPrimary, marginBottom: spacing[5] }]}>
          Create your account
        </Text>

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <FormTextField
              label="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={field.value}
              onChangeText={field.onChange}
              errorMessage={errors.email?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <FormTextField
              label="Password"
              secureTextEntry
              value={field.value}
              onChangeText={field.onChange}
              errorMessage={errors.password?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="confirmPassword"
          render={({ field }) => (
            <FormTextField
              label="Confirm password"
              secureTextEntry
              value={field.value}
              onChangeText={field.onChange}
              errorMessage={errors.confirmPassword?.message}
            />
          )}
        />

        <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[4] }]}>
          By continuing you accept the Terms of Service and Privacy Policy.
        </Text>

        {submitError ? (
          <Text style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>
            {submitError}
          </Text>
        ) : null}

        <PrimaryButton
          label="Create account"
          loading={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
