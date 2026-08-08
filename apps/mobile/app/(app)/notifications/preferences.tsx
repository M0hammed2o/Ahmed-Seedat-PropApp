import React, { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Card, PrimaryButton, QueryState, Screen, ScreenHeader, SectionHeader, StatusPill } from '@/design/components';
import { useNotificationPreferences } from '@/features/portfolio/usePortfolioData';
import { useTheme } from '@/design/theme';
import { ToggleRow } from '@/features/portfolio/PortfolioPrimitives';
import { useRepositories } from '@/data/RepositoryProvider';
import type { NotificationPreferences as Preferences } from '@/data/contracts';

type DevicePermission = 'checking' | 'granted' | 'denied';

export default function NotificationPreferences() {
  const query = useNotificationPreferences();
  const { notifications } = useRepositories();
  const { color, spacing, typeScale } = useTheme();
  const [value, setValue] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devicePermission, setDevicePermission] = useState<DevicePermission>('checking');

  useEffect(() => {
    if (query.data) setValue(query.data);
  }, [query.data]);

  useEffect(() => {
    void Notifications.getPermissionsAsync()
      .then((permission) => setDevicePermission(permission.granted ? 'granted' : 'denied'))
      .catch(() => setDevicePermission('denied'));
  }, []);

  const toggle = (key: keyof Preferences) => (next: boolean) => {
    setSaved(false);
    setValue((current) => current ? { ...current, [key]: next } : current);
  };

  const togglePush = async (next: boolean) => {
    setSaved(false);
    setError(null);
    if (!next) {
      setValue((current) => current ? { ...current, pushEnabled: false } : current);
      return;
    }
    try {
      const permission = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      const granted = permission.granted;
      setDevicePermission(granted ? 'granted' : 'denied');
      setValue((current) => current ? { ...current, pushEnabled: granted } : current);
      if (!granted) setError('Push notifications are disabled for Proplyst in device settings.');
    } catch {
      setValue((current) => current ? { ...current, pushEnabled: false } : current);
      setError('Notification permission could not be requested on this device.');
    }
  };

  const save = async () => {
    if (!value) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await notifications.updatePreferences(value);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Preferences could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Notification preferences" back />
      <QueryState isLoading={query.isLoading} error={query.error} isEmpty={!value} emptyTitle="Preferences unavailable" emptyDescription="Try again when you’re connected." onRetry={query.reload}>
        {value ? (
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: spacing[5], paddingBottom: spacing[8] }}>
            <SectionHeader title="Device permission" />
            <Card>
              <StatusPill
                label={devicePermission === 'checking' ? 'Checking…' : devicePermission === 'granted' ? 'Allowed on this device' : 'Off on this device'}
                tone={devicePermission === 'granted' ? 'success' : devicePermission === 'checking' ? 'neutral' : 'warning'}
              />
              <Text style={[typeScale.caption, { color: color.textSecondary, marginTop: spacing[3] }]}>Proplyst asks for notification access only when you turn on push notifications. Delivery still requires a backend-registered push token.</Text>
              {devicePermission === 'denied' ? <View style={{ marginTop: spacing[3] }}><PrimaryButton label={`Open ${Platform.OS === 'ios' ? 'iPhone' : 'device'} settings`} variant="secondary" onPress={() => void Linking.openSettings()} /></View> : null}
            </Card>
            <SectionHeader title="Delivery" />
            <Card>
              <ToggleRow label="Push notifications" description="Requires permission from this device" value={value.pushEnabled} onChange={(next) => void togglePush(next)} />
              <ToggleRow label="Email notifications" value={value.emailEnabled} onChange={toggle('emailEnabled')} />
            </Card>
            <SectionHeader title="Updates" />
            <Card>
              <ToggleRow label="Payments" value={value.paymentAlerts} onChange={toggle('paymentAlerts')} />
              <ToggleRow label="Maintenance" value={value.maintenanceAlerts} onChange={toggle('maintenanceAlerts')} />
              <ToggleRow label="Lease reminders" value={value.leaseAlerts} onChange={toggle('leaseAlerts')} />
              <ToggleRow label="Documents" value={value.documentAlerts} onChange={toggle('documentAlerts')} />
            </Card>
            {saved ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.statusPaid, marginVertical: spacing[3] }]}>Preferences saved.</Text> : <View style={{ height: spacing[4] }} />}
            {error ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: color.danger, marginBottom: spacing[3] }]}>{error}</Text> : null}
            <PrimaryButton label="Save preferences" loading={busy} onPress={save} />
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
