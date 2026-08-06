import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { propertySchema, type PropertyInput } from '@propvault/validation';
import { useCreatePropertyMutation } from '@/features/properties/usePropertiesQuery';
import { useCurrentOrgId } from '@/features/organizations/useCurrentOrgId';
import { useTheme } from '@/design/theme';
import { FormTextField, PrimaryButton } from '@/design/components';

export default function AddPropertyScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { data: orgId } = useCurrentOrgId();
  const createProperty = useCreatePropertyMutation(orgId ?? '');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PropertyInput>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      country: 'ZA',
      propertyType: 'house',
      addressLine1: '',
      city: '',
      nickname: '',
    },
  });

  const onSubmit = async (values: PropertyInput) => {
    setSubmitError(null);
    try {
      await createProperty.mutateAsync(values);
      router.back();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save this property.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typeScale.title, { color: color.textPrimary, marginBottom: spacing[5] }]}>
          Add property
        </Text>

        <Controller
          control={control}
          name="nickname"
          render={({ field }) => (
            <FormTextField
              label="Property name"
              value={field.value}
              onChangeText={field.onChange}
              errorMessage={errors.nickname?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="addressLine1"
          render={({ field }) => (
            <FormTextField
              label="Address line 1"
              value={field.value}
              onChangeText={field.onChange}
              errorMessage={errors.addressLine1?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="addressLine2"
          render={({ field }) => (
            <FormTextField
              label="Address line 2 (optional)"
              value={field.value ?? ''}
              onChangeText={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="city"
          render={({ field }) => (
            <FormTextField
              label="City"
              value={field.value}
              onChangeText={field.onChange}
              errorMessage={errors.city?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="municipalAccountNumber"
          render={({ field }) => (
            <FormTextField
              label="Municipal account number (optional)"
              value={field.value ?? ''}
              onChangeText={field.onChange}
            />
          )}
        />

        {submitError ? (
          <Text style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>
            {submitError}
          </Text>
        ) : null}

        <PrimaryButton
          label="Save property"
          loading={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
