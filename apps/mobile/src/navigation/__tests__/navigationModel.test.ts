import { MANAGER_CAPABILITIES } from '@/data/mock/portfolioData';
import { canOpenSection, getPrimaryNavigation } from '../navigationModel';

describe('capability-aware mobile navigation', () => {
  it('keeps manager bottom navigation focused to five destinations', () => {
    expect(getPrimaryNavigation(MANAGER_CAPABILITIES).map((item) => item.label)).toEqual(['Home', 'Properties', 'Tenants', 'Accounting', 'More']);
  });

  it('builds tenant navigation from backend-returned identity', () => {
    const tenant = { ...MANAGER_CAPABILITIES, identity: 'tenant' as const, canViewFinancials: false, canManageTenants: false, canViewOwnerDistributions: false };
    expect(getPrimaryNavigation(tenant).map((item) => item.label)).toEqual(['Home', 'My lease', 'Requests', 'Documents', 'More']);
    expect(canOpenSection(tenant, 'accounting')).toBe(false);
    expect(canOpenSection(tenant, 'owners')).toBe(false);
  });
});
