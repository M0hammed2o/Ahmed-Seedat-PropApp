import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { tierForScore } from '@propvault/config';
import { useDemoStore } from '@/demo/demoStore';
import { useTheme } from '@/design/theme';
import {
  Card,
  ConfirmationSheet,
  FadeSlideIn,
  PrimaryButton,
  SuccessCheck,
} from '@/design/components';

const FIELD_LABEL: Record<string, string> = {
  property: 'Property',
  amount: 'Amount',
  amount_within_tolerance: 'Amount (close match)',
  reference: 'Reference / account number',
  supplier: 'Supplier / recipient',
  period: 'Billing period',
};

export default function PaymentMatchScreen() {
  const { id, matchId } = useLocalSearchParams<{ id: string; matchId: string }>();
  const { color, spacing, radii, typeScale } = useTheme();
  const match = useDemoStore((s) => s.paymentMatches.find((m) => m.id === matchId));
  const bill = useDemoStore((s) => s.bills.find((b) => b.id === match?.billId));
  const payment = useDemoStore((s) => s.payments.find((p) => p.id === match?.paymentId));
  const confirmMatch = useDemoStore((s) => s.confirmMatch);
  const rejectMatch = useDemoStore((s) => s.rejectMatch);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmRejectVisible, setConfirmRejectVisible] = useState(false);

  if (!match || !bill || !payment) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: color.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: color.textSecondary }}>Match not found.</Text>
      </SafeAreaView>
    );
  }

  const tier = tierForScore(match.matchScore);
  const tierLabel =
    tier === 'strong'
      ? 'Strong Match Found'
      : tier === 'possible'
        ? 'Possible Match — Please Review'
        : 'Match Unlikely';
  const tierColor =
    tier === 'strong'
      ? color.statusPaid
      : tier === 'possible'
        ? color.statusNeedsReview
        : color.statusOverdue;

  if (confirmed) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: color.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SuccessCheck />
        <Text style={[typeScale.title, { color: color.textPrimary, marginTop: spacing[4] }]}>
          Payment matched
        </Text>
        <Text style={[typeScale.body, { color: color.textSecondary, marginTop: spacing[1] }]}>
          {bill.supplierName} is now marked as paid.
        </Text>
        <View style={{ marginTop: spacing[6], width: '80%' }}>
          <PrimaryButton
            label="Back to property"
            onPress={() => router.replace(`/(app)/properties/${id}`)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing[6] }}>
        <FadeSlideIn>
          <View style={{ alignItems: 'center', marginBottom: spacing[6] }}>
            <View
              style={{
                paddingHorizontal: spacing[4],
                paddingVertical: spacing[2],
                borderRadius: radii.pill,
                backgroundColor: `${tierColor}1A`,
              }}
            >
              <Text style={[typeScale.heading, { color: tierColor }]}>{tierLabel}</Text>
            </View>
            <Text style={[typeScale.display, { color: color.textPrimary, marginTop: spacing[4] }]}>
              {match.matchScore}%
            </Text>
            <Text style={[typeScale.caption, { color: color.textMuted }]}>Confidence</Text>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={60}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing[3],
              marginBottom: spacing[6],
            }}
          >
            <FlowNode label="Bill uploaded" />
            <Text style={{ color: color.textMuted }}>→</Text>
            <FlowNode label="Proof uploaded" />
            <Text style={{ color: color.textMuted }}>→</Text>
            <FlowNode label="AI compared" />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={100}>
          <Card>
            <Text
              style={[typeScale.heading, { color: color.textPrimary, marginBottom: spacing[3] }]}
            >
              {bill.supplierName}
            </Text>
            <Row label="Payment amount" value={`R${payment.amount?.toFixed(2)}`} />
            <Row label="Bill amount due" value={`R${bill.amountDue?.toFixed(2)}`} />
            <Row label="Account number" value={bill.accountNumber ?? '—'} />
            <Row label="Payment reference" value={payment.paymentReference ?? '—'} />
          </Card>
        </FadeSlideIn>

        <FadeSlideIn delay={140}>
          <Text
            style={[
              typeScale.heading,
              { color: color.textPrimary, marginTop: spacing[6], marginBottom: spacing[2] },
            ]}
          >
            Matched fields
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
            {match.matchedFields.map((f) => (
              <Badge key={f} label={FIELD_LABEL[f] ?? f} tone={color.statusPaid} />
            ))}
          </View>
          {match.conflictingFields.length > 0 ? (
            <>
              <Text
                style={[
                  typeScale.heading,
                  { color: color.textPrimary, marginTop: spacing[5], marginBottom: spacing[2] },
                ]}
              >
                Conflicting fields
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
                {match.conflictingFields.map((f) => (
                  <Badge key={f} label={FIELD_LABEL[f] ?? f} tone={color.statusOverdue} />
                ))}
              </View>
            </>
          ) : null}
        </FadeSlideIn>

        <FadeSlideIn delay={180}>
          <View style={{ marginTop: spacing[7], gap: spacing[3] }}>
            <PrimaryButton
              label="Confirm match"
              onPress={() => {
                confirmMatch(match.id);
                setConfirmed(true);
              }}
            />
            <PrimaryButton
              label="Reject"
              variant="secondary"
              onPress={() => setConfirmRejectVisible(true)}
            />
          </View>
        </FadeSlideIn>
      </ScrollView>

      <ConfirmationSheet
        visible={confirmRejectVisible}
        title="Reject this match?"
        description="The bill and proof of payment will remain unmatched — you can match them manually later."
        confirmLabel="Reject match"
        destructive
        onConfirm={() => {
          rejectMatch(match.id);
          setConfirmRejectVisible(false);
          router.replace(`/(app)/properties/${id}`);
        }}
        onCancel={() => setConfirmRejectVisible(false)}
      />
    </SafeAreaView>
  );
}

function FlowNode({ label }: { label: string }) {
  const { color, radii, spacing, typeScale } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[2],
        borderRadius: radii.md,
        backgroundColor: color.surfaceRaised,
        borderWidth: 1,
        borderColor: color.border,
      }}
    >
      <Text style={[typeScale.micro, { color: color.textPrimary }]}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { color, spacing, typeScale } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[1] }}
    >
      <Text style={[typeScale.caption, { color: color.textMuted }]}>{label}</Text>
      <Text style={[typeScale.body, { color: color.textPrimary }]}>{value}</Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  const { radii, spacing, typeScale } = useTheme();
  return (
    <View
      style={{
        backgroundColor: `${tone}1A`,
        borderRadius: radii.pill,
        paddingHorizontal: spacing[3],
        paddingVertical: 4,
      }}
    >
      <Text style={[typeScale.micro, { color: tone, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}
