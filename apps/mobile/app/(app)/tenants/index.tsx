import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { EntityCard, QueryState, RefreshingFlatList, Screen, ScreenHeader, SearchField } from '@/design/components';
import { useTheme } from '@/design/theme';
import { formatZar } from '@/data/format';
import { useTenants } from '@/features/portfolio/usePortfolioData';

export default function TenantsScreen() {
  const { spacing } = useTheme(); const query = useTenants(); const [search, setSearch] = useState('');
  const data = useMemo(() => (query.data ?? []).filter((item) => `${item.displayName} ${item.propertyName} ${item.unitName}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  return <Screen><ScreenHeader title="Tenants" subtitle="People, leases and balances" /><View style={{ paddingHorizontal: spacing[5], paddingBottom: spacing[3] }}><SearchField value={search} onChangeText={setSearch} placeholder="Search tenants or properties" /></View><QueryState isLoading={query.isLoading} error={query.error} isEmpty={!data.length} emptyTitle="No tenants yet" emptyDescription="Tenants will appear when a lease is assigned." onRetry={query.reload}><RefreshingFlatList data={data} keyExtractor={(item) => item.id} refreshing={query.isRefreshing} onRefresh={query.reload} contentContainerStyle={{ paddingHorizontal: spacing[5], paddingBottom: 100, gap: spacing[3] }} renderItem={({ item }) => <EntityCard title={item.displayName} subtitle={`${item.propertyName} · ${item.unitName}`} detail={`${formatZar(item.monthlyRent)}/month${item.outstandingBalance ? ` · ${formatZar(item.outstandingBalance)} outstanding` : ''}`} icon="tenant" status={item.leaseStatus} statusTone={item.leaseStatus === 'overdue' ? 'danger' : item.leaseStatus === 'expiring' ? 'warning' : 'success'} onPress={() => router.push(`/(app)/tenants/${item.id}` as never)} />} /></QueryState></Screen>;
}
