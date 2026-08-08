import React from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type FlatListProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { Tone } from '@/data/contracts';
import { useTheme } from '../theme';
import { AppIcon, type AppIconName } from './AppIcon';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { SkeletonState } from './SkeletonState';

export function Screen({
  children,
  style,
  edges = ['top'],
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  edges?: Edge[];
}) {
  const { color } = useTheme();
  return <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: color.surface }, style]}>{children}</SafeAreaView>;
}

export function KeyboardScreen({ children }: { children: React.ReactNode }) {
  const { color, spacing } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: color.surface }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, padding: spacing[6], paddingBottom: spacing[8] }}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <View style={{ paddingHorizontal: spacing[5], paddingTop: spacing[3], paddingBottom: spacing[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        {back ? (
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={10} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing[2] }}>
            <AppIcon name="back" size={32} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[typeScale.title, { color: color.textPrimary }]}>{title}</Text>
          {subtitle ? <Text style={[typeScale.caption, { color: color.textSecondary, marginTop: 2 }]}>{subtitle}</Text> : null}
        </View>
        {action ? <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={4} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={[typeScale.caption, { color: color.accent, fontWeight: '700' }]}>{action.label}</Text></Pressable> : null}
      </View>
    </View>
  );
}

export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[6], marginBottom: spacing[3] }}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: color.textPrimary, flexShrink: 1 }]}>{title}</Text>
      {actionLabel && onAction ? <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} hitSlop={4} style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}><Text style={[typeScale.caption, { color: color.accent, fontWeight: '700' }]}>{actionLabel}</Text></Pressable> : null}
    </View>
  );
}

const toneColors = (color: ReturnType<typeof useTheme>['color']): Record<Tone, { foreground: string; background: string }> => ({
  neutral: { foreground: color.textSecondary, background: color.surfaceStrong },
  info: { foreground: color.accent, background: color.accentSoft },
  success: { foreground: color.statusPaid, background: `${color.statusPaid}18` },
  warning: { foreground: color.statusNeedsReview, background: `${color.statusNeedsReview}18` },
  danger: { foreground: color.danger, background: `${color.danger}16` },
});

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { color, radii, spacing, typeScale } = useTheme();
  const palette = toneColors(color)[tone];
  return <View accessibilityLabel={`Status: ${label}`} style={{ alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: palette.background, borderRadius: radii.pill, paddingHorizontal: spacing[2], paddingVertical: 4 }}><Text style={[typeScale.micro, { color: palette.foreground, fontWeight: '700', flexShrink: 1 }]}>{label}</Text></View>;
}

export function MetricTile({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: Tone }) {
  const { color, spacing, typeScale } = useTheme();
  const palette = toneColors(color)[tone];
  return (
    <Card style={{ flexGrow: 1, flexBasis: 148, minWidth: 0, minHeight: 118, justifyContent: 'space-between' }}>
      <View style={{ width: 30, height: 4, borderRadius: 4, backgroundColor: palette.foreground, marginBottom: spacing[3] }} />
      <Text style={[typeScale.caption, { color: color.textSecondary }]}>{label}</Text>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={[typeScale.title, { color: color.textPrimary, marginTop: 2 }]}>{value}</Text>
      {detail ? <Text style={[typeScale.micro, { color: color.textMuted, marginTop: spacing[1] }]}>{detail}</Text> : null}
    </Card>
  );
}

export function EntityCard({
  title,
  subtitle,
  detail,
  icon = 'property',
  status,
  statusTone,
  onPress,
}: {
  title: string;
  subtitle: string;
  detail?: string;
  icon?: AppIconName;
  status?: string;
  statusTone?: Tone;
  onPress?: () => void;
}) {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? `Open ${title}` : undefined} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        <View style={{ width: 46, height: 46, borderRadius: radii.lg, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' }}><AppIcon name={icon} color={color.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[typeScale.body, { color: color.textPrimary, fontWeight: '700' }]}>{title}</Text>
          <Text numberOfLines={2} style={[typeScale.caption, { color: color.textSecondary, marginTop: 2 }]}>{subtitle}</Text>
          {detail ? <Text numberOfLines={1} style={[typeScale.micro, { color: color.textMuted, marginTop: spacing[1] }]}>{detail}</Text> : null}
        </View>
        {status ? <StatusPill label={status} tone={statusTone} /> : <Text style={{ color: color.textMuted, fontSize: 24 }}>›</Text>}
      </Card>
    </Pressable>
  );
}

export function SearchField({ value, onChangeText, placeholder = 'Search' }: { value: string; onChangeText: (value: string) => void; placeholder?: string }) {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <View style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceRaised, borderRadius: radii.lg, paddingHorizontal: spacing[3] }}>
      <AppIcon name="search" color={color.textMuted} />
      <TextInput accessibilityLabel={placeholder} clearButtonMode="while-editing" returnKeyType="search" value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={color.textMuted} style={[typeScale.body, { flex: 1, color: color.textPrimary, paddingVertical: spacing[3] }]} />
    </View>
  );
}

export function QueryState({ isLoading, error, isEmpty, emptyTitle, emptyDescription, onRetry, children }: { isLoading: boolean; error: string | null; isEmpty: boolean; emptyTitle: string; emptyDescription: string; onRetry: () => void; children: React.ReactNode }) {
  if (isLoading) return <View style={{ padding: 24 }}><SkeletonState rows={5} /></View>;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isEmpty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}

export function RefreshingScrollView({ refreshing, onRefresh, children, contentContainerStyle }: { refreshing: boolean; onRefresh: () => void; children: React.ReactNode; contentContainerStyle?: ViewStyle }) {
  const { color } = useTheme();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} colors={[color.accent]} />} contentContainerStyle={contentContainerStyle}>{children}</ScrollView>;
}

export function RefreshingFlatList<T>(props: FlatListProps<T> & { refreshing: boolean; onRefresh: () => void }) {
  const { color } = useTheme();
  return <FlatList contentInsetAdjustmentBehavior="automatic" {...props} refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={color.accent} colors={[color.accent]} />} />;
}

export function PermissionGate({ allowed, children, fallback = null }: { allowed: boolean; children: React.ReactNode; fallback?: React.ReactNode }) {
  return <>{allowed ? children : fallback}</>;
}

export function NetworkBanner({ status }: { status: 'online' | 'offline' | 'reconnecting' }) {
  const { color, spacing, typeScale } = useTheme();
  if (status === 'online') return null;
  return <View accessibilityRole="alert" style={{ backgroundColor: status === 'offline' ? color.danger : color.statusNeedsReview, paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}><Text style={[typeScale.caption, { color: '#FFFFFF', textAlign: 'center', fontWeight: '700' }]}>{status === 'offline' ? 'You’re offline. Some information may be out of date.' : 'Reconnecting…'}</Text></View>;
}
