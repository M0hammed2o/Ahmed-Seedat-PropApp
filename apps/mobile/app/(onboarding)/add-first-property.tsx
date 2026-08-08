import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { propertySchema, type PropertyInput } from '@propvault/validation';
import { useCreatePropertyMutation } from '@/features/properties/usePropertiesQuery';
import { useCurrentOrgId } from '@/features/organizations/useCurrentOrgId';
import { useTheme } from '@/design/theme';
import { FormTextField, KeyboardScreen, PrimaryButton } from '@/design/components';

// NOTE (TASKS.md M5, 2026-07-30): this onboarding step still assumes a user can create a
// property immediately after signup, which was true in the single-owner model but isn't
// anymore - a property now needs an organization to belong to, and mobile has no
// create-organization screen yet (that flow only exists on web, /onboarding/create-organization).
// useCurrentOrgId() resolves null until one exists, at which point this screen's submit
// correctly fails at the database (FK violation) rather than silently mis-attributing the
// property. Tracked in TECHNICAL_DEBT_REGISTER.md - designing a mobile org-creation step (or
// deciding mobile onboarding always follows a web-created org) is real product work, not a
// mechanical fix, and is out of scope for this schema cutover.
export default function AddFirstPropertyScreen() {
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
      router.push('/(onboarding)/first-upload');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save this property.');
    }
  };

  return (
    <KeyboardScreen>
        <Text style={[typeScale.title, { color: color.textPrimary, marginBottom: spacing[2] }]}>
          Add your first property
        </Text>
        <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[5] }]}>
          Step 6 of 9
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

        {submitError ? (
          <Text style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>
            {submitError}
          </Text>
        ) : null}

        <PrimaryButton
          label="Save and continue"
          loading={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        />
    </KeyboardScreen>
  );
}
