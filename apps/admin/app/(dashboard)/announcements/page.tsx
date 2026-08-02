import Link from 'next/link';
import type { Announcement } from '@propvault/types';
import { AnnouncementsTable } from '@/components/tables/AnnouncementsTable';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapAnnouncementRow } from '@/lib/notifications';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'demo-announcement-1',
    orgId: 'demo-org-1',
    propertyId: null,
    title: 'Scheduled water maintenance',
    body: 'Municipal water maintenance is scheduled for this Saturday, 08:00-12:00.',
    requiresAcknowledgement: false,
    publishedAt: '2026-08-01T00:00:00Z',
    expiresAt: null,
    createdAt: '2026-08-01T00:00:00Z',
  },
];

/**
 * GET /announcements -- eleventh module in the M20 sequence (TASKS.md), matching
 * PROPVIEW_SCREENSHOT_AUDIT.md's OPERATIONS nav section (Maintenance, Inspections, Tasks,
 * Vendors, Announcements). Same direct-RLS-read pattern as every list page this milestone.
 */
export default async function AnnouncementsPage() {
  const announcements: Announcement[] = ADMIN_DEMO_MODE ? DEMO_ANNOUNCEMENTS : await loadAnnouncements();
  const canWrite = ADMIN_DEMO_MODE ? true : await resolveCanWrite();

  const addAction = (
    <Link href="/announcements/new">
      <Button variant="primary" size="sm">
        + Publish announcement
      </Button>
    </Link>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Announcements</h1>
        {canWrite && announcements.length > 0 ? addAction : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {announcements.length} published across your portfolio.
      </p>

      <div className="mt-6">
        <AnnouncementsTable data={announcements} emptyAction={canWrite ? addAction : undefined} />
      </div>
    </div>
  );
}

async function loadAnnouncements(): Promise<Announcement[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('published_at', { ascending: false });
  if (error) throw new Error(`Failed to load announcements: ${error.message}`);
  return (data ?? []).map(mapAnnouncementRow);
}

async function resolveCanWrite(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canWriteOrgRecords(membership.role));
}
