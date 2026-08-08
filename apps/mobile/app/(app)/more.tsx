import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ActionCard } from '@/features/portfolio/PortfolioPrimitives';
import { ProplystLogo, Screen, ScreenHeader, SectionHeader } from '@/design/components';
import { useTheme } from '@/design/theme';
import { useAuth } from '@/features/auth/AuthProvider';

export default function MoreScreen() {
  const { color, spacing, typeScale } = useTheme(); const { session } = useAuth(); const c = session!.user.capabilities;
  const items = [
    ['Leases', 'Terms, renewals and expiries', 'lease', '/(app)/leases', c.canManageTenants],
    ['Documents', 'Library, uploads and extraction', 'document', '/(app)/documents', true],
    ['Maintenance', 'Requests, costs and progress', 'maintenance', '/(app)/maintenance', c.canManageMaintenance],
    ['Inspections', 'Checklists, photos and sign-off', 'inspection', '/(app)/inspections', c.canManageInspections],
    ['Meter readings', 'Electricity and water history', 'meter', '/(app)/meters', c.canRecordMeterReadings],
    ['Owners', 'Ownership and distributions', 'owner', '/(app)/owners', c.canViewOwnerDistributions],
    ['Reports', 'Portfolio and financial exports', 'report', '/(app)/reports', true],
    ['Notifications', 'Updates and preferences', 'notification', '/(app)/notifications', true],
    ['Settings', 'Account, security and organisation', 'settings', '/(app)/settings', true],
  ] as const;
  return <Screen><ScreenHeader title="More" subtitle={session?.user.organizationName ?? 'Proplyst'} /><ScrollView contentContainerStyle={{ paddingHorizontal: spacing[5], paddingBottom: 110 }}><View style={{ alignItems: 'flex-start', marginVertical: spacing[2] }}><ProplystLogo width={128} /></View><Text style={[typeScale.caption, { color: color.textSecondary }]}>Signed in as {session?.user.displayName} · {c.identity}</Text><SectionHeader title="Manage" />{items.filter((item) => item[4]).map(([title, description, icon, route]) => <View key={title} style={{ marginBottom: spacing[3] }}><ActionCard title={title} description={description} icon={icon} route={route} /></View>)}</ScrollView></Screen>;
}
