import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { FormTextField, KeyboardScreen, PrimaryButton, ProplystLogo, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useRepositories } from '@/data/RepositoryProvider';
import { toE164 } from '@/data/format';

export default function CompleteAccountScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { session } = useAuth();
  const { profiles } = useRepositories();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [country] = useState('South Africa');
  const [callingCode, setCallingCode] = useState('+27');
  const [mobileNumber, setMobileNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const phoneE164 = toE164(callingCode, mobileNumber);
    if (!firstName.trim() || !lastName.trim() || !displayName.trim()) { setError('Complete your name details to continue.'); return; }
    if (!phoneE164) { setError('Enter a valid mobile number with its country calling code.'); return; }
    setSaving(true); setError(null);
    try {
      await profiles.completeProfile({ firstName: firstName.trim(), lastName: lastName.trim(), displayName: displayName.trim(), country: 'ZA', callingCode, mobileNumber, phoneE164 });
      router.replace('/(onboarding)/organization' as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.');
    } finally { setSaving(false); }
  };

  return <KeyboardScreen>
    <ProplystLogo compact />
    <View style={{ marginTop: spacing[5] }}><StatusPill label="Step 1 of 2" tone="info" /></View>
    <Text style={[typeScale.title, { color: color.textPrimary, marginTop: spacing[3] }]}>Complete your account</Text>
    <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[2], marginBottom: spacing[5] }]}>Tell us how your name and mobile number should appear across Proplyst.</Text>
    <FormTextField label="First name" autoComplete="given-name" value={firstName} onChangeText={(value) => { setFirstName(value); if (!displayName) setDisplayName(`${value} ${lastName}`.trim()); }} />
    <FormTextField label="Last name" autoComplete="family-name" value={lastName} onChangeText={(value) => { setLastName(value); setDisplayName(`${firstName} ${value}`.trim()); }} />
    <FormTextField label="Display name" value={displayName} onChangeText={setDisplayName} />
    <FormTextField label="Email address" editable={false} value={session?.user.email ?? ''} style={{ opacity: 0.68 }} />
    <FormTextField label="Country" editable={false} value={country} style={{ opacity: 0.68 }} />
    <View style={{ flexDirection: 'row', gap: spacing[3] }}><View style={{ width: 94 }}><FormTextField label="Code" keyboardType="phone-pad" value={callingCode} onChangeText={setCallingCode} /></View><View style={{ flex: 1 }}><FormTextField label="Mobile number" autoComplete="tel" keyboardType="phone-pad" value={mobileNumber} onChangeText={setMobileNumber} placeholder="082 123 4567" /></View></View>
    <Text style={[typeScale.micro, { color: color.textMuted, marginTop: -spacing[2], marginBottom: spacing[4] }]}>Stored in canonical international format, for example +27821234567.</Text>
    {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{error}</Text> : null}
    <PrimaryButton label="Save and continue" loading={saving} onPress={submit} />
  </KeyboardScreen>;
}
