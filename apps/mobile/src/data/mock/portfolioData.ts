import type {
  AccountingSnapshot,
  DashboardSnapshot,
  DocumentRecord,
  InspectionRecord,
  LeaseRecord,
  MaintenanceTicket,
  MeterReading,
  MobileUser,
  NotificationPreferences,
  NotificationRecord,
  OrganizationSummary,
  OwnerRecord,
  PropertySummary,
  ReportRecord,
  TenantRecord,
  UnitRecord,
} from '../contracts';

export const MANAGER_CAPABILITIES = {
  identity: 'manager',
  canViewFinancials: true,
  canEditProperty: true,
  canManageTenants: true,
  canViewOwnerDistributions: true,
  canUploadDocuments: true,
  canManageMaintenance: true,
  canManageInspections: true,
  canRecordMeterReadings: true,
  canInviteStaff: true,
  canManageOrganization: true,
  canManageBilling: true,
} as const;

export const MOCK_USER: MobileUser = {
  id: 'user-demo-manager',
  email: 'mohammed@proplyst.co.za',
  firstName: 'Mohammed',
  lastName: 'Moosa',
  displayName: 'Mohammed Moosa',
  phoneE164: '+27821234567',
  country: 'ZA',
  emailConfirmed: true,
  profileComplete: true,
  organizationId: 'org-horizon',
  organizationName: 'Horizon Property Group',
  capabilities: MANAGER_CAPABILITIES,
};

export const MOCK_ORGANIZATION: OrganizationSummary = {
  id: 'org-horizon',
  name: 'Horizon Property Group',
  type: 'agency',
  memberCount: 8,
};

export const MOCK_PROPERTIES: PropertySummary[] = [
  {
    id: 'prop-oceans',
    nickname: 'Oceans Umhlanga',
    fullAddress: '7 Lagoon Drive, Umhlanga Rocks, KwaZulu-Natal, 4319',
    addressLine1: '7 Lagoon Drive',
    city: 'Umhlanga',
    province: 'KwaZulu-Natal',
    propertyType: 'apartment',
    status: 'active',
    photoUrl: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=1200',
    unitCount: 8,
    occupiedUnits: 7,
    monthlyRent: 148_500,
    outstandingBalance: 18_500,
    estimatedValue: 28_900_000,
    municipalAccountNumber: 'ETH-8842109',
    notes: 'Premium mixed-use apartments with sea views and secure parking.',
  },
  {
    id: 'prop-ballito',
    nickname: 'Ballito Hills',
    fullAddress: '1 Hills Avenue, Ballito, KwaZulu-Natal, 4420',
    addressLine1: '1 Hills Avenue',
    city: 'Ballito',
    province: 'KwaZulu-Natal',
    propertyType: 'apartment',
    status: 'active',
    photoUrl: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=1200',
    unitCount: 6,
    occupiedUnits: 6,
    monthlyRent: 102_000,
    outstandingBalance: 0,
    estimatedValue: 19_400_000,
    municipalAccountNumber: 'KDM-2204901',
    notes: 'Fully occupied sectional-title portfolio.',
  },
  {
    id: 'prop-rosebank',
    nickname: 'Rosebank Studios',
    fullAddress: '18 Tyrwhitt Avenue, Rosebank, Johannesburg, Gauteng, 2196',
    addressLine1: '18 Tyrwhitt Avenue',
    city: 'Johannesburg',
    province: 'Gauteng',
    propertyType: 'commercial',
    status: 'active',
    photoUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
    unitCount: 12,
    occupiedUnits: 10,
    monthlyRent: 213_000,
    outstandingBalance: 31_200,
    estimatedValue: 42_500_000,
    municipalAccountNumber: 'COJ-7713008',
    notes: 'Flexible studios and two ground-floor retail units.',
  },
  {
    id: 'prop-seapoint',
    nickname: 'Sea Point Collection',
    fullAddress: '82 Regent Road, Sea Point, Cape Town, Western Cape, 8005',
    addressLine1: '82 Regent Road',
    city: 'Cape Town',
    province: 'Western Cape',
    propertyType: 'apartment',
    status: 'active',
    photoUrl: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200',
    unitCount: 5,
    occupiedUnits: 4,
    monthlyRent: 126_000,
    outstandingBalance: 12_600,
    estimatedValue: 25_200_000,
    municipalAccountNumber: 'CCT-4021558',
    notes: 'Five furnished apartments managed for two owners.',
  },
];

export const MOCK_UNITS: UnitRecord[] = [
  { id: 'unit-o-101', propertyId: 'prop-oceans', name: 'Apartment 101', bedrooms: 2, bathrooms: 2, occupancy: 'occupied', tenantId: 'tenant-ayanda', tenantName: 'Ayanda Dlamini', monthlyRent: 18_500, leaseStatus: 'active', meterCount: 2, documentCount: 7, openMaintenance: 1 },
  { id: 'unit-o-203', propertyId: 'prop-oceans', name: 'Apartment 203', bedrooms: 3, bathrooms: 2, occupancy: 'occupied', tenantId: 'tenant-zanele', tenantName: 'Zanele Naidoo', monthlyRent: 23_500, leaseStatus: 'expiring', meterCount: 2, documentCount: 9, openMaintenance: 0 },
  { id: 'unit-o-305', propertyId: 'prop-oceans', name: 'Apartment 305', bedrooms: 2, bathrooms: 2, occupancy: 'vacant', tenantId: null, tenantName: null, monthlyRent: 19_500, leaseStatus: 'none', meterCount: 2, documentCount: 3, openMaintenance: 1 },
  { id: 'unit-b-12', propertyId: 'prop-ballito', name: 'Unit 12', bedrooms: 2, bathrooms: 2, occupancy: 'occupied', tenantId: 'tenant-kyle', tenantName: 'Kyle Govender', monthlyRent: 17_000, leaseStatus: 'active', meterCount: 2, documentCount: 6, openMaintenance: 0 },
  { id: 'unit-r-4a', propertyId: 'prop-rosebank', name: 'Studio 4A', bedrooms: 0, bathrooms: 1, occupancy: 'occupied', tenantId: 'tenant-lerato', tenantName: 'Lerato Mokoena', monthlyRent: 12_800, leaseStatus: 'active', meterCount: 1, documentCount: 5, openMaintenance: 2 },
];

export const MOCK_TENANTS: TenantRecord[] = [
  { id: 'tenant-ayanda', displayName: 'Ayanda Dlamini', email: 'ayanda.dlamini@example.co.za', phone: '+27 82 441 9002', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 101', leaseId: 'lease-ayanda', leaseStatus: 'active', monthlyRent: 18_500, outstandingBalance: 0, paymentHistory: [{ id: 'pay-a-aug', label: 'August 2026 rent', amount: 18_500, status: 'paid' }, { id: 'pay-a-jul', label: 'July 2026 rent', amount: 18_500, status: 'paid' }], documentCount: 7, openMaintenance: 1 },
  { id: 'tenant-zanele', displayName: 'Zanele Naidoo', email: 'zanele.naidoo@example.co.za', phone: '+27 83 772 1180', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 203', leaseId: 'lease-zanele', leaseStatus: 'expiring', monthlyRent: 23_500, outstandingBalance: 5_000, paymentHistory: [{ id: 'pay-z-aug', label: 'August 2026 rent', amount: 18_500, status: 'late' }, { id: 'pay-z-jul', label: 'July 2026 rent', amount: 23_500, status: 'paid' }], documentCount: 9, openMaintenance: 0 },
  { id: 'tenant-kyle', displayName: 'Kyle Govender', email: 'kyle.govender@example.co.za', phone: '+27 79 330 4411', propertyName: 'Ballito Hills', unitName: 'Unit 12', leaseId: 'lease-kyle', leaseStatus: 'active', monthlyRent: 17_000, outstandingBalance: 0, paymentHistory: [{ id: 'pay-k-aug', label: 'August 2026 rent', amount: 17_000, status: 'paid' }], documentCount: 6, openMaintenance: 0 },
  { id: 'tenant-lerato', displayName: 'Lerato Mokoena', email: 'lerato.mokoena@example.co.za', phone: '+27 72 118 4056', propertyName: 'Rosebank Studios', unitName: 'Studio 4A', leaseId: 'lease-lerato', leaseStatus: 'overdue', monthlyRent: 12_800, outstandingBalance: 25_600, paymentHistory: [{ id: 'pay-l-jul', label: 'July 2026 rent', amount: 12_800, status: 'late' }], documentCount: 5, openMaintenance: 2 },
];

export const MOCK_LEASES: LeaseRecord[] = [
  { id: 'lease-ayanda', tenantId: 'tenant-ayanda', tenantName: 'Ayanda Dlamini', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 101', startDate: '2026-02-01', endDate: '2027-01-31', monthlyRent: 18_500, deposit: 37_000, escalationPercent: 7, status: 'active', documentCount: 3 },
  { id: 'lease-zanele', tenantId: 'tenant-zanele', tenantName: 'Zanele Naidoo', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 203', startDate: '2025-09-01', endDate: '2026-08-31', monthlyRent: 23_500, deposit: 47_000, escalationPercent: 7.5, status: 'expiring', documentCount: 4 },
  { id: 'lease-kyle', tenantId: 'tenant-kyle', tenantName: 'Kyle Govender', propertyName: 'Ballito Hills', unitName: 'Unit 12', startDate: '2026-05-01', endDate: '2027-04-30', monthlyRent: 17_000, deposit: 34_000, escalationPercent: 6, status: 'active', documentCount: 2 },
  { id: 'lease-lerato', tenantId: 'tenant-lerato', tenantName: 'Lerato Mokoena', propertyName: 'Rosebank Studios', unitName: 'Studio 4A', startDate: '2026-01-01', endDate: '2026-12-31', monthlyRent: 12_800, deposit: 25_600, escalationPercent: 8, status: 'active', documentCount: 3 },
];

export const MOCK_ACCOUNTING: AccountingSnapshot = {
  rentReceived: 487_600,
  outstandingRent: 67_300,
  expenses: 94_850,
  netIncome: 392_750,
  ownerDistributions: 305_000,
  unreconciledCount: 7,
  transactions: [
    { id: 'txn-1', label: 'August rent · Ayanda Dlamini', propertyName: 'Oceans Umhlanga', occurredAt: '2026-08-07T09:20:00+02:00', amount: 18_500, direction: 'income', status: 'cleared' },
    { id: 'txn-2', label: 'Lift service call-out', propertyName: 'Oceans Umhlanga', occurredAt: '2026-08-06T15:10:00+02:00', amount: 6_850, direction: 'expense', status: 'cleared' },
    { id: 'txn-3', label: 'Owner distribution · July', propertyName: 'Ballito Hills', occurredAt: '2026-08-05T11:00:00+02:00', amount: 72_400, direction: 'distribution', status: 'cleared' },
    { id: 'txn-4', label: 'August rent · Lerato Mokoena', propertyName: 'Rosebank Studios', occurredAt: '2026-08-01T08:00:00+02:00', amount: 12_800, direction: 'income', status: 'overdue' },
    { id: 'txn-5', label: 'Municipal electricity', propertyName: 'Sea Point Collection', occurredAt: '2026-07-31T12:00:00+02:00', amount: 9_420, direction: 'expense', status: 'pending' },
  ],
};

export const MOCK_DASHBOARD: DashboardSnapshot = {
  portfolioLabel: 'Estimated portfolio value',
  portfolioValue: 'R116.0m',
  metrics: [
    { id: 'properties', label: 'Properties', value: '4', detail: '31 units', tone: 'info' },
    { id: 'occupancy', label: 'Occupancy', value: '87%', detail: '27 of 31 units', tone: 'success' },
    { id: 'rent', label: 'Monthly rent', value: 'R589.5k', detail: 'R487.6k received', tone: 'success' },
    { id: 'outstanding', label: 'Outstanding', value: 'R67.3k', detail: '4 tenant accounts', tone: 'danger' },
  ],
  maintenanceAttention: 4,
  leaseExpiries: 3,
  recentActivity: [
    { id: 'activity-1', title: 'Rent received', detail: 'Ayanda Dlamini · R18 500', occurredAt: '2026-08-07T09:20:00+02:00', destination: '/(app)/accounting' },
    { id: 'activity-2', title: 'Maintenance updated', detail: 'Lift service · In progress', occurredAt: '2026-08-06T15:10:00+02:00', destination: '/(app)/maintenance/ticket-lift' },
    { id: 'activity-3', title: 'Document processed', detail: 'Sea Point municipal statement', occurredAt: '2026-08-06T10:40:00+02:00', destination: '/(app)/documents/doc-municipal' },
  ],
  tasks: [
    { id: 'task-1', title: 'Review 7 unreconciled transactions', detail: 'Accounting · due today', occurredAt: '2026-08-08T07:00:00+02:00', destination: '/(app)/accounting' },
    { id: 'task-2', title: 'Renew Zanele’s lease', detail: 'Expires 31 Aug', occurredAt: '2026-08-07T07:00:00+02:00', destination: '/(app)/leases/lease-zanele' },
  ],
  notices: [{ id: 'notice-1', title: 'Water interruption', detail: 'Oceans Umhlanga · 12 Aug, 09:00–15:00', occurredAt: '2026-08-07T14:00:00+02:00' }],
};

export const MOCK_OWNERS: OwnerRecord[] = [
  { id: 'owner-priya', displayName: 'Priya Naidoo', email: 'priya@example.co.za', phone: '+27 82 901 1440', propertyNames: ['Oceans Umhlanga', 'Sea Point Collection'], ownershipPercentage: 60, distributionYtd: 628_400, lastStatementDate: '2026-07-31' },
  { id: 'owner-sipho', displayName: 'Sipho Dlamini', email: 'sipho@example.co.za', phone: '+27 83 771 0021', propertyNames: ['Oceans Umhlanga'], ownershipPercentage: 40, distributionYtd: 388_200, lastStatementDate: '2026-07-31' },
  { id: 'owner-jade', displayName: 'Jade Properties (Pty) Ltd', email: 'accounts@jadeproperties.co.za', phone: '+27 31 566 2190', propertyNames: ['Ballito Hills'], ownershipPercentage: 100, distributionYtd: 742_800, lastStatementDate: '2026-07-31' },
];

export const MOCK_DOCUMENTS: DocumentRecord[] = [
  { id: 'doc-lease-zanele', title: 'Lease · Zanele Naidoo', category: 'Lease', linkedEntity: 'Oceans Umhlanga · Apartment 203', fileType: 'PDF', uploadedAt: '2025-08-22T10:00:00+02:00', status: 'ready', sizeLabel: '1.8 MB' },
  { id: 'doc-municipal', title: 'Municipal statement · July', category: 'Municipal', linkedEntity: 'Sea Point Collection', fileType: 'PDF', uploadedAt: '2026-08-06T10:35:00+02:00', status: 'needs_review', sizeLabel: '842 KB', extractedFields: [{ label: 'Amount due', value: 'R9 420.00', confidence: 0.97 }, { label: 'Due date', value: '25 Aug 2026', confidence: 0.91 }, { label: 'Account', value: 'CCT-4021558', confidence: 0.99 }] },
  { id: 'doc-inspection', title: 'Incoming inspection · Apartment 101', category: 'Inspection', linkedEntity: 'Oceans Umhlanga · Apartment 101', fileType: 'PDF', uploadedAt: '2026-02-01T16:00:00+02:00', status: 'ready', sizeLabel: '4.2 MB' },
  { id: 'doc-invoice', title: 'Lift service invoice', category: 'Maintenance', linkedEntity: 'Oceans Umhlanga', fileType: 'JPG', uploadedAt: '2026-08-06T15:12:00+02:00', status: 'processing', sizeLabel: '2.4 MB' },
];

export const MOCK_MAINTENANCE: MaintenanceTicket[] = [
  { id: 'ticket-lift', title: 'Lift stopping unevenly at level 3', propertyName: 'Oceans Umhlanga', unitName: null, priority: 'urgent', status: 'in_progress', requestedBy: 'Building manager', createdAt: '2026-08-06T07:30:00+02:00', cost: 6_850, notes: ['Technician attended at 14:30.', 'Replacement sensor ordered.'], photoCount: 2 },
  { id: 'ticket-leak', title: 'Kitchen sink leak', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 101', priority: 'medium', status: 'new', requestedBy: 'Ayanda Dlamini', createdAt: '2026-08-07T18:20:00+02:00', cost: null, notes: ['Leak visible below the mixer.'], photoCount: 3 },
  { id: 'ticket-paint', title: 'Prepare vacant studio for listing', propertyName: 'Rosebank Studios', unitName: 'Studio 6C', priority: 'low', status: 'awaiting_approval', requestedBy: 'Portfolio manager', createdAt: '2026-08-03T09:10:00+02:00', cost: 12_400, notes: ['Quote received from Joburg Paint Co.'], photoCount: 5 },
  { id: 'ticket-geyser', title: 'Geyser thermostat replacement', propertyName: 'Ballito Hills', unitName: 'Unit 8', priority: 'high', status: 'completed', requestedBy: 'Tenant', createdAt: '2026-07-29T06:40:00+02:00', cost: 2_150, notes: ['Completed and tested.'], photoCount: 2 },
];

export const MOCK_INSPECTIONS: InspectionRecord[] = [
  { id: 'inspection-203', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 203', type: 'routine', scheduledFor: '2026-08-14T10:00:00+02:00', status: 'scheduled', completedItems: 0, totalItems: 24, photoCount: 0, notes: [] },
  { id: 'inspection-4a', propertyName: 'Rosebank Studios', unitName: 'Studio 4A', type: 'routine', scheduledFor: '2026-08-08T09:00:00+02:00', status: 'in_progress', completedItems: 16, totalItems: 22, photoCount: 8, notes: ['Bedroom window latch needs attention.'] },
  { id: 'inspection-101', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 101', type: 'incoming', scheduledFor: '2026-02-01T14:00:00+02:00', status: 'completed', completedItems: 28, totalItems: 28, photoCount: 18, notes: ['Signed by tenant and agent.'] },
];

export const MOCK_METERS: MeterReading[] = [
  { id: 'meter-o101-elec', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 101', meterType: 'electricity', currentReading: 18_422, previousReading: 18_051, unit: 'kWh', readAt: '2026-08-01T09:00:00+02:00', photoAttached: true },
  { id: 'meter-o101-water', propertyName: 'Oceans Umhlanga', unitName: 'Apartment 101', meterType: 'water', currentReading: 388.2, previousReading: 374.8, unit: 'kL', readAt: '2026-08-01T09:05:00+02:00', photoAttached: true },
  { id: 'meter-r4a-elec', propertyName: 'Rosebank Studios', unitName: 'Studio 4A', meterType: 'electricity', currentReading: 9_821, previousReading: 9_640, unit: 'kWh', readAt: '2026-08-02T11:20:00+02:00', photoAttached: false },
];

export const MOCK_REPORTS: ReportRecord[] = [
  { id: 'report-portfolio', title: 'Portfolio performance', description: 'Occupancy, rent roll, property value and trends.', category: 'portfolio', availability: 'available', lastGeneratedAt: '2026-07-31T17:00:00+02:00' },
  { id: 'report-rent-roll', title: 'Rent roll', description: 'Lease, rent and tenant balances by property.', category: 'financial', availability: 'available', lastGeneratedAt: '2026-08-01T08:00:00+02:00' },
  { id: 'report-owner', title: 'Owner statement pack', description: 'Statements and distribution summaries by owner.', category: 'financial', availability: 'available', lastGeneratedAt: '2026-07-31T18:00:00+02:00' },
  { id: 'report-maintenance', title: 'Maintenance performance', description: 'Response time, spend and contractor trends.', category: 'maintenance', availability: 'planned', lastGeneratedAt: null },
];

export const MOCK_NOTIFICATIONS: NotificationRecord[] = [
  { id: 'notification-1', title: 'Rent payment received', body: 'Ayanda Dlamini paid R18 500 for August.', type: 'payment', createdAt: '2026-08-07T09:20:00+02:00', read: false, destination: '/(app)/tenants/tenant-ayanda' },
  { id: 'notification-2', title: 'Urgent maintenance update', body: 'The lift sensor has been ordered for Oceans Umhlanga.', type: 'maintenance', createdAt: '2026-08-06T15:10:00+02:00', read: false, destination: '/(app)/maintenance/ticket-lift' },
  { id: 'notification-3', title: 'Lease expires this month', body: 'Zanele Naidoo’s lease expires on 31 August.', type: 'lease', createdAt: '2026-08-05T08:00:00+02:00', read: false, destination: '/(app)/leases/lease-zanele' },
  { id: 'notification-4', title: 'Document ready for review', body: 'The Sea Point municipal statement was extracted.', type: 'document', createdAt: '2026-08-04T10:00:00+02:00', read: true, destination: '/(app)/documents/doc-municipal' },
];

export const MOCK_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  emailEnabled: true,
  paymentAlerts: true,
  maintenanceAlerts: true,
  leaseAlerts: true,
  documentAlerts: false,
};
