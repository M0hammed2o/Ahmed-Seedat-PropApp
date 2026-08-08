import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { ProplystLogo } from './ProplystLogo';

export function AuthScaffold({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#030916' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          testID="auth-scroll-view"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View style={{ alignItems: 'center', paddingTop: spacing[5], paddingBottom: spacing[4] }}><ProplystLogo /></View>
          <View style={{ flex: 1, backgroundColor: color.surface, borderTopLeftRadius: radii.panel, borderTopRightRadius: radii.panel, padding: spacing[6] }}>
            <Text accessibilityRole="header" style={[typeScale.title, { color: color.textPrimary }]}>{title}</Text>
            <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[2], marginBottom: spacing[5] }]}>{subtitle}</Text>
            {children}
            {footer ? <View style={{ marginTop: 'auto', paddingTop: spacing[5] }}>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function SocialButton({ label, mark, onPress, disabled, badge }: { label: string; mark: string; onPress: () => void; disabled?: boolean; badge?: string }) {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.border, borderRadius: radii.lg, backgroundColor: color.surfaceRaised, opacity: disabled ? 0.5 : pressed ? 0.72 : 1, marginBottom: spacing[2] })}>
      <Text style={{ fontSize: 18, color: color.textPrimary, marginRight: spacing[2], fontWeight: '800' }}>{mark}</Text>
      <Text style={[typeScale.body, { color: color.textPrimary, fontWeight: '700' }]}>{label}</Text>
      {badge ? <Text style={[typeScale.micro, { color: color.textMuted, marginLeft: spacing[2] }]}>{badge}</Text> : null}
    </Pressable>
  );
}
