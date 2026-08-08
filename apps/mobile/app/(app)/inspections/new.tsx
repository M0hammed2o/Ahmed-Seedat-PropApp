import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { FormTextField, KeyboardScreen, PrimaryButton, ScreenHeader, StatusPill } from '@/design/components';
import { useTheme } from '@/design/theme';
import { usePortfolioActions } from '@/features/portfolio/usePortfolioData';

export default function NewInspection() {
  const { color, spacing, typeScale } = useTheme(); const { createInspection } = usePortfolioActions();
  const [property, setProperty] = useState(''); const [unit, setUnit] = useState(''); const [scheduled, setScheduled] = useState('2026-08-14T10:00:00+02:00'); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const save = async () => { setBusy(true); setError(null); try { const inspection = await createInspection({ propertyName: property, unitName: unit, type: 'routine', scheduledFor: scheduled, status: 'scheduled', totalItems: 24 }); router.replace(`/(app)/inspections/${inspection.id}` as never); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not schedule the inspection.'); } finally { setBusy(false); } };
  return <KeyboardScreen><ScreenHeader title="Schedule inspection" back /><FormTextField label="Property" value={property} onChangeText={setProperty} /><FormTextField label="Unit" value={unit} onChangeText={setUnit} /><FormTextField label="Date and time (ISO)" value={scheduled} onChangeText={setScheduled} /><StatusPill label="Routine inspection · 24 checks" tone="info" /><View style={{ height: spacing[5] }} />{error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{error}</Text> : null}<PrimaryButton label="Schedule inspection" loading={busy} disabled={!property || !unit || !scheduled} onPress={save} /><Text style={[typeScale.micro, { color: color.textMuted, marginTop: spacing[3] }]}>Saved to the mock repository. A native date picker will replace the ISO field when the backend scheduling adapter is connected.</Text></KeyboardScreen>;
}
