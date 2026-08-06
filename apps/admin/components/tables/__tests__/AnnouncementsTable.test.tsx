// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Announcement } from '@propvault/types';
import { AnnouncementsTable } from '../AnnouncementsTable';

afterEach(cleanup);

const ANNOUNCEMENT: Announcement = {
  id: 'announcement-1',
  orgId: 'org-1',
  propertyId: null,
  title: 'Scheduled water maintenance',
  body: 'Municipal water maintenance is scheduled for this Saturday.',
  requiresAcknowledgement: false,
  publishedAt: '2026-08-01T00:00:00Z',
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00Z',
};

describe('AnnouncementsTable', () => {
  it('renders announcement rows with "Never" for no expiry and "Not required" for no acknowledgement', () => {
    render(<AnnouncementsTable data={[ANNOUNCEMENT]} />);
    expect(screen.getByText('Scheduled water maintenance')).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
    expect(screen.getByText('Not required')).toBeTruthy();
  });

  it('renders an expiry date and "Required" when set', () => {
    render(
      <AnnouncementsTable
        data={[
          { ...ANNOUNCEMENT, requiresAcknowledgement: true, expiresAt: '2026-09-01T00:00:00Z' },
        ]}
      />,
    );
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.queryByText('Never')).toBeNull();
  });

  it('renders the empty state with the custom action when there are no announcements', () => {
    render(<AnnouncementsTable data={[]} emptyAction={<button>+ Publish announcement</button>} />);
    expect(screen.getByText('No announcements yet')).toBeTruthy();
    expect(screen.getByText('+ Publish announcement')).toBeTruthy();
  });
});
