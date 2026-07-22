import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { BillStatus } from '@propvault/types';
import { monthLabel } from '@propvault/utils';
import { useDemoStore } from '@/demo/demoStore';
import { DEMO_CATEGORIES } from '@/demo/mockData';
import { useTheme } from '@/design/theme';
import { Card, Chip, EmptyState, FadeSlideIn, PaymentStatusBadge } from '@/design/components';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  propertyId: string;
  status?: BillStatus;
}

export default function SearchScreen() {
  const { color, spacing, radii, typeScale } = useTheme();
  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([
    'Water',
    'July',
    'City of Cape Town',
    'Overdue',
  ]);

  const { bills, documents, properties } = useDemoStore();

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return bills
      .map((bill): SearchResult | null => {
        const property = properties.find((p) => p.id === bill.propertyId);
        const document = documents.find((d) => d.id === bill.documentId);
        const category = DEMO_CATEGORIES.find((c) => c.id === document?.categoryId);
        const haystack = [
          property?.nickname,
          bill.supplierName,
          category?.label,
          document?.originalFileName,
          bill.status,
          bill.amountDue?.toString(),
          bill.billingMonth ? monthLabel(bill.billingMonth) : undefined,
          bill.accountNumber,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(q)) return null;

        return {
          id: bill.id,
          title: bill.supplierName ?? 'Unknown supplier',
          subtitle: `${property?.nickname ?? ''} · ${bill.billingMonth ? monthLabel(bill.billingMonth) : ''} ${bill.billingYear ?? ''}`,
          propertyId: bill.propertyId,
          status: bill.status,
        };
      })
      .filter((r): r is SearchResult => r !== null);
  }, [query, bills, documents, properties]);

  const commitSearch = (text: string) => {
    setQuery(text);
    if (text.trim() && !recentSearches.includes(text)) {
      setRecentSearches((prev) => [text, ...prev].slice(0, 6));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <View style={{ padding: spacing[6], paddingBottom: spacing[3] }}>
        <Text style={[typeScale.title, { color: color.textPrimary, marginBottom: spacing[4] }]}>
          Search
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => commitSearch(query)}
          placeholder="Search property, supplier, month, amount, status…"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="Search"
          style={{
            borderWidth: 1,
            borderColor: color.border,
            borderRadius: radii.md,
            paddingHorizontal: spacing[3],
            height: 48,
            color: color.textPrimary,
            backgroundColor: color.surfaceRaised,
          }}
        />
      </View>

      {query.trim() === '' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing[6] }}>
          <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[2] }]}>
            Recent searches
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing[2],
              marginBottom: spacing[6],
            }}
          >
            {recentSearches.map((s) => (
              <Chip key={s} label={s} selected={false} onPress={() => commitSearch(s)} />
            ))}
          </View>
          <Text style={[typeScale.caption, { color: color.textMuted, marginBottom: spacing[2] }]}>
            Search by
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
            {['Property', 'Month', 'Supplier', 'Category', 'Amount', 'Status'].map((s) => (
              <Chip key={s} label={s} selected={false} onPress={() => {}} />
            ))}
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing[6], paddingTop: 0, gap: spacing[3] }}
          ListEmptyComponent={
            <EmptyState title="No results" description={`Nothing matched "${query}".`} />
          }
          renderItem={({ item, index }) => (
            <FadeSlideIn delay={index * 40}>
              <Pressable onPress={() => router.push(`/(app)/properties/${item.propertyId}`)}>
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[typeScale.body, { color: color.textPrimary, fontWeight: '600' }]}
                      >
                        {item.title}
                      </Text>
                      <Text style={[typeScale.micro, { color: color.textMuted, marginTop: 2 }]}>
                        {item.subtitle}
                      </Text>
                    </View>
                    {item.status ? <PaymentStatusBadge status={item.status} /> : null}
                  </View>
                </Card>
              </Pressable>
            </FadeSlideIn>
          )}
        />
      )}
    </SafeAreaView>
  );
}
