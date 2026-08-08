import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FormTextField, KeyboardScreen, PrimaryButton, ProplystLogo, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';
import { useRepositories } from '@/data/RepositoryProvider';

export default function OrganizationScreen() {
  const { color, radii, spacing, typeScale } = useTheme();
  const { organizations } = useRepositories();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [type, setType] = useState<'agency' | 'owner_managed'>('agency');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (mode === 'create' && name.trim().length < 2) { setError('Enter your organisation or portfolio name.'); return; }
    if (mode === 'join' && !code.trim()) { setError('Enter the invitation code from your organisation.'); return; }
    setSaving(true); setError(null);
    try {
      if (mode === 'create') await organizations.create({ name: name.trim(), type });
      else await organizations.joinWithCode(code);
      router.replace('/(app)/dashboard');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not complete organisation setup.'); }
    finally { setSaving(false); }
  };

  return <KeyboardScreen>
    <ProplystLogo compact />
    <View style={{ marginTop: spacing[5] }}><StatusPill label="Step 2 of 2" tone="info" /></View>
    <Text style={[typeScale.title, { color: color.textPrimary, marginTop: spacing[3] }]}>Your organisation</Text>
    <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[2], marginBottom: spacing[5] }]}>Create a workspace for your portfolio, or join one using an invitation.</Text>
    <View style={{ flexDirection: 'row', padding: 4, borderRadius: radii.lg, backgroundColor: color.surfaceStrong, marginBottom: spacing[5] }}>{(['create', 'join'] as const).map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} onPress={() => { setMode(item); setError(null); }} style={{ flex: 1, minHeight: 44, borderRadius: radii.md, backgroundColor: mode === item ? color.surfaceRaised : 'transparent', alignItems: 'center', justifyContent: 'center' }}><Text style={[typeScale.caption, { color: mode === item ? color.textPrimary : color.textMuted, fontWeight: '700' }]}>{item === 'create' ? 'Create new' : 'Join existing'}</Text></Pressable>)}</View>
    {mode === 'create' ? <><FormTextField label="Organisation / portfolio name" autoComplete="organization" value={name} onChangeText={setName} placeholder="Horizon Property Group" /><Text style={[typeScale.caption, { color: color.textSecondary, marginBottom: spacing[2] }]}>How do you manage property?</Text><Choice label="Agency" detail="I manage property for owners" selected={type === 'agency'} onPress={() => setType('agency')} /><Choice label="Owner-managed" detail="I manage my own portfolio" selected={type === 'owner_managed'} onPress={() => setType('owner_managed')} /></> : <><FormTextField label="Invitation code" autoCapitalize="characters" value={code} onChangeText={setCode} placeholder="HORIZON26" /><Text style={[typeScale.caption, { color: color.textMuted }]}>Your administrator can find this code in Staff & Roles. Demo code: HORIZON26.</Text></>}
    {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginVertical: spacing[3] }]}>{error}</Text> : <View style={{ height: spacing[5] }} />}
    <PrimaryButton label={mode === 'create' ? 'Create organisation' : 'Join organisation'} loading={saving} onPress={submit} />
  </KeyboardScreen>;

  function Choice({ label, detail, selected, onPress }: { label: string; detail: string; selected: boolean; onPress: () => void }) {
    return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, borderWidth: 1, borderColor: selected ? color.accent : color.border, backgroundColor: selected ? color.accentSoft : color.surfaceRaised, borderRadius: radii.lg, paddingHorizontal: spacing[4], marginBottom: spacing[3] }}><View style={{ flex: 1 }}><Text style={[typeScale.body, { color: color.textPrimary, fontWeight: '700' }]}>{label}</Text><Text style={[typeScale.caption, { color: color.textSecondary }]}>{detail}</Text></View><View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? color.accent : color.borderStrong, alignItems: 'center', justifyContent: 'center' }}>{selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.accent }} /> : null}</View></Pressable>;
  }
}
