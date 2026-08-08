import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useRepositories } from '@/data/RepositoryProvider';
import { useRepositoryQuery } from '@/data/useRepositoryQuery';
import { formatZar } from '@/data/format';
import { Chip, EntityCard, PrimaryButton, QueryState, RefreshingFlatList, Screen, ScreenHeader, SearchField } from '@/design/components';
import { useTheme } from '@/design/theme';

export default function PropertiesListScreen() {
  const { color, spacing, typeScale } = useTheme();
  const { properties } = useRepositories();
  const query = useRepositoryQuery(() => properties.list('active'), [properties]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'vacancy' | 'arrears'>('all');
  const results = useMemo(() => (query.data ?? []).filter((property) => {
    const matchesSearch = `${property.nickname} ${property.fullAddress}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'vacancy' ? property.occupiedUnits < property.unitCount : property.outstandingBalance > 0);
    return matchesSearch && matchesFilter;
  }), [filter, query.data, search]);
  return <Screen>
    <ScreenHeader title="Properties" subtitle={`${query.data?.length ?? 0} active properties`} action={{ label: 'Add', onPress: () => router.push('/(app)/properties/add') }} />
    <View style={{ paddingHorizontal: spacing[5], gap: spacing[3] }}><SearchField value={search} onChangeText={setSearch} placeholder="Search properties" /><View style={{ flexDirection: 'row', gap: spacing[2] }}><Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} /><Chip label="Vacancies" selected={filter === 'vacancy'} onPress={() => setFilter('vacancy')} /><Chip label="Arrears" selected={filter === 'arrears'} onPress={() => setFilter('arrears')} /></View></View>
    <QueryState isLoading={query.isLoading} error={query.error} isEmpty={!query.isLoading && results.length === 0} emptyTitle={search || filter !== 'all' ? 'No matching properties' : 'No properties yet'} emptyDescription={search || filter !== 'all' ? 'Change your search or filters.' : 'Add your first property to start building the portfolio.'} onRetry={query.reload}>
      <RefreshingFlatList data={results} keyExtractor={(item) => item.id} refreshing={query.isRefreshing} onRefresh={query.reload} contentContainerStyle={{ padding: spacing[5], gap: spacing[3], paddingBottom: 100 }} renderItem={({ item }) => <EntityCard title={item.nickname} subtitle={item.fullAddress} detail={`${item.occupiedUnits}/${item.unitCount} occupied · ${formatZar(item.monthlyRent, { compact: true })}/month`} icon="property" status={item.outstandingBalance > 0 ? formatZar(item.outstandingBalance, { compact: true }) + ' due' : 'On track'} statusTone={item.outstandingBalance > 0 ? 'warning' : 'success'} onPress={() => router.push(`/(app)/properties/${item.id}`)} />} ListFooterComponent={<View style={{ marginTop: spacing[3] }}><Text style={[typeScale.micro, { color: color.textMuted, textAlign: 'center' }]}>Pull down to refresh portfolio data.</Text></View>} />
    </QueryState>
    {!query.isLoading && query.data?.length === 0 ? <View style={{ padding: spacing[5] }}><PrimaryButton label="Add property" onPress={() => router.push('/(app)/properties/add')} /></View> : null}
  </Screen>;
}
