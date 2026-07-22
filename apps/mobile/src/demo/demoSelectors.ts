import type { Bill, DocumentRecord } from '@propvault/types';
import { isOverdue } from '@propvault/utils';
import type { PropertyHealthItem } from '@/design/components/PropertyHealthCard';
import { DEMO_CATEGORIES } from './mockData';
import { useDemoStore } from './demoStore';

/**
 * Derived/computed views over the demo store — the client-side equivalent of what
 * `calculate_monthly_checklist()` and a few dashboard aggregate queries do server-side in
 * production (see DATABASE.md). Kept in one place so every demo screen computes these
 * identically rather than re-deriving ad hoc.
 */

export interface DashboardStats {
  propertyCount: number;
  billsDueSoon: number;
  billsOverdue: number;
  billsPaidThisMonth: number;
  missingDocuments: number;
  documentsAwaitingReview: number;
  monthlyCompletionPercent: number;
  recentUploads: DocumentRecord[];
}

const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 7;

export function useDashboardStats(): DashboardStats {
  const { properties, bills, documents, expectedCategories } = useDemoStore();
  const activeProperties = properties.filter((p) => p.status === 'active');

  const now = new Date('2026-07-22T00:00:00Z');
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  let billsDueSoon = 0;
  let billsOverdue = 0;
  let billsPaidThisMonth = 0;

  for (const bill of bills) {
    if (
      bill.status === 'paid' &&
      bill.billingYear === CURRENT_YEAR &&
      bill.billingMonth === CURRENT_MONTH
    ) {
      billsPaidThisMonth += 1;
    }
    if (
      bill.status === 'overdue' ||
      (bill.dueDate && isOverdue(bill.dueDate, now) && bill.status !== 'paid')
    ) {
      billsOverdue += 1;
    } else if (bill.dueDate && new Date(bill.dueDate) <= in14Days && bill.status === 'unpaid') {
      billsDueSoon += 1;
    }
  }

  const documentsAwaitingReview = bills.filter(
    (b) => b.status === 'needs_review' || b.status === 'processing',
  ).length;

  let expectedCount = 0;
  let satisfiedCount = 0;
  for (const property of activeProperties) {
    const expected = expectedCategories[property.id] ?? [];
    for (const slug of expected) {
      expectedCount += 1;
      const hasDoc = documents.some(
        (d) =>
          d.propertyId === property.id &&
          d.billingYear === CURRENT_YEAR &&
          d.billingMonth === CURRENT_MONTH &&
          DEMO_CATEGORIES.find((c) => c.id === d.categoryId)?.slug === slug,
      );
      if (hasDoc) satisfiedCount += 1;
    }
  }
  const missingDocuments = expectedCount - satisfiedCount;
  const monthlyCompletionPercent =
    expectedCount === 0 ? 100 : Math.round((satisfiedCount / expectedCount) * 100);

  const recentUploads = [...documents]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 5);

  return {
    propertyCount: activeProperties.length,
    billsDueSoon,
    billsOverdue,
    billsPaidThisMonth,
    missingDocuments: Math.max(missingDocuments, 0),
    documentsAwaitingReview,
    monthlyCompletionPercent,
    recentUploads,
  };
}

export interface PropertyHealth {
  score: number;
  items: PropertyHealthItem[];
}

export function usePropertyHealth(propertyId: string): PropertyHealth {
  const { bills, documents, expectedCategories } = useDemoStore();
  const expected = expectedCategories[propertyId] ?? [];

  const items: PropertyHealthItem[] = expected.map((slug) => {
    const category = DEMO_CATEGORIES.find((c) => c.slug === slug)!;
    const doc = documents.find(
      (d) =>
        d.propertyId === propertyId &&
        d.categoryId === category.id &&
        d.billingYear === CURRENT_YEAR &&
        d.billingMonth === CURRENT_MONTH,
    );
    if (!doc) return { categorySlug: slug, label: category.label, status: 'missing' };
    const bill = bills.find((b) => b.documentId === doc.id);
    return {
      categorySlug: slug,
      label: category.label,
      status: (bill?.status as PropertyHealthItem['status']) ?? 'missing',
    };
  });

  const weight: Record<PropertyHealthItem['status'], number> = {
    paid: 1,
    unpaid: 0.4,
    needs_review: 0.5,
    processing: 0.5,
    overdue: 0,
    missing: 0,
  };
  const score =
    items.length === 0
      ? 100
      : Math.round((items.reduce((sum, i) => sum + weight[i.status], 0) / items.length) * 100);

  return { score, items };
}

export interface ChecklistRow {
  categorySlug: string;
  label: string;
  isExpected: boolean;
  document: DocumentRecord | null;
  bill: Bill | null;
  hasProofOfPayment: boolean;
}

export function useMonthlyChecklist(
  propertyId: string,
  year: number,
  month: number,
): ChecklistRow[] {
  const { documents, bills, paymentMatches, expectedCategories } = useDemoStore();
  const expected = expectedCategories[propertyId] ?? [];

  return DEMO_CATEGORIES.filter(
    (c) => c.slug !== 'proof_of_payment' && c.slug !== 'receipt' && c.slug !== 'other',
  )
    .map((cat) => {
      const document =
        documents.find(
          (d) =>
            d.propertyId === propertyId &&
            d.categoryId === cat.id &&
            d.billingYear === year &&
            d.billingMonth === month,
        ) ?? null;
      const bill = document ? (bills.find((b) => b.documentId === document.id) ?? null) : null;
      const hasProofOfPayment = bill
        ? paymentMatches.some((m) => m.billId === bill.id && m.status === 'confirmed')
        : false;
      return {
        categorySlug: cat.slug,
        label: cat.label,
        isExpected: expected.includes(cat.slug),
        document,
        bill,
        hasProofOfPayment,
      };
    })
    .filter((row) => row.isExpected || row.document);
}

export function useRecentActivity(propertyId: string) {
  const { documents, bills, payments } = useDemoStore();
  const propertyDocs = documents.filter((d) => d.propertyId === propertyId);
  const propertyBills = bills
    .filter((b) => b.propertyId === propertyId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const propertyPayments = payments
    .filter((p) => p.propertyId === propertyId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const recentUploads = [...propertyDocs]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 5);
  return {
    recentBills: propertyBills.slice(0, 5),
    recentPayments: propertyPayments.slice(0, 5),
    recentUploads,
  };
}
