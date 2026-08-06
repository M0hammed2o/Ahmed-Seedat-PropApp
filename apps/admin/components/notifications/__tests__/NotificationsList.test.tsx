// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AppNotification } from '@propvault/types';
import { NotificationsList } from '../NotificationsList';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const UNREAD: AppNotification = {
  id: 'notification-1',
  userId: 'user-1',
  type: 'rent_overdue',
  title: 'Rent overdue',
  body: 'Unit 1 rent is overdue.',
  relatedEntityType: 'rent_schedule',
  relatedEntityId: 'rent-schedule-1',
  readAt: null,
  createdAt: '2026-08-01T08:00:00Z',
};

describe('NotificationsList', () => {
  it('renders the empty state when there are no notifications', () => {
    render(<NotificationsList notifications={[]} />);
    expect(screen.getByText('No notifications yet')).toBeTruthy();
  });

  it('shows "Mark as read" for an unread notification', () => {
    render(<NotificationsList notifications={[UNREAD]} />);
    expect(screen.getByText('Rent overdue')).toBeTruthy();
    expect(screen.getByText('Mark as read')).toBeTruthy();
  });

  it('hides "Mark as read" for an already-read notification', () => {
    render(<NotificationsList notifications={[{ ...UNREAD, readAt: '2026-08-01T09:00:00Z' }]} />);
    expect(screen.queryByText('Mark as read')).toBeNull();
  });
});
