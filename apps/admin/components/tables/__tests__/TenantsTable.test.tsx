// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Tenant } from '@propvault/types';
import { TenantsTable } from '../TenantsTable';

afterEach(cleanup);

const TENANT: Tenant = {
  id: 'tenant-1',
  orgId: 'org-1',
  userId: null,
  fullName: 'Naledi Khumalo',
  email: 'naledi@example.com',
  phone: '+27 82 555 0134',
  idNumberRef: null,
  status: 'active',
  createdAt: '2026-06-05T00:00:00Z',
  updatedAt: '2026-06-05T00:00:00Z',
};

describe('TenantsTable', () => {
  it('renders tenant rows with contact details and status', () => {
    render(<TenantsTable data={[TENANT]} />);
    expect(screen.getByText('Naledi Khumalo')).toBeTruthy();
    expect(screen.getByText('naledi@example.com')).toBeTruthy();
    expect(screen.getByText('+27 82 555 0134')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows a dash for missing email/phone', () => {
    render(<TenantsTable data={[{ ...TENANT, email: null, phone: null }]} />);
    expect(screen.getAllByText('—').length).toBe(2);
  });

  it('shows "No account" for an unlinked tenant and "Account linked" once userId is set', () => {
    render(<TenantsTable data={[TENANT, { ...TENANT, id: 'tenant-2', userId: 'user-1' }]} />);
    expect(screen.getByText('No account')).toBeTruthy();
    expect(screen.getByText('Account linked')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no tenants', () => {
    render(<TenantsTable data={[]} emptyAction={<button>+ Add tenant</button>} />);
    expect(screen.getByText('No tenants yet')).toBeTruthy();
    expect(screen.getByText('+ Add tenant')).toBeTruthy();
  });
});
