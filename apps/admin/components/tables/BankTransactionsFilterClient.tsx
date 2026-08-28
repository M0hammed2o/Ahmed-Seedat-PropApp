'use client';

import type { BankTransaction, RentSchedule, Expense } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { BankTransactionsTable } from './BankTransactionsTable';

export function BankTransactionsFilterClient({
  transactions,
  canPost,
  rentScheduleCandidates,
  pendingExpenseCandidates,
}: {
  transactions: BankTransaction[];
  canPost: boolean;
  rentScheduleCandidates: RentSchedule[];
  pendingExpenseCandidates: Expense[];
}) {
  const { query, setQuery, filtered } = useListSearch(
    transactions,
    (t) => `${t.description ?? ''} ${t.reference ?? ''} ${t.matchStatus}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search transactions by description or reference"
      />
      <BankTransactionsTable
        data={filtered}
        canPost={canPost}
        rentScheduleCandidates={rentScheduleCandidates}
        pendingExpenseCandidates={pendingExpenseCandidates}
      />
    </div>
  );
}
