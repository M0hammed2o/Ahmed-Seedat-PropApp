/**
 * Realistic mock data for the admin dashboard demo (Phase 2 — see WORKLOG.md). Only ever read
 * when NEXT_PUBLIC_DEMO_MODE=true (see lib/demoMode.ts); the real pages read live Supabase data
 * via the service-role client exactly as documented in ADMIN_DASHBOARD.md/SECURITY.md. Never
 * mixed into the production code path — this file is the single, explicit boundary.
 */

export interface DemoAdminSession {
  id: string;
  authUserId: string;
  role: 'super_admin' | 'support_admin' | 'operations_admin' | 'read_only_admin';
  displayName: string;
}

export const DEMO_ADMIN_SESSION: DemoAdminSession = {
  id: 'demo-platform-admin-1',
  authUserId: 'demo-admin-1',
  role: 'super_admin',
  displayName: 'Ahmed Seedat',
};

export interface DemoCustomer {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
  propertyCount: number;
  documentCount: number;
  storageUsedMb: number;
  subscriptionStatus:
    'trialing' | 'active' | 'grace_period' | 'billing_issue' | 'expired' | 'cancelled';
  lastActiveAt: string;
}

const FIRST_NAMES = [
  'Mohammed',
  'Thabo',
  'Aisha',
  'Johan',
  'Lerato',
  'Pieter',
  'Zanele',
  'Sipho',
  'Farah',
  'Karabo',
  'Michael',
  'Nomvula',
  'Riaan',
  'Amahle',
  'David',
  'Bongani',
  'Chantelle',
  'Kagiso',
];
const LAST_NAMES = [
  'Khumalo',
  'Nkosi',
  'van der Merwe',
  'Dlamini',
  'Botha',
  'Mokoena',
  'Pillay',
  'Naidoo',
  'Fourie',
  'Mahlangu',
  'Smith',
  'Ndlovu',
  'Petersen',
  'Zulu',
  'Adams',
];

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

const rand = seededRandom(42);

export const DEMO_CUSTOMERS: DemoCustomer[] = Array.from({ length: 24 }, (_, i) => {
  const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
  const last = LAST_NAMES[(i * 3) % LAST_NAMES.length]!;
  const statuses: DemoCustomer['subscriptionStatus'][] = [
    'active',
    'active',
    'active',
    'trialing',
    'active',
    'grace_period',
    'billing_issue',
    'expired',
    'active',
    'cancelled',
  ];
  const daysAgo = Math.floor(rand() * 180);
  const created = new Date('2026-07-21T00:00:00Z');
  created.setDate(created.getDate() - daysAgo);
  const lastActive = new Date(created);
  lastActive.setDate(lastActive.getDate() + Math.floor(rand() * daysAgo));

  return {
    id: `cust-${i + 1}`,
    displayName: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
    createdAt: created.toISOString(),
    propertyCount: 1 + Math.floor(rand() * 5),
    documentCount: 3 + Math.floor(rand() * 40),
    storageUsedMb: 20 + Math.floor(rand() * 900),
    subscriptionStatus: statuses[i % statuses.length]!,
    lastActiveAt: lastActive.toISOString(),
  };
});

export const DEMO_OVERVIEW_STATS = {
  totalCustomers: DEMO_CUSTOMERS.length,
  activeSubscribers: DEMO_CUSTOMERS.filter((c) => c.subscriptionStatus === 'active').length,
  trialingCustomers: DEMO_CUSTOMERS.filter((c) => c.subscriptionStatus === 'trialing').length,
  billingIssues: DEMO_CUSTOMERS.filter((c) => c.subscriptionStatus === 'billing_issue').length,
  expiredSubscriptions: DEMO_CUSTOMERS.filter((c) => c.subscriptionStatus === 'expired').length,
  newRegistrationsLast30Days: 7,
  totalProperties: DEMO_CUSTOMERS.reduce((sum, c) => sum + c.propertyCount, 0),
  totalDocuments: DEMO_CUSTOMERS.reduce((sum, c) => sum + c.documentCount, 0),
  totalStorageGb:
    Math.round((DEMO_CUSTOMERS.reduce((sum, c) => sum + c.storageUsedMb, 0) / 1024) * 10) / 10,
  monthlyRecurringRevenueZar:
    DEMO_CUSTOMERS.filter((c) => c.subscriptionStatus === 'active').length * 149,
};

/** Last 6 months, MRR in ZAR — deliberately trending upward for a compelling demo chart. */
export const DEMO_REVENUE_SERIES = [
  { month: 'Feb', mrr: 3420 },
  { month: 'Mar', mrr: 4180 },
  { month: 'Apr', mrr: 4750 },
  { month: 'May', mrr: 5390 },
  { month: 'Jun', mrr: 6280 },
  { month: 'Jul', mrr: 7154 },
];

export const DEMO_SIGNUP_SERIES = [
  { month: 'Feb', signups: 4 },
  { month: 'Mar', signups: 3 },
  { month: 'Apr', signups: 5 },
  { month: 'May', signups: 3 },
  { month: 'Jun', signups: 6 },
  { month: 'Jul', signups: 7 },
];

export interface DemoOcrJob {
  id: string;
  customerName: string;
  documentName: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  provider: string;
  durationMs: number | null;
  createdAt: string;
  errorCategory: string | null;
}

export const DEMO_OCR_JOBS: DemoOcrJob[] = [
  {
    id: 'job-1',
    customerName: 'Mohammed Khumalo',
    documentName: 'city-of-cape-town-water-july-2026.pdf',
    status: 'succeeded',
    provider: 'mock',
    durationMs: 1840,
    createdAt: '2026-07-21T14:22:00Z',
    errorCategory: null,
  },
  {
    id: 'job-2',
    customerName: 'Thabo Nkosi',
    documentName: 'city-power-electricity-july-2026.pdf',
    status: 'succeeded',
    provider: 'mock',
    durationMs: 2210,
    createdAt: '2026-07-21T13:10:00Z',
    errorCategory: null,
  },
  {
    id: 'job-3',
    customerName: 'Aisha van der Merwe',
    documentName: 'rates-and-taxes-july-2026.pdf',
    status: 'processing',
    provider: 'mock',
    durationMs: null,
    createdAt: '2026-07-21T15:02:00Z',
    errorCategory: null,
  },
  {
    id: 'job-4',
    customerName: 'Johan Dlamini',
    documentName: 'santam-home-insurance-july.jpg',
    status: 'failed',
    provider: 'mock',
    durationMs: 640,
    createdAt: '2026-07-21T09:44:00Z',
    errorCategory: 'low_image_quality',
  },
  {
    id: 'job-5',
    customerName: 'Lerato Botha',
    documentName: 'levy-statement-july.pdf',
    status: 'queued',
    provider: 'mock',
    durationMs: null,
    createdAt: '2026-07-21T15:20:00Z',
    errorCategory: null,
  },
  {
    id: 'job-6',
    customerName: 'Pieter Mokoena',
    documentName: 'eft-confirmation-water.pdf',
    status: 'succeeded',
    provider: 'mock',
    durationMs: 1510,
    createdAt: '2026-07-21T08:12:00Z',
    errorCategory: null,
  },
  {
    id: 'job-7',
    customerName: 'Zanele Pillay',
    documentName: 'municipal-account-statement.pdf',
    status: 'failed',
    provider: 'mock',
    durationMs: 890,
    createdAt: '2026-07-20T18:30:00Z',
    errorCategory: 'unsupported_layout',
  },
];

export interface DemoActivityEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
}

export const DEMO_ACTIVITY: DemoActivityEvent[] = [
  {
    id: 'act-1',
    actor: 'Mohammed Khumalo',
    action: 'confirmed payment match',
    target: 'Water bill · Sea Point Apartment',
    createdAt: '2026-07-21T16:02:00Z',
  },
  {
    id: 'act-2',
    actor: 'System',
    action: 'flagged low-confidence extraction',
    target: 'Rates bill · Constantia House',
    createdAt: '2026-07-21T15:02:00Z',
  },
  {
    id: 'act-3',
    actor: 'Thabo Nkosi',
    action: 'uploaded document',
    target: 'Electricity bill · July 2026',
    createdAt: '2026-07-21T13:10:00Z',
  },
  {
    id: 'act-4',
    actor: 'Ahmed Seedat (admin)',
    action: 'reactivated account',
    target: 'billing_issue → active',
    createdAt: '2026-07-21T11:40:00Z',
  },
  {
    id: 'act-5',
    actor: 'System',
    action: 'RevenueCat webhook processed',
    target: 'subscription renewed',
    createdAt: '2026-07-21T09:00:00Z',
  },
  {
    id: 'act-6',
    actor: 'Johan Dlamini',
    action: 'extraction failed',
    target: 'Santam insurance photo',
    createdAt: '2026-07-21T09:44:00Z',
  },
];

export interface DemoFeatureFlag {
  key: string;
  label: string;
  enabled: boolean;
  description: string;
}

export const DEMO_FEATURE_FLAGS: DemoFeatureFlag[] = [
  {
    key: 'verified_automatic_payment_matching',
    label: 'Verified automatic payment matching',
    enabled: false,
    description: 'Auto-confirms strong matches without customer review. Off by design for V1.',
  },
  {
    key: 'push_notifications',
    label: 'Push notifications',
    enabled: false,
    description: 'Production push delivery — pending notification service integration.',
  },
  {
    key: 'admin_support_document_access',
    label: 'Admin support document access',
    enabled: false,
    description: 'Controlled, audited raw-document access for support staff.',
  },
  {
    key: 'ocr_real_provider',
    label: 'Real OCR provider',
    enabled: false,
    description: 'Switches from the mock provider to a live document-intelligence vendor.',
  },
];

export const DEMO_SYSTEM_HEALTH = {
  supabasePostgres: 'connected' as const,
  supabaseStorage: 'connected' as const,
  revenueCatWebhook: 'not_connected' as const,
  ocrProvider: 'not_connected' as const,
  payfast: 'not_connected' as const,
  notificationService: 'not_connected' as const,
  apiLatencyMs: 118,
  errorRatePercent: 0.4,
  uptimePercent: 99.97,
};
