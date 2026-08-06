// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Announcement } from '@propvault/types';
import { NoticesList } from '../NoticesList';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const REQUIRES_ACK: Announcement = {
  id: 'announcement-1',
  orgId: 'org-1',
  propertyId: null,
  title: 'Scheduled water maintenance',
  body: 'Water maintenance this Saturday.',
  requiresAcknowledgement: true,
  publishedAt: '2026-08-01T00:00:00Z',
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00Z',
};

describe('NoticesList', () => {
  it('shows an Acknowledge button for a notice requiring acknowledgement that has not been acknowledged', () => {
    render(<NoticesList announcements={[REQUIRES_ACK]} acknowledgedIds={[]} />);
    expect(screen.getByText('Scheduled water maintenance')).toBeTruthy();
    expect(screen.getByText('Acknowledge')).toBeTruthy();
  });

  it('shows "Acknowledged" instead of a button when already acknowledged', () => {
    render(<NoticesList announcements={[REQUIRES_ACK]} acknowledgedIds={['announcement-1']} />);
    expect(screen.getByText('Acknowledged')).toBeTruthy();
    expect(screen.queryByText('Acknowledge')).toBeNull();
  });

  it('does not show an acknowledgement control for a notice that does not require one', () => {
    render(
      <NoticesList
        announcements={[{ ...REQUIRES_ACK, requiresAcknowledgement: false }]}
        acknowledgedIds={[]}
      />,
    );
    expect(screen.queryByText('Acknowledge')).toBeNull();
    expect(screen.queryByText('Acknowledged')).toBeNull();
  });
});
