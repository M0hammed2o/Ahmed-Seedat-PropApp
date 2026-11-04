// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppNotification } from '@propvault/types';
import { NotificationsFilterClient } from '../NotificationsFilterClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const note = (id: string, title: string): AppNotification => ({
  id,
  userId: 'user-1',
  type: 'utility_alert',
  title,
  body: null,
  relatedEntityType: 'utility_alerts',
  relatedEntityId: `alert-${id}`,
  readAt: '2026-11-03T08:00:00Z',
  createdAt: '2026-11-03T08:00:00Z',
});

const NOTES = [note('n1', 'Possible leak on Unit 4'), note('n2', 'Meter DEMO-E-101 is offline')];

describe('NotificationsFilterClient', () => {
  it('lists active notifications by default and resolved-alert ones under their own tab', () => {
    render(<NotificationsFilterClient notifications={NOTES} resolvedIds={['n2']} />);
    expect(screen.getByText('Possible leak on Unit 4')).toBeTruthy();
    expect(screen.queryByText('Meter DEMO-E-101 is offline')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Resolved alerts (1)' }));
    expect(screen.getByText('Meter DEMO-E-101 is offline')).toBeTruthy();
    expect(screen.queryByText('Possible leak on Unit 4')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Active (1)' }));
    expect(screen.getByText('Possible leak on Unit 4')).toBeTruthy();
  });

  it('shows no tabs and every notification when nothing is resolved', () => {
    render(<NotificationsFilterClient notifications={NOTES} />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Possible leak on Unit 4')).toBeTruthy();
    expect(screen.getByText('Meter DEMO-E-101 is offline')).toBeTruthy();
  });
});
