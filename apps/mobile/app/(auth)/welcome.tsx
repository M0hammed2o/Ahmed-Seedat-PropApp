import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ProplystLogo, PrimaryButton, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';

export default function WelcomeScreen() {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#030916' }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minHeight: 360, paddingHorizontal: spacing[6], paddingTop: spacing[5] }}>
        <ProplystLogo />
        <View style={{ marginTop: 'auto', marginBottom: spacing[6] }}>
          <StatusPill label="Property management, simplified" tone="info" />
          <Text style={[typeScale.display, { color: '#FFFFFF', fontSize: 38, lineHeight: 46, marginTop: spacing[4] }]}>Your portfolio.{`\n`}One clear view.</Text>
          <Text style={[typeScale.body, { color: '#B9C7DA', marginTop: spacing[3], maxWidth: 330 }]}>Manage properties, tenants, rent, maintenance and documents wherever the day takes you.</Text>
        </View>
      </View>
      <View style={{ backgroundColor: color.surface, borderTopLeftRadius: radii.panel, borderTopRightRadius: radii.panel, padding: spacing[6], gap: spacing[3] }}>
        <PrimaryButton label="Get started" onPress={() => router.push('/(auth)/register')} />
        <PrimaryButton label="Sign in" variant="secondary" onPress={() => router.push('/(auth)/login')} />
        <Text style={[typeScale.micro, { color: color.textMuted, textAlign: 'center', marginTop: spacing[2] }]}>By continuing, you agree to the Proplyst Terms and Privacy Policy. Legal links will be enabled when their approved URLs are connected.</Text>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}
