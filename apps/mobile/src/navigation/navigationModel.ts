import type { AppIconName } from '@/design/components';
import type { CurrentUserCapabilities } from '@/data/contracts';

export interface NavigationItem { key: string; label: string; route: string; icon: AppIconName }

export function getPrimaryNavigation(capabilities: CurrentUserCapabilities): NavigationItem[] {
  if (capabilities.identity === 'tenant') return [
    { key: 'home', label: 'Home', route: '/(app)/dashboard', icon: 'home' },
    { key: 'lease', label: 'My lease', route: '/(app)/leases', icon: 'lease' },
    { key: 'maintenance', label: 'Requests', route: '/(app)/maintenance', icon: 'maintenance' },
    { key: 'documents', label: 'Documents', route: '/(app)/documents', icon: 'document' },
    { key: 'more', label: 'More', route: '/(app)/more', icon: 'more' },
  ];
  if (capabilities.identity === 'owner') return [
    { key: 'home', label: 'Home', route: '/(app)/dashboard', icon: 'home' },
    { key: 'properties', label: 'Properties', route: '/(app)/properties', icon: 'property' },
    { key: 'reports', label: 'Statements', route: '/(app)/reports', icon: 'report' },
    { key: 'documents', label: 'Documents', route: '/(app)/documents', icon: 'document' },
    { key: 'more', label: 'More', route: '/(app)/more', icon: 'more' },
  ];
  return [
    { key: 'home', label: 'Home', route: '/(app)/dashboard', icon: 'home' },
    { key: 'properties', label: 'Properties', route: '/(app)/properties', icon: 'property' },
    { key: 'tenants', label: 'Tenants', route: '/(app)/tenants', icon: 'tenant' },
    ...(capabilities.canViewFinancials ? [{ key: 'accounting', label: 'Accounting', route: '/(app)/accounting', icon: 'money' as const }] : []),
    { key: 'more', label: 'More', route: '/(app)/more', icon: 'more' },
  ];
}

export function canOpenSection(capabilities: CurrentUserCapabilities, section: string): boolean {
  const rules: Record<string, boolean> = {
    accounting: capabilities.canViewFinancials,
    owners: capabilities.canViewOwnerDistributions,
    tenants: capabilities.canManageTenants,
    inspections: capabilities.canManageInspections,
    meters: capabilities.canRecordMeterReadings,
    staff: capabilities.canInviteStaff,
    billing: capabilities.canManageBilling,
  };
  return rules[section] ?? true;
}
