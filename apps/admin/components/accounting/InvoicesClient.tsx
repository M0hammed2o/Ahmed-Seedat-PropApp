'use client';

import { useRouter } from 'next/navigation';
import { InvoicesFilterClient } from './InvoicesFilterClient';
import type { InvoiceRow } from './InvoicesTable';

// Thin client wrapper to own useRouter().refresh() after "Send invoice" -- the page itself is an
// async server component and can't call hooks directly (same split as RentDueClient).
export function InvoicesClient({ invoices, canSend }: { invoices: InvoiceRow[]; canSend: boolean }) {
  const router = useRouter();
  return (
    <InvoicesFilterClient invoices={invoices} canSend={canSend} onSent={() => router.refresh()} />
  );
}
