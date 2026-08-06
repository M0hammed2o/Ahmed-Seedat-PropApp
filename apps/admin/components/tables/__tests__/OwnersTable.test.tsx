// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Owner } from '@propvault/types';
import { OwnersTable } from '../OwnersTable';

afterEach(cleanup);

const OWNER: Owner = {
  id: 'owner-1',
  orgId: 'org-1',
  userId: null,
  ownerType: 'individual',
  name: 'Thabo Mokoena',
  email: 'thabo@example.com',
  phone: '+27 83 555 0199',
  bankingRef: null,
  mandateStart: null,
  mandateEnd: null,
  status: 'active',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('OwnersTable', () => {
  it('renders owner rows with type, contact details, and status', () => {
    render(<OwnersTable data={[OWNER]} />);
    expect(screen.getByText('Thabo Mokoena')).toBeTruthy();
    expect(screen.getByText('individual')).toBeTruthy();
    expect(screen.getByText('thabo@example.com')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows Inactive for an inactive owner', () => {
    render(<OwnersTable data={[{ ...OWNER, status: 'inactive' }]} />);
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no owners', () => {
    render(<OwnersTable data={[]} emptyAction={<button>+ Add owner</button>} />);
    expect(screen.getByText('No owners yet')).toBeTruthy();
    expect(screen.getByText('+ Add owner')).toBeTruthy();
  });
});
