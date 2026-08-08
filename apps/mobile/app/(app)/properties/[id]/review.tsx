import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import type { DocumentType } from '@propvault/types';
import { calculateMatchScore } from '@propvault/utils';
import { MATCH_THRESHOLDS } from '@propvault/config';
import { generateExtraction } from '@/demo/extractionTemplates';
import { useDemoStore } from '@/demo/demoStore';
import { DEMO_CATEGORIES } from '@/demo/mockData';
import { useTheme } from '@/design/theme';
import {
  Card,
  ConfidenceBadge,
  EditableRow,
  FadeSlideIn,
  PrimaryButton,
} from '@/design/components';

export default function ReviewExtractionScreen() {
  const { id, documentId, categorySlug, documentType } = useLocalSearchParams<{
    id: string;
    documentId: string;
    categorySlug: string;
    documentType: DocumentType;
  }>();
  const { color, spacing, typeScale } = useTheme();
  const property = useDemoStore((s) => s.properties.find((p) => p.id === id));
  const saveBill = useDemoStore((s) => s.saveBillFromExtraction);
  const savePayment = useDemoStore((s) => s.savePaymentFromExtraction);
  const proposeMatch = useDemoStore((s) => s.proposeMatch);
  const bills = useDemoStore((s) => s.bills);
  const payments = useDemoStore((s) => s.payments);
  const paymentMatches = useDemoStore((s) => s.paymentMatches);

  const extraction = useMemo(
    () => generateExtraction(id, categorySlug, documentType),
    [id, categorySlug, documentType],
  );
  const isPayment = extraction.kind === 'payment';
  const categoryLabel = DEMO_CATEGORIES.find((c) => c.slug === categorySlug)?.label ?? categorySlug;

  const initialSupplier =
    extraction.kind === 'payment'
      ? extraction.fields.recipientName
      : extraction.fields.supplierName;
  const initialAmount =
    extraction.kind === 'payment' ? extraction.fields.amount : extraction.fields.amountDue;
  const initialAccountNumber = extraction.kind === 'bill' ? extraction.fields.accountNumber : '';
  const initialDueOrPaymentDate =
    extraction.kind === 'payment' ? extraction.fields.paymentDate : extraction.fields.dueDate;

  const [supplier, setSupplier] = useState(initialSupplier);
  const [amount, setAmount] = useState(String(initialAmount));
  const [accountNumber, setAccountNumber] = useState(initialAccountNumber);
  const [reference, setReference] = useState(extraction.fields.paymentReference);
  const [dueOrPaymentDate, setDueOrPaymentDate] = useState(initialDueOrPaymentDate);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    const amountNumber = Number.parseFloat(amount) || 0;

    if (isPayment) {
      const payment = savePayment(documentId, {
        recipientName: supplier,
        amount: amountNumber,
        paymentReference: reference,
        paymentDate: dueOrPaymentDate,
        extractionConfidence: extraction.fields.confidence,
      });

      const candidates = bills.filter(
        (b) =>
          b.propertyId === id &&
          b.status !== 'paid' &&
          !paymentMatches.some((m) => m.billId === b.id && m.status === 'confirmed'),
      );
      let best: {
        billId: string;
        score: number;
        matchedFields: string[];
        conflictingFields: string[];
      } | null = null;
      for (const bill of candidates) {
        const result = calculateMatchScore({ bill, payment });
        if (!best || result.score > best.score)
          best = {
            billId: bill.id,
            score: result.score,
            matchedFields: result.matchedFields,
            conflictingFields: result.conflictingFields,
          };
      }

      if (best && best.score >= MATCH_THRESHOLDS.possible) {
        const match = proposeMatch(
          payment.id,
          best.billId,
          best.score,
          best.matchedFields,
          best.conflictingFields,
        );
        router.replace({
          pathname: '/(app)/properties/[id]/match',
          params: { id, matchId: match.id },
        });
        return;
      }
      router.replace({ pathname: '/(app)/properties/[id]', params: { id } });
      return;
    }

    const bill = saveBill(documentId, {
      supplierName: supplier,
      amountDue: amountNumber,
      accountNumber,
      paymentReference: reference,
      dueDate: dueOrPaymentDate,
      status: 'unpaid',
      extractionConfidence: extraction.fields.confidence,
    });

    const candidates = payments.filter(
      (p) =>
        p.propertyId === id &&
        !paymentMatches.some((m) => m.paymentId === p.id && m.status === 'confirmed'),
    );
    let best: {
      paymentId: string;
      score: number;
      matchedFields: string[];
      conflictingFields: string[];
    } | null = null;
    for (const payment of candidates) {
      const result = calculateMatchScore({ bill, payment });
      if (!best || result.score > best.score)
        best = {
          paymentId: payment.id,
          score: result.score,
          matchedFields: result.matchedFields,
          conflictingFields: result.conflictingFields,
        };
    }

    if (best && best.score >= MATCH_THRESHOLDS.possible) {
      const match = proposeMatch(
        best.paymentId,
        bill.id,
        best.score,
        best.matchedFields,
        best.conflictingFields,
      );
      router.replace({
        pathname: '/(app)/properties/[id]/match',
        params: { id, matchId: match.id },
      });
      return;
    }
    router.replace({ pathname: '/(app)/properties/[id]', params: { id } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <FadeSlideIn>
          <Text style={[typeScale.title, { color: color.textPrimary }]}>
            Review extracted details
          </Text>
          <Text
            style={[
              typeScale.body,
              { color: color.textSecondary, marginTop: spacing[1], marginBottom: spacing[4] },
            ]}
          >
            Confirm or correct what Proplyst read from your document before saving.
          </Text>
          <ConfidenceBadge confidence={extraction.fields.confidence} />
        </FadeSlideIn>

        <FadeSlideIn delay={60}>
          <Card style={{ marginTop: spacing[5] }}>
            <EditableRow
              label={isPayment ? 'Recipient' : 'Supplier'}
              value={supplier ?? ''}
              onChangeText={setSupplier}
            />
            <View style={{ height: 1, backgroundColor: color.border }} />
            <EditableRow
              label="Property"
              value={property?.nickname ?? ''}
              onChangeText={() => {}}
            />
            <View style={{ height: 1, backgroundColor: color.border }} />
            <EditableRow label="Category" value={categoryLabel} onChangeText={() => {}} />
            <View style={{ height: 1, backgroundColor: color.border }} />
            <EditableRow
              label="Amount (R)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <View style={{ height: 1, backgroundColor: color.border }} />
            <EditableRow
              label={isPayment ? 'Payment date' : 'Due date'}
              value={dueOrPaymentDate ?? ''}
              onChangeText={setDueOrPaymentDate}
            />
            {!isPayment ? (
              <>
                <View style={{ height: 1, backgroundColor: color.border }} />
                <EditableRow
                  label="Account number"
                  value={accountNumber ?? ''}
                  onChangeText={setAccountNumber}
                />
              </>
            ) : null}
            <View style={{ height: 1, backgroundColor: color.border }} />
            <EditableRow label="Reference" value={reference ?? ''} onChangeText={setReference} />
          </Card>
        </FadeSlideIn>

        <FadeSlideIn delay={100}>
          <View style={{ marginTop: spacing[6] }}>
            <PrimaryButton label="Save" loading={saving} onPress={handleSave} />
          </View>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
  );
}
