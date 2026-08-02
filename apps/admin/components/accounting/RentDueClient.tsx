'use client';

import { useRouter } from 'next/navigation';
import type { RentSchedule } from '@propvault/types';
import { RentScheduleTable } from '@/components/tables/RentScheduleTable';

// Thin client wrapper solely to own useRouter().refresh() as the "an invoice was just issued,
// re-fetch this server-rendered list" callback -- the page itself is an async server component
// and can't call hooks directly.
export function RentDueClient({ data, canPost }: { data: RentSchedule[]; canPost: boolean }) {
  const router = useRouter();
  return <RentScheduleTable data={data} canPost={canPost} onChanged={() => router.refresh()} />;
}
