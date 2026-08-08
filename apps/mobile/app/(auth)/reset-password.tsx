import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordInput } from '@propvault/validation';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBiometricLock } from '@/features/biometrics/BiometricLockProvider';
import { useTheme } from '@/design/theme';
import { AuthScaffold, FormTextField, PrimaryButton } from '@/design/components';

// Reached via the deep link from the password-reset email (Supabase establishes a recovery
// session before this screen renders). Completing this always requires full re-auth
// afterwards, never a biometric-only unlock (brief) — enforced via invalidateSession().
export default function ResetPasswordScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { updatePassword } = useAuth();
  const { invalidateSession } = useBiometricLock();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: ResetPasswordInput) => {
    setSubmitError(null);
    const result = await updatePassword(values.password);
    if (result.status === 'error') {
      setSubmitError(result.message);
      return;
    }
    invalidateSession();
    router.replace('/(auth)/login');
  };

  return (
    <AuthScaffold title="Choose a new password" subtitle="Use a strong password you do not use elsewhere.">

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <FormTextField
              label="New password"
              secureTextEntry
              autoComplete="new-password"
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
              label="Confirm new password"
              secureTextEntry
              autoComplete="new-password"
              value={field.value}
              onChangeText={field.onChange}
              errorMessage={errors.confirmPassword?.message}
            />
          )}
        />

        {submitError ? (
          <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>
            {submitError}
          </Text>
        ) : null}

        <PrimaryButton
          label="Update password"
          loading={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        />
    </AuthScaffold>
  );
}
