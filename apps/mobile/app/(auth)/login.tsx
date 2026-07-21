import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@propvault/validation';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/design/theme';
import { FormTextField, PrimaryButton } from '@/design/components';

export default function LoginScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { signIn } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginInput) => {
    setSubmitError(null);
    const { error } = await signIn(values.email, values.password);
    if (error) {
      setSubmitError(error);
      return;
    }
    router.replace('/(app)/dashboard');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typeScale.title, { color: color.textPrimary, marginBottom: spacing[5] }]}>
          Welcome back
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

        {submitError ? (
          <Text style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>
            {submitError}
          </Text>
        ) : null}

        <PrimaryButton label="Sign in" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />
        <Text
          onPress={() => router.push('/(auth)/forgot-password')}
          style={[
            typeScale.caption,
            { color: color.textSecondary, marginTop: spacing[4], textAlign: 'center' },
          ]}
        >
          Forgot your password?
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
