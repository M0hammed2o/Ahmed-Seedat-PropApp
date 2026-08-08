import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { FormTextField, KeyboardScreen, PrimaryButton, ScreenHeader } from '@/design/components';
import { useTheme } from '@/design/theme';
import { useRepositories } from '@/data/RepositoryProvider';
import { useRepositoryQuery } from '@/data/useRepositoryQuery';

export default function EditPropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { color, spacing, typeScale } = useTheme();
  const { properties } = useRepositories();
  const query = useRepositoryQuery(() => properties.getById(id), [properties, id]);
  const [name, setName] = useState(''); const [address, setAddress] = useState(''); const [city, setCity] = useState(''); const [province, setProvince] = useState(''); const [municipal, setMunicipal] = useState(''); const [notes, setNotes] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (query.data) { setName(query.data.nickname); setAddress(query.data.addressLine1); setCity(query.data.city); setProvince(query.data.province); setMunicipal(query.data.municipalAccountNumber ?? ''); setNotes(query.data.notes ?? ''); } }, [query.data]);
  return <KeyboardScreen><ScreenHeader title="Edit property" subtitle={query.data?.nickname} back /><FormTextField label="Property name" value={name} onChangeText={setName} /><FormTextField label="Street address" value={address} onChangeText={setAddress} /><FormTextField label="City" value={city} onChangeText={setCity} /><FormTextField label="Province" value={province} onChangeText={setProvince} /><FormTextField label="Municipal account" value={municipal} onChangeText={setMunicipal} /><FormTextField label="Notes" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: spacing[3] }} />{error ? <Text style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{error}</Text> : null}<PrimaryButton label="Save changes" loading={saving} onPress={async () => { setSaving(true); try { await properties.update(id, { nickname: name, addressLine1: address, city, province, municipalAccountNumber: municipal, notes }); router.back(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save changes.'); } finally { setSaving(false); } }} /></KeyboardScreen>;
}
