'use client';

import { useRouter } from 'next/navigation';
import type { RentSchedule } from '@propvault/types';
import { RentScheduleTable } from '@/components/tables/RentScheduleTable';

// Thin client wrapper to own useRouter().refresh() as the invoice-issued re-fetch callback --
// same pattern as RentDueClient (components/accounting/RentDueClient.tsx), just without its search
// box (a single lease's schedule is short enough not to need one).
export function LeaseRentScheduleClient({
  data,
  canPost,
}: {
  data: RentSchedule[];
  canPost: boolean;
}) {
  const router = useRouter();
  return <RentScheduleTable data={data} canPost={canPost} onChanged={() => router.refresh()} />;
}
