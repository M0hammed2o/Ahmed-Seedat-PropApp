import type {
  Bill,
  DocumentCategory,
  DocumentRecord,
  Payment,
  PaymentMatch,
  Property,
} from '@propvault/types';

/**
 * Realistic, hand-authored demo dataset for client demonstrations (Phase 2 — see WORKLOG.md).
 * Never mixed into production code paths: only read by src/demo/demoStore.ts, which is only
 * ever wired up when EXPO_PUBLIC_DEMO_MODE=true (see src/lib/supabase.ts, ARCHITECTURE.md).
 */

export const DEMO_USER = {
  id: 'demo-user-1',
  email: 'demo@propvault.app',
  displayName: 'Mohammed Khumalo',
};

// Added 2026-07-30 (TASKS.md M5): properties are org-scoped now, not user-scoped. Demo mode
// still has no fake org/membership layer of its own (that's separately-scoped work, not part of
// this schema cutover) - this constant exists only so DEMO_PROPERTIES has a plausible-looking
// orgId to satisfy the Property type, matching the same single-workspace assumption the rest of
// the demo dataset already makes.
export const DEMO_ORG_ID = 'demo-org-1';

export const DEMO_CATEGORIES: DocumentCategory[] = [
  {
    id: 'cat-water',
    slug: 'water',
    label: 'Water',
    isDefault: true,
    ownerUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-electricity',
    slug: 'electricity',
    label: 'Electricity',
    isDefault: true,
    ownerUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-rates',
    slug: 'rates_and_taxes',
    label: 'Rates and Taxes',
    isDefault: true,
    ownerUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-levies',
    slug: 'levies',
    label: 'Levies',
    isDefault: true,
    ownerUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-insurance',
    slug: 'insurance',
    label: 'Insurance',
    isDefault: true,
    ownerUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
];

function category(slug: string): string {
  return DEMO_CATEGORIES.find((c) => c.slug === slug)?.id ?? DEMO_CATEGORIES[0]!.id;
}

export const DEMO_PROPERTIES: Property[] = [
  {
    id: 'prop-sea-point',
    orgId: DEMO_ORG_ID,
    nickname: 'Sea Point Apartment',
    fullAddress: '12 Beach Road, Sea Point, Cape Town, Western Cape, 8005',
    addressLine1: '12 Beach Road',
    addressLine2: 'Unit 4B',
    suburb: 'Sea Point',
    city: 'Cape Town',
    province: 'Western Cape',
    postalCode: '8005',
    country: 'ZA',
    propertyType: 'apartment',
    municipalAccountNumber: '4021558790',
    notes: 'Rented out — tenant handles utilities directly for water/electricity top-ups.',
    imagePath: null,
    estimatedValue: null,
    estimatedValueAsOf: null,
    latitude: null,
    longitude: null,
    status: 'active',
    createdAt: '2026-02-03T08:00:00Z',
    updatedAt: '2026-07-18T10:00:00Z',
  },
  {
    id: 'prop-constantia',
    orgId: DEMO_ORG_ID,
    nickname: 'Constantia House',
    fullAddress: '45 Vineyard Lane, Constantia, Cape Town, Western Cape, 7806',
    addressLine1: '45 Vineyard Lane',
    addressLine2: null,
    suburb: 'Constantia',
    city: 'Cape Town',
    province: 'Western Cape',
    postalCode: '7806',
    country: 'ZA',
    propertyType: 'house',
    municipalAccountNumber: '4018827341',
    notes: 'Primary residence.',
    imagePath: null,
    estimatedValue: null,
    estimatedValueAsOf: null,
    latitude: null,
    longitude: null,
    status: 'active',
    createdAt: '2026-01-15T08:00:00Z',
    updatedAt: '2026-07-20T14:30:00Z',
  },
  {
    id: 'prop-rondebosch',
    orgId: DEMO_ORG_ID,
    nickname: 'Rondebosch Cottage',
    fullAddress: '8 Oak Avenue, Rondebosch, Cape Town, Western Cape, 7700',
    addressLine1: '8 Oak Avenue',
    addressLine2: null,
    suburb: 'Rondebosch',
    city: 'Cape Town',
    province: 'Western Cape',
    postalCode: '7700',
    country: 'ZA',
    propertyType: 'townhouse',
    municipalAccountNumber: '4033910228',
    notes: null,
    imagePath: null,
    estimatedValue: null,
    estimatedValueAsOf: null,
    latitude: null,
    longitude: null,
    status: 'active',
    createdAt: '2026-04-10T08:00:00Z',
    updatedAt: '2026-07-15T09:00:00Z',
  },
];

interface DemoDocSeed {
  id: string;
  propertyId: string;
  categorySlug: string;
  documentType: DocumentRecord['documentType'];
  fileName: string;
  billingYear: number;
  billingMonth: number;
  createdAt: string;
}

const DOC_SEEDS: DemoDocSeed[] = [
  {
    id: 'doc-sp-water-may',
    propertyId: 'prop-sea-point',
    categorySlug: 'water',
    documentType: 'bill',
    fileName: 'city-of-cape-town-water-may-2026.pdf',
    billingYear: 2026,
    billingMonth: 5,
    createdAt: '2026-05-04T09:12:00Z',
  },
  {
    id: 'doc-sp-water-june',
    propertyId: 'prop-sea-point',
    categorySlug: 'water',
    documentType: 'bill',
    fileName: 'city-of-cape-town-water-june-2026.pdf',
    billingYear: 2026,
    billingMonth: 6,
    createdAt: '2026-06-05T09:00:00Z',
  },
  {
    id: 'doc-sp-water-july',
    propertyId: 'prop-sea-point',
    categorySlug: 'water',
    documentType: 'bill',
    fileName: 'city-of-cape-town-water-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-06T08:41:00Z',
  },
  {
    id: 'doc-sp-elec-july',
    propertyId: 'prop-sea-point',
    categorySlug: 'electricity',
    documentType: 'bill',
    fileName: 'city-power-electricity-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-07T11:20:00Z',
  },
  {
    id: 'doc-sp-levy-july',
    propertyId: 'prop-sea-point',
    categorySlug: 'levies',
    documentType: 'bill',
    fileName: 'sea-point-body-corporate-levy-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-10T07:55:00Z',
  },
  {
    id: 'doc-sp-water-july-pop',
    propertyId: 'prop-sea-point',
    categorySlug: 'water',
    documentType: 'proof_of_payment',
    fileName: 'eft-confirmation-water-july.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-08T16:02:00Z',
  },

  {
    id: 'doc-con-water-july',
    propertyId: 'prop-constantia',
    categorySlug: 'water',
    documentType: 'bill',
    fileName: 'city-of-cape-town-water-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-05T10:00:00Z',
  },
  {
    id: 'doc-con-elec-july',
    propertyId: 'prop-constantia',
    categorySlug: 'electricity',
    documentType: 'bill',
    fileName: 'city-power-electricity-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-05T10:05:00Z',
  },
  {
    id: 'doc-con-rates-july',
    propertyId: 'prop-constantia',
    categorySlug: 'rates_and_taxes',
    documentType: 'bill',
    fileName: 'rates-and-taxes-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-06T12:30:00Z',
  },
  {
    id: 'doc-con-insurance-july',
    propertyId: 'prop-constantia',
    categorySlug: 'insurance',
    documentType: 'bill',
    fileName: 'santam-home-insurance-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-09T09:00:00Z',
  },
  {
    id: 'doc-con-rates-june-pop',
    propertyId: 'prop-constantia',
    categorySlug: 'rates_and_taxes',
    documentType: 'proof_of_payment',
    fileName: 'eft-confirmation-rates-june.pdf',
    billingYear: 2026,
    billingMonth: 6,
    createdAt: '2026-06-18T14:00:00Z',
  },

  {
    id: 'doc-ron-water-july',
    propertyId: 'prop-rondebosch',
    categorySlug: 'water',
    documentType: 'bill',
    fileName: 'city-of-cape-town-water-july-2026.pdf',
    billingYear: 2026,
    billingMonth: 7,
    createdAt: '2026-07-11T08:00:00Z',
  },
];

function checksumFor(id: string): string {
  return `demo${id
    .replace(/[^a-z0-9]/gi, '')
    .padEnd(58, '0')
    .slice(0, 58)}`;
}

export const DEMO_DOCUMENTS: DocumentRecord[] = DOC_SEEDS.map((seed) => ({
  id: seed.id,
  ownerUserId: DEMO_USER.id,
  orgId: DEMO_ORG_ID,
  leaseId: null,
  propertyId: seed.propertyId,
  categoryId: category(seed.categorySlug),
  documentType: seed.documentType,
  storagePath: `${DEMO_USER.id}/${seed.propertyId}/${seed.billingYear}/${seed.billingMonth}/${seed.id}.pdf`,
  originalFileName: seed.fileName,
  mimeType: 'application/pdf',
  fileSizeBytes: 180_000 + Math.floor(Math.random() * 90_000),
  checksumSha256: checksumFor(seed.id),
  billingYear: seed.billingYear,
  billingMonth: seed.billingMonth,
  deletedAt: null,
  createdAt: seed.createdAt,
  updatedAt: seed.createdAt,
}));

interface DemoBillSeed {
  documentId: string;
  propertyId: string;
  supplierName: string;
  billingYear: number;
  billingMonth: number;
  statementDate: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  accountNumber: string;
  invoiceNumber: string;
  paymentReference: string;
  status: Bill['status'];
  confidence: number;
}

const BILL_SEEDS: DemoBillSeed[] = [
  {
    documentId: 'doc-sp-water-may',
    propertyId: 'prop-sea-point',
    supplierName: 'City of Cape Town',
    billingYear: 2026,
    billingMonth: 5,
    statementDate: '2026-05-01',
    dueDate: '2026-05-25',
    amountDue: 842.5,
    amountPaid: 842.5,
    accountNumber: '4021558790',
    invoiceNumber: 'INV-5590112',
    paymentReference: '4021558790',
    status: 'paid',
    confidence: 0.94,
  },
  {
    documentId: 'doc-sp-water-june',
    propertyId: 'prop-sea-point',
    supplierName: 'City of Cape Town',
    billingYear: 2026,
    billingMonth: 6,
    statementDate: '2026-06-01',
    dueDate: '2026-06-25',
    amountDue: 910.0,
    amountPaid: 910.0,
    accountNumber: '4021558790',
    invoiceNumber: 'INV-6614302',
    paymentReference: '4021558790',
    status: 'paid',
    confidence: 0.96,
  },
  {
    documentId: 'doc-sp-water-july',
    propertyId: 'prop-sea-point',
    supplierName: 'City of Cape Town',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-01',
    dueDate: '2026-07-25',
    amountDue: 5000.0,
    amountPaid: 5000.0,
    accountNumber: '4021558790',
    invoiceNumber: 'INV-7728819',
    paymentReference: '4021558790',
    status: 'paid',
    confidence: 0.91,
  },
  {
    documentId: 'doc-sp-elec-july',
    propertyId: 'prop-sea-point',
    supplierName: 'City Power',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-01',
    dueDate: '2026-07-24',
    amountDue: 1284.3,
    amountPaid: 0,
    accountNumber: '7719004410',
    invoiceNumber: 'CP-991823',
    paymentReference: '7719004410',
    status: 'unpaid',
    confidence: 0.89,
  },
  {
    documentId: 'doc-sp-levy-july',
    propertyId: 'prop-sea-point',
    supplierName: 'Sea Point Body Corporate',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-05',
    dueDate: '2026-07-07',
    amountDue: 2150.0,
    amountPaid: 0,
    accountNumber: 'SPBC-4B',
    invoiceNumber: 'SPBC-2607',
    paymentReference: 'SPBC-4B-JUL',
    status: 'overdue',
    confidence: 0.78,
  },

  {
    documentId: 'doc-con-water-july',
    propertyId: 'prop-constantia',
    supplierName: 'City of Cape Town',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-01',
    dueDate: '2026-07-25',
    amountDue: 1120.75,
    amountPaid: 0,
    accountNumber: '4018827341',
    invoiceNumber: 'INV-7728820',
    paymentReference: '4018827341',
    status: 'unpaid',
    confidence: 0.93,
  },
  {
    documentId: 'doc-con-elec-july',
    propertyId: 'prop-constantia',
    supplierName: 'City Power',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-01',
    dueDate: '2026-07-24',
    amountDue: 2430.6,
    amountPaid: 2430.6,
    accountNumber: '7719004500',
    invoiceNumber: 'CP-991905',
    paymentReference: '7719004500',
    status: 'paid',
    confidence: 0.95,
  },
  {
    documentId: 'doc-con-rates-july',
    propertyId: 'prop-constantia',
    supplierName: 'City of Cape Town Rates',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-01',
    dueDate: '2026-07-28',
    amountDue: 3320.0,
    amountPaid: 0,
    accountNumber: '4018827341',
    invoiceNumber: 'RATES-77341',
    paymentReference: '4018827341',
    status: 'needs_review',
    confidence: 0.58,
  },
  {
    documentId: 'doc-con-insurance-july',
    propertyId: 'prop-constantia',
    supplierName: 'Santam',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-01',
    dueDate: '2026-07-15',
    amountDue: 1875.4,
    amountPaid: 1875.4,
    accountNumber: 'POL-8827341',
    invoiceNumber: 'SNT-220145',
    paymentReference: 'POL-8827341',
    status: 'paid',
    confidence: 0.97,
  },

  {
    documentId: 'doc-ron-water-july',
    propertyId: 'prop-rondebosch',
    supplierName: 'City of Cape Town',
    billingYear: 2026,
    billingMonth: 7,
    statementDate: '2026-07-01',
    dueDate: '2026-07-25',
    amountDue: 640.2,
    amountPaid: 0,
    accountNumber: '4033910228',
    invoiceNumber: 'INV-7728901',
    paymentReference: '4033910228',
    status: 'processing',
    confidence: 0.4,
  },
];

export const DEMO_BILLS: Bill[] = BILL_SEEDS.map((seed, i) => ({
  id: `bill-${i + 1}`,
  documentId: seed.documentId,
  ownerUserId: DEMO_USER.id,
  propertyId: seed.propertyId,
  supplierName: seed.supplierName,
  billingMonth: seed.billingMonth,
  billingYear: seed.billingYear,
  statementDate: seed.statementDate,
  dueDate: seed.dueDate,
  amountDue: seed.amountDue,
  amountPaid: seed.amountPaid,
  accountNumber: seed.accountNumber,
  invoiceNumber: seed.invoiceNumber,
  paymentReference: seed.paymentReference,
  notes: null,
  status: seed.status,
  extractionConfidence: seed.confidence,
  createdAt:
    DEMO_DOCUMENTS.find((d) => d.id === seed.documentId)?.createdAt ?? '2026-07-01T00:00:00Z',
  updatedAt:
    DEMO_DOCUMENTS.find((d) => d.id === seed.documentId)?.createdAt ?? '2026-07-01T00:00:00Z',
}));

export const DEMO_PAYMENTS: Payment[] = [
  {
    id: 'payment-1',
    documentId: 'doc-sp-water-july-pop',
    ownerUserId: DEMO_USER.id,
    propertyId: 'prop-sea-point',
    recipientName: 'City of Cape Town',
    amount: 5000.0,
    paymentReference: '4021558790',
    paymentDate: '2026-07-08',
    extractionConfidence: 0.92,
    createdAt: '2026-07-08T16:02:00Z',
    updatedAt: '2026-07-08T16:02:00Z',
  },
  {
    id: 'payment-2',
    documentId: 'doc-con-rates-june-pop',
    ownerUserId: DEMO_USER.id,
    propertyId: 'prop-constantia',
    recipientName: 'Municipality',
    amount: 3120.0,
    paymentReference: '4018827341',
    paymentDate: '2026-06-18',
    extractionConfidence: 0.81,
    createdAt: '2026-06-18T14:00:00Z',
    updatedAt: '2026-06-18T14:00:00Z',
  },
];

export const DEMO_PAYMENT_MATCHES: PaymentMatch[] = [
  {
    id: 'match-1',
    paymentId: 'payment-1',
    billId: DEMO_BILLS.find((b) => b.documentId === 'doc-sp-water-july')!.id,
    ownerUserId: DEMO_USER.id,
    matchScore: 96,
    status: 'confirmed',
    matchedFields: ['property', 'amount', 'reference', 'supplier', 'period'],
    conflictingFields: [],
    confirmedAt: '2026-07-08T16:05:00Z',
    confirmedByUserId: DEMO_USER.id,
    createdAt: '2026-07-08T16:03:00Z',
    updatedAt: '2026-07-08T16:05:00Z',
  },
];

export interface DemoNotification {
  id: string;
  type: 'due_soon' | 'overdue' | 'missing' | 'needs_review' | 'storage_warning';
  title: string;
  body: string;
  propertyId: string | null;
  createdAt: string;
  read: boolean;
}

export const DEMO_NOTIFICATIONS: DemoNotification[] = [
  {
    id: 'notif-1',
    type: 'overdue',
    title: 'Levy overdue',
    body: 'Sea Point Apartment — Body Corporate levy is overdue by 15 days.',
    propertyId: 'prop-sea-point',
    createdAt: '2026-07-21T08:00:00Z',
    read: false,
  },
  {
    id: 'notif-2',
    type: 'needs_review',
    title: 'Rates bill needs review',
    body: 'Constantia House — extracted amount has low confidence, please confirm.',
    propertyId: 'prop-constantia',
    createdAt: '2026-07-20T09:15:00Z',
    read: false,
  },
  {
    id: 'notif-3',
    type: 'due_soon',
    title: 'Electricity due soon',
    body: 'Sea Point Apartment — City Power bill is due in 3 days.',
    propertyId: 'prop-sea-point',
    createdAt: '2026-07-21T07:00:00Z',
    read: false,
  },
  {
    id: 'notif-4',
    type: 'missing',
    title: 'Missing document',
    body: 'Rondebosch Cottage — no electricity bill uploaded for July yet.',
    propertyId: 'prop-rondebosch',
    createdAt: '2026-07-19T12:00:00Z',
    read: true,
  },
  {
    id: 'notif-5',
    type: 'storage_warning',
    title: 'Storage 62% used',
    body: "You're using 1.27GB of your 2GB storage allowance.",
    propertyId: null,
    createdAt: '2026-07-15T10:00:00Z',
    read: true,
  },
];

export const DEMO_EXPECTED_CATEGORIES: Record<string, string[]> = {
  'prop-sea-point': ['water', 'electricity', 'levies'],
  'prop-constantia': ['water', 'electricity', 'rates_and_taxes', 'insurance'],
  'prop-rondebosch': ['water', 'electricity'],
};

export const DEMO_SUBSCRIPTION = {
  planId: 'propvault_base',
  status: 'active' as const,
  renewalDate: '2026-08-21',
  storageUsedMb: 1274,
  storageAllowanceMb: 2048,
};
