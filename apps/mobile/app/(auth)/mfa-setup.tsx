import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AuthScaffold, PrimaryButton, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';

export default function MfaSetupScreen() {
  const { color, radii, spacing, typeScale } = useTheme();
  const [code, setCode] = useState('');
  return (
    <AuthScaffold title="Protect your account" subtitle="Use an authenticator app for an additional security check when signing in.">
      <StatusPill label="Backend enrollment pending" tone="warning" />
      <View accessibilityLabel="Inactive authenticator setup preview" style={{ width: 190, height: 190, alignSelf: 'center', marginVertical: spacing[5], borderRadius: radii.lg, backgroundColor: '#FFFFFF', borderWidth: 12, borderColor: '#FFFFFF', flexDirection: 'row', flexWrap: 'wrap' }}>{Array.from({ length: 81 }).map((_, index) => <View key={index} style={{ width: '11.11%', height: '11.11%', backgroundColor: (index * 7 + Math.floor(index / 9) * 3) % 5 < 2 ? '#07101F' : '#FFFFFF' }} />)}</View>
      <Text style={[typeScale.caption, { color: color.textSecondary, textAlign: 'center' }]}>Can’t scan? Preview setup key:</Text>
      <Text selectable style={[typeScale.body, { color: color.textPrimary, fontWeight: '700', textAlign: 'center', marginTop: spacing[1] }]}>JBSW Y3DP EHPK 3PXP</Text>
      <TextInput accessibilityLabel="Confirmation code" autoComplete="one-time-code" keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} placeholder="6-digit code" placeholderTextColor={color.textMuted} style={[typeScale.body, { minHeight: 52, marginVertical: spacing[4], paddingHorizontal: spacing[3], textAlign: 'center', color: color.textPrimary, borderWidth: 1, borderColor: color.border, borderRadius: radii.lg }]} />
      <PrimaryButton label="Enable authenticator" disabled onPress={() => {}} />
      <View style={{ marginTop: spacing[3] }}><PrimaryButton label="Back to settings" variant="secondary" onPress={() => router.back()} /></View>
      <Text style={[typeScale.micro, { color: color.textMuted, marginTop: spacing[3], textAlign: 'center' }]}>Frontend preview only. The setup image and key are not active credentials. Backend enrollment and recovery codes must be connected before this action is enabled.</Text>
    </AuthScaffold>
  );
}
