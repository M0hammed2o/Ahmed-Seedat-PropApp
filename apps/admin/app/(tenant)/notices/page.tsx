import type { Announcement } from '@propvault/types';
import { NoticesList } from '@/components/tenant-portal/NoticesList';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapAnnouncementRow } from '@/lib/notifications';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'demo-tenant-announcement-1',
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

/** GET /notices — tenant portal (V1 scope correction, 2026-08-01, DECISIONS.md). */
export default async function NoticesPage() {
  const { announcements, acknowledgedIds } = ADMIN_DEMO_MODE
    ? { announcements: DEMO_ANNOUNCEMENTS, acknowledgedIds: [] as string[] }
    : await loadNotices();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Notices"
        subtitle="Announcements from your landlord or property manager."
      />

      {announcements.length === 0 ? (
        <EmptyState icon={<span className="text-lg">📣</span>} title="No notices yet" />
      ) : (
        <NoticesList announcements={announcements} acknowledgedIds={acknowledgedIds} />
      )}
    </div>
  );
}

async function loadNotices(): Promise<{
  announcements: Announcement[];
  acknowledgedIds: string[];
}> {
  const supabase = await getServerSupabaseClient();

  const { data: announcementRows, error: announcementError } = await supabase
    .from('announcements')
    .select('*')
    .order('published_at', { ascending: false });
  if (announcementError) throw new Error(`Failed to load notices: ${announcementError.message}`);

  const { data: readRows, error: readError } = await supabase
    .from('announcement_reads')
    .select('announcement_id')
    .not('acknowledged_at', 'is', null);
  if (readError) throw new Error(`Failed to load acknowledgements: ${readError.message}`);

  return {
    announcements: (announcementRows ?? []).map(mapAnnouncementRow),
    acknowledgedIds: (readRows ?? []).map((r) => r.announcement_id as string),
  };
}
