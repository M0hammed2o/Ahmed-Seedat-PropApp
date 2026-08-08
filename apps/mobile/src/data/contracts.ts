export type IdentityKind = 'manager' | 'owner' | 'tenant';

export interface CurrentUserCapabilities {
  identity: IdentityKind;
  canViewFinancials: boolean;
  canEditProperty: boolean;
  canManageTenants: boolean;
  canViewOwnerDistributions: boolean;
  canUploadDocuments: boolean;
  canManageMaintenance: boolean;
  canManageInspections: boolean;
  canRecordMeterReadings: boolean;
  canInviteStaff: boolean;
  canManageOrganization: boolean;
  canManageBilling: boolean;
}

export interface MobileUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phoneE164: string | null;
  country: string;
  emailConfirmed: boolean;
  profileComplete: boolean;
  organizationId: string | null;
  organizationName: string | null;
  capabilities: CurrentUserCapabilities;
}

export interface AuthSession {
  user: MobileUser;
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_unconfirmed'
  | 'rate_limited'
  | 'network_error'
  | 'provider_disabled'
  | 'expired_link'
  | 'invalid_mfa_code'
  | 'unknown';

export type AuthResult =
  | { status: 'authenticated'; session: AuthSession }
  | { status: 'mfa_required'; factorId: string }
  | { status: 'email_unconfirmed'; email: string }
  | { status: 'confirmation_sent'; email: string }
  | { status: 'success' }
  | { status: 'error'; code: AuthErrorCode; message: string };

export interface AccountProfileInput {
  firstName: string;
  lastName: string;
  displayName: string;
  country: string;
  callingCode: string;
  mobileNumber: string;
  phoneE164: string;
}

export interface AuthRepository {
  getSession(): Promise<AuthSession | null>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signInWithProvider(provider: 'google' | 'apple'): Promise<AuthResult>;
  verifyMfa(factorId: string, code: string): Promise<AuthResult>;
  completeEmailConfirmation(): Promise<AuthResult>;
  resendConfirmation(email: string): Promise<AuthResult>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  updatePassword(password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}

export interface ProfileRepository {
  getCurrent(): Promise<MobileUser>;
  completeProfile(input: AccountProfileInput): Promise<MobileUser>;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  type: 'agency' | 'owner_managed';
  memberCount: number;
}

export interface OrganizationRepository {
  getCurrent(): Promise<OrganizationSummary | null>;
  create(input: { name: string; type: OrganizationSummary['type'] }): Promise<OrganizationSummary>;
  joinWithCode(code: string): Promise<OrganizationSummary>;
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface DashboardMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  occurredAt: string;
  destination?: string;
}

export interface DashboardSnapshot {
  portfolioLabel: string;
  portfolioValue: string;
  metrics: DashboardMetric[];
  maintenanceAttention: number;
  leaseExpiries: number;
  recentActivity: ActivityItem[];
  tasks: ActivityItem[];
  notices: ActivityItem[];
}

export interface DashboardRepository {
  getSnapshot(): Promise<DashboardSnapshot>;
}

export interface PropertySummary {
  id: string;
  nickname: string;
  fullAddress: string;
  addressLine1: string;
  city: string;
  province: string;
  propertyType: 'house' | 'apartment' | 'townhouse' | 'commercial' | 'vacant_land' | 'other';
  status: 'active' | 'archived';
  photoUrl: string | null;
  unitCount: number;
  occupiedUnits: number;
  monthlyRent: number;
  outstandingBalance: number;
  estimatedValue: number | null;
  municipalAccountNumber: string | null;
  notes: string | null;
}

export interface PropertyDraft {
  nickname: string;
  addressLine1: string;
  addressLine2?: string | null;
  suburb?: string | null;
  city: string;
  province?: string | null;
  postalCode?: string | null;
  country: string;
  propertyType: PropertySummary['propertyType'];
  municipalAccountNumber?: string | null;
  notes?: string | null;
}

export interface PropertyRepository {
  list(status?: PropertySummary['status']): Promise<PropertySummary[]>;
  getById(id: string): Promise<PropertySummary>;
  create(input: PropertyDraft): Promise<PropertySummary>;
  update(id: string, input: Partial<PropertyDraft>): Promise<PropertySummary>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
}

export interface UnitRecord {
  id: string;
  propertyId: string;
  name: string;
  bedrooms: number;
  bathrooms: number;
  occupancy: 'occupied' | 'vacant' | 'maintenance';
  tenantId: string | null;
  tenantName: string | null;
  monthlyRent: number;
  leaseStatus: 'active' | 'expiring' | 'none';
  meterCount: number;
  documentCount: number;
  openMaintenance: number;
}

export interface UnitRepository {
  list(propertyId?: string): Promise<UnitRecord[]>;
  getById(id: string): Promise<UnitRecord>;
}

export interface TenantRecord {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  propertyName: string;
  unitName: string;
  leaseId: string;
  leaseStatus: 'active' | 'expiring' | 'overdue' | 'ended';
  monthlyRent: number;
  outstandingBalance: number;
  paymentHistory: { id: string; label: string; amount: number; status: 'paid' | 'late' }[];
  documentCount: number;
  openMaintenance: number;
}

export interface TenantRepository {
  list(): Promise<TenantRecord[]>;
  getById(id: string): Promise<TenantRecord>;
}

export interface LeaseRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  propertyName: string;
  unitName: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  deposit: number;
  escalationPercent: number;
  status: 'draft' | 'active' | 'expiring' | 'ended';
  documentCount: number;
}

export interface LeaseRepository {
  list(): Promise<LeaseRecord[]>;
  getById(id: string): Promise<LeaseRecord>;
  create(input: Omit<LeaseRecord, 'id' | 'documentCount'>): Promise<LeaseRecord>;
}

export interface FinancialTransaction {
  id: string;
  label: string;
  propertyName: string;
  occurredAt: string;
  amount: number;
  direction: 'income' | 'expense' | 'distribution';
  status: 'cleared' | 'pending' | 'overdue';
}

export interface AccountingSnapshot {
  rentReceived: number;
  outstandingRent: number;
  expenses: number;
  netIncome: number;
  ownerDistributions: number;
  unreconciledCount: number;
  transactions: FinancialTransaction[];
}

export interface AccountingRepository {
  getOverview(): Promise<AccountingSnapshot>;
  listTransactions(): Promise<FinancialTransaction[]>;
}

export interface OwnerRecord {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  propertyNames: string[];
  ownershipPercentage: number;
  distributionYtd: number;
  lastStatementDate: string;
}

export interface OwnerRepository {
  list(): Promise<OwnerRecord[]>;
  getById(id: string): Promise<OwnerRecord>;
}

export interface DocumentRecord {
  id: string;
  title: string;
  category: string;
  linkedEntity: string;
  fileType: string;
  uploadedAt: string;
  status: 'ready' | 'processing' | 'needs_review' | 'failed';
  sizeLabel: string;
  extractedFields?: { label: string; value: string; confidence: number }[];
}

export interface DocumentRepository {
  list(): Promise<DocumentRecord[]>;
  getById(id: string): Promise<DocumentRecord>;
  beginUpload(input: { name: string; mimeType: string; linkedEntity: string }): Promise<DocumentRecord>;
  reviewExtraction(id: string, fields: DocumentRecord['extractedFields']): Promise<DocumentRecord>;
}

export interface MaintenanceTicket {
  id: string;
  title: string;
  propertyName: string;
  unitName: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'new' | 'in_progress' | 'awaiting_approval' | 'completed';
  requestedBy: string;
  createdAt: string;
  cost: number | null;
  notes: string[];
  photoCount: number;
}

export interface MaintenanceRepository {
  list(): Promise<MaintenanceTicket[]>;
  getById(id: string): Promise<MaintenanceTicket>;
  create(input: Omit<MaintenanceTicket, 'id' | 'createdAt' | 'notes'>): Promise<MaintenanceTicket>;
}

export interface InspectionRecord {
  id: string;
  propertyName: string;
  unitName: string;
  type: 'incoming' | 'outgoing' | 'routine';
  scheduledFor: string;
  status: 'scheduled' | 'in_progress' | 'awaiting_signature' | 'completed';
  completedItems: number;
  totalItems: number;
  photoCount: number;
  notes: string[];
}

export interface InspectionRepository {
  list(): Promise<InspectionRecord[]>;
  getById(id: string): Promise<InspectionRecord>;
  create(input: Omit<InspectionRecord, 'id' | 'completedItems' | 'photoCount' | 'notes'>): Promise<InspectionRecord>;
}

export interface MeterReading {
  id: string;
  propertyName: string;
  unitName: string;
  meterType: 'electricity' | 'water' | 'gas' | 'other';
  currentReading: number;
  previousReading: number;
  unit: 'kWh' | 'kL' | 'm³';
  readAt: string;
  photoAttached: boolean;
}

export interface MeterRepository {
  list(): Promise<MeterReading[]>;
  add(input: Omit<MeterReading, 'id'>): Promise<MeterReading>;
}

export interface ReportRecord {
  id: string;
  title: string;
  description: string;
  category: 'portfolio' | 'financial' | 'tenancy' | 'maintenance';
  availability: 'available' | 'planned';
  lastGeneratedAt: string | null;
}

export interface ReportRepository {
  list(): Promise<ReportRecord[]>;
  requestExport(input: { reportId: string; from: string; to: string }): Promise<{ jobId: string }>;
}

export interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  type: 'payment' | 'maintenance' | 'lease' | 'document' | 'system';
  createdAt: string;
  read: boolean;
  destination: string | null;
}

export interface NotificationPreferences {
  pushEnabled: boolean;
  emailEnabled: boolean;
  paymentAlerts: boolean;
  maintenanceAlerts: boolean;
  leaseAlerts: boolean;
  documentAlerts: boolean;
}

export interface NotificationRepository {
  list(): Promise<NotificationRecord[]>;
  markRead(id: string): Promise<void>;
  getPreferences(): Promise<NotificationPreferences>;
  updatePreferences(input: NotificationPreferences): Promise<NotificationPreferences>;
}

export interface MobileRepositories {
  auth: AuthRepository;
  profiles: ProfileRepository;
  organizations: OrganizationRepository;
  dashboard: DashboardRepository;
  properties: PropertyRepository;
  units: UnitRepository;
  tenants: TenantRepository;
  leases: LeaseRepository;
  accounting: AccountingRepository;
  owners: OwnerRepository;
  documents: DocumentRepository;
  maintenance: MaintenanceRepository;
  inspections: InspectionRepository;
  meters: MeterRepository;
  notifications: NotificationRepository;
  reports: ReportRepository;
}
