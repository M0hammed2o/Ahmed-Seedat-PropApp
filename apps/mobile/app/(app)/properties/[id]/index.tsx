import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import {
  usePropertyQuery,
  useArchivePropertyMutation,
} from '@/features/properties/usePropertiesQuery';
import { usePropertyHealth, useRecentActivity } from '@/demo/demoSelectors';
import { useTheme } from '@/design/theme';
import {
  Card,
  ConfirmationSheet,
  ErrorState,
  FadeSlideIn,
  PaymentStatusBadge,
  PrimaryButton,
  PropertyHealthCard,
  SkeletonState,
} from '@/design/components';

const PROPERTY_TYPE_LABEL: Record<string, string> = {
  house: 'House',
  apartment: 'Apartment',
  townhouse: 'Townhouse',
  vacant_land: 'Vacant Land',
  commercial: 'Commercial',
  other: 'Other',
};

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { color, spacing, radii, typeScale } = useTheme();
  const propertyQuery = usePropertyQuery(id);
  const health = usePropertyHealth(id);
  const { recentBills, recentPayments, recentUploads } = useRecentActivity(id);
  const archiveMutation = useArchivePropertyMutation();
  const [confirmArchiveVisible, setConfirmArchiveVisible] = useState(false);

  if (propertyQuery.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
        <SkeletonState rows={4} />
      </SafeAreaView>
    );
  }

  if (propertyQuery.isError || !propertyQuery.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
        <ErrorState onRetry={() => propertyQuery.refetch?.()} />
      </SafeAreaView>
    );
  }

  const property = propertyQuery.data;
  const overdueBills = recentBills.filter((b) => b.status === 'overdue' || b.status === 'unpaid');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing[8] }}>
        {/* Hero */}
        <FadeSlideIn>
          <View
            style={{
              backgroundColor: color.surfaceRaised,
              paddingHorizontal: spacing[6],
              paddingTop: spacing[6],
              paddingBottom: spacing[5],
              borderBottomWidth: 1,
              borderBottomColor: color.border,
            }}
          >
            <View
              style={{
                alignSelf: 'flex-start',
                backgroundColor: `${color.accent}1A`,
                borderRadius: radii.pill,
                paddingHorizontal: spacing[3],
                paddingVertical: 4,
                marginBottom: spacing[3],
              }}
            >
              <Text style={[typeScale.micro, { color: color.accent, fontWeight: '700' }]}>
                {PROPERTY_TYPE_LABEL[property.propertyType] ?? property.propertyType}
              </Text>
            </View>
            <Text style={[typeScale.display, { color: color.textPrimary }]}>
              {property.nickname}
            </Text>
            <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[1] }]}>
              {property.fullAddress}
            </Text>
            {property.municipalAccountNumber ? (
              <Text style={[typeScale.caption, { color: color.textMuted, marginTop: spacing[2] }]}>
                Municipal account · {property.municipalAccountNumber}
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing[3], marginTop: spacing[5] }}>
              <QuickAction
                label="Upload bill"
                onPress={() => router.push(`/(app)/properties/${id}/upload`)}
              />
              <QuickAction
                label="Checklist"
                onPress={() => router.push(`/(app)/properties/${id}/checklist`)}
              />
              <QuickAction
                label="Search"
                onPress={() =>
                  router.push({ pathname: '/(app)/search', params: { propertyId: id } })
                }
              />
            </View>
          </View>
        </FadeSlideIn>

        <View style={{ padding: spacing[6], gap: spacing[5] }}>
          <FadeSlideIn delay={60}>
            <PropertyHealthCard score={health.score} items={health.items} />
          </FadeSlideIn>

          {overdueBills.length > 0 ? (
            <FadeSlideIn delay={100}>
              <Text
                style={[typeScale.heading, { color: color.textPrimary, marginBottom: spacing[3] }]}
              >
                Needs attention
              </Text>
              <Card>
                {overdueBills.map((bill, i) => (
                  <View
                    key={bill.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: spacing[2],
                      borderBottomWidth: i === overdueBills.length - 1 ? 0 : 1,
                      borderBottomColor: color.border,
                    }}
                  >
                    <View>
                      <Text style={[typeScale.body, { color: color.textPrimary }]}>
                        {bill.supplierName}
                      </Text>
                      <Text style={[typeScale.micro, { color: color.textMuted }]}>
                        R{bill.amountDue?.toFixed(2)} · due{' '}
                        {bill.dueDate
                          ? new Date(bill.dueDate).toLocaleDateString('en-ZA', {
                              day: 'numeric',
                              month: 'short',
                            })
                          : '—'}
                      </Text>
                    </View>
                    <PaymentStatusBadge status={bill.status} />
                  </View>
                ))}
              </Card>
            </FadeSlideIn>
          ) : null}

          <FadeSlideIn delay={140}>
            <Text
              style={[typeScale.heading, { color: color.textPrimary, marginBottom: spacing[3] }]}
            >
              Recent bills
            </Text>
            {recentBills.length === 0 ? (
              <Card>
                <Text style={[typeScale.caption, { color: color.textMuted }]}>
                  No bills uploaded yet for this property.
                </Text>
              </Card>
            ) : (
              <Card>
                {recentBills.map((bill, i) => (
                  <View
                    key={bill.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: spacing[2],
                      borderBottomWidth: i === recentBills.length - 1 ? 0 : 1,
                      borderBottomColor: color.border,
                    }}
                  >
                    <View>
                      <Text style={[typeScale.body, { color: color.textPrimary }]}>
                        {bill.supplierName}
                      </Text>
                      <Text style={[typeScale.micro, { color: color.textMuted }]}>
                        R{bill.amountDue?.toFixed(2)}
                      </Text>
                    </View>
                    <PaymentStatusBadge status={bill.status} />
                  </View>
                ))}
              </Card>
            )}
          </FadeSlideIn>

          {recentPayments.length > 0 ? (
            <FadeSlideIn delay={180}>
              <Text
                style={[typeScale.heading, { color: color.textPrimary, marginBottom: spacing[3] }]}
              >
                Recent payments
              </Text>
              <Card>
                {recentPayments.map((payment, i) => (
                  <View
                    key={payment.id}
                    style={{
                      paddingVertical: spacing[2],
                      borderBottomWidth: i === recentPayments.length - 1 ? 0 : 1,
                      borderBottomColor: color.border,
                    }}
                  >
                    <Text style={[typeScale.body, { color: color.textPrimary }]}>
                      {payment.recipientName}
                    </Text>
                    <Text style={[typeScale.micro, { color: color.textMuted }]}>
                      R{payment.amount?.toFixed(2)} ·{' '}
                      {payment.paymentDate
                        ? new Date(payment.paymentDate).toLocaleDateString('en-ZA', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}
                    </Text>
                  </View>
                ))}
              </Card>
            </FadeSlideIn>
          ) : null}

          {recentUploads.length > 0 ? (
            <FadeSlideIn delay={220}>
              <Text
                style={[typeScale.heading, { color: color.textPrimary, marginBottom: spacing[3] }]}
              >
                Recent uploads
              </Text>
              <Card>
                {recentUploads.map((doc, i) => (
                  <View
                    key={doc.id}
                    style={{
                      paddingVertical: spacing[2],
                      borderBottomWidth: i === recentUploads.length - 1 ? 0 : 1,
                      borderBottomColor: color.border,
                    }}
                  >
                    <Text style={[typeScale.body, { color: color.textPrimary }]} numberOfLines={1}>
                      {doc.originalFileName}
                    </Text>
                    <Text style={[typeScale.micro, { color: color.textMuted }]}>
                      {new Date(doc.createdAt).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                  </View>
                ))}
              </Card>
            </FadeSlideIn>
          ) : null}

          <FadeSlideIn delay={260}>
            <PrimaryButton
              label="Archive property"
              variant="secondary"
              onPress={() => setConfirmArchiveVisible(true)}
            />
          </FadeSlideIn>
        </View>
      </ScrollView>

      <ConfirmationSheet
        visible={confirmArchiveVisible}
        title="Archive this property?"
        description="Archived properties are hidden from your active list but nothing is deleted — you can restore them any time."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => {
          await archiveMutation.mutateAsync(property.id);
          setConfirmArchiveVisible(false);
          router.back();
        }}
        onCancel={() => setConfirmArchiveVisible(false)}
      />
    </SafeAreaView>
  );
}

function QuickAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing[2],
        borderRadius: radii.md,
        backgroundColor: color.surface,
        borderWidth: 1,
        borderColor: color.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={[typeScale.caption, { color: color.textPrimary, fontWeight: '600' }]}>
        {label}
      </Text>
    </Pressable>
  );
}
