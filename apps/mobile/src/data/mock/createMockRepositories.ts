import type {
  AccountProfileInput,
  AuthRepository,
  AuthResult,
  AuthSession,
  DocumentRecord,
  LeaseRecord,
  MaintenanceTicket,
  MeterReading,
  MobileRepositories,
  MobileUser,
  NotificationPreferences,
  OrganizationSummary,
  PropertyDraft,
  PropertySummary,
} from '../contracts';
import {
  MOCK_ACCOUNTING,
  MOCK_DASHBOARD,
  MOCK_DOCUMENTS,
  MOCK_INSPECTIONS,
  MOCK_LEASES,
  MOCK_MAINTENANCE,
  MOCK_METERS,
  MOCK_NOTIFICATION_PREFERENCES,
  MOCK_NOTIFICATIONS,
  MOCK_ORGANIZATION,
  MOCK_OWNERS,
  MOCK_PROPERTIES,
  MOCK_REPORTS,
  MOCK_TENANTS,
  MOCK_UNITS,
  MOCK_USER,
} from './portfolioData';

export interface MockRepositoryScenario {
  latencyMs?: number;
  failMethods?: string[];
  emptyCollections?: string[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createRuntime(scenario: MockRepositoryScenario) {
  const latencyMs = scenario.latencyMs ?? 120;
  return {
    async run<T>(method: string, value: T): Promise<T> {
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (scenario.failMethods?.includes(method)) {
        throw new Error('We could not load this information. Check your connection and try again.');
      }
      return clone(value);
    },
    list<T>(name: string, values: T[]): T[] {
      return scenario.emptyCollections?.includes(name) ? [] : values;
    },
  };
}

interface IdentityState {
  user: MobileUser;
  session: AuthSession | null;
  listeners: Set<(session: AuthSession | null) => void>;
}

class MockAuthRepository implements AuthRepository {
  constructor(
    private readonly state: IdentityState,
    private readonly runtime: ReturnType<typeof createRuntime>,
  ) {}

  private emit(session: AuthSession | null) {
    this.state.session = session;
    this.state.listeners.forEach((listener) => listener(clone(session)));
  }

  async getSession() {
    return this.runtime.run('auth.getSession', this.state.session);
  }

  subscribe(listener: (session: AuthSession | null) => void) {
    this.state.listeners.add(listener);
    return () => this.state.listeners.delete(listener);
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    await this.runtime.run('auth.signIn', true);
    const normalized = email.trim().toLowerCase();
    if (normalized.startsWith('offline@')) return { status: 'error', code: 'network_error', message: 'You appear to be offline. Reconnect and try again.' };
    if (normalized.startsWith('rate@')) return { status: 'error', code: 'rate_limited', message: 'Too many attempts. Wait a moment and try again.' };
    if (normalized.startsWith('unconfirmed@')) return { status: 'email_unconfirmed', email };
    if (password === 'wrong-password') return { status: 'error', code: 'invalid_credentials', message: 'The email or password is incorrect.' };
    if (normalized.startsWith('mfa@')) return { status: 'mfa_required', factorId: 'mock-factor-1' };

    this.state.user = { ...this.state.user, email: email || this.state.user.email };
    const session = { user: clone(this.state.user) };
    this.emit(session);
    return { status: 'authenticated', session };
  }

  async signUp(email: string): Promise<AuthResult> {
    await this.runtime.run('auth.signUp', true);
    if (email.trim().toLowerCase().startsWith('existing@')) {
      return { status: 'error', code: 'unknown', message: 'Use sign in to continue with this email address.' };
    }
    this.state.user = {
      ...this.state.user,
      email,
      emailConfirmed: false,
      profileComplete: false,
      organizationId: null,
      organizationName: null,
    };
    return { status: 'confirmation_sent', email };
  }

  async signInWithProvider(provider: 'google' | 'apple'): Promise<AuthResult> {
    await this.runtime.run(`auth.provider.${provider}`, true);
    if (provider === 'apple') {
      return { status: 'error', code: 'provider_disabled', message: 'Apple sign-in is not available yet.' };
    }
    const session = { user: clone(this.state.user) };
    this.emit(session);
    return { status: 'authenticated', session };
  }

  async verifyMfa(_factorId: string, code: string): Promise<AuthResult> {
    await this.runtime.run('auth.verifyMfa', true);
    if (code !== '123456') return { status: 'error', code: 'invalid_mfa_code', message: 'That code is incorrect or has expired.' };
    const session = { user: clone(this.state.user) };
    this.emit(session);
    return { status: 'authenticated', session };
  }

  async completeEmailConfirmation(): Promise<AuthResult> {
    await this.runtime.run('auth.completeEmailConfirmation', true);
    this.state.user = { ...this.state.user, emailConfirmed: true };
    const session = { user: clone(this.state.user) };
    this.emit(session);
    return { status: 'authenticated', session };
  }

  async resendConfirmation(email: string): Promise<AuthResult> {
    await this.runtime.run('auth.resendConfirmation', true);
    return { status: 'confirmation_sent', email };
  }

  async requestPasswordReset(): Promise<AuthResult> {
    await this.runtime.run('auth.requestPasswordReset', true);
    return { status: 'success' };
  }

  async updatePassword(): Promise<AuthResult> {
    await this.runtime.run('auth.updatePassword', true);
    return { status: 'success' };
  }

  async signOut() {
    await this.runtime.run('auth.signOut', true);
    this.emit(null);
  }
}

export function createMockRepositories(scenario: MockRepositoryScenario = {}): MobileRepositories {
  const runtime = createRuntime(scenario);
  const identity: IdentityState = {
    user: clone(MOCK_USER),
    session: null,
    listeners: new Set(),
  };
  let organization: OrganizationSummary | null = clone(MOCK_ORGANIZATION);
  let properties = clone(MOCK_PROPERTIES);
  let leases = clone(MOCK_LEASES);
  let documents = clone(MOCK_DOCUMENTS);
  let maintenance = clone(MOCK_MAINTENANCE);
  let inspections = clone(MOCK_INSPECTIONS);
  let meters = clone(MOCK_METERS);
  let notifications = clone(MOCK_NOTIFICATIONS);
  let notificationPreferences = clone(MOCK_NOTIFICATION_PREFERENCES);
  let nextId = 100;
  const id = (prefix: string) => `${prefix}-mock-${++nextId}`;

  const auth = new MockAuthRepository(identity, runtime);
  const publishUser = () => {
    if (!identity.session) return;
    identity.session = { user: clone(identity.user) };
    identity.listeners.forEach((listener) => listener(clone(identity.session)));
  };

  return {
    auth,
    profiles: {
      getCurrent: () => runtime.run('profiles.getCurrent', identity.user),
      async completeProfile(input: AccountProfileInput) {
        identity.user = {
          ...identity.user,
          firstName: input.firstName,
          lastName: input.lastName,
          displayName: input.displayName,
          country: input.country,
          phoneE164: input.phoneE164,
          profileComplete: true,
        };
        publishUser();
        return runtime.run('profiles.completeProfile', identity.user);
      },
    },
    organizations: {
      getCurrent: () => runtime.run('organizations.getCurrent', organization),
      async create(input) {
        organization = { id: id('org'), name: input.name, type: input.type, memberCount: 1 };
        identity.user = { ...identity.user, organizationId: organization.id, organizationName: organization.name };
        publishUser();
        return runtime.run('organizations.create', organization);
      },
      async joinWithCode(code) {
        if (code.trim().toUpperCase() !== 'HORIZON26') throw new Error('That invitation code is invalid or has expired.');
        organization = clone(MOCK_ORGANIZATION);
        identity.user = { ...identity.user, organizationId: organization.id, organizationName: organization.name };
        publishUser();
        return runtime.run('organizations.joinWithCode', organization);
      },
    },
    dashboard: { getSnapshot: () => runtime.run('dashboard.getSnapshot', MOCK_DASHBOARD) },
    properties: {
      list: (status = 'active') => runtime.run('properties.list', runtime.list('properties', properties.filter((item) => item.status === status))),
      async getById(propertyId) {
        const property = properties.find((item) => item.id === propertyId);
        if (!property) throw new Error('Property not found.');
        return runtime.run('properties.getById', property);
      },
      async create(input: PropertyDraft) {
        const property: PropertySummary = {
          id: id('property'), nickname: input.nickname,
          fullAddress: [input.addressLine1, input.addressLine2, input.suburb, input.city, input.province, input.postalCode].filter(Boolean).join(', '),
          addressLine1: input.addressLine1, city: input.city, province: input.province ?? '', propertyType: input.propertyType,
          status: 'active', photoUrl: null, unitCount: 0, occupiedUnits: 0, monthlyRent: 0, outstandingBalance: 0,
          estimatedValue: null, municipalAccountNumber: input.municipalAccountNumber ?? null, notes: input.notes ?? null,
        };
        properties = [property, ...properties];
        return runtime.run('properties.create', property);
      },
      async update(propertyId, input) {
        const current = properties.find((item) => item.id === propertyId);
        if (!current) throw new Error('Property not found.');
        const updated: PropertySummary = {
          ...current,
          nickname: input.nickname ?? current.nickname,
          addressLine1: input.addressLine1 ?? current.addressLine1,
          city: input.city ?? current.city,
          province: input.province ?? current.province,
          propertyType: input.propertyType ?? current.propertyType,
          municipalAccountNumber: input.municipalAccountNumber ?? current.municipalAccountNumber,
          notes: input.notes ?? current.notes,
        };
        updated.fullAddress = [updated.addressLine1, updated.city, updated.province].filter(Boolean).join(', ');
        properties = properties.map((item) => item.id === propertyId ? updated : item);
        return runtime.run('properties.update', updated);
      },
      async archive(propertyId) {
        properties = properties.map((item) => item.id === propertyId ? { ...item, status: 'archived' } : item);
        await runtime.run('properties.archive', true);
      },
      async restore(propertyId) {
        properties = properties.map((item) => item.id === propertyId ? { ...item, status: 'active' } : item);
        await runtime.run('properties.restore', true);
      },
    },
    units: {
      list: (propertyId) => runtime.run('units.list', runtime.list('units', MOCK_UNITS.filter((unit) => !propertyId || unit.propertyId === propertyId))),
      async getById(unitId) {
        const unit = MOCK_UNITS.find((item) => item.id === unitId);
        if (!unit) throw new Error('Unit not found.');
        return runtime.run('units.getById', unit);
      },
    },
    tenants: {
      list: () => runtime.run('tenants.list', runtime.list('tenants', MOCK_TENANTS)),
      async getById(tenantId) {
        const tenant = MOCK_TENANTS.find((item) => item.id === tenantId);
        if (!tenant) throw new Error('Tenant not found.');
        return runtime.run('tenants.getById', tenant);
      },
    },
    leases: {
      list: () => runtime.run('leases.list', runtime.list('leases', leases)),
      async getById(leaseId) {
        const lease = leases.find((item) => item.id === leaseId);
        if (!lease) throw new Error('Lease not found.');
        return runtime.run('leases.getById', lease);
      },
      async create(input) {
        const lease: LeaseRecord = { ...input, id: id('lease'), documentCount: 0 };
        leases = [lease, ...leases];
        return runtime.run('leases.create', lease);
      },
    },
    accounting: {
      getOverview: () => runtime.run('accounting.getOverview', MOCK_ACCOUNTING),
      listTransactions: () => runtime.run('accounting.listTransactions', MOCK_ACCOUNTING.transactions),
    },
    owners: {
      list: () => runtime.run('owners.list', runtime.list('owners', MOCK_OWNERS)),
      async getById(ownerId) {
        const owner = MOCK_OWNERS.find((item) => item.id === ownerId);
        if (!owner) throw new Error('Owner not found.');
        return runtime.run('owners.getById', owner);
      },
    },
    documents: {
      list: () => runtime.run('documents.list', runtime.list('documents', documents)),
      async getById(documentId) {
        const document = documents.find((item) => item.id === documentId);
        if (!document) throw new Error('Document not found.');
        return runtime.run('documents.getById', document);
      },
      async beginUpload(input) {
        const document: DocumentRecord = { id: id('document'), title: input.name, category: 'Uncategorised', linkedEntity: input.linkedEntity, fileType: input.mimeType.includes('pdf') ? 'PDF' : 'Image', uploadedAt: new Date().toISOString(), status: 'processing', sizeLabel: 'Pending' };
        documents = [document, ...documents];
        return runtime.run('documents.beginUpload', document);
      },
      async reviewExtraction(documentId, fields) {
        const current = documents.find((item) => item.id === documentId);
        if (!current) throw new Error('Document not found.');
        const updated = { ...current, status: 'ready' as const, extractedFields: fields };
        documents = documents.map((item) => item.id === documentId ? updated : item);
        return runtime.run('documents.reviewExtraction', updated);
      },
    },
    maintenance: {
      list: () => runtime.run('maintenance.list', runtime.list('maintenance', maintenance)),
      async getById(ticketId) {
        const ticket = maintenance.find((item) => item.id === ticketId);
        if (!ticket) throw new Error('Maintenance request not found.');
        return runtime.run('maintenance.getById', ticket);
      },
      async create(input) {
        const ticket: MaintenanceTicket = { ...input, id: id('maintenance'), createdAt: new Date().toISOString(), notes: [] };
        maintenance = [ticket, ...maintenance];
        return runtime.run('maintenance.create', ticket);
      },
    },
    inspections: {
      list: () => runtime.run('inspections.list', runtime.list('inspections', inspections)),
      async getById(inspectionId) {
        const inspection = inspections.find((item) => item.id === inspectionId);
        if (!inspection) throw new Error('Inspection not found.');
        return runtime.run('inspections.getById', inspection);
      },
      async create(input) {
        const inspection = { ...input, id: id('inspection'), completedItems: 0, photoCount: 0, notes: [] };
        inspections = [inspection, ...inspections];
        return runtime.run('inspections.create', inspection);
      },
    },
    meters: {
      list: () => runtime.run('meters.list', runtime.list('meters', meters)),
      async add(input) {
        const reading: MeterReading = { ...input, id: id('meter') };
        meters = [reading, ...meters];
        return runtime.run('meters.add', reading);
      },
    },
    notifications: {
      list: () => runtime.run('notifications.list', runtime.list('notifications', notifications)),
      async markRead(notificationId) {
        notifications = notifications.map((item) => item.id === notificationId ? { ...item, read: true } : item);
        await runtime.run('notifications.markRead', true);
      },
      getPreferences: () => runtime.run('notifications.getPreferences', notificationPreferences),
      async updatePreferences(input: NotificationPreferences) {
        notificationPreferences = clone(input);
        return runtime.run('notifications.updatePreferences', notificationPreferences);
      },
    },
    reports: {
      list: () => runtime.run('reports.list', runtime.list('reports', MOCK_REPORTS)),
      requestExport: ({ reportId }) => runtime.run('reports.requestExport', { jobId: `report-job-${reportId}` }),
    },
  };
}
