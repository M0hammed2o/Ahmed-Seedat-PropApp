import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@propvault/validation';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';
import { FormTextField, PrimaryButton } from '@/design/components';

export default function ForgotPasswordScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { sendPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordInput) => {
    setSubmitError(null);
    const { error } = await sendPasswordReset(values.email);
    if (error) {
      setSubmitError(error);
      return;
    }
    setSent(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typeScale.title, { color: color.textPrimary, marginBottom: spacing[5] }]}>
          Reset your password
        </Text>

        {sent ? (
          <Text style={[typeScale.body, { color: color.textSecondary }]}>
            If an account exists for that email, a reset link has been sent.
          </Text>
        ) : (
          <>
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
            {submitError ? (
              <Text style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>
                {submitError}
              </Text>
            ) : null}
            <PrimaryButton
              label="Send reset link"
              loading={isSubmitting}
              onPress={handleSubmit(onSubmit)}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
